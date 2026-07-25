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
  // Attach pos.engaz.tech to system-online-web worker
  const attach = await api(`/accounts/${ACCOUNT_ID}/workers/domains`, {
    method: 'PUT',
    body: JSON.stringify({
      hostname: 'pos.engaz.tech',
      service: 'system-online-web',
      environment: 'production',
      zone_id: ZONE_ID,
    }),
  });
  console.log('ATTACH POS:', JSON.stringify(attach, null, 2));

  // Update frontend env to use api.engaz.tech and rebuild? We'll do that next.
  const domains = await api(`/accounts/${ACCOUNT_ID}/workers/domains`);
  console.log('WORKER DOMAINS:', JSON.stringify(domains, null, 2));
})().catch(console.error);
