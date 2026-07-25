async function assetOf(url) {
  const html = await (await fetch(url, { cache: 'no-store' })).text();
  const m = html.match(/assets\/index-[^"' ]+\.js/);
  return m ? m[0] : null;
}

async function main() {
  const targets = [
    'https://pos.engaz.tech/',
    'https://system-online-web.hassanmamdouh461.workers.dev/',
    'https://80f2c10c.system-online.pages.dev/',
  ];
  for (const url of targets) {
    try {
      const asset = await assetOf(url);
      console.log(url, '->', asset);
      if (asset && url.includes('pos.engaz')) {
        const js = await (await fetch(url + asset, { cache: 'no-store' })).text();
        console.log('  snapshotService chunk ref', js.includes('snapshotService'));
        console.log('  settingsCloud string', js.includes('settingsCloud') || js.includes('hydrateSettingsFromCloud') || js.includes('DURABLE_SETTING'));
        console.log('  cloudUpsert', js.includes('cloudUpsert') || js.includes('/v1/databases/default/collections/'));
      }
    } catch (e) {
      console.log(url, 'ERR', e.message);
    }
  }
}

main();
