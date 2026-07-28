/**
 * Functional tests for secretBox — the AES-GCM box that lets the Telegram bot
 * token live in D1 readable only by the manager.
 *
 * Runs in the Node environment; src/test/setup bridges window.crypto onto
 * Node's webcrypto, so the real Web Crypto path executes unchanged.
 */
import { describe, it, expect } from 'vitest';
import {
  encryptSecret,
  decryptSecret,
  serializeSecretBox,
  parseSecretBox,
} from './secretBox';

const PW = 'correct horse battery staple';
const OTHER_PW = 'cashier-does-not-know-this';

describe('secretBox encrypt/decrypt round-trip', () => {
  it('decrypts with the correct password', async () => {
    const box = await encryptSecret('123456:ABCdefTelegramToken', PW);
    expect(await decryptSecret(box, PW)).toBe('123456:ABCdefTelegramToken');
  });

  it('returns null (never throws) with the wrong password', async () => {
    const box = await encryptSecret('secret-token', PW);
    expect(await decryptSecret(box, OTHER_PW)).toBeNull();
  });

  it('handles unicode / Arabic plaintext losslessly', async () => {
    const box = await encryptSecret('توكن سرّي 🔐 123', PW);
    expect(await decryptSecret(box, PW)).toBe('توكن سرّي 🔐 123');
  });

  it('never leaks the plaintext or the password into the payload', async () => {
    const box = await encryptSecret('super-secret-token', PW);
    const serialized = serializeSecretBox(box);
    expect(serialized).not.toContain('super-secret-token');
    expect(serialized).not.toContain(PW);
    expect(box.ct).not.toContain('super-secret-token');
  });

  it('produces a different ciphertext each time (random salt+iv)', async () => {
    const a = await encryptSecret('same-token', PW);
    const b = await encryptSecret('same-token', PW);
    expect(a.ct).not.toBe(b.ct);
    expect(a.salt).not.toBe(b.salt);
    expect(a.iv).not.toBe(b.iv);
    // ...yet both still decrypt to the same plaintext.
    expect(await decryptSecret(a, PW)).toBe('same-token');
    expect(await decryptSecret(b, PW)).toBe('same-token');
  });
});

describe('secretBox serialize/parse', () => {
  it('round-trips through the stored JSON string', async () => {
    const box = await encryptSecret('token-xyz', PW);
    const parsed = parseSecretBox(serializeSecretBox(box));
    expect(parsed).not.toBeNull();
    expect(await decryptSecret(parsed, PW)).toBe('token-xyz');
  });

  it('parseSecretBox rejects junk / non-box strings', () => {
    expect(parseSecretBox('')).toBeNull();
    expect(parseSecretBox('not json')).toBeNull();
    expect(parseSecretBox('{"v":99}')).toBeNull();
    expect(parseSecretBox('{"v":1,"salt":"x"}')).toBeNull();
    expect(parseSecretBox(null)).toBeNull();
    expect(parseSecretBox(undefined)).toBeNull();
  });

  it('decryptSecret tolerates malformed payloads without throwing', async () => {
    expect(await decryptSecret(null, PW)).toBeNull();
    expect(await decryptSecret(undefined, PW)).toBeNull();
    expect(await decryptSecret({}, PW)).toBeNull();
    expect(await decryptSecret({ v: 1, salt: 'zz', iv: 'zz', ct: 'zz' }, PW)).toBeNull();
    expect(await decryptSecret('a string', PW)).toBeNull();
  });
});
