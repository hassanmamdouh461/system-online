/**
 * Local store for the refund escalation PIN.
 *
 * The Cloudflare Worker requires the X-Refund-PIN header to let a session write
 * refund fields (refundedAt / refundReason) on an order. The PIN itself is a
 * server secret (env.REFUND_PIN) — the client keeps only the value the manager
 * typed, in memory + sessionStorage, so it survives a reload on the same tab
 * but is never persisted to localStorage (a POS till is often a shared device).
 *
 * A refund authorized with the PIN works for ANY authenticated role on the
 * server (the Worker treats a valid PIN as proven refund authority), so a
 * cashier can escalate a single refund without holding the manager password.
 */

const SESSION_KEY = 'pos_refund_pin';

let memoryPin: string | null = null;

function readSessionPin(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return sessionStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

/** Store the PIN for the current tab session (empty clears it). */
export function setRefundPin(pin: string | null | undefined): void {
  const value = (pin || '').trim();
  memoryPin = value || null;
  if (typeof window === 'undefined') return;
  try {
    if (memoryPin) sessionStorage.setItem(SESSION_KEY, memoryPin);
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // ignore
  }
}

/** The currently held PIN, or null when none was entered this session. */
export function getRefundPin(): string | null {
  return memoryPin || readSessionPin();
}

/** True when a PIN is held and a refund can be escalated. */
export function hasRefundPin(): boolean {
  return !!getRefundPin();
}

/** Clear the held PIN (e.g. after logout). */
export function clearRefundPin(): void {
  setRefundPin(null);
}
