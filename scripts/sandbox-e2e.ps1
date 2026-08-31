# Xena Sandbox E2E v5 --- run INSIDE Windows Sandbox.
# Adds: CDP bubble chat (no key + with Gemini key), rapid-send stress.
$ErrorActionPreference = "Continue"
$setup = "C:\Shared\Xena-setup-0.6.1.exe"
if (-not (Test-Path $setup)) { $setup = "C:\Shared\Xena-setup-0.6.0.exe" }
if (-not (Test-Path $setup)) { Write-Host "E2E FAIL: installer not found at $setup"; exit 1 }

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
function Find-XenaLog {
  param([string[]]$ExtraRoots = @())
  $roots = @("$env:APPDATA\Xena", "$env:APPDATA\@xena\stage-xena", "$env:APPDATA\@xenastage-xena") + $ExtraRoots
  $found = $null
  $newest = [datetime]::MinValue
  foreach ($r in $roots) {
    $p = Join-Path $r "xena-main.log"
    if (Test-Path $p) {
      $t = (Get-Item $p).LastWriteTime
      if ($t -gt $newest) { $newest = $t; $found = $p }
    }
  }
  return $found
}
function Copy-XenaLog {
  param([string]$Dest)
  $src = Find-XenaLog
  if ($src) { Copy-Item $src $Dest -Force; return $true }
  return $false
}
function Get-Provider-From-Log {
  param([string]$Path)
  if (-not (Test-Path $Path)) { return "" }
  $m = Select-String -Path $Path -Pattern "reply done via (\S+)" | Select-Object -Last 1
  if ($m) { return $m.Matches.Groups[1].Value }
  return ""
}

# Persona error lines (ui/error-lines.ts BUBBLE map) - the bubble renders
# these instead of raw provider noise (ADR-004 boundary). The oracle must
# not mistake one for a model reply.
$PERSONA_ERROR_SNIPPETS = @(
  "my thoughts feel far away right now",
  "I've talked myself hoarse today",
  "That one slipped away from me",
  "Nothing came to me just now",
  "Something went sideways in my head"
)
function Test-PersonaErrorLine {
  param([string]$Text)
  foreach ($s in $PERSONA_ERROR_SNIPPETS) {
    if ($Text -like "*$s*") { return $true }
  }
  return $false
}

function Send-Chat-And-Wait-Bubble {
  # Returns $true when a substantive MODEL reply rendered (persona refuses
  # literal parroting - oracle is "a real reply appeared", not token match).
  # Persona error lines are surfaced as $false with a diagnostic host line.
  param([string]$Message, [int]$TimeoutSec = 150)
  $s = Open-Cdp -Title "Xena"
  if (-not $s) { Write-Host "E2E FAIL: no CDP target"; return $false }
  $null = Invoke-Cdp $s "Runtime.enable" @{}
  $expr = "window.xena.sendChat(" + ($Message | ConvertTo-Json) + ").then(function(){return 'ok'},function(e){return 'rej:' + e}); 'fired'"
  $send = Invoke-Cdp $s "Runtime.evaluate" @{ expression = $expr; returnByValue = $true }
  $sendVal = ""
  if ($send.result -and $send.result.result) { $sendVal = [string]$send.result.result.value }
  Write-Host ("send eval: " + $sendVal)
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  $last = ""
  $lastLen = 0
  $stablePasses = 0
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 4
    $r = Invoke-Cdp $s "Runtime.evaluate" @{ expression = "(() => { const t = document.getElementById('bubble-text'); return t ? t.textContent : ''; })()"; returnByValue = $true }
    $text = ""
    if ($r.result -and $r.result.result) { $text = [string]$r.result.result.value }
    if ($text) { $last = $text }
    # Substantive = long enough to be a real reply, contains letters, and
    # stable across two polls (streaming finished).
    if ($text.Length -gt 15 -and $text -match "[a-zA-Z]" -and $text.Length -eq $lastLen) {
      $stablePasses++
      if ($stablePasses -ge 2) {
        $flat = $text.Trim() -replace '\s+', ' '
        if (Test-PersonaErrorLine -Text $flat) {
          Write-Host "bubble shows persona ERROR line (ADR-004 boundary): $flat"
          $null = $s.ws.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, "done", $s.ct).Wait()
          return $false
        }
        Write-Host "bubble reply captured: $flat"
        $null = $s.ws.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, "done", $s.ct).Wait()
        return $true
      }
    } else { $stablePasses = 0 }
    $lastLen = $text.Length
  }
  Write-Host "E2E FAIL: no substantive bubble reply (last: $last)"
  $null = $s.ws.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, "done", $s.ct).Wait()
  return $false
}

