const cols = [
  'orders',
  'menu_items',
  'customers',
  'companies',
  'inventory',
  'settings',
  'recipes',
  'inventory_transactions',
  'snapshots',
];

const base = 'https://api.engaz.tech';

async function main() {
  for (const c of cols) {
    const r = await fetch(`${base}/v1/databases/default/collections/${c}/documents`);
    const j = await r.json().catch(() => ({}));
    console.log(c, r.status, 'count=', Array.isArray(j.documents) ? j.documents.length : 'n/a');
  }

  const html = await (await fetch('https://pos.engaz.tech/')).text();
  const m = html.match(/assets\/index-[^"' ]+\.js/);
  console.log('POS_ASSET', m && m[0]);
  if (m) {
    const js = await (await fetch('https://pos.engaz.tech/' + m[0])).text();
    console.log('HAS_SNAPSHOT_SERVICE', js.includes('snapshot') || js.includes('createSnapshot'));
    console.log('HAS_SETTINGS_CLOUD', js.includes('settingsCloud') || js.includes('hydrateSettingsFromCloud'));
    console.log('HAS_API', js.includes('api.engaz.tech'));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
