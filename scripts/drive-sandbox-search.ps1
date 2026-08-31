param([string]$Target = "C:\Shared\run-e2e.cmd")
# Click taskbar Search box (left of Start area), type target path, Enter.
Add-Type -AssemblyName System.Windows.Forms
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class WA {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
  public struct RECT { public int L, T, R, B; }
  public const uint LEFTDOWN = 0x02, LEFTUP = 0x04;
}
'@
$p = Get-Process WindowsSandboxClient -ErrorAction SilentlyContinue
if (-not $p) { Write-Output "FAIL: no sandbox window"; exit 1 }
[WA]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
Start-Sleep -Seconds 2
# Close stray windows.
[System.Windows.Forms.SendKeys]::SendWait("{ESC}")
Start-Sleep -Milliseconds 500
$r = New-Object WA+RECT
[WA]::GetWindowRect($p.MainWindowHandle, [ref]$r) | Out-Null
# Search box: ~250px right of window-left, near bottom (taskbar height ~48px).
$sx = $r.L + 250
$sy = $r.B - 24
[WA]::SetCursorPos($sx, $sy) | Out-Null
Start-Sleep -Milliseconds 400
[WA]::mouse_event([WA]::LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
[WA]::mouse_event([WA]::LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Seconds 2
[System.Windows.Forms.SendKeys]::SendWait($Target)
Start-Sleep -Seconds 4
[System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
Write-Output "search-launched: $Target"
