// Vitest global setup.
//
// The auth code hashes passwords with `window.crypto.subtle` (PBKDF2). Under the
// Node test environment there is no `window`, but Node ships the same Web Crypto
// API as `globalThis.crypto`. Bridge the two so the hashing logic runs unchanged.
import { webcrypto } from 'node:crypto';

const g = globalThis as unknown as { crypto?: Crypto; window?: unknown };

if (!g.crypto) {
  g.crypto = webcrypto as unknown as Crypto;
}
if (!g.window) {
  g.window = globalThis;
}
