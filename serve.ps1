$port = 8080
$localPath = (Resolve-Path "dist").Path
$url = "http://localhost:$port/"

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($url)
try {
    $listener.Start()
} catch {
    Write-Error "Failed to start HttpListener. It might be already in use or requires Administrator privileges."
    throw $_
}

Write-Host "HTTP Server running on $url"
Write-Host "Press Ctrl+C to stop..."

try {
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response

        $rawUrl = $request.RawUrl
        if ($rawUrl.Contains("?")) {
            $rawUrl = $rawUrl.Substring(0, $rawUrl.IndexOf("?"))
        }

        # Construct file path safely
        $subPath = $rawUrl.TrimStart('/')
        $subPath = $subPath -replace '/', [System.IO.Path]::DirectorySeparatorChar
        $filePath = Join-Path $localPath $subPath

        # Directory routing
        if (Test-Path $filePath -PathType Container) {
            $filePath = Join-Path $filePath "index.html"
        }

        # SPA fallback to index.html if file doesn't exist
        if (-not (Test-Path $filePath)) {
            $filePath = Join-Path $localPath "index.html"
        }

        if (Test-Path $filePath -PathType Leaf) {
            try {
                $bytes = [System.IO.File]::ReadAllBytes($filePath)
                $ext = [System.IO.Path]::GetExtension($filePath).ToLower()
                $contentType = switch ($ext) {
                    ".html" { "text/html; charset=utf-8" }
                    ".css"  { "text/css; charset=utf-8" }
                    ".js"   { "application/javascript; charset=utf-8" }
                    ".json" { "application/json; charset=utf-8" }
                    ".png"  { "image/png" }
                    ".jpg"  { "image/jpeg" }
                    ".jpeg" { "image/jpeg" }
                    ".gif"  { "image/gif" }
                    ".svg"  { "image/svg+xml" }
                    ".ico"  { "image/x-icon" }
                    default { "application/octet-stream" }
                }
                
                $response.ContentType = $contentType
                $response.ContentLength64 = $bytes.Length
                $response.OutputStream.Write($bytes, 0, $bytes.Length)
            } catch {
                $response.StatusCode = 500
            }
        } else {
            $response.StatusCode = 404
        }
        $response.Close()
    }
} finally {
    $listener.Stop()
}
