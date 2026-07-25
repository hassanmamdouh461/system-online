const fs = require('fs');
const path = process.env.APPDATA + '/xdg.config/.wrangler/config/default.toml';
const toml = fs.readFileSync(path, 'utf8');
const match = toml.match(/oauth_token\s*=\s*"([^"]+)"/);
if (!match) {
  console.error('No oauth token found');
  process.exit(1);
}
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
const PAGES_PROJECT = 'system-online';
const WORKER_NAME = 'system-online-backend';

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

function log(title, data) {
  console.log('\n=== ' + title + ' ===');
  console.log(JSON.stringify(data, null, 2));
}

(async () => {
  // 1) Pages custom domain: pos.engaz.tech
  const pagesDomain = await api(
    `/accounts/${ACCOUNT_ID}/pages/projects/${PAGES_PROJECT}/domains`,
    {
      method: 'POST',
      body: JSON.stringify({ name: 'pos.engaz.tech' }),
    }
  );
  log('Pages domain pos.engaz.tech', pagesDomain);

  // 2) Ensure CNAME for pos.engaz.tech -> system-online.pages.dev
  const existingPos = await api(
    `/zones/${ZONE_ID}/dns_records?type=CNAME&name=pos.engaz.tech`
  );
  log('Existing DNS pos', existingPos);

  const posRecords = existingPos.json?.result || [];
  if (posRecords.length === 0) {
    const createPos = await api(`/zones/${ZONE_ID}/dns_records`, {
      method: 'POST',
      body: JSON.stringify({
        type: 'CNAME',
        name: 'pos',
        content: 'system-online.pages.dev',
        proxied: true,
        ttl: 1,
      }),
    });
    log('Create DNS pos', createPos);
  } else {
    log('DNS pos already exists', posRecords[0]);
  }

  // 3) Worker custom domain: api.engaz.tech
  // Prefer workers domains attach
  const workerDomain = await api(
    `/accounts/${ACCOUNT_ID}/workers/domains`,
    {
      method: 'PUT',
      body: JSON.stringify({
        hostname: 'api.engaz.tech',
        service: WORKER_NAME,
        environment: 'production',
        zone_id: ZONE_ID,
      }),
    }
  );
  log('Worker domain api.engaz.tech', workerDomain);

  // Fallback: create CNAME if needed (Workers custom domains usually auto-create)
  const existingApi = await api(
    `/zones/${ZONE_ID}/dns_records?name=api.engaz.tech`
  );
  log('Existing DNS api', existingApi);

  // 4) List final state
  const pagesDomains = await api(
    `/accounts/${ACCOUNT_ID}/pages/projects/${PAGES_PROJECT}/domains`
  );
  log('All Pages domains', pagesDomains);

  const workerDomains = await api(`/accounts/${ACCOUNT_ID}/workers/domains`);
  log('All Worker domains', workerDomains);

  const dns = await api(`/zones/${ZONE_ID}/dns_records?per_page=100`);
  log(
    'Relevant DNS',
    (dns.json?.result || []).filter((r) =>
      ['pos.engaz.tech', 'api.engaz.tech'].includes(r.name)
    )
  );
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
