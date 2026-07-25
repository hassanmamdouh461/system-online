$tokenLine = Get-Content "$env:APPDATA\xdg.config\.wrangler\config\default.toml" | Select-String 'oauth_token'
$token = ($tokenLine.Line -split '=', 2)[1].Trim().Trim('"')
$headers = @{ Authorization = "Bearer $token" }
$account = "6c8cc1f1a3f0af27b949d785c31c8c6c"

Write-Host "=== system-online-web script settings ==="
try {
  $r = Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/accounts/$account/workers/scripts/system-online-web/settings" -Headers $headers
  Write-Host ($r | ConvertTo-Json -Depth 12)
} catch {
  Write-Host ("settings error: " + $_.Exception.Message)
  if ($_.ErrorDetails) { Write-Host $_.ErrorDetails.Message }
}

Write-Host ""
Write-Host "=== system-online-web subdomain ==="
try {
  $r2 = Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/accounts/$account/workers/scripts/system-online-web/subdomain" -Headers $headers
  Write-Host ($r2 | ConvertTo-Json -Depth 6)
} catch {
  Write-Host ("subdomain error: " + $_.Exception.Message)
}

Write-Host ""
Write-Host "=== Download current script metadata ==="
try {
  $r3 = Invoke-WebRequest -Uri "https://api.cloudflare.com/client/v4/accounts/$account/workers/scripts/system-online-web" -Headers $headers -UseBasicParsing
  Write-Host ("status=" + $r3.StatusCode + " len=" + $r3.RawContentLength)
  Write-Host ("content-type=" + $r3.Headers['Content-Type'])
  # save body for inspection
  [System.IO.File]::WriteAllBytes("C:\Users\DELL\whtool\online-system\scripts\system-online-web-current.bin", $r3.Content)
  $text = [System.Text.Encoding]::UTF8.GetString($r3.Content)
  Write-Host ("text preview: " + $text.Substring(0, [Math]::Min(800, $text.Length)))
} catch {
  Write-Host ("download error: " + $_.Exception.Message)
  if ($_.ErrorDetails) { Write-Host $_.ErrorDetails.Message }
}
