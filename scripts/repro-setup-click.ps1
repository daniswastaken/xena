# Repro bug: real-mouse click on setup yes button.
# 1. boot app (no .firstrun) with CDP
# 2. wait for setup-ui visible
# 3. query button screen rect via CDP (element rect + window position)
# 4. real mouse_event click
# 5. check ask-key step appears
param([string]$Exe = "C:\Users\daniswastaken\Documents\project-xena\apps\stage-xena\release\win-unpacked\Xena.exe")
Add-Type -AssemblyName System.Windows.Forms
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class MR {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  public struct RECT { public int L, T, R, B; }
  public const uint LEFTDOWN = 0x02, LEFTUP = 0x04;
}
'@
$ws = $null
function CdpInit {
  $targets = Invoke-RestMethod -Uri "http://127.0.0.1:9223/json" -TimeoutSec 10
  $t = $targets | Where-Object { $_.title -eq "Xena" -and $_.webSocketDebuggerUrl }
  if (-not $t) { return $false }
  $script:ws = New-Object System.Net.WebSockets.ClientWebSocket
  $script:ct = New-Object System.Threading.CancellationToken
  $script:ws.ConnectAsync([Uri]$t.webSocketDebuggerUrl, $script:ct).Wait()
  $script:seq = 0
  return $true
}
function Cdp {
  param([string]$Method, $Params, [switch]$FireAndForget)
  $script:seq++
  $id = $script:seq
  $payload = @{ id = $id; method = $Method; params = $Params } | ConvertTo-Json -Depth 6 -Compress
  $bytes = [Text.Encoding]::UTF8.GetBytes($payload)
  $null = $script:ws.SendAsync([ArraySegment[byte]]::new($bytes), [System.Net.WebSockets.WebSocketMessageType]::Text, $true, $script:ct).Wait()
  if ($FireAndForget) { return $null }
  $buf = New-Object byte[] 262144
  while ($true) {
    $res = $script:ws.ReceiveAsync([ArraySegment[byte]]::new($buf), $script:ct)
    $null = $res.Wait()
    $text = [Text.Encoding]::UTF8.GetString($buf, 0, $res.Result.Count)
    $msg = $text | ConvertFrom-Json
    if ($msg.id -eq $id) { return $msg }
  }
}
function Eval {
  param([string]$expr)
  $r = Cdp "Runtime.evaluate" @{ expression = $expr; returnByValue = $true }
  if ($r.result -and $r.result.result) { return [string]$r.result.result.value }
  return ""
}

Remove-Item "$env:APPDATA\Xena\data\.firstrun", "$env:APPDATA\@xena\stage-xena\data\.firstrun" -Force -ErrorAction SilentlyContinue
$env:XENA_CDP = "1"
$env:XENA_LOG = "1"
Start-Process -FilePath $Exe
Start-Sleep -Seconds 40
if (-not (CdpInit)) { Write-Host "FAIL: no CDP"; exit 1 }
$null = Cdp "Runtime.enable" @{} -FireAndForget
# wait for setup-ui visible
$deadline = (Get-Date).AddSeconds(30)
$vis = $false
while ((Get-Date) -lt $deadline) {
  $v = Eval "(() => { const u = document.getElementById('setup-ui'); return u ? !u.classList.contains('hidden') : false; })()"
  if ($v -eq "True") { $vis = $true; break }
  Start-Sleep -Seconds 2
}
Write-Host "setup-ui visible: $vis"
if (-not $vis) { exit 1 }
# button rect in page coords
$rectJson = Eval "(() => { const b = document.getElementById('setup-yes'); const r = b.getBoundingClientRect(); return JSON.stringify({ x: r.x + r.width/2, y: r.y + r.height/2 }); })()"
Write-Host "btn page center: $rectJson"
$rect = $rectJson | ConvertFrom-Json
# window position on screen: find the Electron avatar window by bounds 460x400
$p = Get-Process Xena -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $p) { Write-Host "FAIL: no windowed Xena proc"; exit 1 }
$r2 = New-Object MR+RECT
[MR]::GetWindowRect($p.MainWindowHandle, [ref]$r2) | Out-Null
Write-Host "window rect: $($r2.L),$($r2.T) - $($r2.R),$($r2.B)"
[MR]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
Start-Sleep -Seconds 1
# DIP vs pixel scaling: assume 100% (laptop) — compute screen point
$sx = [int]($r2.L + $rect.x)
$sy = [int]($r2.T + $rect.y)
Write-Host "clicking at $sx,$sy"
[MR]::SetCursorPos($sx, $sy) | Out-Null
Start-Sleep -Milliseconds 400
[MR]::mouse_event([MR]::LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
[MR]::mouse_event([MR]::LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Seconds 3
# did ask-key step appear?
$row = Eval "(() => { const row = document.getElementById('setup-key-row'); return row ? (!row.classList.contains('hidden') ? 'visible' : 'hidden') : 'no-row'; })()"
Write-Host "key row after real click: $row"
# also probe elementFromPoint under the click to see what's on top
$top = Eval "(() => { const el = document.elementFromPoint($($rect.x), $($rect.y)); return el ? (el.id || el.tagName) : 'nothing'; })()"
Write-Host "elementFromPoint at button center: $top"
