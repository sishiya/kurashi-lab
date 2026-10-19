# Minimal static file server for previewing the apps (multi-file pages need http://, not file://).
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File .claude/serve.ps1 [-Port 8765]
param([int]$Port = 8765)
$root = Split-Path -Parent $PSScriptRoot
$mime = @{ '.html'='text/html; charset=utf-8'; '.js'='text/javascript; charset=utf-8'; '.css'='text/css; charset=utf-8';
  '.json'='application/json'; '.png'='image/png'; '.jpg'='image/jpeg'; '.svg'='image/svg+xml'; '.md'='text/plain; charset=utf-8' }
$l = New-Object System.Net.HttpListener
$l.Prefixes.Add("http://localhost:$Port/")
$l.Start()
Write-Host "serving $root on http://localhost:$Port/"
while ($l.IsListening) {
  $c = $l.GetContext()
  try {
    $rel = [Uri]::UnescapeDataString($c.Request.Url.AbsolutePath.TrimStart('/'))
    # PUT: the promo pages (_dev/promo/*.html) save videos, subtitles, check frames and saves into _dev/promo/out/ only
    if ($c.Request.HttpMethod -eq 'PUT') {
      if ($rel -match '^_dev/promo/out/[A-Za-z0-9_.-]+\.(mp4|webm|srt|jpg|wav|json)$') {
        $dir = Join-Path $root '_dev/promo/out'
        if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force $dir | Out-Null }
        $fs = [IO.File]::Create((Join-Path $root $rel)); $c.Request.InputStream.CopyTo($fs); $fs.Close()
      } else { $c.Response.StatusCode = 403 }
      $c.Response.Close(); continue
    }
    $path = [IO.Path]::GetFullPath((Join-Path $root $rel))
    if (Test-Path $path -PathType Container) { $path = Join-Path $path 'index.html' }
    # serve only files inside the project folder, and never the private word list
    $inside = $path.StartsWith($root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)
    if ($inside -and ([IO.Path]::GetFileName($path) -ne '.private-words.txt') -and (Test-Path $path -PathType Leaf)) {
      $bytes = [IO.File]::ReadAllBytes($path)
      $ext = [IO.Path]::GetExtension($path).ToLower()
      $c.Response.ContentType = if ($mime[$ext]) { $mime[$ext] } else { 'application/octet-stream' }
      $c.Response.Headers.Add('Cache-Control','no-store')
      $c.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    } else { $c.Response.StatusCode = 404 }
  } catch { $c.Response.StatusCode = 500 }
  $c.Response.Close()
}
