/**
 * "Has the cloud settings hydrate finished yet?" — an app-wide, observable signal.
 *
 * WHY THIS EXISTS
 * ---------------
 * Components that keep a durable, cloud-backed list in React state (POSView's
 * table list and staff list) seed that state from localStorage on mount. On a
 * device whose localStorage is empty — a brand-new till, a private window, a
 * cleared cache — that seed is the hard-coded DEFAULT, not the truth.
 *
 * Before PR #25 every settings write to D1 was rejected, so uploading that
 * default was harmless. Once writes started working, the mount-time upload
 * became a data-loss bug: the default list was pushed to D1 with a FRESH
 * timestamp, beat the older real value under the freshness guard, and wiped the
 * shop's real table names (`["وي","التعاون","Engaz","tea","Tech"]` -> `["1".."8"]`)
 * and the entire staff list on every device (production, 2026-08-03 15:15:22Z).
 *
 * The rule that follows: a device may not push a durable list to the cloud
 * until it knows what the cloud holds. This module is that gate.
 *
 * Two distinct facts, because callers legitimately need both:
 *   settled   — a hydrate attempt FINISHED (it may have failed: offline, 401).
 *   succeeded — a hydrate attempt actually READ the cloud copy.
 * A till that is merely offline must still be able to save the table its
 * operator just added; a till that has never seen the cloud AND has no local
 * copy must not upload its defaults over one. `succeeded` is what separates
 * those two cases.
 */

export type SettingsHydrationState = {
  /** A hydrate attempt has finished — successfully or not. */
  settled: boolean;
  /** A hydrate attempt has genuinely read the cloud copy. */
  succeeded: boolean;
};

let state: SettingsHydrationState = { settled: false, succeeded: false };
const listeners = new Set<(s: SettingsHydrationState) => void>();

/** Current hydration state (a snapshot — safe to hold). */
export function getSettingsHydrationState(): SettingsHydrationState {
  return state;
}

/** Convenience: has an attempt finished, whatever its outcome? */
export function isSettingsHydrationSettled(): boolean {
  return state.settled;
}

/** Convenience: has an attempt actually read the cloud? */
export function didSettingsHydrationSucceed(): boolean {
  return state.succeeded;
}

/**
 * Record that a hydrate attempt finished. Subscribers are notified only on a
 * real transition — first settle, and the first upgrade from failed to
 * succeeded — because hydrate re-runs every ~10s on the manager dashboard.
 */
export function markSettingsHydrationSettled(ok: boolean): void {
  const settledNow = !state.settled;
  const succeededNow = ok && !state.succeeded;
  if (!settledNow && !succeededNow) return;

  state = { settled: true, succeeded: state.succeeded || ok };
  for (const listener of [...listeners]) {
    try {
      listener(state);
    } catch {
      // a broken subscriber must not block the others
    }
  }
}

/**
 * Observe hydration transitions. The callback fires on each state change (not
 * on subscribe); read `getSettingsHydrationState()` for the value you have
 * missed. Returns an unsubscribe function for component cleanup.
 */
export function subscribeSettingsHydration(
  callback: (s: SettingsHydrationState) => void
): () => void {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

/** Test-only: return the gate to its pristine, closed state. */
export function resetSettingsHydrationForTests(): void {
  state = { settled: false, succeeded: false };
  listeners.clear();
}
