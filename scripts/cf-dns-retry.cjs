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
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, json };
}

(async () => {
  // Try multiple DNS create variants
  const attempts = [
    ['POST zones dns', `/zones/${ZONE_ID}/dns_records`, { type: 'CNAME', name: 'pos.engaz.tech', content: 'system-online.pages.dev', proxied: true, ttl: 1 }],
    ['POST zones dns short', `/zones/${ZONE_ID}/dns_records`, { type: 'CNAME', name: 'pos', content: 'system-online.pages.dev', proxied: true, ttl: 1 }],
    // Pages domain re-get
    ['GET pages domains', `/accounts/${ACCOUNT_ID}/pages/projects/system-online/domains`, null],
    // Worker domain status
    ['GET worker domains', `/accounts/${ACCOUNT_ID}/workers/domains`, null],
    // Try zone settings / activation check
    ['GET zone', `/zones/${ZONE_ID}`, null],
  ];

  for (const [label, pathName, body] of attempts) {
    const opts = body ? { method: 'POST', body: JSON.stringify(body) } : {};
    const r = await api(pathName, opts);
    console.log('\n--- ' + label + ' ---');
    console.log(JSON.stringify(r, null, 2));
  }
})().catch(console.error);
