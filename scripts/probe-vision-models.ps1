# Probes 9Router models for image-input capability.
# Sends the generated test image, asks what it shows, checks the answer.
param(
    [string]$B64File = "$env:TEMP\opencode\xena-probe.b64",
    [string[]]$Models = @(
        "tokenrouter/google/gemini-3-flash-preview",
        "bzl/gemini-3-flash-preview",
        "gc/gemini-2.5-flash",
        "af/google/gemini-2.5-flash",
        "oc/x-preview-f-free"
    ),
    [string]$OutMd = "docs/vision-models.md"
)
$ErrorActionPreference = "Continue"
$key = (Get-Content .env | Where-Object { $_ -match '^ROUTER9_API_KEY=' }) -replace '^ROUTER9_API_KEY=', ''
$b64 = [IO.File]::ReadAllText($B64File).Trim()
$results = @()
foreach ($m in $Models) {
    Write-Host "--- probing $m"
    $body = @{
        model      = $m
        max_tokens = 60
        messages   = @(
            @{
                role    = "user"
                content = @(
                    @{ type = "text"; text = "What background color and what text do you see in this image? Answer in one short sentence." },
                    @{ type = "image_url"; image_url = @{ url = "data:image/png;base64,$b64" } }
                )
            }
        )
    } | ConvertTo-Json -Depth 8
    $sw = [Diagnostics.Stopwatch]::StartNew()
    try {
        $r = Invoke-RestMethod -Uri "http://localhost:20129/v1/chat/completions" -Method Post `
            -Body ([Text.Encoding]::UTF8.GetBytes($body)) -ContentType "application/json" `
            -Headers @{ Authorization = "Bearer $key" } -TimeoutSec 90
        $sw.Stop()
        $answer = ""
        if ($r.choices[0].message.content) { $answer = $r.choices[0].message.content }
        elseif ($r.choices[0].message.reasoning_content) { $answer = "(reasoning only) " + $r.choices[0].message.reasoning_content }
        $answer = ($answer -replace "`n", " ").Trim()
        if ($answer.Length -gt 200) { $answer = $answer.Substring(0, 200) }
        $hit = ($answer -match "blue") -and ($answer -match "XENA")
        Write-Host ("{0} => {1} ({2:N1}s): {3}" -f $m, $(if ($hit) { "PASS" } else { "reply-no-match" }), $sw.Elapsed.TotalSeconds, $answer)
        $results += [pscustomobject]@{ Model = $m; Status = $(if ($hit) { "PASS" } else { "REPLY" }); Seconds = [math]::Round($sw.Elapsed.TotalSeconds, 1); Answer = $answer }
    } catch {
        $sw.Stop()
        $msg = $_.Exception.Message
        if ($msg.Length -gt 160) { $msg = $msg.Substring(0, 160) }
        Write-Host ("{0} => FAIL ({1:N1}s): {2}" -f $m, $sw.Elapsed.TotalSeconds, $msg)
        $results += [pscustomobject]@{ Model = $m; Status = "FAIL"; Seconds = [math]::Round($sw.Elapsed.TotalSeconds, 1); Answer = $msg }
    }
}
New-Item -ItemType Directory -Force -Path (Split-Path $OutMd) | Out-Null
$lines = @("# Vision Model Probe Results", "", "Test image: 320x200 PNG, blue background (#228BE6), white bold text 'XENA-42'.", "Probe date: $(Get-Date -Format 'yyyy-MM-dd HH:mm')", "", "| Model | Result | Time (s) | Answer/Error |", "|---|---|---|---|")
foreach ($r in $results) { $lines += ("| `{0}` | {1} | {2} | {3} |" -f $r.Model, $r.Status, $r.Seconds, ($r.Answer -replace '\|', '/')) }
$lines += ""
$lines += "**Verdict:** first PASS model = preferred Xena vision model."
[IO.File]::WriteAllLines($OutMd, $lines)
Write-Host "wrote $OutMd"
