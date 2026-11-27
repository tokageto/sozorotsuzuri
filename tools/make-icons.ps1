# アプリのアイコン（PNG）を作るスクリプト
# 使い方: PowerShell で  .\tools\make-icons.ps1  を実行すると web\icons に出力する
Add-Type -AssemblyName System.Drawing

$out = Join-Path $PSScriptRoot '..\web\icons'
New-Item -ItemType Directory -Force $out | Out-Null

function New-Icon([int]$size, [string]$path, [bool]$maskable, [bool]$rounded) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.TextRenderingHint = 'AntiAliasGridFit'
  $g.Clear([System.Drawing.Color]::Transparent)

  $bg = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(15, 118, 110))
  if ($rounded) {
    $r = [int]($size * 0.22)
    $gp = New-Object System.Drawing.Drawing2D.GraphicsPath
    $gp.AddArc(0, 0, $r * 2, $r * 2, 180, 90)
    $gp.AddArc($size - $r * 2, 0, $r * 2, $r * 2, 270, 90)
    $gp.AddArc($size - $r * 2, $size - $r * 2, $r * 2, $r * 2, 0, 90)
    $gp.AddArc(0, $size - $r * 2, $r * 2, $r * 2, 90, 90)
    $gp.CloseFigure()
    $g.FillPath($bg, $gp)
  } else {
    $g.FillRectangle($bg, 0, 0, $size, $size)
  }

  # 文字「そ」（maskable は安全領域に収まるよう小さめ）
  $scale = if ($maskable) { 0.42 } else { 0.56 }
  $fontName = 'Yu Mincho'
  $font = New-Object System.Drawing.Font($fontName, [single]($size * $scale), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $white = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(250, 247, 240))
  $sf = New-Object System.Drawing.StringFormat
  $sf.Alignment = 'Center'
  $sf.LineAlignment = 'Center'
  $rect = New-Object System.Drawing.RectangleF(0, [single](-$size * 0.03), $size, $size)
  # 「そ」(U+305D)。PowerShell 5.1 は BOM なし UTF-8 を正しく読めないため文字コードで書く
  $g.DrawString([string][char]0x305D, $font, $white, $rect, $sf)

  # 足あとの点（旅のしるし）
  $dot = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(242, 196, 107))
  $d = [single]($size * 0.045)
  $base = if ($maskable) { 0.70 } else { 0.80 }
  foreach ($i in 0..2) {
    $x = [single]($size * (0.36 + 0.12 * $i))
    $y = [single]($size * ($base - 0.02 * ($i % 2)))
    $g.FillEllipse($dot, $x, $y, $d, $d)
  }

  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
}

New-Icon 192 (Join-Path $out 'icon-192.png') $false $true
New-Icon 512 (Join-Path $out 'icon-512.png') $false $true
New-Icon 512 (Join-Path $out 'icon-maskable-512.png') $true $false
New-Icon 180 (Join-Path $out 'apple-touch-icon.png') $false $false
Write-Output "icons written to $out"
