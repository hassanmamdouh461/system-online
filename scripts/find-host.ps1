$tokenLine = Get-Content "$env:APPDATA\xdg.config\.wrangler\config\default.toml" | Select-String 'oauth_token'
$token = ($tokenLine.Line -split '=', 2)[1].Trim().Trim('"')
$headers = @{ Authorization = "Bearer $token" }
$account = "6c8cc1f1a3f0af27b949d785c31c8c6c"

Write-Host "=== Workers scripts ==="
try {
  $r = Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/accounts/$account/workers/scripts" -Headers $headers
  foreach ($s in $r.result) {
    Write-Host ("script=" + $s.id + " created=" + $s.created_on + " modified=" + $s.modified_on)
  }
} catch {
  Write-Host ("workers error: " + $_.Exception.Message)
  if ($_.ErrorDetails) { Write-Host $_.ErrorDetails.Message }
}

Write-Host ""
Write-Host "=== Workers routes on engaz zone (if permitted) ==="
try {
  $zoneId = "1252da82cfc658ae3a25d2eb3dc76971"
  $r2 = Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/zones/$zoneId/workers/routes" -Headers $headers
  Write-Host ($r2 | ConvertTo-Json -Depth 6)
} catch {
  Write-Host ("routes error: " + $_.Exception.Message)
  if ($_.ErrorDetails) { Write-Host $_.ErrorDetails.Message }
}

Write-Host ""
Write-Host "=== Custom hostnames / domain status detailed ==="
try {
  $r3 = Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/accounts/$account/pages/projects/system-online/domains" -Headers $headers
  Write-Host ($r3 | ConvertTo-Json -Depth 10)
} catch {
  Write-Host $_.Exception.Message
}
