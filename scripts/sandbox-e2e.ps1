# Xena Sandbox E2E v5 --- run INSIDE Windows Sandbox.
# Adds: CDP bubble chat (no key + with Gemini key), rapid-send stress.
$ErrorActionPreference = "Continue"
$setup = "C:\Shared\Xena-setup-0.6.0.exe"
if (-not (Test-Path $setup)) { Write-Output "E2E FAIL: installer not found at $setup"; exit 1 }

function Probe-9Router {
  try { Invoke-RestMethod -Uri "http://127.0.0.1:20129/v1/models" -TimeoutSec 6 | Out-Null; return $true } catch { return $false }
}

# --- CDP over raw ClientWebSocket (PS 5.1 has no websocket client cmdlet) ---
$script:cdpSeq = 0
function Open-Cdp {
  param([string]$Title)
  $targets = Invoke-RestMethod -Uri "http://127.0.0.1:9223/json" -TimeoutSec 10
  $t = $targets | Where-Object { $_.title -eq $Title -and $_.webSocketDebuggerUrl }
  if (-not $t) { return $null }
  $ws = New-Object System.Net.WebSockets.ClientWebSocket
  $ct = New-Object System.Threading.CancellationToken
  $ws.ConnectAsync([Uri]$t.webSocketDebuggerUrl, $ct).Wait()
  return @{ ws = $ws; ct = $ct }
}
function Invoke-Cdp {
  param($Session, [string]$Method, $Params)
  $script:cdpSeq++
  $id = $script:cdpSeq
  $payload = @{ id = $id; method = $Method; params = $Params } | ConvertTo-Json -Depth 6 -Compress
  $bytes = [Text.Encoding]::UTF8.GetBytes($payload)
  $null = $Session.ws.SendAsync([ArraySegment[byte]]::new($bytes), [System.Net.WebSockets.WebSocketMessageType]::Text, $true, $Session.ct).Wait()
  $buf = New-Object byte[] 262144
  while ($true) {
    $res = $Session.ws.ReceiveAsync([ArraySegment[byte]]::new($buf), $Session.ct)
    $null = $res.Wait()
    $text = [Text.Encoding]::UTF8.GetString($buf, 0, $res.Result.Count)
    $msg = $text | ConvertFrom-Json
    if ($msg.id -eq $id) { return $msg }
  }
}
function Send-Chat-And-Wait-Bubble {
  param([string]$Message, [string]$Expect, [int]$TimeoutSec = 60)
  $s = Open-Cdp -Title "Xena"
  if (-not $s) { Write-Output "E2E FAIL: no CDP target"; return $false }
  $null = Invoke-Cdp $s "Runtime.enable" @{}
  # Fire-and-forget send (NO awaitPromise: the reply stream takes a while and
  # we want the poll loop below to watch the bubble LIVE, not after the fact).
  $expr = "window.xena.sendChat(" + ($Message | ConvertTo-Json) + ").then(function(){return 'ok'},function(e){return 'rej:' + e}); 'fired'"
  $send = Invoke-Cdp $s "Runtime.evaluate" @{ expression = $expr; returnByValue = $true }
  $sendVal = ""
  if ($send.result -and $send.result.result) { $sendVal = [string]$send.result.result.value }
  Write-Output ("send eval: " + $sendVal)
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  $last = ""
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 3
    $r = Invoke-Cdp $s "Runtime.evaluate" @{ expression = "(() => { const b = document.getElementById('bubble'); const t = document.getElementById('bubble-text'); return (t ? t.textContent : (b ? b.textContent : 'NOBUBBLE')) ; })()"; returnByValue = $true }
    $text = ""
    if ($r.result -and $r.result.result) { $text = [string]$r.result.result.value }
    if ($text) { $last = $text }
    if ($text -match [regex]::Escape($Expect)) {
      $flat = $text.Trim() -replace '\s+', ' '
      Write-Output "bubble reply captured: $flat"
      $null = $s.ws.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, "done", $s.ct).Wait()
      return $true
    }
  }
  Write-Output "E2E FAIL: bubble never contained '$Expect' (last: $last)"
  $null = $s.ws.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, "done", $s.ct).Wait()
  return $false
}

