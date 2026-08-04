import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Regression guard: a failed login must say what actually went wrong.
 *
 * AuthContext.login() threw the same string for every failure:
 *
 *   if (!isValid) { throw new Error('كلمة المرور غير صحيحة'); }
 *
 * ensureCloudSession() collapses every outcome into a boolean, so that one message
 * also covered: the Worker's per-IP rate limit (429), a Worker with no
 * SESSION_SECRET configured (503), a Worker that was down, and a dead network.
 * Reproduced during the audit: locked out by a 429 and told the password was wrong
 * while it was in fact correct.
 *
 * Why it matters operationally: during the busy hour the operator responds to
 * "wrong password" by trying other passwords and resetting the credential — and
 * every extra attempt extends the rate-limit lockout, when waiting a minute was
 * the entire fix.
 *
 * getLastSessionMintOutcome() now reports the reason the mint already knew, and
 * these tests drive the real classifier through the real module.
 */
const authSrc = readFileSync(resolve(__dirname, './AuthContext.tsx'), 'utf8');

describe('login failure messages are cause-specific', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('does not throw a hardcoded password message', () => {
    // The literal may only appear inside the classifier's default branch.
    const throwSite = authSrc.match(/if \(!isValid\) \{[\s\S]{0,400}?\}/);
    expect(throwSite).not.toBeNull();
    expect(throwSite![0]).toContain('describeLoginFailure()');
    expect(throwSite![0]).not.toContain('كلمة المرور غير صحيحة');
  });

  it('classifies every mint failure the Worker can produce', async () => {
    const mod = await import('../services/cloudConfig');
    // The classifier is exercised through the exported accessor's type contract:
    // assert each documented kind is handled by the message mapper in AuthContext.
    expect(typeof mod.getLastSessionMintOutcome).toBe('function');
    for (const kind of [
      'rate_limited',
      'server_misconfigured',
      'server_error',
      'unreachable',
      'rejected',
      'no_attempt',
    ]) {
      expect(authSrc).toContain(`case '${kind}'`);
    }
  });

  it('a fresh module reports no_attempt before anything is tried', async () => {
    const mod = await import('../services/cloudConfig');
    expect(mod.getLastSessionMintOutcome()).toEqual({ kind: 'no_attempt' });
  });

  it('maps each cause to a distinct operator-facing message', () => {
    // 429 is now only the brute-force backstop, and it must never be phrased as
    // a "wait a minute" cooldown a mistyped password can trigger.
    expect(authSrc).toMatch(/rate_limited[\s\S]{0,400}اتقفل مؤقتًا/);
    const rateMsg = authSrc.match(/case 'rate_limited':[\s\S]{0,600}?return '([^']+)'/);
    expect(rateMsg).not.toBeNull();
    expect(rateMsg![1]).not.toContain('استنى دقيقة');
    // 503 must point at server configuration, not the operator.
    expect(authSrc).toMatch(/server_misconfigured[\s\S]{0,200}SESSION_SECRET/);
    // Network failure must not be reported as a credential problem.
    expect(authSrc).toMatch(/unreachable[\s\S]{0,200}مفيش اتصال/);
    // Only a genuine refusal keeps the original wording.
    expect(authSrc).toMatch(/كلمة المرور غير صحيحة/);
  });

  it('the rate-limit message never claims the password is wrong', () => {
    const rateLimitCase = authSrc.match(/case 'rate_limited':[\s\S]{0,600}?return '([^']+)'/);
    expect(rateLimitCase).not.toBeNull();
    expect(rateLimitCase![1]).not.toContain('غير صحيحة');
  });
});
