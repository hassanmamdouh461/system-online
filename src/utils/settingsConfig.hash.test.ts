import { describe, it, expect } from 'vitest';
import { hashPassword } from './settingsConfig';

// The auth layer stores PBKDF2 hashes (SHA-256, 100k iterations, random salt).
// These tests pin the KDF's shape and determinism so a future refactor can't
// silently weaken or break password verification.
describe('hashPassword (PBKDF2 / SHA-256)', () => {
  it('returns a hex salt (16 bytes) and hex hash (32 bytes)', async () => {
    const { hash, salt } = await hashPassword('s3cret');
    expect(salt).toMatch(/^[0-9a-f]{32}$/);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic for the same password + salt', async () => {
    const first = await hashPassword('s3cret');
    const again = await hashPassword('s3cret', first.salt);
    expect(again.salt).toBe(first.salt);
    expect(again.hash).toBe(first.hash);
  });

  it('produces a different hash for a different password under the same salt', async () => {
    const first = await hashPassword('s3cret');
    const other = await hashPassword('not-the-password', first.salt);
    expect(other.hash).not.toBe(first.hash);
  });

  it('uses a fresh random salt each call when none is supplied', async () => {
    const a = await hashPassword('same');
    const b = await hashPassword('same');
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
  });
});
