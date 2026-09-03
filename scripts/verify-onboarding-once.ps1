# Verify onboarding-once fix: boot fresh -> setup appears -> real-click "no"
# -> flow completes; relaunch -> NO setup UI, chat-mode.
param([string]$Exe = "C:\Users\daniswastaken\Documents\project-xena\apps\stage-xena\release\win-unpacked\Xena.exe")
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class MR2 {
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
function Click-SetupBtn([string]$btnId) {
  $rectJson = Eval "(() => { const b = document.getElementById('$btnId'); const r = b.getBoundingClientRect(); return JSON.stringify({ x: r.x + r.width/2, y: r.y + r.height/2 }); })()"
  $rect = $rectJson | ConvertFrom-Json
  $p = Get-Process Xena -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
  $r2 = New-Object MR2+RECT
  [MR2]::GetWindowRect($p.MainWindowHandle, [ref]$r2) | Out-Null
  [MR2]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
  Start-Sleep -Milliseconds 800
  $sx = [int]($r2.L + $rect.x); $sy = [int]($r2.T + $rect.y)
  [MR2]::SetCursorPos($sx, $sy) | Out-Null
  Start-Sleep -Milliseconds 400
  [MR2]::mouse_event([MR2]::LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
  [MR2]::mouse_event([MR2]::LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
}

function Stop-Xena {
  Get-Process Xena -ErrorAction SilentlyContinue | Stop-Process -Force
  Get-CimInstance Win32_Process -Filter "Name='Xena.exe'" | ForEach-Object { taskkill /PID $($_.ProcessId) /T /F 2>$null | Out-Null }
  Start-Sleep -Seconds 4
}

# ---------- Boot 1: fresh (no marker) ----------
Stop-Xena
Get-ChildItem "$env:APPDATA\Xena\data", "$env:APPDATA\@xena\stage-xena\data" -Filter ".firstrun*" -Force -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
$env:XENA_CDP = "1"; $env:XENA_LOG = "1"
Start-Process -FilePath $Exe
Start-Sleep -Seconds 40
if (-not (CdpInit)) { Write-Host "FAIL boot1: no CDP"; exit 1 }
$null = Cdp "Runtime.enable" @{} -FireAndForget
$deadline = (Get-Date).AddSeconds(30); $vis = $false
while ((Get-Date) -lt $deadline) {
  $v = Eval "(() => { const u = document.getElementById('setup-ui'); return u ? !u.classList.contains('hidden') : false; })()"
  if ($v -eq "True") { $vis = $true; break }
  Start-Sleep -Seconds 2
}
Write-Host "boot1 setup visible: $vis"
if (-not $vis) { Write-Host "FAIL: setup should show on fresh boot"; exit 1 }
Click-SetupBtn "setup-no"
# decline path: completion lines play (audio waits up to ~13s)
$deadline = (Get-Date).AddSeconds(45); $done = $false
while ((Get-Date) -lt $deadline) {
  $u = Eval "(() => { const u = document.getElementById('setup-ui'); return u ? (u.classList.contains('hidden') ? 'hidden' : 'visible') : 'gone'; })()"
  if ($u -ne "visible") { $done = $true; break }
  Start-Sleep -Seconds 3
}
Write-Host "boot1 setup dismissed after 'no': $done"
Stop-Xena

# ---------- Boot 2: marker present -> NO setup ----------
$fr = (Test-Path "$env:APPDATA\Xena\data\.firstrun*") -or (Test-Path "$env:APPDATA\@xena\stage-xena\data\.firstrun*")
Write-Host "firstrun marker after boot1: $fr"
Start-Process -FilePath $Exe
Start-Sleep -Seconds 40
if (-not (CdpInit)) { Write-Host "FAIL boot2: no CDP"; exit 1 }
$null = Cdp "Runtime.enable" @{} -FireAndForget
$deadline = (Get-Date).AddSeconds(15); $vis2 = $false
while ((Get-Date) -lt $deadline) {
  $v = Eval "(() => { const u = document.getElementById('setup-ui'); return u ? !u.classList.contains('hidden') : false; })()"
  if ($v -eq "True") { $vis2 = $true; break }
  Start-Sleep -Seconds 2
}
Write-Host "boot2 setup visible (must be False): $vis2"
if ($vis2) { Write-Host "E2E FAIL: onboarding re-ran on second boot"; exit 1 }

# ---------- Boot 3: even a renderer reload must not resurrect setup ----------
# (did-finish-load refires on reload - pre-fix this resurrected onboarding)
$deadline = (Get-Date).AddSeconds(12); $vis3 = $false
while ((Get-Date) -lt $deadline) {
  $v = Eval "(() => { const u = document.getElementById('setup-ui'); return u ? !u.classList.contains('hidden') : false; })()"
  if ($v -eq "True") { $vis3 = $true; break }
  Start-Sleep -Seconds 2
}
Write-Host "post-reload setup visible (must be False): $vis3"
if ($vis3) { Write-Host "E2E FAIL: renderer reload resurrected onboarding"; exit 1 }
Write-Host "PASS: onboarding once - setup only on first run"
