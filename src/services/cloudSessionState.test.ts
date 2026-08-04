import { describe, it, expect, beforeEach } from 'vitest';
import {
  getCloudSessionState,
  getCloudSessionLostSince,
  reportCloudSessionAlive,
  reportCloudSessionLost,
  resetCloudSessionState,
  resetCloudSessionStateForTests,
  subscribeCloudSession,
} from './cloudSessionState';

/**
 * Regression guard: an expired cloud session must become a visible, evidence-
 * based state — and being offline must never be mistaken for one.
 *
 * THE OUTAGE THIS PREVENTS
 * The Worker mints a session cookie that lives 12 hours. The password that mints
 * it is held in memory only, and `ensureCloudSession` is explicit that without a
 * credential it cannot mint at all — it can only "ride any existing cookie". So
 * after any page refresh the tab has no way to renew.
 *
 * The UI session is the opposite: `auth_session_system_online` in localStorage
 * has no expiry and is cleared only by an explicit logout. Once the 12h cookie
 * lapses the two disagree in the most damaging way possible — the cashier is
 * still "logged in", every screen works, and every cloud write returns 401.
 * Orders, edits and deletes pile up in IndexedDB and the sync queue, and the
 * first cache clear destroys the lot. Nothing in the UI said a word.
 *
 * The rule these tests pin down: the state moves to 'lost' only on EVIDENCE — a
 * write that actually got a 401, or a session probe that found no session while
 * the Worker is configured and the browser is online. Offline is a legitimate,
 * supported state with its own message, and it must never raise the alarm.
 */
beforeEach(() => {
  resetCloudSessionStateForTests();
});

describe('cloud session state', () => {
  it('starts unknown — a fresh load has proved nothing either way', () => {
    expect(getCloudSessionState()).toBe('unknown');
    expect(getCloudSessionLostSince()).toBeNull();
  });

  it('goes to lost only when something reports real evidence', () => {
    // Nothing has happened yet, so nothing may claim the session is dead.
    expect(getCloudSessionState()).toBe('unknown');

    reportCloudSessionLost();

    expect(getCloudSessionState()).toBe('lost');
  });

  it('stamps when the loss was first observed', () => {
    reportCloudSessionLost();
    expect(getCloudSessionLostSince()).toBeTruthy();
  });

  it('a confirmed write clears the alarm', () => {
    reportCloudSessionLost();
    expect(getCloudSessionState()).toBe('lost');

    reportCloudSessionAlive();

    expect(getCloudSessionState()).toBe('ok');
    expect(getCloudSessionLostSince()).toBeNull();
  });

  it('going offline retracts the verdict instead of keeping a stale alarm', () => {
    // An unreachable Worker proves nothing about the cookie. Continuing to shout
    // "your session expired" at a cashier who is simply offline is false, and it
    // would train the staff to ignore the banner that matters.
    reportCloudSessionLost();

    resetCloudSessionState();

    expect(getCloudSessionState()).toBe('unknown');
    expect(getCloudSessionLostSince()).toBeNull();
  });

  it('notifies subscribers on every real transition, and not on a repeat', () => {
    const seen: string[] = [];
    subscribeCloudSession((s) => seen.push(s));

    reportCloudSessionLost();
    reportCloudSessionLost(); // same state — must not re-notify
    reportCloudSessionAlive();

    expect(seen).toEqual(['lost', 'ok']);
  });

  it('stops notifying after unsubscribe', () => {
    const seen: string[] = [];
    const off = subscribeCloudSession((s) => seen.push(s));
    off();

    reportCloudSessionLost();

    expect(seen).toEqual([]);
  });

  it('one throwing subscriber does not stop the others', () => {
    const seen: string[] = [];
    subscribeCloudSession(() => {
      throw new Error('boom');
    });
    subscribeCloudSession((s) => seen.push(s));

    reportCloudSessionLost();

    expect(seen).toEqual(['lost']);
  });
});

/**
 * The 401 path in cloudUpsertWithOutcome is the primary evidence source, and a
 * 403 deliberately is NOT. These assertions read the shipped source because the
 * distinction is easy to "tidy away" into a single `status >= 401` branch, and
 * doing so would tell a cashier who hit a legitimate permission rule to log in
 * again — pushing him to work around a server policy that is intentional (see
 * cloudflare-worker/src/permissions.ts).
 */
describe('what counts as evidence in cloudConfig', () => {
  it('reports a lost session on 401 and on nothing else', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(resolve(__dirname, './cloudConfig.ts'), 'utf8');

    // Exactly one place raises the alarm, and it is the 401 branch.
    const raises = src.match(/reportCloudSessionLost\(\)/g) || [];
    expect(raises).toHaveLength(1);

    const at = src.indexOf('reportCloudSessionLost()');
    const branch = src.slice(Math.max(0, at - 400), at);
    expect(branch).toContain('res.status === 401');

    // The 403 branch must not raise it: a 403 is an authenticated operator being
    // refused, not an expired session.
    const denied = src.indexOf("return { kind: 'denied'");
    const deniedBranch = src.slice(Math.max(0, denied - 600), denied);
    expect(deniedBranch).not.toContain('reportCloudSessionLost');
  });

  it('a confirmed write and a successful probe both clear the alarm', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(resolve(__dirname, './cloudConfig.ts'), 'utf8');

    // Without these the banner would latch on forever after one transient 401.
    expect((src.match(/reportCloudSessionAlive\(\)/g) || []).length).toBeGreaterThanOrEqual(2);
  });
});

/**
 * The banner is the delivery mechanism, and the two rules that make it
 * trustworthy are asserted against its source: it must not fire on offline
 * alone, and the "session lost" state must not be dismissible.
 */
describe('the banner only alarms on evidence', () => {
  it('treats offline as its own state and never as a lost session', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(
      resolve(__dirname, '../components/ui/CloudSessionBanner.tsx'),
      'utf8'
    );

    // Offline short-circuits BEFORE the probe result is treated as evidence.
    expect(src).toContain('if (!health.online)');
    expect(src).toContain('resetCloudSessionState()');
    // And the red alarm is gated on the proven state, not on connectivity.
    expect(src).toContain("sessionState === 'lost'");
  });

  it('rules out an unconfigured Worker before probing', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(
      resolve(__dirname, '../components/ui/CloudSessionBanner.tsx'),
      'utf8'
    );

    // refreshCloudSessionRole() also returns null with no worker URL; treating
    // that as a dead session would alarm every local-only install forever.
    expect(src).toContain('if (!workerUrl) return;');
  });

  it('does not force a logout — the cashier must keep selling offline', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(
      resolve(__dirname, '../components/ui/CloudSessionBanner.tsx'),
      'utf8'
    );

    // The decision on record: warn and offer an in-place re-auth. Dumping the
    // operator at the login screen mid-order would cost real sales to fix a
    // background sync problem.
    expect(src).not.toContain('logout(');
    expect(src).toContain('refreshCloudSession');
  });
});
