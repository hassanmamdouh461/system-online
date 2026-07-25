$tokenLine = Get-Content "$env:APPDATA\xdg.config\.wrangler\config\default.toml" | Select-String 'oauth_token'
$token = ($tokenLine.Line -split '=', 2)[1].Trim().Trim('"')
$headers = @{ Authorization = "Bearer $token" }

Write-Host "=== Pages project system-online ==="
try {
  $r = Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/accounts/6c8cc1f1a3f0af27b949d785c31c8c6c/pages/projects/system-online" -Headers $headers
  Write-Host ("name=" + $r.result.name)
  Write-Host ("subdomain=" + $r.result.subdomain)
  Write-Host ("domains=" + ($r.result.domains -join ", "))
  Write-Host ("canonical_deployment=" + $r.result.canonical_deployment.id)
  Write-Host ("production_branch=" + $r.result.production_branch)
  if ($r.result.canonical_deployment) {
    Write-Host ("canonical_url=" + $r.result.canonical_deployment.url)
    Write-Host ("canonical_created=" + $r.result.canonical_deployment.created_on)
  }
} catch {
  Write-Host ("ERROR project: " + $_.Exception.Message)
  if ($_.ErrorDetails) { Write-Host $_.ErrorDetails.Message }
}

Write-Host ""
Write-Host "=== Zones for engaz.tech ==="
try {
  $z = Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/zones?name=engaz.tech" -Headers $headers
  Write-Host ("success=" + $z.success)
  Write-Host ("count=" + $z.result.Count)
  foreach ($zone in $z.result) {
    Write-Host ("zone id=" + $zone.id + " name=" + $zone.name + " status=" + $zone.status)
  }
  if ($z.result.Count -gt 0) {
    $zoneId = $z.result[0].id
    Write-Host ""
    Write-Host "=== DNS for pos.engaz.tech ==="
    $dns = Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/zones/$zoneId/dns_records?name=pos.engaz.tech" -Headers $headers
    foreach ($rec in $dns.result) {
      Write-Host ("type=" + $rec.type + " content=" + $rec.content + " proxied=" + $rec.proxied + " id=" + $rec.id)
    }
  }
} catch {
  Write-Host ("ERROR zones: " + $_.Exception.Message)
  if ($_.ErrorDetails) { Write-Host $_.ErrorDetails.Message }
}

Write-Host ""
Write-Host "=== Live HTML bundles ==="
foreach ($url in @("https://pos.engaz.tech/", "https://system-online.pages.dev/")) {
  $html = (Invoke-WebRequest -Uri $url -UseBasicParsing).Content
  $m = [regex]::Match($html, "index-[A-Za-z0-9_-]+\.js")
  Write-Host ($url + " => " + $m.Value)
}
