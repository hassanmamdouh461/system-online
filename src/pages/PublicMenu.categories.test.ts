import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Regression guard: the customer-facing menu must show every available item,
 * under the category the operator actually assigned.
 *
 * WHY THIS GUARD EXISTS
 * /public-menu had two defects that combined into lost sales:
 *
 *   1. smartCategorize() re-derived each item's category by matching ENGLISH
 *      keywords ('frappe', 'iced', 'milkshake') against the item name, with a
 *      final `else` branch that stamped anything unmatched as 'Hot Coffee|Bar'.
 *      The menu is predominantly Arabic-named, and an Arabic name matches no
 *      English keyword — so sandwiches, desserts and sides were all relabelled
 *      as hot coffee and shown to the customer under that heading.
 *   2. The category list excluded 'Kitchen', 'General' and 'Bar' while the item
 *      filter matched categories by exact equality. An item whose menu category
 *      was any of those three had no tab to appear under, so it was absent from
 *      the customer's menu entirely — with no empty state and nothing anywhere
 *      in the UI indicating that items were being withheld.
 *
 * Business impact: an item a customer cannot see is an item a customer cannot
 * order. The QR menu is the ordering surface for seated customers, so this was
 * revenue quietly not being collected on the food side of the menu, plus a
 * visibly wrong menu (a sandwich listed under Hot Coffee) that costs trust.
 *
 * The menu editor has no fixed category vocabulary — MenuModal builds its list
 * from the categories already present on items and lets the operator invent new
 * ones — so inferring categories on the display side can never be correct. The
 * only correct behaviour is to read what was stored.
 *
 * This page mounts heavy browser dependencies at import time, so — following the
 * convention in IndexedDbOrderRepository.updatedAt.test.ts — these assertions
 * run against the module source.
 */

const SRC = readFileSync(resolve(__dirname, './PublicMenu.tsx'), 'utf8');

/** Strip comments, so prose describing the old behaviour cannot fail the guard. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const BODY = code(SRC);

describe('public menu categories come from the data, not from keywords', () => {
  it('smartCategorize is gone entirely', () => {
    expect(BODY).not.toContain('smartCategorize');
  });

  it('no keyword-guessing lists remain', () => {
    // The exact mechanism that mislabelled Arabic-named food as hot coffee.
    expect(BODY).not.toMatch(/frappeKw|milkshakeKw|icedKw/);
    // No `nameLower`-style inspection of the item name for categorisation.
    // ('cold brew' still legitimately appears in ITEM_TRANSLATIONS as an item
    // name — that is a display translation, not a categorisation input.)
    expect(BODY).not.toContain('nameLower');
    expect(BODY).not.toMatch(/menuCategory\s*=\s*'Hot Coffee'/);
  });

  it('the four hardcoded sections are no longer a fallback category list', () => {
    // 'Hot Coffee' etc. must not appear as a defaults array driving the tabs.
    expect(BODY).not.toMatch(/defaults\s*=\s*\[/);
    expect(BODY).not.toMatch(/\[\s*'Hot Coffee',\s*'Iced Coffee'/);
  });

  it('items are stored unmodified — the fetch does not remap categories', () => {
    expect(BODY).toMatch(/setItems\(fetchedItems\)/);
  });
});

describe('every available item is reachable', () => {
  it('Kitchen / General / Bar are no longer excluded from the category list', () => {
    // This exclusion, combined with equality filtering, is what hid food items.
    expect(BODY).not.toMatch(/menuCat\s*!==\s*'Kitchen'/);
    expect(BODY).not.toMatch(/menuCat\s*!==\s*'General'/);
    expect(BODY).not.toMatch(/menuCat\s*!==\s*'Bar'/);
  });

  it('there is an uncategorised bucket so a blank category cannot hide an item', () => {
    expect(BODY).toContain('UNCATEGORISED');
    // Must be a real, displayable Arabic label, not an empty string.
    expect(SRC).toMatch(/const UNCATEGORISED = '[^']+'/);
  });

  it('the tab list and the item filter use the same category function', () => {
    // The invariant that makes "no hidden items" structural rather than
    // incidental: one function decides both, so they cannot disagree.
    const helper = /function publicMenuCategory\(/;
    expect(BODY).toMatch(helper);

    const uses = BODY.match(/publicMenuCategory\(/g) || [];
    // Declaration + use in the category list + use in the filter.
    expect(uses.length).toBeGreaterThanOrEqual(3);
  });

  it('the filter no longer re-splits the category inline', () => {
    // An inline split next to the helper would be a second, divergent source of
    // truth — exactly how the tabs and the filter drifted apart before.
    expect(BODY).not.toMatch(/const menuCat = item\.category \? item\.category\.split/);
  });
});

describe('empty menu is reported honestly', () => {
  it('an empty menu says the menu is unavailable, not "this section is empty"', () => {
    // A fresh install has no menu items at all (auto-seeding was removed), so
    // this is a reachable state, not a theoretical one.
    expect(SRC).toContain('القائمة غير متاحة حالياً');
    expect(BODY).toMatch(/activeCategories\.length === 0/);
  });
});
