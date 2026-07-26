/**
 * test-money.ts — regression suite for issue B.1 (float money).
 *
 * Run:  node --experimental-strip-types scripts/test-money.ts
 *   or bundle it:  esbuild scripts/test-money.ts --bundle --platform=node | node
 *
 * Exits non-zero on any failure so it can gate CI.
 */
import {
  roundMoney, addMoney, sumMoney, multiplyMoney, lineTotal, sumLineTotals,
  calcTax, calcGrandTotal, allocateMoney, moneyPercent, averageMoney,
  calcChangeDue, subtractMoney, toMinor, fromMinor, moneyEquals, safeMoney,
} from '../src/utils/money';

let pass = 0, fail = 0;
const eq = (name: string, actual: any, expected: any) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       got      ${JSON.stringify(actual)}\n       expected ${JSON.stringify(expected)}`); }
};

console.log('\n--- The reported bug: 3 x 33.33 + 14% ---');
console.log('  raw float:', 3 * 33.33 + (3 * 33.33) * 0.14);
const items = [{ price: 33.33, quantity: 3 }];
const sub = sumLineTotals(items);
const tax = calcTax(sub, 0.14);
const grand = calcGrandTotal(sub, tax);
eq('subtotal   = 99.99', sub, 99.99);
eq('tax @14%   = 14.00', tax, 14);
eq('grandTotal = 113.99', grand, 113.99);
eq('grandTotal is exact (no dust)', String(grand), '113.99');
eq('receipt lines sum == stored subtotal', sumMoney(items.map(i => lineTotal(i.price, i.quantity))), sub);

console.log('\n--- 3 separate lines of 33.33 (receipt reconciliation) ---');
const three = [{price:33.33,quantity:1},{price:33.33,quantity:1},{price:33.33,quantity:1}];
const s3 = sumLineTotals(three);
eq('subtotal = 99.99', s3, 99.99);
eq('lines sum to subtotal exactly', sumMoney(three.map(i=>lineTotal(i.price,i.quantity))), s3);
const t3 = calcTax(s3, 0.14);
eq('grand = 113.99', calcGrandTotal(s3, t3), 113.99);

console.log('\n--- classic float traps ---');
eq('0.1 + 0.2 = 0.3', addMoney(0.1, 0.2), 0.3);
eq('112.49999999999999 -> 112.5', roundMoney(112.49999999999999), 112.5);
eq('1.005 -> 1.01 (half-up preserved)', roundMoney(1.005), 1.01);
eq('99.99 * 0.14 = 14.00', multiplyMoney(99.99, 0.14), 14);
eq('0.07 * 3 = 0.21', multiplyMoney(0.07, 3), 0.21);
eq('19.99 * 3 = 59.97', lineTotal(19.99, 3), 59.97);
eq('4.35 * 100 = 435', multiplyMoney(4.35, 100), 435);
eq('sum of 10x 0.1 = 1', sumMoney(Array(10).fill(0.1)), 1);
eq('sum of 100x 0.01 = 1', sumMoney(Array(100).fill(0.01)), 1);
eq('1.1 - 1.0 = 0.1', subtractMoney(1.1, 1.0), 0.1);
eq('negative round symmetric', roundMoney(-1.005), -1.01);

console.log('\n--- garbage input safety ---');
eq('undefined -> 0', roundMoney(undefined), 0);
eq('null -> 0', roundMoney(null), 0);
eq('NaN -> 0', roundMoney(NaN), 0);
eq('Infinity -> 0', roundMoney(Infinity), 0);
eq('"" -> 0', roundMoney(''), 0);
eq('"33.33" -> 33.33', roundMoney('33.33'), 33.33);
eq('safeMoney(null,5) -> 5', safeMoney(null, 5), 5);
eq('tax with null rate -> 0', calcTax(100, null), 0);
eq('averageMoney div0 -> 0', averageMoney(100, 0), 0);
eq('changeDue underpay -> 0', calcChangeDue(50, 113.99), 0);
eq('changeDue 120 - 113.99 = 6.01', calcChangeDue(120, 113.99), 6.01);
eq('grandTotal clamps negative', calcGrandTotal(-50, 0), 0);

console.log('\n--- minor units ---');
eq('toMinor(112.49999999999999) = 11250', toMinor(112.49999999999999), 11250);
eq('toMinor(33.33) = 3333', toMinor(33.33), 3333);
eq('fromMinor(11399) = 113.99', fromMinor(11399), 113.99);
eq('moneyEquals(0.1+0.2, 0.3)', moneyEquals(addMoney(0.1,0.2), 0.3), true);

console.log('\n--- allocation must reconcile (no leaked piasters) ---');
const a1 = allocateMoney(100, [1,1,1]);
eq('100 / 3 parts', a1, [33.34, 33.33, 33.33]);
eq('parts sum to 100 exactly', sumMoney(a1), 100);
const a2 = allocateMoney(113.99, [33.33, 33.33, 33.33]);
eq('113.99 across 3 equal weights sums back', sumMoney(a2), 113.99);
const a3 = allocateMoney(0.05, [1,1,1,1,1,1]);
eq('0.05 across 6 parts sums back', sumMoney(a3), 0.05);
eq('zero weights keep the money', sumMoney(allocateMoney(50, [0,0,0])), 50);
eq('empty weights -> []', allocateMoney(50, []), []);

console.log('\n--- percentages ---');
eq('50 of 200 = 25%', moneyPercent(50, 200), 25);
eq('div by zero -> 0%', moneyPercent(50, 0), 0);
eq('1/3 with 2dp', moneyPercent(1, 3, 2), 33.33);

console.log(`\n${'='.repeat(46)}\n  PASS ${pass}   FAIL ${fail}\n${'='.repeat(46)}\n`);
process.exit(fail === 0 ? 0 : 1);