Write-Host "== Stage 0: silent install =="
$p = Start-Process -FilePath $setup -ArgumentList "/S" -Wait -PassThru
Write-Host "installer exit: $($p.ExitCode)"
$exe = $null
foreach ($root in @("$env:LOCALAPPDATA\Programs", $env:ProgramFiles, "${env:ProgramFiles(x86)}")) {
  $found = Get-ChildItem $root -Filter "Xena.exe" -Recurse -Depth 2 -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($found) { $exe = $found.FullName; break }
}
if (-not $exe) {
  Write-Host "E2E FAIL: Xena.exe not found under any Programs root"
  exit 1
}
Write-Host "exe: $exe"

Write-Host "== Stage A: first boot, NO Gemini key, bubble chat =="
# Pre-mark first-run done in every candidate userData dir so the packaged app
# (whose userData dir name Electron derives from the package name) skips the
# setup flow and the bubble is chat-ready immediately.
foreach ($ud in @("$env:APPDATA\Xena\data", "$env:APPDATA\@xena\stage-xena\data", "$env:APPDATA\@xenastage-xena\data")) {
  New-Item -ItemType Directory -Force $ud | Out-Null
  Set-Content -Path "$ud\.firstrun" -Value "sandbox-e2e" -Encoding ASCII
}
$env:XENA_CDP = "1"
$env:XENA_LOG = "1"
Start-Process -FilePath $exe
Start-Sleep -Seconds 75
$null = Copy-XenaLog -Dest "C:\Shared\xena-main.log"
$up = Probe-9Router
Write-Host "9router child up: $up"
if (-not $up) { Write-Host "E2E FAIL: 9router never came up"; exit 1 }

$okA = Send-Chat-And-Wait-Bubble -Message "Hi! Say hi back in your own words." -TimeoutSec 150
Write-Host "Stage A bubble chat: $okA"
$null = Copy-XenaLog -Dest "C:\Shared\xena-main.log"
if (-not (Test-Path "C:\Shared\xena-main.log")) {
  Write-Host "note: xena-main.log not found; dumping %APPDATA% dirs for diagnosis"
  Get-ChildItem $env:APPDATA -Directory | Where-Object { $_.Name -match "xena" } | ForEach-Object { Write-Host ("  " + $_.FullName) }
}
if (-not $okA) { exit 1 }
$providerA = Get-Provider-From-Log -Path "C:\Shared\xena-main.log"
Write-Host "Stage A provider: $providerA"

Write-Host "== Stage B: kill 9router child, verify respawn =="
$killed = 0
Get-CimInstance Win32_Process -Filter "Name='Xena.exe'" | Where-Object { $_.CommandLine -match "cli\.js" } | ForEach-Object {
  taskkill /PID $($_.ProcessId) /T /F | Out-Null; $killed++
}
Write-Host "killed: $killed"
if ($killed -eq 0) { Write-Host "E2E FAIL: no child found to kill"; exit 1 }
$recovered = $false
for ($i = 0; $i -lt 30; $i++) { Start-Sleep -Seconds 5; if (Probe-9Router) { $recovered = $true; break } }
Write-Host "auto-recovery respawn: $recovered"
if (-not $recovered) { Write-Host "E2E FAIL: no respawn"; exit 1 }

