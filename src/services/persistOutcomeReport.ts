import type { PersistOutcome } from './settingsCloudService';

/**
 * Turn a `PersistOutcome` into something an operator can act on.
 *
 * THE BUG THIS EXISTS TO CLOSE
 * Deleting a table, a staff member or a menu category goes through
 * `persistSetting`, which has always returned a truthful `PersistOutcome` — and
 * every caller `void`-ed the call and threw the result away. The row vanished
 * from the screen, so the operator read that as "deleted". In three of the four
 * possible outcomes it was not:
 *
 *   'queued'      the cloud write failed; only IndexedDB's sync queue still
 *                 remembers the deletion.
 *   'local_only'  no cloud configured, or the push gate is still shut — the
 *                 deletion never left localStorage at all.
 *   'forbidden'   a cashier session touched a manager-only key.
 *                 `enqueueSettingSync` refuses to even queue it (a queued 403
 *                 would sit there as a dead row and light up the "failed" badge),
 *                 so this deletion is not merely late — it is never happening.
 *
 * In all three the operator then cleared site data, the queue and the
 * localStorage copy went with it, and the next hydrate pulled the deleted table
 * back out of D1. Reporting the outcome honestly is the whole fix; the amber
 * wording deliberately matches the delete paths shipped alongside it so the two
 * read as one behaviour.
 */
export type PersistReport = {
  /** Which toast channel to use. `success` is reserved for a confirmed D1 write. */
  tone: 'success' | 'warning' | 'error';
  title: string;
  message: string;
};

/**
 * `null` means "confirmed by the cloud" — the caller owns the green message
 * because only it knows what was deleted ("table 5", "the Drinks category").
 * Any non-null report MUST be shown; it is the difference between a deletion
 * that survives a cache clear and one that does not.
 */
export function describePersistOutcome(
  outcome: PersistOutcome,
  language: string
): PersistReport | null {
  const ar = language === 'ar';

  switch (outcome) {
    case 'synced':
      return null;

    case 'forbidden':
      // A certain, permanent refusal — not a retry. The server's permission
      // rules are deliberate policy (cloudflare-worker/src/permissions.ts); the
      // client's job is to report the refusal, never to work around it.
      return {
        tone: 'error',
        title: ar ? 'العملية مرفوضة' : 'Not permitted',
        message: ar
          ? 'التعديل ده محتاج صلاحية مدير — سجّل دخول كمدير وأعد المحاولة. التغيير على هذا الجهاز فقط ولن يُحفظ على السحاب.'
          : 'This change requires a manager account — sign in as manager and try again. It is on this device only and will not be saved to the cloud.',
      };

    case 'queued':
    case 'local_only':
    default:
      return {
        tone: 'warning',
        title: ar ? 'التعديل في انتظار المزامنة' : 'Change pending sync',
        message: ar
          ? 'تم التعديل على هذا الجهاز، لكنه لم يتأكد على السحاب بعد. لا تمسح بيانات المتصفح قبل نجاح المزامنة وإلا سيرجع السجل.'
          : 'Changed on this device, but not confirmed in the cloud yet. Do not clear browser data before it syncs, or the record will come back.',
      };
  }
}
