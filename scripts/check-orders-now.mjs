async function main() {
  const r = await fetch('https://api.engaz.tech/v1/databases/default/collections/orders/documents', {
    headers: { 'X-Branch-ID': 'main_branch' },
  });
  const j = await r.json();
  const docs = j.documents || [];
  console.log('TOTAL_ORDERS_ON_D1:', docs.length);
  console.log('---');

  const sorted = docs.slice().sort(
    (a, b) =>
      new Date(b.createdAt || b.paidAt || 0).getTime() -
      new Date(a.createdAt || a.paidAt || 0).getTime()
  );

  for (const o of sorted) {
    let items = o.items;
    if (typeof items === 'string') {
      try {
        items = JSON.parse(items || '[]');
      } catch {
        items = [];
      }
    }
    if (!Array.isArray(items)) items = [];
    const itemsStr = items
      .map((i) => `${i.quantity || 1}x ${i.name || '?'}`)
      .join(', ');

    console.log(
      JSON.stringify(
        {
          id: o.id,
          orderNumber: o.orderNumber,
          status: o.status,
          payment: o.paymentStatus,
          total: o.totalAmount,
          tax: o.taxAmount,
          grand: o.grandTotal,
          phone: o.customerPhone,
          paidAt: o.paidAt,
          createdAt: o.createdAt,
          items: itemsStr,
          branch: o.branch_id || o.branchId,
        },
        null,
        2
      )
    );
    console.log('---');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