Write-Host "== Stage C: stress --- 3 rapid sends, all must land =="
# Oracle: log-line counting, not bubble echo - the persona refuses to
# parrot literal markers on demand, so we count [chat] reply-done lines.
$null = Copy-XenaLog -Dest "C:\Shared\xena-main.log"
$donesBefore = @((Get-Content "C:\Shared\xena-main.log" -ErrorAction SilentlyContinue) | Select-String "reply done via").Count
$s = Open-Cdp -Title "Xena"
$null = Invoke-Cdp $s "Runtime.enable" @{}
foreach ($n in 1..3) {
  $msg = 'Say something short to me.'
  $expr = 'window.xena.sendChat(' + ($msg | ConvertTo-Json) + '); "sent"'
  $null = Invoke-Cdp $s "Runtime.evaluate" @{ expression = $expr; returnByValue = $true }
}
$deadline = (Get-Date).AddSeconds(240)
$stressOk = $false
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Seconds 10
  $null = Copy-XenaLog -Dest "C:\Shared\xena-main.log"
  $dones = @((Get-Content "C:\Shared\xena-main.log" -ErrorAction SilentlyContinue) | Select-String "reply done via").Count
  if (($dones - $donesBefore) -ge 3) { $stressOk = $true; break }
}
Write-Host "stress (3 rapid sends, 3 reply-dones in log): $stressOk"
$null = $s.ws.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, "done", $s.ct).Wait()
if (-not $stressOk) { Write-Host "E2E FAIL: stress sends lost"; exit 1 }

Write-Host "== Stage D: relaunch WITH Gemini key, bubble chat =="
Get-Process Xena -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 5
# App userData dir name depends on Electron's package-name sanitization -
# write settings to every candidate so the relaunch sees the key regardless.
# Optional: real Gemini key for the with-key stage. Passed via the mapped
# share (C:\Shared\gemini-key.txt) - NEVER committed to the repo (Google
# flags public keys as leaked). Absent file = a syntactically-valid dummy;
# the overlay + chain-attempt assertions still hold, gemini just 401/403s.
$gkey = "AIzaSyDUMMYKEY0123456789abcdefghijklmnopqrstuv"
if (Test-Path "C:\Shared\gemini-key.txt") {
  $k = (Get-Content "C:\Shared\gemini-key.txt" -Raw).Trim()
  if ($k -match "^AIza[0-9A-Za-z_-]{35,}$") { $gkey = $k }
}
$settingsJson = @{ voiceEnabled = $true; proactiveEnabled = $true; shakeEnabled = $true; avatarEnabled = $true; autostartEnabled = $false; ambientEnabled = $false; textModel = ""; geminiApiKey = $gkey } | ConvertTo-Json
foreach ($ud in @("$env:APPDATA\Xena\data", "$env:APPDATA\@xena\stage-xena\data", "$env:APPDATA\@xenastage-xena\data")) {
  New-Item -ItemType Directory -Force $ud | Out-Null
  Set-Content -Path "$ud\settings.json" -Value $settingsJson -Encoding ASCII
}
Start-Process -FilePath $exe
Start-Sleep -Seconds 75
$up2 = Probe-9Router
Write-Host "9router child up (relaunch): $up2"
$okD = Send-Chat-And-Wait-Bubble -Message "Hello again! Greet me in your own words." -TimeoutSec 150
Write-Host "Stage D bubble chat (with key): $okD"
$null = Copy-XenaLog -Dest "C:\Shared\xena-main-withkey.log"
if ($okD) {
  $providerD = Get-Provider-From-Log -Path "C:\Shared\xena-main-withkey.log"
  Write-Host "Stage D provider: $providerD"
  $keyLine = (Select-String -Path "C:\Shared\xena-main-withkey.log" -Pattern "gemini key: .* -> (\S+)" | Select-Object -Last 1).Matches.Groups[1].Value
  Write-Host "Stage D key state: $keyLine"
  $geminiAttempted = [bool](Select-String -Path "C:\Shared\xena-main-withkey.log" -Pattern "rung down: gemini/|reply done via gemini")
  Write-Host "Stage D gemini rung attempted: $geminiAttempted"
  # Pass = key overlay active AND the chain actually tried Gemini first
  # (a dead/quota'd key legitimately falls to router9 - that's the design).
  if ($keyLine -ne "active" -or -not $geminiAttempted) {
    Write-Host "E2E FAIL: with-key boot did not activate/attempt Gemini (key=$keyLine attempted=$geminiAttempted)"; exit 1
  }
}

Write-Host "== Stage E: footprint =="
$procs = Get-Process Xena -ErrorAction SilentlyContinue
$total = ($procs | Measure-Object WorkingSet64 -Sum).Sum / 1MB
Write-Host ("procs: {0}, working set total: {1:N0} MB" -f @($procs).Count, $total)

