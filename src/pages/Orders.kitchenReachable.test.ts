import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Regression guard: the kitchen kanban board must stay reachable.
 *
 * The README's headline feature is "Live Kanban Board — New → Preparing → Ready".
 * The board was fully implemented (columns, ordering, animation, and a card click
 * handler that advances New → Preparing → Ready → Completed) but no user could
 * ever see it:
 *
 *   const [activeView] = useState<'pos'|'tracker'>(type === 'all' ? 'pos' : 'tracker');
 *
 * There was no setter, so the value never changed, and every route in App.tsx
 * passes type="all" — which pinned activeView to 'pos' and made the tracker branch
 * of the JSX dead code. The practical result: an order's status column was written
 * on every row and then never advanced by anything, so fully paid invoices sat at
 * status 'New' forever and the chef had no screen at all.
 *
 * These assertions read the source because the page pulls in IndexedDB-backed
 * contexts at import time — the same convention the repository guards use.
 */
const orders = readFileSync(resolve(__dirname, './Orders.tsx'), 'utf8');
const app = readFileSync(resolve(__dirname, '../App.tsx'), 'utf8');

describe('kitchen kanban board is reachable', () => {
  it('activeView has a setter', () => {
    expect(orders).toMatch(/const \[activeView, setActiveView\] = useState</);
  });

  it('something actually calls the setter', () => {
    expect(orders).toMatch(/setActiveView\(/);
  });

  it('the cashier screen renders a Kitchen Board tab', () => {
    expect(orders).toContain("label: 'Kitchen Board'");
    expect(orders).toContain("label: 'Cashier Board'");
    expect(orders).toMatch(/onClick=\{\(\) => setActiveView\(tab\.view\)\}/);
  });

  it('a dedicated /kitchen route opens straight onto the board', () => {
    expect(app).toMatch(/path="\/kitchen"/);
    expect(app).toMatch(/initialView="tracker"/);
  });

  it('the tracker branch is still rendered for the kitchen view', () => {
    // The POS branch must be conditional on activeView, not just on type —
    // gating only on `type === 'all'` is what made the board unreachable.
    expect(orders).toContain("type === 'all' && activeView === 'pos' ?");
  });
});
