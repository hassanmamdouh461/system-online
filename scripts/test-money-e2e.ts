/**
 * End-to-end verification against the ACTUAL application modules.
 * Reproduces the exact scenario from issue B.1.
 */
import { getOrderGrandTotal, getOrderMoney } from '../src/types/order';
import { sumLineTotals, calcTax, calcGrandTotal, sumMoney, lineTotal, formatMoney, addMoney, allocateMoney } from '../src/utils/money';

let pass=0, fail=0;
const chk=(n:string,c:boolean,extra='')=>{ c?pass++:fail++; console.log((c?'  ok   ':'  FAIL ')+n+(extra?'  '+extra:'')); };

console.log('\n════ ISSUE B.1: 3 items x 33.33 + 14% tax ════\n');
console.log('  OLD (raw float):');
const oldSub = 3*33.33, oldTax = oldSub*0.14, oldGrand = oldSub+oldTax;
console.log(`    subtotal   = ${oldSub}`);
console.log(`    taxAmount  = ${oldTax}`);
console.log(`    grandTotal = ${oldGrand}      <-- STORED IN DB`);
console.log(`    displayed  = ${oldGrand.toFixed(2)}      <-- screen lied`);

console.log('\n  NEW (money.ts):');
const items = [{ id:'a', name:'Latte', price:33.33, quantity:3 }];
const sub = sumLineTotals(items);
const tax = calcTax(sub, 0.14);
const grand = calcGrandTotal(sub, tax);
console.log(`    subtotal   = ${sub}`);
console.log(`    taxAmount  = ${tax}`);
console.log(`    grandTotal = ${grand}                 <-- STORED IN DB`);
console.log(`    displayed  = ${formatMoney(grand)}                 <-- matches stored`);

chk('stored grandTotal has no float dust', String(grand)==='113.99', `(${grand})`);
chk('stored value === displayed value', String(grand)===formatMoney(grand));
chk('receipt lines sum EXACTLY to stored subtotal',
    sumMoney(items.map(i=>lineTotal(i.price,i.quantity)))===sub);
chk('subtotal + tax === stored grandTotal (to the millieme)', addMoney(sub,tax)===grand);

console.log('\n════ THE RECEIPT INVARIANT (3 separate lines) ════\n');
const three = [
  {id:'1',name:'Espresso',price:33.33,quantity:1},
  {id:'2',name:'Latte',price:33.33,quantity:1},
  {id:'3',name:'Mocha',price:33.33,quantity:1},
];
const s3 = sumLineTotals(three), t3 = calcTax(s3,0.14), g3 = calcGrandTotal(s3,t3);
three.forEach(i=>console.log(`    ${i.quantity}x ${i.name.padEnd(10)} ${formatMoney(lineTotal(i.price,i.quantity)).padStart(8)}`));
console.log(`    ${''.padEnd(13)} ${'--------'}`);
console.log(`    Subtotal     ${formatMoney(s3).padStart(8)}`);
console.log(`    Tax (14%)    ${formatMoney(t3).padStart(8)}`);
console.log(`    TOTAL        ${formatMoney(g3).padStart(8)}`);
const printedLines = three.map(i=>lineTotal(i.price,i.quantity));
chk('printed lines add up to printed subtotal', sumMoney(printedLines)===s3);
chk('printed subtotal + tax === printed total', addMoney(s3,t3)===g3);

console.log('\n════ getOrderGrandTotal heals legacy drifted rows ════\n');
const legacy = { totalAmount: 99.99000000000001, taxRate: 0.14, taxAmount: 13.998600000000001, grandTotal: 112.49999999999999 };
const healed = getOrderGrandTotal(legacy as any, 0.14);
console.log(`    stored grandTotal : ${legacy.grandTotal}`);
console.log(`    read back as      : ${healed}`);
chk('legacy drifted grandTotal rounds on read', healed===112.5, `(${healed})`);

const m = getOrderMoney({ totalAmount: 99.99000000000001, taxRate: 0.14, taxAmount: undefined, grandTotal: undefined } as any, 0.14);
chk('getOrderMoney re-derives clean triple', m.subtotal===99.99 && m.taxAmount===14 && m.grandTotal===113.99,
    `(${m.subtotal}/${m.taxAmount}/${m.grandTotal})`);
chk('missing snapshot: subtotal+tax === grandTotal', addMoney(m.subtotal,m.taxAmount)===m.grandTotal);

console.log('\n════ analytics allocation reconciles ════\n');
const weights = three.map(i=>lineTotal(i.price,i.quantity));
const shares = allocateMoney(g3, weights);
shares.forEach((sh,i)=>console.log(`    ${three[i].name.padEnd(10)} revenue share = ${formatMoney(sh)}`));
console.log(`    ${'TOTAL'.padEnd(10)} ${' '.repeat(16)}${formatMoney(sumMoney(shares))}`);
chk('per-item revenue sums back to order total (no leaked piasters)', sumMoney(shares)===g3);

console.log('\n════ 1000 random orders: drawer vs report ════\n');
let drawer=0, reportSub=0, reportTax=0;
for(let n=0;n<1000;n++){
  const its = Array.from({length:1+(n%5)},(_,k)=>({id:String(k),name:'x',price:Math.round((5+((n*7+k*13)%9000)/100)*100)/100,quantity:1+((n+k)%4)}));
  const sb=sumLineTotals(its), tx=calcTax(sb,0.14), gt=calcGrandTotal(sb,tx);
  // the receipt the customer gets
  if(sumMoney(its.map(i=>lineTotal(i.price,i.quantity)))!==sb) { fail++; console.log('  FAIL receipt mismatch at order '+n); break; }
  if(addMoney(sb,tx)!==gt) { fail++; console.log('  FAIL total mismatch at order '+n); break; }
  drawer=addMoney(drawer,gt); reportSub=addMoney(reportSub,sb); reportTax=addMoney(reportTax,tx);
}
console.log(`    drawer total       = ${formatMoney(drawer)}`);
console.log(`    report sub + tax   = ${formatMoney(addMoney(reportSub,reportTax))}`);
chk('1000-order drawer === report (exact reconciliation)', drawer===addMoney(reportSub,reportTax));

console.log('\n'+'═'.repeat(52));
console.log(`  PASS ${pass}   FAIL ${fail}`);
console.log('═'.repeat(52)+'\n');
process.exit(fail===0?0:1);
