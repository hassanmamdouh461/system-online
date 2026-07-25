async function main() {
  const html = await (await fetch('https://pos.engaz.tech/')).text();
  const m = html.match(/assets\/index-[^"' ]+\.js/);
  console.log('HTML_ASSET', m && m[0]);
  if (!m) return;
  const js = await (await fetch('https://pos.engaz.tech/' + m[0])).text();
  console.log('HAS_API', js.includes('api.engaz.tech'));
  console.log('HAS_CLOUDCONFIG_MARKER', js.includes('brewmaster_d1_worker_url'));
  console.log('BUNDLE_LEN', js.length);

  const orders = await (await fetch('https://api.engaz.tech/v1/databases/default/collections/orders/documents')).json();
  console.log('D1_ORDERS', orders.documents.length);
  const now = new Date();
  console.log('SERVER_NOW_UTC', now.toISOString());
  for (const o of orders.documents) {
    const d = new Date(o.paidAt || o.createdAt);
    const isToday = d.toDateString() === now.toDateString();
    console.log({
      id: o.id,
      pay: o.paymentStatus,
      total: o.totalAmount,
      paidAt: o.paidAt,
      isTodayLocal: isToday,
    });
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
