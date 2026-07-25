/**
 * Simulate post-wipe recovery math against live D1 orders.
 * Verifies the root bug fix: null tax/grandTotal must NOT zero revenue.
 */
function optionalNumber(value) {
  if (value === null || value === undefined || value === '') return undefined;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function getOrderGrandTotal(order, fallbackTaxRate = 0.1) {
  if (typeof order.grandTotal === 'number' && Number.isFinite(order.grandTotal) && order.grandTotal > 0) {
    return order.grandTotal;
  }
  const rate =
    typeof order.taxRate === 'number' && Number.isFinite(order.taxRate)
      ? order.taxRate
      : fallbackTaxRate;
  const tax =
    typeof order.taxAmount === 'number' && Number.isFinite(order.taxAmount)
      ? order.taxAmount
      : order.totalAmount * rate;
  const points = order.pointsRedeemed || 0;
  const total = order.totalAmount + tax - points;
  return Math.max(0, Number.isFinite(total) ? total : 0);
}

// OLD broken mapping (Number(null) => 0)
function brokenMap(doc) {
  return {
    totalAmount: Number(doc.totalAmount) || 0,
    taxRate: typeof doc.taxRate === 'number' ? doc.taxRate : Number(doc.tax_rate),
    taxAmount: typeof doc.taxAmount === 'number' ? doc.taxAmount : Number(doc.tax_amount),
    grandTotal: typeof doc.grandTotal === 'number' ? doc.grandTotal : Number(doc.grand_total),
    paymentStatus: doc.paymentStatus,
  };
}

function fixedMap(doc) {
  return {
    totalAmount: optionalNumber(doc.totalAmount) ?? 0,
    taxRate: optionalNumber(doc.taxRate),
    taxAmount: optionalNumber(doc.taxAmount),
    grandTotal: optionalNumber(doc.grandTotal),
    paymentStatus: doc.paymentStatus,
  };
}

async function main() {
  const res = await fetch('https://api.engaz.tech/v1/databases/default/collections/orders/documents');
  const json = await res.json();
  const docs = json.documents || [];
  console.log('D1_ORDERS', docs.length);

  let brokenRev = 0;
  let fixedRev = 0;
  for (const d of docs) {
    if (d.paymentStatus !== 'Paid') continue;
    const b = brokenMap(d);
    const f = fixedMap(d);
    // old analytics: if typeof grandTotal === 'number' use it (0 from Number(null))
    const oldLine =
      typeof b.grandTotal === 'number' ? b.grandTotal : b.totalAmount + (b.taxAmount || 0);
    const newLine = getOrderGrandTotal(f, 0.1);
    brokenRev += oldLine;
    fixedRev += newLine;
    console.log({
      id: d.id,
      totalAmount: d.totalAmount,
      taxRate: d.taxRate,
      taxAmount: d.taxAmount,
      grandTotal: d.grandTotal,
      OLD_line: oldLine,
      NEW_line: newLine,
      paidAt: d.paidAt,
    });
  }
  console.log('BROKEN_TOTAL', brokenRev);
  console.log('FIXED_TOTAL', fixedRev);

  const html = await (await fetch('https://pos.engaz.tech/')).text();
  const m = html.match(/assets\/index-[A-Za-z0-9_-]+\.js/);
  console.log('LIVE_ASSET', m && m[0]);
  if (m) {
    const js = await (await fetch('https://pos.engaz.tech/' + m[0])).text();
    console.log('HAS_HYDRATE', js.includes('hydrateFromCloud') || js.includes('cloud hydrate'));
    console.log('HAS_API', js.includes('api.engaz.tech'));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
