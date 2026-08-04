import { describe, it, expect } from 'vitest';
import { describePersistOutcome } from './persistOutcomeReport';

/**
 * Regression guard: a settings-list change may only look successful when the
 * CLOUD confirmed it.
 *
 * THE OUTAGE THIS PREVENTS
 * Deleting a table, a staff member or a menu category goes through
 * `persistSetting`, which returns a truthful `PersistOutcome`. Every caller used
 * to write `void persistSetting(...)` and drop it on the floor, so all four
 * outcomes rendered the same way: the row left the screen and the operator read
 * that as "deleted". Three of the four were not deletions at all —
 *
 *   'queued'      the D1 write failed; only the local sync queue remembers it.
 *   'local_only'  it never left localStorage.
 *   'forbidden'   a cashier touched a manager-only key; `enqueueSettingSync`
 *                 refuses to queue a write that can only 403, so the delete is
 *                 not late, it is never happening.
 *
 * The operator then cleared site data — wiping localStorage AND the queue — and
 * the next hydrate pulled the deleted table back out of D1. "I removed it, I
 * cleared the cache, and I found it back."
 *
 * These assertions pin the two rules that close it: green is reserved for
 * 'synced', and a certain refusal is reported as an error, never as a
 * pending-retry warning that implies waiting will fix it.
 */
describe('describePersistOutcome', () => {
  it('reserves the green path for a cloud-confirmed write', () => {
    // null = "no warning to show"; the caller then prints its own success.
    expect(describePersistOutcome('synced', 'ar')).toBeNull();
    expect(describePersistOutcome('synced', 'en')).toBeNull();
  });

  it('never returns a success tone for an unconfirmed write', () => {
    for (const outcome of ['queued', 'local_only', 'forbidden'] as const) {
      for (const lang of ['ar', 'en']) {
        const report = describePersistOutcome(outcome, lang);
        expect(report, `${outcome}/${lang} must produce a report`).not.toBeNull();
        expect(report!.tone, `${outcome} must not be dressed as success`).not.toBe('success');
      }
    }
  });

  it('warns — amber, retryable — when the write is merely unconfirmed', () => {
    for (const outcome of ['queued', 'local_only'] as const) {
      expect(describePersistOutcome(outcome, 'ar')!.tone).toBe('warning');
    }
  });

  it('tells the operator not to clear browser data while a change is unconfirmed', () => {
    // This sentence is the actionable half of the warning: the sync queue lives
    // in IndexedDB, so "clear site data" is the one action that destroys the
    // pending change for good.
    expect(describePersistOutcome('queued', 'ar')!.message).toContain('لا تمسح بيانات المتصفح');
    expect(describePersistOutcome('queued', 'en')!.message).toContain('Do not clear browser data');
  });

  it('reports a role refusal as an error, not a pending retry', () => {
    // 'forbidden' is a server permission decision (see
    // cloudflare-worker/src/permissions.ts). Showing it as amber "pending" would
    // tell the cashier to wait for a sync that is never coming.
    const ar = describePersistOutcome('forbidden', 'ar')!;
    const en = describePersistOutcome('forbidden', 'en')!;
    expect(ar.tone).toBe('error');
    expect(en.tone).toBe('error');
    expect(ar.message).toContain('مدير');
    expect(en.message).toContain('manager');
  });

  it('answers in Arabic for ar and English for anything else', () => {
    expect(/[؀-ۿ]/.test(describePersistOutcome('queued', 'ar')!.message)).toBe(true);
    expect(/[؀-ۿ]/.test(describePersistOutcome('queued', 'en')!.message)).toBe(false);
  });
});
