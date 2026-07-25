/**
 * One-time localStorage cleanup for broken / orphaned / duplicate keys that
 * accumulated across earlier builds (mostly brewmaster_* and i18n_* variants).
 *
 * Runs once per browser, gated by a sentinel key, so it never repeatedly scans.
 * Safe: only removes keys explicitly listed below, never anything by pattern.
 */

const SENTINEL_KEY = 'brewmaster_locale_migration_v1_done';

// Known orphaned / superseded keys from older builds. Newer code uses the
// canonical names on the right; these legacy variants are safe to drop.
const LEGACY_KEYS: Record<string, string | null> = {
  // Old locale stores superseded by i18next-backed keys.
  'brewmaster_locale': null, // no canonical replacement — language now via i18n_* keys
  'brewmaster_language': 'i18nextLng',
  'brewmaster_lang': 'i18nextLng',
  // Old PIN variants before the hashed format landed.
  'brewmaster_pin': 'brewmaster_admin_pin',
  'brewmaster_admin_pin_legacy': null,
  // Old telegram keys — superseded by the structured telegram_config blob.
  'brewmaster_telegram_token': 'brewmaster_telegram_bot_token',
};

// Duplicate-value consolidation: if both the legacy key and its canonical
// counterpart exist, prefer the canonical one and drop the legacy.
export function migrateLocaleKeys(): number {
  if (typeof window === 'undefined') return 0;
  try {
    if (localStorage.getItem(SENTINEL_KEY) === '1') return 0;
  } catch {
    return 0;
  }

  let removed = 0;
  try {
    for (const [legacy, canonical] of Object.entries(LEGACY_KEYS)) {
      const legacyValue = localStorage.getItem(legacy);
      if (legacyValue === null) continue;

      if (canonical) {
        const currentValue = localStorage.getItem(canonical);
        // Only migrate when canonical is empty — never overwrite a real value.
        if (currentValue === null || currentValue === '') {
          localStorage.setItem(canonical, legacyValue);
        }
      }
      localStorage.removeItem(legacy);
      removed++;
    }

    // Dedupe i18nextLng duplicates: a couple of older builds stored the same
    // language under multiple keys. Keep i18nextLng (canonical) and drop the
    // redundant aliases only when they hold the same value.
    const canonical = 'i18nextLng';
    const canonicalVal = localStorage.getItem(canonical);
    if (canonicalVal) {
      for (const alias of ['i18n_lang', 'i18n_language', 'brewmaster_i18n']) {
        if (localStorage.getItem(alias) === canonicalVal) {
          localStorage.removeItem(alias);
          removed++;
        }
      }
    }

    localStorage.setItem(SENTINEL_KEY, '1');
  } catch (err) {
    console.warn('[localeMigration] failed:', err);
  }

  return removed;
}
