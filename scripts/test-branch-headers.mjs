async function getOrders(branchHeader) {
  const r = await fetch(
    'https://api.engaz.tech/v1/databases/default/collections/orders/documents',
    {
      headers: branchHeader ? { 'X-Branch-ID': branchHeader } : {},
    }
  );
  const j = await r.json();
  const docs = j.documents || [];
  const paid = docs.filter((o) => o.paymentStatus === 'Paid');
  const revenue = paid.reduce((s, o) => {
    const g = Number(o.grandTotal);
    if (Number.isFinite(g) && g > 0) return s + g;
    return s + (Number(o.totalAmount) || 0);
  }, 0);
  return {
    header: branchHeader || '(none)',
    count: docs.length,
    paid: paid.length,
    revenue: Math.round(revenue * 100) / 100,
  };
}

async function main() {
  for (const h of [undefined, 'default', 'main_branch', 'manager', 'all']) {
    console.log(await getOrders(h));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
