$tokenLine = Get-Content "$env:APPDATA\xdg.config\.wrangler\config\default.toml" | Select-String 'oauth_token'
$token = ($tokenLine.Line -split '=', 2)[1].Trim().Trim('"')
$headers = @{
  Authorization = "Bearer $token"
  "Content-Type" = "application/json"
}

$account = "6c8cc1f1a3f0af27b949d785c31c8c6c"
$project = "system-online"
$domain = "pos.engaz.tech"

Write-Host "=== Adding custom domain $domain to $project ==="
try {
  $body = @{ name = $domain } | ConvertTo-Json
  $r = Invoke-RestMethod -Method Post -Uri "https://api.cloudflare.com/client/v4/accounts/$account/pages/projects/$project/domains" -Headers $headers -Body $body
  Write-Host ("success=" + $r.success)
  Write-Host ($r | ConvertTo-Json -Depth 8)
} catch {
  Write-Host ("ERROR add domain: " + $_.Exception.Message)
  if ($_.ErrorDetails) { Write-Host $_.ErrorDetails.Message }
}

Write-Host ""
Write-Host "=== List domains after attempt ==="
try {
  $r2 = Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/accounts/$account/pages/projects/$project/domains" -Headers $headers
  Write-Host ($r2 | ConvertTo-Json -Depth 8)
} catch {
  Write-Host ("ERROR list domains: " + $_.Exception.Message)
  if ($_.ErrorDetails) { Write-Host $_.ErrorDetails.Message }
}

Write-Host ""
Write-Host "=== List all Pages projects with domains ==="
try {
  $r3 = Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/accounts/$account/pages/projects" -Headers $headers
  foreach ($p in $r3.result) {
    Write-Host ("project=" + $p.name + " domains=" + (($p.domains) -join ", "))
  }
} catch {
  Write-Host ("ERROR list projects: " + $_.Exception.Message)
}
