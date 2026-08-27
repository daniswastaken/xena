/**
 * Avatar window: transparent, frameless, always-on-top, permanently pinned
 * bottom-right and fully click-through. The avatar never moves.
 */
import { app, BrowserWindow, screen } from "electron";
import { execFile } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CHANNELS } from "../ipc/channels.js";

export const WINDOW_WIDTH = 460;
export const WINDOW_HEIGHT = 400;
export const AVATAR_MARGIN = 0;

export interface AvatarHome {
  x: number;
  y: number;
}

/**
 * Windows keeps the taskbar's reserved space even while it is hidden (e.g. when
 * another app goes fullscreen), so `screen.workArea` does NOT change and a plain
 * metrics listener never fires. We probe the real taskbar visibility directly via
 * the Shell_TrayWnd window and pin to the true screen edge when it is hidden.
 */
const PROBE_SCRIPT = `
param([uint32]$myPid = 0)
$ErrorActionPreference = 'Stop'
$dll = Join-Path $env:TEMP 'xena_fs_probe_v2.dll'
$src = @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public class TaskbarProbe {
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("user32.dll")] static extern int GetSystemMetrics(int n);
  [DllImport("user32.dll")] static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")] static extern int GetClassName(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr hwnd, int dwAttribute, out int pvAttribute, int cbAttribute);

  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L,T,R,B; }

  const int DWMWA_CLOAKED = 14;

  public static string Probe(uint myPid) {
    int sw = GetSystemMetrics(0);
    int sh = GetSystemMetrics(1);
    bool full = false;

    EnumWindows((hWnd, lParam) => {
      if (!IsWindowVisible(hWnd)) return true;

      int cloaked = 0;
      DwmGetWindowAttribute(hWnd, DWMWA_CLOAKED, out cloaked, 4);
      if (cloaked != 0) return true;

      uint pid;
      GetWindowThreadProcessId(hWnd, out pid);
      if (pid == myPid) return true;

      RECT r;
      if (GetWindowRect(hWnd, out r)) {
        if (r.L <= 2 && r.T <= 2 && r.R >= (sw - 2) && r.B >= (sh - 2)) {
          StringBuilder sbTitle = new StringBuilder(256);
          StringBuilder sbClass = new StringBuilder(256);
          GetWindowText(hWnd, sbTitle, 256);
          GetClassName(hWnd, sbClass, 256);
          string title = sbTitle.ToString();
          string cls = sbClass.ToString();
          if (title != "Program Manager" && title != "Desktop" && cls != "Progman" && cls != "WorkerW" && cls != "Shell_TrayWnd") {
            full = true;
            return false;
          }
        }
      }
      return true;
    }, IntPtr.Zero);

    return (full ? "1" : "0") + "|" + sw + "|" + sh;
  }
}
'@
if (-not (Test-Path $dll)) {
  Add-Type -TypeDefinition $src -OutputAssembly $dll -ErrorAction Stop
}
[System.Reflection.Assembly]::LoadFrom($dll) | Out-Null
[TaskbarProbe]::Probe($myPid)
`;

interface TaskbarState {
  visible: boolean;
  screenW: number;
  screenH: number;
}

let probePath: string | null = null;
function getProbePath(): string {
  if (!probePath) {
    probePath = join(app.getPath("temp"), "xena-taskbar-probe.ps1");
    if (!existsSync(probePath)) writeFileSync(probePath, PROBE_SCRIPT, "utf8");
  }
  return probePath;
}

function probeTaskbar(): Promise<TaskbarState> {
  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        getProbePath(),
        "-myPid",
        String(process.pid),
      ],
      { windowsHide: true, timeout: 5000 },
      (err, stdout) => {
        if (err) return resolve({ visible: true, screenW: 0, screenH: 0 });
        const parts = stdout.trim().split("|");
        if (parts.length < 3) return resolve({ visible: true, screenW: 0, screenH: 0 });
        // Probe returns "1" when a visible, uncloaked fullscreen app covers the screen.
        resolve({
          visible: parts[0] !== "1",
          screenW: Number(parts[1]) || 0,
          screenH: Number(parts[2]) || 0,
        });
      },
    );
  });
}

export function createAvatarWindow(): { win: BrowserWindow; home: AvatarHome } {
  const disp = screen.getPrimaryDisplay();
  const home: AvatarHome = {
    x: disp.workArea.x + disp.workArea.width - WINDOW_WIDTH - AVATAR_MARGIN,
    y: disp.workArea.y + disp.workArea.height - WINDOW_HEIGHT - AVATAR_MARGIN,
  };

  let probing = false;
  const onMetricsChanged = (): void => {
    void trackWorkArea();
  };
  const trackWorkArea = async (): Promise<void> => {
    if (probing) return;
    probing = true;
    try {
      const display = screen.getPrimaryDisplay();
      const { visible } = await probeTaskbar();
      // Hidden taskbar (fullscreen app, etc.) => glue to the true screen edge.
      // Visible taskbar => sit above it (work area) so she doesn't overlap it.
      const anchorX = visible
        ? display.workArea.x + display.workArea.width
        : display.bounds.x + display.bounds.width;
      const anchorY = visible
        ? display.workArea.y + display.workArea.height
        : display.bounds.y + display.bounds.height;
      const nx = anchorX - WINDOW_WIDTH - AVATAR_MARGIN;
      const ny = anchorY - WINDOW_HEIGHT - AVATAR_MARGIN;
      if (nx === home.x && ny === home.y) return;
      home.x = nx;
      home.y = ny;
      if (!win.isDestroyed() && win.isVisible()) win.setPosition(nx, ny, false);
    } finally {
      probing = false;
    }
  };

  const win = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    x: home.x,
    y: home.y,
    icon: join(__dirname, "../renderer/assets/app-icon.png"),
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
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });
  win.setAlwaysOnTop(true, "screen-saver");
  win.loadFile(join(__dirname, "../renderer/index.html"));
  win.once("ready-to-show", () => win.showInactive());
  // Click-through by default; the bubble surface flips interactivity
  // on hover (scroll/select/copy) via the renderer.
  win.setIgnoreMouseEvents(true, { forward: true });
  void win.webContents.ipc.on(CHANNELS.setClickThrough, (_e, interactive: unknown) => {
    if (typeof interactive === "boolean") {
      win.setIgnoreMouseEvents(!interactive, { forward: true });
    }
  });
  // Keep Xena glued to the correct corner. The taskbar-visibility probe is the
  // reliable signal (display metrics don't change on fullscreen toggles).
  screen.on("display-metrics-changed", onMetricsChanged);
  const areaTimer = setInterval(() => void trackWorkArea(), 1500);
  win.on("closed", () => {
    screen.removeListener("display-metrics-changed", onMetricsChanged);
    clearInterval(areaTimer);
  });
  // Always-on companion: a crashed renderer comes back on its own.
  win.webContents.on("render-process-gone", (_event, details) => {
    if (details.reason === "clean-exit") return;
    setTimeout(() => {
      if (!win.isDestroyed()) win.webContents.reload();
    }, 1500);
  });
  return { win, home };
}
