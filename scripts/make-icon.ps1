Add-Type -AssemblyName System.Drawing
$assetDirectory = Join-Path $PSScriptRoot '../assets'
New-Item -ItemType Directory -Force -Path $assetDirectory | Out-Null
$bitmap = New-Object System.Drawing.Bitmap 256, 256
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = 'AntiAlias'
$graphics.Clear([System.Drawing.ColorTranslator]::FromHtml('#1b1e24'))
$pen = New-Object System.Drawing.Pen ([System.Drawing.ColorTranslator]::FromHtml('#9bbdff')), 9
$graphics.DrawRectangle($pen, 65, 39, 134, 178)
$graphics.DrawLine($pen, 96, 39, 96, 217)
foreach ($lineY in @(78, 128, 178)) { $graphics.DrawLine($pen, 46, $lineY, 76, $lineY) }
$graphics.DrawLine($pen, 122, 89, 170, 89)
$graphics.DrawLine($pen, 122, 122, 170, 122)
$pngStream = New-Object System.IO.MemoryStream
$bitmap.Save($pngStream, [System.Drawing.Imaging.ImageFormat]::Png)
$pngBytes = $pngStream.ToArray()
$iconStream = [System.IO.File]::Create((Join-Path $assetDirectory 'icon.ico'))
$writer = New-Object System.IO.BinaryWriter $iconStream
$writer.Write([UInt16]0); $writer.Write([UInt16]1); $writer.Write([UInt16]1)
$writer.Write([byte]0); $writer.Write([byte]0); $writer.Write([byte]0); $writer.Write([byte]0)
$writer.Write([UInt16]1); $writer.Write([UInt16]32)
$writer.Write([UInt32]$pngBytes.Length); $writer.Write([UInt32]22); $writer.Write($pngBytes)
$writer.Dispose(); $pngStream.Dispose(); $pen.Dispose(); $graphics.Dispose(); $bitmap.Dispose()
