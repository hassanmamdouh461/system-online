/**
 * secretBox — symmetric AES-GCM encryption for small secrets that must be
 * stored in the cloud but readable ONLY by the manager.
 *
 * Why this exists: the Telegram bot token is a plaintext credential. The
 * documented security constraint (see settingsCloudService / settingsConfig)
 * is that it must NEVER sit in a shared D1 row readable by every authenticated
 * device (incl. a cashier till). But the manager wants the config to survive a
 * browser wipe and restore on any manager device.
 *
 * The resolution: encrypt the sensitive fields with a key derived (PBKDF2-100k)
 * from the manager's OWN login password — a secret only the manager knows.
 * The ciphertext + salt + iv go to D1; a cashier (or a snapshot, or anyone
 * reading the settings table) sees only opaque ciphertext. Only a manager who
 * typed the correct password can derive the key and decrypt.
 *
 * Format (versioned, JSON): { v: 1, salt: hex, iv: hex, ct: hex }
 * The KDF salt is random per-encryption, so the same password+plaintext never
 * yields the same ciphertext (and a D1 reader cannot tell two configs apart).
 */

const PBKDF2_ITERATIONS = 100_000;
const ENC_VERSION = 1;

export interface SecretBoxPayload {
  v: number;
  salt: string; // hex, 16 bytes
  iv: string;   // hex, 12 bytes (AES-GCM)
  ct: string;   // hex, ciphertext
}

function bufToHex(buf: Uint8Array): string {
  return Array.from(buf).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBuf(hex: string): Uint8Array {
  const clean = String(hex).replace(/[^0-9a-fA-F]/g, '');
  const bytes = new Uint8Array(Math.ceil(clean.length / 2));
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function cryptoApi(): Crypto {
  const c = (typeof window !== 'undefined' ? window.crypto : (globalThis as any).crypto) as Crypto | undefined;
  if (!c || !c.subtle) {
    throw new Error('Web Crypto API is unavailable on this device');
  }
  return c;
}

/** Derive the AES-GCM-256 key for a manager password + salt. */
async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const c = cryptoApi();
  const enc = new TextEncoder();
  const keyMaterial = await c.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, [
    'deriveBits',
    'deriveKey',
  ]);
  return c.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Encrypt a UTF-8 string with a manager password. Returns a self-contained
 * payload (salt+iv+ciphertext) safe to store in the cloud.
 */
export async function encryptSecret(plaintext: string, password: string): Promise<SecretBoxPayload> {
  const c = cryptoApi();
  const salt = c.getRandomValues(new Uint8Array(16));
  const iv = c.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const ctBuf = await c.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    new TextEncoder().encode(plaintext),
  );
  return {
    v: ENC_VERSION,
    salt: bufToHex(salt),
    iv: bufToHex(iv),
    ct: bufToHex(new Uint8Array(ctBuf)),
  };
}

/**
 * Decrypt a SecretBoxPayload. Returns the plaintext, or null when the password
 * is wrong / the payload is malformed or tampered (AES-GCM auth tag fails).
 * Never throws on bad input — a failed decrypt just yields null.
 */
export async function decryptSecret(payload: unknown, password: string): Promise<string | null> {
  try {
    const p = payload as SecretBoxPayload;
    if (!p || typeof p !== 'object') return null;
    if (p.v !== ENC_VERSION) return null;
    if (typeof p.salt !== 'string' || typeof p.iv !== 'string' || typeof p.ct !== 'string') return null;
    const c = cryptoApi();
    const salt = hexToBuf(p.salt);
    const iv = hexToBuf(p.iv);
    const ct = hexToBuf(p.ct);
    const key = await deriveKey(password, salt);
    const plainBuf = await c.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      key,
      ct as BufferSource,
    );
    return new TextDecoder().decode(plainBuf);
  } catch {
    // Wrong password (GCM tag mismatch) or corrupt payload.
    return null;
  }
}

/** Serialize a payload to the compact JSON string stored in D1. */
export function serializeSecretBox(payload: SecretBoxPayload): string {
  return JSON.stringify(payload);
}

/** Parse a stored string back into a payload (null when not a valid box). */
export function parseSecretBox(raw: unknown): SecretBoxPayload | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const p = JSON.parse(raw);
    if (p && p.v === ENC_VERSION && typeof p.salt === 'string' && typeof p.iv === 'string' && typeof p.ct === 'string') {
      return p as SecretBoxPayload;
    }
    return null;
  } catch {
    return null;
  }
}
