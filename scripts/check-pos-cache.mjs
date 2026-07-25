async function check(url) {
  const r = await fetch(url + '?cb=' + Date.now(), { cache: 'no-store' });
  const html = await r.text();
  const m = html.match(/assets\/index-[^"]+\.js/);
  console.log(url);
  console.log('  bundle :', m && m[0]);
  console.log('  cf-cache:', r.headers.get('cf-cache-status'), '| age:', r.headers.get('age'));
  console.log('  cache  :', r.headers.get('cache-control'));
  console.log('  etag   :', r.headers.get('etag'));
  console.log('  server :', r.headers.get('server'));
}
await check('https://pos.engaz.tech/');
await check('https://system-online-web.hassanmamdouh461.workers.dev/');
