/**
 * "Is this device's cloud session still alive?" — tracked from EVIDENCE.
 *
 * THE OUTAGE THIS EXISTS TO SURFACE
 * The Worker's session cookie lasts 12 hours. The password that mints it is held
 * in memory only (`setSessionCredential`), and `ensureCloudSession` says so
 * outright: "No credential ⇒ cannot mint (no anonymous sessions). Ride any
 * existing cookie." So after ANY page refresh this tab can no longer re-mint.
 *
 * Meanwhile the UI session in localStorage (`auth_session_system_online`) has no
 * expiry at all — it is only ever cleared by an explicit logout. The two clocks
 * therefore drift apart, and when the 12h cookie finally expires the result is
 * the worst possible combination: the cashier is still logged in, the screens
 * all work, and every single cloud write comes back 401 with no way to renew.
 * Orders, edits and deletions pile up in IndexedDB and die the moment browser
 * data is cleared — and nothing anywhere told the operator.
 *
 * This module is the missing signal. It is deliberately dependency-free (no
 * import of cloudConfig) so cloudConfig can report into it without an import
 * cycle; the probe that needs cloudConfig lives in the UI layer.
 *
 * WHY EVIDENCE AND NOT A GUESS
 * Being offline is a legitimate, well-supported state with its own honest
 * message — it must never be dressed up as a lost session. Only two things move
 * this module into 'lost':
 *   1. a cloud write actually answered 401 / unauthenticated, or
 *   2. a session probe (GET /v1/session) reported no session while the Worker
 *      is configured AND the browser is online.
 */

export type CloudSessionState =
  /** A write or probe succeeded — the cookie is good. */
  | 'ok'
  /** Proven dead: a 401, or a probe that found no session while online. */
  | 'lost'
  /** Nothing has proved anything yet (fresh load, offline, no cloud). */
  | 'unknown';

let state: CloudSessionState = 'unknown';
/** When the loss was first observed, so the banner can say how long. */
let lostSince: string | null = null;

type Listener = (next: CloudSessionState) => void;
const listeners = new Set<Listener>();

function emit(): void {
  for (const fn of [...listeners]) {
    try {
      fn(state);
    } catch {
      // a broken subscriber must not stop the others
    }
  }
}

function setState(next: CloudSessionState): void {
  if (next === state) return;
  state = next;
  lostSince = next === 'lost' ? new Date().toISOString() : null;
  emit();
}

/**
 * A cloud write came back 401 / unauthenticated. This is the strongest evidence
 * available: the request reached the Worker and the Worker refused the cookie.
 *
 * Note this is NOT called for 403. A 403 is a permission decision about a role
 * that IS authenticated — telling that operator to log in again would be a lie,
 * and would push him to work around a rule the server means to enforce.
 */
export function reportCloudSessionLost(): void {
  setState('lost');
}

/** A write or probe succeeded, so whatever was wrong is over. */
export function reportCloudSessionAlive(): void {
  setState('ok');
}

/**
 * Forget the verdict without claiming either state — used on logout, and when
 * the device goes offline (an unreachable Worker proves nothing about the
 * cookie, so a stale 'lost' must not keep shouting).
 */
export function resetCloudSessionState(): void {
  if (state === 'unknown') return;
  state = 'unknown';
  lostSince = null;
  emit();
}

export function getCloudSessionState(): CloudSessionState {
  return state;
}

export function getCloudSessionLostSince(): string | null {
  return lostSince;
}

export function subscribeCloudSession(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Test-only: drop all state and subscribers between cases. */
export function resetCloudSessionStateForTests(): void {
  state = 'unknown';
  lostSince = null;
  listeners.clear();
}
