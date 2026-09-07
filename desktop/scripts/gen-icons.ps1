#Requires -Version 5.1
# Icons from brand/logo-source.png — optically centered (centroid), transparent, NO plate
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$Root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$SrcPath = Join-Path $Root "brand\logo-source.png"
$Assets = Join-Path $Root "desktop\assets"
$WebPublic = Join-Path $Root "web\public"

if (-not (Test-Path $SrcPath)) {
    Write-Host "Missing brand\logo-source.png" -ForegroundColor Yellow
    exit 1
}

New-Item -ItemType Directory -Force -Path $Assets, $WebPublic | Out-Null

$src = [System.Drawing.Bitmap]::FromFile($SrcPath)
$sumX = 0.0; $sumY = 0.0; $sumA = 0.0
$minX = $src.Width; $minY = $src.Height; $maxX = -1; $maxY = -1
for ($y = 0; $y -lt $src.Height; $y++) {
    for ($x = 0; $x -lt $src.Width; $x++) {
        $a = $src.GetPixel($x, $y).A
        if ($a -gt 12) {
            $sumX += $x * $a; $sumY += $y * $a; $sumA += $a
            if ($x -lt $minX) { $minX = $x }
            if ($y -lt $minY) { $minY = $y }
            if ($x -gt $maxX) { $maxX = $x }
            if ($y -gt $maxY) { $maxY = $y }
        }
    }
}
$cx = [int]($sumX / $sumA)
$cy = [int]($sumY / $sumA)
$maxR = 0.0
for ($y = $minY; $y -le $maxY; $y++) {
    for ($x = $minX; $x -le $maxX; $x++) {
        if ($src.GetPixel($x, $y).A -gt 12) {
            $r = [Math]::Sqrt(($x - $cx) * ($x - $cx) + ($y - $cy) * ($y - $cy))
            if ($r -gt $maxR) { $maxR = $r }
        }
    }
}
$pad = [Math]::Max(2, [int]($maxR * 0.02))
$half = [int][Math]::Ceiling($maxR) + $pad
$canvas = 2 * $half

$crop = New-Object System.Drawing.Bitmap $canvas, $canvas
$g = [System.Drawing.Graphics]::FromImage($crop)
$g.Clear([System.Drawing.Color]::Transparent)
$g.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
$destRect = New-Object System.Drawing.Rectangle ($half - $cx), ($half - $cy), $src.Width, $src.Height
$g.DrawImage($src, $destRect)
$g.Dispose()
$src.Dispose()

$white = New-Object System.Drawing.Bitmap $canvas, $canvas
for ($y = 0; $y -lt $canvas; $y++) {
    for ($x = 0; $x -lt $canvas; $x++) {
        $c = $crop.GetPixel($x, $y)
        if ($c.A -lt 8) {
            $white.SetPixel($x, $y, [System.Drawing.Color]::Transparent)
        } else {
            $white.SetPixel($x, $y, [System.Drawing.Color]::FromArgb($c.A, 255, 255, 255))
        }
    }
}
$crop.Dispose()

function Save-Sized([System.Drawing.Bitmap]$mark, [int]$size, [string]$dest) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.Clear([System.Drawing.Color]::Transparent)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $m = 0
    $g.DrawImage($mark, $m, $m, ($size - 2 * $m), ($size - 2 * $m))
    $g.Dispose()
    if (Test-Path $dest) { Remove-Item $dest -Force }
    $bmp.Save($dest, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
}

Save-Sized $white 16 (Join-Path $Assets "icon-16.png")
Save-Sized $white 24 (Join-Path $Assets "icon-24.png")
Save-Sized $white 32 (Join-Path $Assets "tray-icon.png")
Save-Sized $white 32 (Join-Path $Assets "icon-32.png")
Save-Sized $white 48 (Join-Path $Assets "icon-48.png")
Save-Sized $white 64 (Join-Path $Assets "tray-icon@2x.png")
Save-Sized $white 128 (Join-Path $Assets "logo-light.png")
Save-Sized $white 256 (Join-Path $Assets "icon-256.png")
Save-Sized $white 512 (Join-Path $Assets "icon.png")
Copy-Item (Join-Path $Assets "icon.png") (Join-Path $Assets "logo.png") -Force

# Black mark for light Windows taskbars (white would vanish)
$black = New-Object System.Drawing.Bitmap $canvas, $canvas
for ($y = 0; $y -lt $canvas; $y++) {
    for ($x = 0; $x -lt $canvas; $x++) {
        $c = $white.GetPixel($x, $y)
        if ($c.A -lt 8) {
            $black.SetPixel($x, $y, [System.Drawing.Color]::Transparent)
        } else {
            $black.SetPixel($x, $y, [System.Drawing.Color]::FromArgb($c.A, 20, 20, 20))
        }
    }
}
Save-Sized $black 32 (Join-Path $Assets "tray-icon-dark.png")
Save-Sized $black 64 (Join-Path $Assets "tray-icon-dark@2x.png")
$black.Dispose()
Save-Sized $white 32 (Join-Path $WebPublic "favicon.png")
Save-Sized $white 180 (Join-Path $WebPublic "apple-touch-icon.png")
Save-Sized $white 128 (Join-Path $WebPublic "logo.png")
Save-Sized $white 512 (Join-Path $WebPublic "logo-light.png")
$white.Dispose()

$RendererPublic = Join-Path $Root "desktop\renderer\public"
New-Item -ItemType Directory -Force -Path $RendererPublic | Out-Null
Copy-Item (Join-Path $Assets "logo-light.png") (Join-Path $RendererPublic "logo.png") -Force

$WebDist = Join-Path $Root "web\dist"
if (Test-Path $WebDist) {
    Copy-Item (Join-Path $WebPublic "favicon.png") (Join-Path $WebDist "favicon.png") -Force
    Copy-Item (Join-Path $WebPublic "apple-touch-icon.png") (Join-Path $WebDist "apple-touch-icon.png") -Force
    Copy-Item (Join-Path $WebPublic "logo.png") (Join-Path $WebDist "logo.png") -Force
}

$ogScript = Join-Path $Root "brand\gen-og-image.py"
$py = Join-Path $Root "server\.venv\Scripts\python.exe"
if ((Test-Path $ogScript) -and (Test-Path $py)) {
    & $py $ogScript
    if ($LASTEXITCODE -ne 0) {
        Write-Host "og-image generation failed" -ForegroundColor Yellow
    } elseif (Test-Path $WebDist) {
        $ogOut = Join-Path $WebPublic "og-image.png"
        if (Test-Path $ogOut) {
            Copy-Item $ogOut (Join-Path $WebDist "og-image.png") -Force
        }
    }
}

Write-Host "Wrote optically centered transparent icons (no plate)"
