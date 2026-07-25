const fs = require('fs');
const path = process.env.APPDATA + '/xdg.config/.wrangler/config/default.toml';
const toml = fs.readFileSync(path, 'utf8');
const match = toml.match(/oauth_token\s*=\s*"([^"]+)"/);
const token = match[1];
const ACCOUNT_ID = '6c8cc1f1a3f0af27b949d785c31c8c6c';
const ZONE_ID = '1252da82cfc658ae3a25d2eb3dc76971';

async function api(pathname, options = {}) {
  const res = await fetch('https://api.cloudflare.com/client/v4' + pathname, {
    ...options,
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const json = await res.json();
  return { status: res.status, json };
}

(async () => {
  // Re-attach pos domain
  const attach = await api(`/accounts/${ACCOUNT_ID}/workers/domains`, {
    method: 'PUT',
    body: JSON.stringify({
      hostname: 'pos.engaz.tech',
      service: 'system-online-web',
      environment: 'production',
      zone_id: ZONE_ID,
    }),
  });
  console.log('REATTACH:', JSON.stringify(attach, null, 2));

  // List all worker domains
  const domains = await api(`/accounts/${ACCOUNT_ID}/workers/domains`);
  console.log('DOMAINS:', JSON.stringify(domains, null, 2));

  // Zone status
  const zone = await api(`/zones/${ZONE_ID}`);
  console.log('ZONE STATUS:', zone.json?.result?.status, zone.json?.result?.name_servers);

  // Try reading DNS via different endpoint
  const dns1 = await api(`/zones/${ZONE_ID}/dns_records?per_page=50`);
  console.log('DNS STATUS:', dns1.status, JSON.stringify(dns1.json?.errors || dns1.json?.result?.map?.(r => ({name:r.name,type:r.type,content:r.content,proxied:r.proxied})) || dns1.json, null, 2));

  // SSL verification packages for hostnames
  const ssl = await api(`/zones/${ZONE_ID}/ssl/verification`);
  console.log('SSL VERIFICATION:', JSON.stringify(ssl, null, 2));
})().catch(console.error);
