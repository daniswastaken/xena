# Generates a small test image for vision-model probing:
# solid background color + text label. Outputs PNG + base64 to temp dir.
param(
    [string]$OutPng = "$env:TEMP\opencode\xena-probe.png",
    [string]$OutB64 = "$env:TEMP\opencode\xena-probe.b64",
    [int]$R = 34,
    [int]$G = 139,
    [int]$B = 230
)
New-Item -ItemType Directory -Force -Path (Split-Path $OutPng) | Out-Null
Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap(320, 200)
$gfx = [System.Drawing.Graphics]::FromImage($bmp)
$gfx.Clear([System.Drawing.Color]::FromArgb(255, $R, $G, $B))
$font = New-Object System.Drawing.Font("Arial", 36, [System.Drawing.FontStyle]::Bold)
$brush = [System.Drawing.Brushes]::White
$fmt = New-Object System.Drawing.StringFormat
$fmt.Alignment = "Center"
$fmt.LineAlignment = "Center"
$rect = New-Object System.Drawing.RectangleF(0, 0, 320, 200)
$gfx.DrawString("XENA-42", $font, $brush, $rect, $fmt)
$gfx.Dispose()
$bmp.Save($OutPng, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
$b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($OutPng))
[IO.File]::WriteAllText($OutB64, $b64)
Write-Output "image=$OutPng bytes=$(($b64.Length * 3) / 4 -as [int]) b64=$OutB64"
