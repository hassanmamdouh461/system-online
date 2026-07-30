/**
 * Rebase a rejected order write against the row D1 actually holds.
 *
 * WHY THIS EXISTS
 * ---------------
 * The Worker enforces last-writer-wins: `ON CONFLICT(id) DO UPDATE ... WHERE
 * COALESCE(excluded.updatedAt,'') > COALESCE(orders.updatedAt,'')`. When the
 * stored row wins, the write is DISCARDED and the Worker answers HTTP 200 with
 * `{ stale: true, current }` — an explicit "rebase and try again", not a
 * success. The client used to read only `response.ok`, so it marked the queue
 * row synced and the change was lost forever (this is how a manager's refund
 * came back from the dead after a cache clear).
 *
 * Retrying the identical payload cannot work — it loses the same comparison
 * again. The write has to be rebased first: merge the local intent with the
 * server's current row, then re-stamp `updatedAt` so the retry is genuinely the
 * newest version of the record.
 *
 * mergeOrderRecords is the right merge: it latches the terminal states, so a
 * refund can never be reverted to Paid and a settled payment can never revert
 * to Unpaid, whichever side happens to be newer.
 *
 * Kept in its own module on purpose: syncService cannot import cloudHydrate
 * (cloudHydrate → settingsCloudService → syncService is a cycle).
 */
import { withDB } from '../repositories/indexeddb/db';
import { mergeOrderRecords } from '../utils/orderNumber';
import type { Order } from '../types/order';

/** Map a raw D1 order row onto the client shape (snake_case + JSON items). */
export function mapRemoteOrderRow(row: Record<string, any>): Record<string, any> {
  let items = row.items;
  if (typeof items === 'string') {
    try {
      items = JSON.parse(items || '[]');
    } catch {
      items = [];
    }
  }
  if (!Array.isArray(items)) items = [];

  return {
    ...row,
    items,
    refundedAt: row.refundedAt ?? row.refunded_at ?? undefined,
    refundReason: row.refundReason ?? row.refund_reason ?? undefined,
    deletedAt: row.deletedAt ?? row.deleted_at ?? undefined,
    updatedAt: row.updatedAt ?? row.updated_at ?? undefined,
    branchId: row.branchId ?? row.branch_id ?? undefined,
  };
}

/**
 * Stamp a timestamp that is strictly newer than the server's copy.
 *
 * Plain `Date.now()` is not enough: the row that beat us may carry a timestamp
 * from a device whose clock runs ahead, and then the rebased retry would lose
 * the comparison again and spin until the record died. Step past the remote
 * value when it is in the future.
 */
function newerThan(remoteUpdatedAt: unknown): string {
  const remoteMs = remoteUpdatedAt ? new Date(String(remoteUpdatedAt)).getTime() : NaN;
  const base = Number.isFinite(remoteMs) ? Math.max(Date.now(), remoteMs + 1) : Date.now();
  return new Date(base).toISOString();
}

/**
 * Merge a discarded local order write with the server row and return the
 * payload to re-push. The rebased row is also written back to IndexedDB so the
 * local copy stops diverging from what the retry will send.
 *
 * `remoteRow` may be absent (an older Worker, or a response shape without
 * `current`). In that case the local intent is re-stamped and re-pushed as-is:
 * losing a field another device edited is bad, but silently dropping a refund
 * is worse, and the terminal-state latches still hold on the next hydration.
 */
export async function rebaseOrderAgainstRemote(
  localData: Record<string, any>,
  remoteRow?: Record<string, any> | null
): Promise<Record<string, any> | null> {
  if (!localData?.id) return null;

  const remote = remoteRow ? mapRemoteOrderRow(remoteRow) : null;
  const merged: Record<string, any> = remote
    ? (mergeOrderRecords(localData as any, remote as any) as Record<string, any>)
    : { ...localData };

  merged.id = localData.id;
  merged.updatedAt = newerThan(remote?.updatedAt);

  // Keep IndexedDB in step with what we are about to push, so a later local
  // edit builds on the rebased row instead of resurrecting the discarded one.
  try {
    await withDB(async (db) => {
      const existing = (await db.get('orders', merged.id)) as Order | undefined;
      await db.put('orders', { ...(existing || {}), ...merged } as Order);
    });
  } catch (err) {
    console.warn('[orderRebase] could not persist rebased order locally:', err);
  }

  return merged;
}
