#!/usr/bin/env node
/**
 * check-money-safety.mjs — guard rail for issue B.1.
 *
 * Enforces the one rule that keeps money correct:
 *
 *   Money arithmetic happens ONLY inside src/utils/money.ts.
 *
 * It fails the build when it finds raw `*` / `+` / `-` on a money value, or a
 * bare `.toFixed(2)` on money (which prints a rounded string while the drifted
 * number stays in the variable and gets stored).
 *
 * Run:  node scripts/check-money-safety.mjs
 * CI:   add to the build/lint step so a regression can't merge.
 */

import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { fileURLToPath } from 'url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(ROOT, 'src');
const MONEY_MODULE = join(SRC, 'utils', 'money.ts');

/** Identifiers that hold money. */
const MONEY_WORDS = [
  'price', 'prices', 'cost', 'costs', 'costPerUnit', 'costVal', 'itemCost', 'itemUnitCost',
  'subtotal', 'lineSubtotal', 'totalAmount', 'taxAmount', 'grandTotal', 'total', 'totals',
  'amount', 'amt', 'balance', 'revenue', 'profit', 'cogs', 'receivables', 'debt',
  'paidAmount', 'paidAmt', 'openAmount', 'cashAmount', 'cardAmount', 'unpaidAmount',
  'potSales', 'potProfit', 'avgYield', 'unitYield', 'allocatedRevenue', 'netProfit',
  'changeAmount', 'received', 'grandTotalDue', 'avgTicket', 'avgOrderValue', 'yield',
];

const isMoneyIdent = (id) => {
  const lower = id.toLowerCase();
  return MONEY_WORDS.some(w => {
    const wl = w.toLowerCase();
    return lower === wl || lower.endsWith(wl) || lower.startsWith(wl);
  });
};

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(p)) out.push(p);
  }
  return out;
}

const violations = [];

for (const file of walk(SRC)) {
  if (file === MONEY_MODULE) continue; // the one place arithmetic is allowed
  const rel = relative(ROOT, file);
  const lines = readFileSync(file, 'utf8').split('\n');

  lines.forEach((line, i) => {
    const lineNo = i + 1;
    const code = line.trim();

    // Skip comments and intentional opt-outs.
    if (code.startsWith('//') || code.startsWith('*') || code.startsWith('/*')) return;
    if (line.includes('money-safety-ignore')) return;

    // ── 1. Raw multiplication / addition / subtraction between money identifiers
    // `*` may hug its operands, but `+`/`-` must have surrounding whitespace —
    // otherwise CSS class names (`total-row`) and HTML parse as arithmetic.
    const arith = /([A-Za-z_$][\w$]*(?:\.[\w$]+)*)\s*(?:(\*)\s*|\s([+\-])\s)([A-Za-z_$][\w$]*(?:\.[\w$]+)*)/g;
    let m;
    while ((m = arith.exec(line)) !== null) {
      const [full, left, mulOp, addOp, right] = m;
      const op = mulOp || addOp;
      const leafOf = (x) => x.split('.').pop();
      const leftIsMoney = isMoneyIdent(leafOf(left));
      const rightIsMoney = isMoneyIdent(leafOf(right));

      // `+` on two money values is always wrong. `*` / `-` is wrong when either side is money.
      const bad = op === '+' ? (leftIsMoney && rightIsMoney) : (leftIsMoney || rightIsMoney);
      if (!bad) continue;

      // String concatenation / template building is not arithmetic.
      if (op === '+' && /['"`]/.test(full)) continue;

      violations.push({
        rel, lineNo, code,
        why: `raw \`${op}\` on money (${full.trim()}) — use addMoney / subtractMoney / multiplyMoney from utils/money`,
      });
    }

    // ── 2. Compound assignment on a money accumulator
    const compound = /([A-Za-z_$][\w$]*(?:\.[\w$]+|\[[^\]]+\])*)\s*([*+\-])=\s*/g;
    while ((m = compound.exec(line)) !== null) {
      const target = m[1];
      const leaf = target.replace(/\[[^\]]+\]/g, '').split('.').pop();
      if (isMoneyIdent(leaf)) {
        violations.push({
          rel, lineNo, code,
          why: `\`${m[2]}=\` on money accumulator (${target}) — use addMoney / subtractMoney`,
        });
      }
    }

    // ── 3. Bare .toFixed(2) on money — rounds the STRING, leaves the value drifted
    const fixed = /([A-Za-z_$][\w$]*(?:\.[\w$]+)*)\s*\.toFixed\(\s*2\s*\)/g;
    while ((m = fixed.exec(line)) !== null) {
      const expr = m[1];
      const leaf = expr.split('.').pop();
      if (isMoneyIdent(leaf) && !line.includes('formatMoney')) {
        violations.push({
          rel, lineNo, code,
          why: `.toFixed(2) on money (${expr}) — use formatMoney() so the string can't disagree with the stored value`,
        });
      }
    }
  });
}

if (violations.length === 0) {
  console.log('✓ money safety: no raw money arithmetic found outside src/utils/money.ts');
  process.exit(0);
}

console.error(`\n✗ money safety: ${violations.length} violation(s)\n`);
console.error('  Money arithmetic must go through src/utils/money.ts (issue B.1).');
console.error('  Add a `money-safety-ignore` comment on the line if a hit is a false positive.\n');
for (const v of violations) {
  console.error(`  ${v.rel}:${v.lineNo}`);
  console.error(`    ${v.code}`);
  console.error(`    → ${v.why}\n`);
}
process.exit(1);
