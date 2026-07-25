const fs = require('fs');
const path = process.env.APPDATA + '/xdg.config/.wrangler/config/default.toml';
const toml = fs.readFileSync(path, 'utf8');
const match = toml.match(/oauth_token\s*=\s*"([^"]+)"/);
const token = match[1];
// Infrastructure identifiers come from the environment, never the repo.
// Set CF_ACCOUNT_ID and CF_ZONE_ID before running (see scripts/README.md).
function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

const ACCOUNT_ID = requireEnv('CF_ACCOUNT_ID');
const ZONE_ID = requireEnv('CF_ZONE_ID');

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
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  return { status: res.status, json, text };
}

(async () => {
  // list current domains
  let list = await api(`/accounts/${ACCOUNT_ID}/workers/domains`);
  console.log('LIST1:', JSON.stringify(list.json, null, 2));
  const pos = (list.json?.result || []).find((d) => d.hostname === 'pos.engaz.tech');
  if (pos?.id) {
    const del = await api(`/accounts/${ACCOUNT_ID}/workers/domains/${pos.id}`, { method: 'DELETE' });
    console.log('DELETE:', del.status, del.text || del.json);
  }

  const attach = await api(`/accounts/${ACCOUNT_ID}/workers/domains`, {
    method: 'PUT',
    body: JSON.stringify({
      hostname: 'pos.engaz.tech',
      service: 'system-online-web',
      environment: 'production',
      zone_id: ZONE_ID,
    }),
  });
  console.log('ATTACH:', JSON.stringify(attach, null, 2));

  // Try routes
  const routes = await api(`/zones/${ZONE_ID}/workers/routes`, {
    method: 'POST',
    body: JSON.stringify({
      pattern: 'pos.engaz.tech/*',
      script: 'system-online-web',
    }),
  });
  console.log('ROUTE:', JSON.stringify(routes, null, 2));

  // Wait a bit then DNS lookup via public resolver
  await new Promise((r) => setTimeout(r, 3000));
  list = await api(`/accounts/${ACCOUNT_ID}/workers/domains`);
  console.log('LIST2:', JSON.stringify(list.json, null, 2));

  // Cloudflare DNS over HTTPS
  const doh = await fetch('https://cloudflare-dns.com/dns-query?name=pos.engaz.tech&type=A', {
    headers: { Accept: 'application/dns-json' },
  }).then((r) => r.json());
  console.log('DOH pos A:', JSON.stringify(doh, null, 2));

  const dohApi = await fetch('https://cloudflare-dns.com/dns-query?name=api.engaz.tech&type=A', {
    headers: { Accept: 'application/dns-json' },
  }).then((r) => r.json());
  console.log('DOH api A:', JSON.stringify(dohApi, null, 2));
})().catch(console.error);
