# TopTen.one — generate the PNG icons and the Open Graph image.
#
#   powershell -ExecutionPolicy Bypass -File scripts\make-icons.ps1
#
# Uses System.Drawing from the Windows runtime, so it needs no Node, no Python
# and no image tooling. Re-run it after changing the mark in icons/favicon.svg.

Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$icons = Join-Path $root 'icons'
if (-not (Test-Path $icons)) { New-Item -ItemType Directory -Path $icons | Out-Null }

$ink  = [System.Drawing.ColorTranslator]::FromHtml('#08090c')
$gold = [System.Drawing.ColorTranslator]::FromHtml('#ffc233')
$grey = [System.Drawing.ColorTranslator]::FromHtml('#9aa0ad')
$dim  = [System.Drawing.ColorTranslator]::FromHtml('#6b7280')

function New-Canvas([int]$w, [int]$h) {
    $bmp = New-Object System.Drawing.Bitmap($w, $h)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    return @{ Bitmap = $bmp; Graphics = $g }
}

# The mark: a heavy "1" standing on a bar. Reads at 32px and at 512px.
function Draw-Mark([System.Drawing.Graphics]$g, [int]$size, [double]$scale) {
    $inkBrush = New-Object System.Drawing.SolidBrush($ink)
    $g.FillRectangle($inkBrush, 0, 0, $size, $size)

    $goldBrush = New-Object System.Drawing.SolidBrush($gold)
    $unit = $size * $scale

    # stem
    $stemW = $unit * 0.155
    $stemH = $unit * 0.52
    $cx = $size / 2.0
    $top = ($size - $unit * 0.66) / 2.0
    $g.FillRectangle($goldBrush, [single]($cx - $stemW / 2), [single]$top, [single]$stemW, [single]$stemH)

    # the flag of the "1"
    $flagW = $unit * 0.17
    $flagH = $unit * 0.115
    $g.FillPolygon($goldBrush, @(
        (New-Object System.Drawing.PointF([single]($cx - $stemW / 2 - $flagW), [single]($top + $flagH * 1.5))),
        (New-Object System.Drawing.PointF([single]($cx - $stemW / 2), [single]$top)),
        (New-Object System.Drawing.PointF([single]($cx - $stemW / 2), [single]($top + $flagH * 1.9)))
    ))

    # base bar
    $barW = $unit * 0.44
    $barH = $unit * 0.105
    $g.FillRectangle($goldBrush, [single]($cx - $barW / 2), [single]($top + $stemH + $unit * 0.045), [single]$barW, [single]$barH)

    $inkBrush.Dispose(); $goldBrush.Dispose()
}

function Save-Icon([int]$size, [string]$name, [double]$scale) {
    $c = New-Canvas $size $size
    Draw-Mark $c.Graphics $size $scale
    $path = Join-Path $icons $name
    $c.Bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $c.Graphics.Dispose(); $c.Bitmap.Dispose()
    Write-Output "  icons/$name  ($size x $size)"
}

Save-Icon 32  'favicon-32.png'          0.92
Save-Icon 180 'apple-touch-icon-180.png' 0.80
Save-Icon 192 'icon-192.png'             0.80
Save-Icon 512 'icon-512.png'             0.80
# Maskable icons get cropped to a circle inside the safe zone, so shrink the mark.
Save-Icon 512 'icon-512-maskable.png'    0.55

# ------------------------------------------------------------- og image ----

$c = New-Canvas 1200 630
$g = $c.Graphics

$bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.Point(0, 0)),
    (New-Object System.Drawing.Point(1200, 630)),
    ([System.Drawing.ColorTranslator]::FromHtml('#12141b')),
    ([System.Drawing.ColorTranslator]::FromHtml('#07080b')))
$g.FillRectangle($bg, 0, 0, 1200, 630)

$goldBrush = New-Object System.Drawing.SolidBrush($gold)
$g.FillRectangle($goldBrush, 0, 0, 1200, 8)

$white = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml('#f2f3f5'))
$greyBrush = New-Object System.Drawing.SolidBrush($grey)
$dimBrush = New-Object System.Drawing.SolidBrush($dim)

$fWord = New-Object System.Drawing.Font('Segoe UI', 92, [System.Drawing.FontStyle]::Bold)
$fTag  = New-Object System.Drawing.Font('Segoe UI', 46, [System.Drawing.FontStyle]::Bold)
$fSub  = New-Object System.Drawing.Font('Segoe UI', 27, [System.Drawing.FontStyle]::Regular)
$fFoot = New-Object System.Drawing.Font('Segoe UI', 20, [System.Drawing.FontStyle]::Regular)

# Typographic measuring drops the padding MeasureString adds by default, so the
# two halves of the wordmark sit flush instead of with a gap between them.
$fmt = [System.Drawing.StringFormat]::GenericTypographic
$fmt.FormatFlags = $fmt.FormatFlags -bor [System.Drawing.StringFormatFlags]::MeasureTrailingSpaces

# "TopTen" in white, ".one" in gold, drawn side by side.
$wordA = 'TopTen'
$wordB = '.one'
$sizeA = $g.MeasureString($wordA, $fWord, [System.Drawing.PointF]::Empty, $fmt)
$g.DrawString($wordA, $fWord, $white, (New-Object System.Drawing.PointF(78, 168)), $fmt)
$g.DrawString($wordB, $fWord, $goldBrush, (New-Object System.Drawing.PointF([single](78 + $sizeA.Width), 168)), $fmt)

$g.DrawString('Be the one.', $fTag, $white, (New-Object System.Drawing.PointF(80, 318)), $fmt)
$g.DrawString('Pay to be seen. Top 10 per platform. No algorithm.', $fSub, $greyBrush,
              (New-Object System.Drawing.PointF(82, 394)), $fmt)

# Build the separator from its code point: the source file's encoding must not
# decide whether this renders as a middot or as mojibake.
$sep = '  ' + [char]0x00B7 + '  '
$platformLine = @('X', 'Instagram', 'TikTok', 'YouTube', 'Twitch', 'LinkedIn', 'Threads', 'Facebook') -join $sep
$g.DrawString($platformLine, $fFoot, $dimBrush, (New-Object System.Drawing.PointF(84, 524)), $fmt)

$ogPath = Join-Path $root 'og-image.png'
$c.Bitmap.Save($ogPath, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $c.Bitmap.Dispose()
Write-Output "  og-image.png  (1200 x 630)"

Write-Output 'Icons generated.'