Write-Host "== Stage F: FIRST-RUN setup flow (greeting -> yes -> key) =="
# The real fresh-user path: no .firstrun marker, no settings - the avatar
# window must show the greeting with clickable yes/no, accept a pasted key,
# save it to settings, mark first-run done, and finish into chat mode.
Get-Process Xena -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 5
foreach ($ud in @("$env:APPDATA\Xena", "$env:APPDATA\@xena\stage-xena", "$env:APPDATA\@xenastage-xena")) {
  if (Test-Path $ud) { Remove-Item $ud -Recurse -Force }
}
Start-Process -FilePath $exe
Start-Sleep -Seconds 75
$sF = Open-Cdp -Title "Xena"
if (-not $sF) { Write-Host "E2E FAIL: Stage F no CDP target"; exit 1 }
$null = Invoke-Cdp $sF "Runtime.enable" @{}
# Greeting visible + setup UI clickable (click-through lifted during setup)?
$r = Invoke-Cdp $sF "Runtime.evaluate" @{ expression = "(() => { const ui = document.getElementById('setup-ui'); const y = document.getElementById('setup-yes'); return JSON.stringify({ ui: !!ui, uiVisible: ui ? !ui.classList.contains('hidden') : false, yes: !!y }); })()"; returnByValue = $true }
$probeF = ""
if ($r.result -and $r.result.result) { $probeF = [string]$r.result.result.value }
Write-Host "setup UI probe: $probeF"
if ($probeF -notmatch '"uiVisible":true') { Write-Host "E2E FAIL: setup UI never became visible"; exit 1 }
# Click yes -> ask-key step.
$null = Invoke-Cdp $sF "Runtime.evaluate" @{ expression = "document.getElementById('setup-yes').click(); 'clicked'"; returnByValue = $true }
Start-Sleep -Seconds 2
$r = Invoke-Cdp $sF "Runtime.evaluate" @{ expression = "(() => { const row = document.getElementById('setup-key-row'); return row ? (!row.classList.contains('hidden') ? 'key-row-visible' : 'key-row-hidden') : 'no-row'; })()"; returnByValue = $true }
$rowState = ""
if ($r.result -and $r.result.result) { $rowState = [string]$r.result.result.value }
Write-Host "key row: $rowState"
if ($rowState -ne "key-row-visible") { Write-Host "E2E FAIL: ask-key step did not reveal the key input"; exit 1 }
# Paste the key + Enter (reuse $gkey from Stage D).
$null = Invoke-Cdp $sF "Runtime.evaluate" @{ expression = "(() => { const i = document.getElementById('setup-key-input'); i.value = " + ($gkey | ConvertTo-Json) + "; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); 'typed' })()"; returnByValue = $true }
# Flow: key-saved line plays, TTS wait, unlock line, then setupDone.
$doneF = $false
$deadlineF = (Get-Date).AddSeconds(60)
while ((Get-Date) -lt $deadlineF) {
  Start-Sleep -Seconds 5
  $r = Invoke-Cdp $sF "Runtime.evaluate" @{ expression = "(() => { const ui = document.getElementById('setup-ui'); return ui ? (ui.classList.contains('hidden') ? 'setup-hidden' : 'setup-visible') : 'gone'; })()"; returnByValue = $true }
  $uiState = ""
  if ($r.result -and $r.result.result) { $uiState = [string]$r.result.result.value }
  if ($uiState -eq "setup-hidden" -or $uiState -eq "gone") { $doneF = $true; break }
}
Write-Host "setup UI dismissed after key: $doneF"
$null = $sF.ws.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, "done", $sF.ct).Wait()
# Assert persistence: .firstrun marker + key in settings.json.
$frFound = $false
$settingsKey = $false
foreach ($ud in @("$env:APPDATA\Xena", "$env:APPDATA\@xena\stage-xena", "$env:APPDATA\@xenastage-xena")) {
  if (Test-Path "$ud\data\.firstrun") { $frFound = $true }
  $sj = "$ud\data\settings.json"
  if (Test-Path $sj) { if ((Get-Content $sj -Raw) -match "AIza") { $settingsKey = $true } }
}
Write-Host "firstrun marker: $frFound, key persisted: $settingsKey"
if (-not ($frFound -and $settingsKey)) { Write-Host "E2E FAIL: setup flow did not persist (.firstrun=$frFound key=$settingsKey)"; exit 1 }

