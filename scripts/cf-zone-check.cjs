const fs = require('fs');
const path = process.env.APPDATA + '/xdg.config/.wrangler/config/default.toml';
const toml = fs.readFileSync(path, 'utf8');
const match = toml.match(/oauth_token\s*=\s*"([^"]+)"/);
if (!match) {
  console.error('No oauth token found');
  process.exit(1);
}
const token = match[1];

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
  const zones = await api('/zones?name=engaz.tech');
  console.log('ZONES:', JSON.stringify(zones, null, 2));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
