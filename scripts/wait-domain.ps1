$tokenLine = Get-Content "$env:APPDATA\xdg.config\.wrangler\config\default.toml" | Select-String 'oauth_token'
$token = ($tokenLine.Line -split '=', 2)[1].Trim().Trim('"')
$headers = @{ Authorization = "Bearer $token"; "Content-Type" = "application/json" }
$account = $env:CF_ACCOUNT_ID
$project = "system-online"
$zoneId = $env:CF_ZONE_ID

for ($i = 1; $i -le 12; $i++) {
  Write-Host ("--- poll $i ---")
  try {
    $r = Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/accounts/$account/pages/projects/$project/domains" -Headers $headers
    foreach ($d in $r.result) {
      Write-Host ("domain=" + $d.name + " status=" + $d.status + " verify=" + $d.verification_data.status + " validation=" + $d.validation_data.status)
    }
  } catch {
    Write-Host ("poll error: " + $_.Exception.Message)
  }

  $html = (Invoke-WebRequest -Uri "https://pos.engaz.tech/" -UseBasicParsing).Content
  $m = [regex]::Match($html, "index-[A-Za-z0-9_-]+\.js")
  Write-Host ("live bundle=" + $m.Value)

  if ($m.Value -eq "index-Dn5Rzkw2.js") {
    Write-Host "SUCCESS: new bundle is live on pos.engaz.tech"
    break
  }
  Start-Sleep -Seconds 10
}

Write-Host ""
Write-Host "=== DNS records matching pos ==="
try {
  # try list all and filter - may 403 with oauth scopes
  $dns = Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/zones/$zoneId/dns_records?per_page=100" -Headers $headers
  $dns.result | Where-Object { $_.name -like "*pos*" -or $_.name -eq "engaz.tech" } | ForEach-Object {
    Write-Host ("type=" + $_.type + " name=" + $_.name + " content=" + $_.content + " proxied=" + $_.proxied)
  }
} catch {
  Write-Host ("DNS list error: " + $_.Exception.Message)
  if ($_.ErrorDetails) { Write-Host $_.ErrorDetails.Message }
}
