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
  const json = await res.json();
  return { status: res.status, json };
}

(async () => {
  // 1) Remove pending Pages domain that blocks/conflicts
  const delPages = await api(
    `/accounts/${ACCOUNT_ID}/pages/projects/system-online/domains/pos.engaz.tech`,
    { method: 'DELETE' }
  );
  console.log('DELETE PAGES DOMAIN:', JSON.stringify(delPages, null, 2));

  // 2) Delete existing worker domain for pos then recreate
  const list = await api(`/accounts/${ACCOUNT_ID}/workers/domains`);
  const pos = (list.json?.result || []).find((d) => d.hostname === 'pos.engaz.tech');
  if (pos?.id) {
    const del = await api(`/accounts/${ACCOUNT_ID}/workers/domains/${pos.id}`, { method: 'DELETE' });
    console.log('DELETE WORKER DOMAIN:', JSON.stringify(del, null, 2));
  }

  // 3) Recreate worker custom domain
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

  // 4) Also try workers routes as alternative
  const routes = await api(`/zones/${ZONE_ID}/workers/routes`, {
    method: 'POST',
    body: JSON.stringify({
      pattern: 'pos.engaz.tech/*',
      script: 'system-online-web',
    }),
  });
  console.log('ROUTE CREATE:', JSON.stringify(routes, null, 2));

  // 5) Try GraphQL? skip. Try account-level DNS?
  // Some accounts allow creating records via workers for domains endpoint only.

  // Wait and list domains again
  const finalDomains = await api(`/accounts/${ACCOUNT_ID}/workers/domains`);
  console.log('FINAL DOMAINS:', JSON.stringify(finalDomains, null, 2));
})().catch(console.error);