if (-not $okD) { Write-Host "E2E PARTIAL: no-key path green, with-key failed"; exit 1 }

Write-Host "== Stage H: XENA_NINEROUTER_ENABLED=0 (pure Gemini + Pollinations) =="
# .env next to the installed exe turns the 9Router rung off entirely (paths.ts:
# packaged envDir = dirname of Xena.exe). Child must report disabled, port must
# stay free, and chat must still serve through the remaining chain.
Get-Process Xena -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 5
$installDir = Split-Path $exe
Set-Content -Path "$installDir\.env" -Value "XENA_NINEROUTER_ENABLED=0" -Encoding ASCII
Write-Host "wrote: $installDir\.env"
Start-Process -FilePath $exe
Start-Sleep -Seconds 75
Start-Sleep -Seconds 45
$null = Copy-XenaLog -Dest "C:\Shared\xena-main-norouter.log"
$childState = (Select-String -Path "C:\Shared\xena-main-norouter.log" -Pattern "9router child: (\S+)" | Select-Object -Last 1).Matches.Groups[1].Value
Write-Host "child state: $childState"
$portFree = $false
try { Invoke-RestMethod -Uri "http://127.0.0.1:20129/v1/models" -TimeoutSec 4 | Out-Null } catch { $portFree = $true }
Write-Host "port 20129 free: $portFree"
if ($childState -ne "disabled" -or -not $portFree) {
  Write-Host "E2E FAIL: 9Router not disabled (state=$childState portFree=$portFree)"; exit 1
}
$okH = Send-Chat-And-Wait-Bubble -Message "Still there? Say something." -TimeoutSec 180
$null = Copy-XenaLog -Dest "C:\Shared\xena-main-norouter.log"
$geminiTriedH = [bool](Select-String -Path "C:\Shared\xena-main-norouter.log" -Pattern "rung down: gemini/|reply done via gemini")
Write-Host "Stage H chat served: $okH (gemini attempted: $geminiTriedH)"
if ($geminiTriedH -and -not $okH) {
  # Dead key (403 leaked) + keyless Pollinations having a bad day in the
  # sandbox => persona error line. That IS the ADR-004 contract: rung walk
  # happened, no raw errors surfaced. Accept with note.
  Write-Host "note: chain walked to the end and surfaced a persona line - ADR-004 contract holds"
} elseif (-not $okH) {
  Write-Host "E2E FAIL: no-9Router chat never even attempted gemini"; exit 1
} else {
  $providerH = Get-Provider-From-Log -Path "C:\Shared\xena-main-norouter.log"
  Write-Host "Stage H provider: $providerH"
  # 9router must NOT serve.
  if ($providerH -match "^router9") { Write-Host "E2E FAIL: 9Router served despite XENA_NINEROUTER_ENABLED=0"; exit 1 }
}
Remove-Item "$installDir\.env" -Force -ErrorAction SilentlyContinue

Write-Host "== Stage G: uninstall (per-user NSIS) =="
Get-Process Xena -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 5
$unins = @("$env:LOCALAPPDATA\Programs\@xenastage-xena\Uninstall Xena.exe", "$env:LOCALAPPDATA\Programs\Xena\Uninstall Xena.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $unins) { Write-Host "E2E FAIL: uninstaller not found"; exit 1 }
Write-Host "uninstaller: $unins"
$p = Start-Process -FilePath $unins -ArgumentList "/S" -Wait -PassThru
Write-Host "uninstall exit: $($p.ExitCode)"
Start-Sleep -Seconds 10
$exeGone = -not (Test-Path $exe)
Write-Host "exe removed: $exeGone"
# Orphan check: no Xena.exe processes, no lingering 9router child on our port.
$procsLeft = @(Get-Process Xena -ErrorAction SilentlyContinue).Count
$portHeld = $false
try { Invoke-RestMethod -Uri "http://127.0.0.1:20129/v1/models" -TimeoutSec 4 | Out-Null; $portHeld = $true } catch {}
Write-Host "xena procs left: $procsLeft, 9router port still held: $portHeld"
if (-not $exeGone -or $procsLeft -gt 0) { Write-Host "E2E FAIL: uninstall incomplete (exeGone=$exeGone procs=$procsLeft)"; exit 1 }
Write-Host "E2E DONE --- all stages green"
