# TopTen.one — local static server for testing, matching GitHub Pages routing.
#
#   powershell -ExecutionPolicy Bypass -File scripts\serve.ps1
#   then open http://localhost:8080
#
# Uses HttpListener from the Windows runtime, so it needs no Node and no Python.
# Ctrl+C to stop. This is a test aid only; production is GitHub Pages.

param([int]$Port = 8080)

$root = Split-Path -Parent $PSScriptRoot

$types = @{
    '.html' = 'text/html; charset=utf-8'
    '.js'   = 'text/javascript; charset=utf-8'
    '.css'  = 'text/css; charset=utf-8'
    '.json' = 'application/json; charset=utf-8'
    '.svg'  = 'image/svg+xml'
    '.png'  = 'image/png'
    '.xml'  = 'application/xml; charset=utf-8'
    '.txt'  = 'text/plain; charset=utf-8'
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Output "Serving $root on http://localhost:$Port/  (Ctrl+C to stop)"

while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $urlPath = [System.Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath)

    # Same shape as GitHub Pages: directories resolve to index.html, and an
    # unknown path falls through to 404.html so the SPA can still route it.
    $rel = $urlPath.TrimStart('/')
    if ($rel -eq '') { $rel = 'index.html' }
    $file = Join-Path $root $rel

    if (Test-Path -LiteralPath $file -PathType Container) {
        $file = Join-Path $file 'index.html'
    }
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
        $withIndex = Join-Path $root (Join-Path $rel 'index.html')
        if (Test-Path -LiteralPath $withIndex -PathType Leaf) {
            $file = $withIndex
        } else {
            $file = Join-Path $root '404.html'
            $ctx.Response.StatusCode = 404
        }
    }

    try {
        $bytes = [System.IO.File]::ReadAllBytes($file)
        $ext = [System.IO.Path]::GetExtension($file).ToLower()
        if ($types.ContainsKey($ext)) { $ctx.Response.ContentType = $types[$ext] }
        $ctx.Response.Headers.Add('Cache-Control', 'no-store')
        $ctx.Response.ContentLength64 = $bytes.Length
        $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    } catch {
        $ctx.Response.StatusCode = 500
    }
    $ctx.Response.OutputStream.Close()
    Write-Output ("  {0}  {1}" -f $ctx.Response.StatusCode, $urlPath)
}
