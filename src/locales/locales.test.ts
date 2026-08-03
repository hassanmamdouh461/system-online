import { describe, it, expect } from 'vitest';
import ar from './ar.json';
import en from './en.json';

/**
 * Regression guard: a t() key with no entry falls back to the raw English key.
 *
 * WHY THIS GUARD EXISTS
 * LanguageContext's t() is:
 *
 *   if (dict && dict[key]) return dict[key];
 *   return key;
 *
 * so a missing translation is not an error — it silently renders the English key
 * text. Seven strings were already wrapped in t() but had no entry in ar.json,
 * which is why an Arabic-only cashier saw "No stock items found",
 * "Search stock items...", "Item Details" and "Refresh" in English on an
 * otherwise fully Arabic, right-to-left screen. The call sites looked correct in
 * review — the bug was the absence of a row in a JSON file, which nothing checked.
 *
 * These assertions make that absence loud instead of silent.
 */

const arDict = ar as Record<string, string>;
const enDict = en as Record<string, string>;

describe('locale dictionaries', () => {
  it('ar.json and en.json define exactly the same keys', () => {
    const missingFromAr = Object.keys(enDict).filter((k) => !(k in arDict));
    const missingFromEn = Object.keys(arDict).filter((k) => !(k in enDict));
    expect(missingFromAr, 'keys present in en.json but missing from ar.json').toEqual([]);
    expect(missingFromEn, 'keys present in ar.json but missing from en.json').toEqual([]);
  });

  it('no Arabic entry is empty or left as the untranslated English key', () => {
    const untranslated = Object.entries(arDict)
      // A handful of entries are legitimately identical in both languages
      // (brand names, currency codes, symbols). Only flag values that contain
      // Latin letters AND no Arabic letters — i.e. genuinely untranslated prose.
      .filter(([key, value]) => {
        if (!value.trim()) return true;
        const hasArabic = /[؀-ۿ]/.test(value);
        const hasLatinWord = /[A-Za-z]{3,}/.test(value);
        return !hasArabic && hasLatinWord && value === key;
      })
      .map(([key]) => key);

    // Locked to the current known set so this cannot silently grow. If you are
    // adding a key, translate it rather than extending this list.
    expect(untranslated).toEqual(ALLOWED_UNTRANSLATED);
  });

  it('the strings reported as untranslated are now translated in ar.json', () => {
    for (const key of [
      'Item Details',
      'Item added successfully',
      'No stock items found',
      'Search stock items...',
      'Search history logs...',
      'Refresh',
      'Recipe materials cost',
    ]) {
      expect(arDict[key], `ar.json has an entry for "${key}"`).toBeTruthy();
      expect(/[؀-ۿ]/.test(arDict[key]), `"${key}" is translated to Arabic`).toBe(true);
    }
  });
});

/**
 * Keys whose Arabic value is still the English text. Kept explicit so the count
 * can only go down. Empty today — do not add to it without a reason.
 */
const ALLOWED_UNTRANSLATED: string[] = [];
