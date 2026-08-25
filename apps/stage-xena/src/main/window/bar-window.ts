/**
 * Bar window: small transparent summon-bar surface. Lives independently
 * from the avatar window so shake-summon moves ONLY the bar.
 */
import { app, BrowserWindow, screen } from "electron";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { CHANNELS } from "../ipc/channels.js";

export const BAR_WIDTH = 380;
export const BAR_IDLE_HEIGHT = 72;
export const BAR_MAX_HEIGHT = 400;

export class BarWindow {
  readonly win: BrowserWindow;
  private home = { x: 0, y: 0 };
  private away = false;
  private shownAt = 0;

  constructor(avatarHome: { x: number; y: number }) {
    const { workArea } = screen.getPrimaryDisplay();
    // Bar bottom sits just above the avatar's head.
    this.home = {
      x: avatarHome.x - (BAR_WIDTH - 188) + 8,
      y: avatarHome.y - BAR_IDLE_HEIGHT - 8,
    };
    this.win = new BrowserWindow({
      width: BAR_WIDTH,
      height: BAR_IDLE_HEIGHT,
      x: this.home.x,
      y: this.home.y,
      transparent: true,
      frame: false,
      hasShadow: false,
      backgroundColor: "#00000000",
      roundedCorners: false,
      resizable: false,
      movable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      show: false,
      focusable: true,
      webPreferences: {
        preload: join(__dirname, "../preload/index.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        backgroundThrottling: false,
      },
    });
    this.win.setAlwaysOnTop(true, "screen-saver");
    this.win.loadFile(join(__dirname, "../renderer/bar.html"));
    this.win.setIgnoreMouseEvents(true, { forward: true });

    void this.win.webContents.ipc.on(CHANNELS.setClickThrough, (_event, interactive: unknown) => {
      if (typeof interactive === "boolean") {
        this.win.setIgnoreMouseEvents(!interactive, { forward: true });
      }
    });
    void this.win.webContents.ipc.on(CHANNELS.barDismissed, () => this.hide());
    void this.win.webContents.ipc.on(CHANNELS.barResize, (_e: unknown, h: unknown) => {
      if (typeof h === "number" && h > 0) this.resizeTo(h);
    });

    this.win.on("blur", () => {
      if (!this.win.isVisible()) return;
      if (Date.now() - this.shownAt < 600) return;
      this.hide();
    });
  }

  /** Bar above the avatar. */
  summonCorner(): void {
    if (this.away) this.restoreIdleSize();
    this.win.setPosition(this.home.x, this.home.y, false);
    this.away = false;
    this.show();
  }

  /** Bar centered on the cursor: bar center == cursor point. */
  summonAtCursor(x: number, y: number): void {
    if (this.away) this.restoreIdleSize();
    const { workArea } = screen.getPrimaryDisplay();
    const wx = Math.round(
      Math.max(workArea.x + 4, Math.min(x - BAR_WIDTH / 2, workArea.x + workArea.width - BAR_WIDTH - 4)),
    );
    // Bar is bottom-anchored and ~44px tall centered at ~36px from bottom.
    // wy + height - 34 == y  =>  wy == y - height + 34
    const wy = Math.round(
      Math.max(
        workArea.y + 4,
        Math.min(y - (BAR_IDLE_HEIGHT - 34), workArea.y + workArea.height - BAR_IDLE_HEIGHT - 4),
      ),
    );
    this.win.setPosition(wx, wy, false);
    this.away = true;
    this.show();
  }

  hide(): void {
    this.win.hide();
    this.win.setIgnoreMouseEvents(true, { forward: true });
    this.restoreIdleSize();
    if (this.away) {
      this.win.setPosition(this.home.x, this.home.y, false);
      this.away = false;
    }
  }

  private resizeTo(height: number): void {
    const h = Math.max(BAR_IDLE_HEIGHT, Math.min(BAR_MAX_HEIGHT, Math.round(height)));
    const b = this.win.getBounds();
    if (b.height === h) return;
    const dy = h - b.height;
    this.win.setBounds({ x: b.x, y: b.y - dy, width: b.width, height: h }, false);
  }

  private restoreIdleSize(): void {
    const b = this.win.getBounds();
    if (b.height !== BAR_IDLE_HEIGHT) {
      const dy = BAR_IDLE_HEIGHT - b.height;
      this.win.setBounds({ x: b.x, y: b.y - dy, width: BAR_WIDTH, height: BAR_IDLE_HEIGHT }, false);
    }
  }

  private show(): void {
    this.shownAt = Date.now();
    this.win.show();
    this.win.setIgnoreMouseEvents(false);
    try {
      app.focus({ steal: true });
    } catch {}
    const handle = this.win.getNativeWindowHandle();
    // Bypass Windows focus-steal block for synthetic shake summons.
    // Direct user32 SetForegroundWindow via PowerShell is the only
    // reliable path when the summon isn't from a globalShortcut.
    const forceWin32Foreground = () => {
      try {
        const hwnd = handle.readInt32LE(0);
        if (hwnd === 0) return;
        const ps =
          `Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h); [DllImport("user32.dll")] public static extern bool SetFocus(IntPtr h); [DllImport("user32.dll")] public static extern void keybd_event(byte bVk,byte bScan,uint dwFlags,UIntPtr dwExtra);' -Name W -Namespace X; ` +
          `[X.W]::keybd_event(0x12,0,0,[UIntPtr]::Zero); [X.W]::SetForegroundWindow([IntPtr]${hwnd}); [X.W]::SetFocus([IntPtr]${hwnd}); [X.W]::keybd_event(0x12,0,2,[UIntPtr]::Zero)`;
        execFile("powershell.exe", ["-NoProfile", "-WindowStyle", "Hidden", "-Command", ps], { windowsHide: true }, () => {});
      } catch {}
    };
    const doFocus = () => {
      this.win.moveTop();
      this.win.focus();
      // @ts-expect-error win32
      if (typeof this.win.setForegroundWindow === "function") this.win.setForegroundWindow();
      this.win.webContents.focus();
      forceWin32Foreground();
    };
    setTimeout(() => {
      doFocus();
      this.win.webContents.send(CHANNELS.summonAt, { mode: "corner" });
      setTimeout(() => { if (this.win.isVisible()) doFocus(); }, 50);
      setTimeout(() => { if (this.win.isVisible()) doFocus(); }, 200);
      // Verify OS focus landed; if not, retry once more via win32
      setTimeout(() => {
        if (this.win.isVisible() && !this.win.isFocused()) doFocus();
      }, 400);
    }, 15);
  }
}