Write-Output "== Stage 0: silent install =="
$p = Start-Process -FilePath $setup -ArgumentList "/S" -Wait -PassThru
Write-Output "installer exit: $($p.ExitCode)"
$exe = @("$env:LOCALAPPDATA\Programs\Xena\Xena.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $exe) { Write-Output "E2E FAIL: Xena.exe not found"; exit 1 }
Write-Output "exe: $exe"

Write-Output "== Stage A: first boot, NO Gemini key, bubble chat =="
$dataDir = "$env:APPDATA\Xena\data"
New-Item -ItemType Directory -Force $dataDir | Out-Null
Set-Content -Path "$dataDir\.firstrun" -Value "sandbox-e2e" -Encoding ASCII
$env:XENA_CDP = "1"
$env:XENA_LOG = "1"
Start-Process -FilePath $exe
Start-Sleep -Seconds 75
$logSrc = "$env:APPDATA\Xena\xena-main.log"
if (Test-Path $logSrc) { Copy-Item $logSrc "C:\Shared\xena-main.log" -Force }
$up = Probe-9Router
Write-Output "9router child up: $up"
if (-not $up) { Write-Output "E2E FAIL: 9router never came up"; exit 1 }

$okA = Send-Chat-And-Wait-Bubble -Message "Reply with exactly: SANDBOX_OK" -Expect "SANDBOX_OK" -TimeoutSec 150
Write-Output "Stage A bubble chat: $okA"
if (Test-Path $logSrc) { Copy-Item $logSrc "C:\Shared\xena-main.log" -Force }
if (-not $okA) { Get-Content $logSrc -ErrorAction SilentlyContinue | Select-Object -Last 20 | ForEach-Object { Write-Output $_ }; exit 1 }
$providerA = (Select-String -Path "C:\Shared\xena-main.log" -Pattern "reply done via (\S+)" | Select-Object -Last 1).Matches.Groups[1].Value
Write-Output "Stage A provider: $providerA"

Write-Output "== Stage B: kill 9router child, verify respawn =="
$killed = 0
Get-CimInstance Win32_Process -Filter "Name='Xena.exe'" | Where-Object { $_.CommandLine -match "cli\.js" } | ForEach-Object {
  taskkill /PID $($_.ProcessId) /T /F | Out-Null; $killed++
}
Write-Output "killed: $killed"
if ($killed -eq 0) { Write-Output "E2E FAIL: no child found to kill"; exit 1 }
$recovered = $false
for ($i = 0; $i -lt 30; $i++) { Start-Sleep -Seconds 5; if (Probe-9Router) { $recovered = $true; break } }
Write-Output "auto-recovery respawn: $recovered"
if (-not $recovered) { Write-Output "E2E FAIL: no respawn"; exit 1 }

Write-Output "== Stage C: stress --- 3 rapid sends, all must land =="
# Oracle: log-line counting, not bubble echo — the persona refuses to
# parrot literal markers on demand, so we count [chat] reply-done lines.
if (Test-Path $logSrc) { Copy-Item $logSrc "C:\Shared\xena-main.log" -Force }
$donesBefore = @((Get-Content "C:\Shared\xena-main.log" -ErrorAction SilentlyContinue) | Select-String "reply done via").Count
$s = Open-Cdp -Title "Xena"
$null = Invoke-Cdp $s "Runtime.enable" @{}
foreach ($n in 1..3) {
  $msg = 'Reply with exactly: STRESS' + $n
  $expr = 'window.xena.sendChat(' + ($msg | ConvertTo-Json) + '); "sent"'
  $null = Invoke-Cdp $s "Runtime.evaluate" @{ expression = $expr; returnByValue = $true }
}
$deadline = (Get-Date).AddSeconds(180)
$stressOk = $false
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Seconds 5
  if (Test-Path $logSrc) { Copy-Item $logSrc "C:\Shared\xena-main.log" -Force }
  $dones = @((Get-Content "C:\Shared\xena-main.log" -ErrorAction SilentlyContinue) | Select-String "reply done via").Count
  if (($dones - $donesBefore) -ge 3) { $stressOk = $true; break }
}
Write-Output "stress (3 rapid sends, 3 reply-dones in log): $stressOk"
$null = $s.ws.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, "done", $s.ct).Wait()
if (-not $stressOk) { Write-Output "E2E FAIL: stress sends lost"; exit 1 }

Write-Output "== Stage D: relaunch WITH Gemini key, bubble chat =="
Get-Process Xena -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 5
@{ voiceEnabled = $true; proactiveEnabled = $true; shakeEnabled = $true; avatarEnabled = $true; autostartEnabled = $false; ambientEnabled = $false; textModel = ""; geminiApiKey = "AIzaSyD0OS-zrUsyIV05lzwZ9w55yLg3U-Vnlps" } | ConvertTo-Json | Set-Content -Path "$dataDir\settings.json" -Encoding ASCII
Start-Process -FilePath $exe
Start-Sleep -Seconds 75
$up2 = Probe-9Router
Write-Output "9router child up (relaunch): $up2"
$okD = Send-Chat-And-Wait-Bubble -Message "Reply with exactly: GEMINI_OK" -Expect "GEMINI_OK" -TimeoutSec 150
Write-Output "Stage D bubble chat (with key): $okD"
if (Test-Path $logSrc) { Copy-Item $logSrc "C:\Shared\xena-main-withkey.log" -Force }
if ($okD) {
  $providerD = (Select-String -Path "C:\Shared\xena-main-withkey.log" -Pattern "reply done via (\S+)" | Select-Object -Last 1).Matches.Groups[1].Value
  Write-Output "Stage D provider: $providerD"
  if ($providerD -notmatch "^gemini") { Write-Output "E2E FAIL: with-key boot did not use Gemini ($providerD)"; exit 1 }
}

Write-Output "== Stage E: footprint =="
$procs = Get-Process Xena -ErrorAction SilentlyContinue
$total = ($procs | Measure-Object WorkingSet64 -Sum).Sum / 1MB
Write-Output ("procs: {0}, working set total: {1:N0} MB" -f @($procs).Count, $total)

if (-not $okD) { Write-Output "E2E PARTIAL: no-key path green, with-key failed"; exit 1 }
Write-Output "E2E DONE --- all stages green"
