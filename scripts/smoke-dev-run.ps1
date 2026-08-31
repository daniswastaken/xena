# Dev-run smoke: send one chat via CDP, wait for reply-done in the dev log.
$ws = New-Object System.Net.WebSockets.ClientWebSocket
$ct = New-Object System.Threading.CancellationToken
$targets = Invoke-RestMethod -Uri "http://127.0.0.1:9223/json" -TimeoutSec 10
$t = $targets | Where-Object { $_.title -eq "Xena" -and $_.webSocketDebuggerUrl }
$ws.ConnectAsync([Uri]$t.webSocketDebuggerUrl, $ct).Wait()
$seq = 0
function Invoke-Cdp {
  param([string]$Method, $Params)
  $script:seq++
  $id = $script:seq
  $payload = @{ id = $id; method = $Method; params = $Params } | ConvertTo-Json -Depth 6 -Compress
  $bytes = [Text.Encoding]::UTF8.GetBytes($payload)
  $null = $ws.SendAsync([ArraySegment[byte]]::new($bytes), [System.Net.WebSockets.WebSocketMessageType]::Text, $true, $ct).Wait()
  $buf = New-Object byte[] 262144
  while ($true) {
    $res = $ws.ReceiveAsync([ArraySegment[byte]]::new($buf), $ct)
    $null = $res.Wait()
    $text = [Text.Encoding]::UTF8.GetString($buf, 0, $res.Result.Count)
    $msg = $text | ConvertFrom-Json
    if ($msg.id -eq $id) { return $msg }
  }
}
$null = Invoke-Cdp "Runtime.enable" @{}
$null = Invoke-Cdp "Runtime.evaluate" @{ expression = "window.xena.sendChat('Hi from the dev smoke test - reply in your own words.').then(function(){return 'ok'},function(e){return 'rej:' + e}); 'fired'"; returnByValue = $true }
$log = "$env:APPDATA\Xena\xena-main.log"
if (-not (Test-Path $log)) { $log = "$env:APPDATA\@xena\stage-xena\xena-main.log" }
$before = (Get-Content $log | Select-String "reply done via").Count
$deadline = (Get-Date).AddSeconds(120)
$ok = $false
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Seconds 5
  $dones = (Get-Content $log | Select-String "reply done via").Count
  if (($dones - $before) -ge 1) { $ok = $true; break }
}
$last = (Get-Content $log | Select-String "reply done via" | Select-Object -Last 1).Line
Write-Host "dev chat reply-done: $ok"
Write-Host "last: $last"
$null = $ws.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, "done", $ct).Wait()
if (-not $ok) { exit 1 }
