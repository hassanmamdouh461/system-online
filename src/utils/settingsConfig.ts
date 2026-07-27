import { MAIN_BRANCH_ID } from '../services/cloudConfig';

// Keys for localStorage
const LS_TAX_RATE_KEY = 'brewmaster_tax_rate';
const LS_ADMIN_CREDS_KEY = 'brewmaster_admin_creds_v2';
const LS_MANAGER_CREDS_KEY = 'brewmaster_manager_creds_v1';
const LS_BRANCH_CONFIG_KEY = 'brewmaster_branch_config';

/**
 * First-run bootstrap password.
 *
 * Only usable when NO credential has ever been stored; logging in with it
 * immediately persists a real hashed credential and raises the
 * must-change-password flag, so the door closes after a single use. It cannot
 * be removed outright without locking the owner out of a fresh install.
 */
const BOOTSTRAP_PASSWORD = '123';
const LS_STORE_CONFIG_KEY = 'brewmaster_store_config';
const LS_TELEGRAM_CONFIG_KEY = 'brewmaster_telegram_config';

/** Fire-and-forget durable cloud persist (never blocks UI) */
function cloudPersist(key: string, value: string) {
  try {
    void import('../services/settingsCloudService').then((m) =>
      m.persistSetting(key, value)
    );
  } catch {
    // ignore
  }
}


export interface BranchConfig {
  branchId: string;
  branchName: string;
  email: string;
  password?: string;
}

export interface StoreConfig {
  storeName: string;
  address: string;
  phone: string;
  footerText: string;
  receiptHeader: string;
  tagline?: string;
  taxNumber?: string;
  /**
   * Hour (0–23) at which the business day rolls over. 0 = calendar midnight
   * (legacy behaviour). Set to e.g. 6 for a venue that closes after midnight,
   * so a 12:10am order is still counted on the previous business day. Consumed
   * by src/utils/businessDay.ts — the single source of truth for day bucketing.
   */
  dayStartHour?: number;
}

export interface TelegramConfig {
  botToken: string;
  chatId: string;
  enabled: boolean;
  reportTime?: string;
}

const DEFAULT_BRANCH_CONFIG: BranchConfig = {
  branchId: MAIN_BRANCH_ID,
  branchName: 'Main Branch',
  email: 'admin@branch.local',
  password: '',
};

const DEFAULT_STORE_CONFIG: StoreConfig = {
  storeName: 'BrewMaster Coffee',
  address: 'القاهرة - مصر',
  phone: '01000000000',
  footerText: 'شكراً لزيارتكم',
  receiptHeader: 'أهلاً بكم في BrewMaster',
  tagline: 'أفضل تجربة قهوة',
  dayStartHour: 0,
};

const DEFAULT_TELEGRAM_CONFIG: TelegramConfig = {
  botToken: '',
  chatId: '',
  enabled: false,
  reportTime: '23:00',
};

// ─── Web Crypto API PBKDF2 Password Hashing Helpers ───────────────────────────

function bufToHex(buf: Uint8Array): string {
  return Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('');
}

function hexToBuf(hex: string): Uint8Array {
  const bytes = new Uint8Array(Math.ceil(hex.length / 2));
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export async function hashPassword(password: string, saltHex?: string): Promise<{ hash: string; salt: string }> {
  const enc = new TextEncoder();
  const salt = saltHex ? hexToBuf(saltHex) : window.crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await window.crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey']
  );
  const derivedKey = await window.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations: 100000,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
  const exported = await window.crypto.subtle.exportKey('raw', derivedKey);
  return {
    hash: bufToHex(new Uint8Array(exported)),
    salt: bufToHex(salt)
  };
}

/** Hash a short numeric PIN using PBKDF2. Format: `pinhash$<saltHex>$<hashHex>`.
 *  Reuses the same KDF parameters as hashPassword but stores the result in a
 *  single self-describing string so verifyAdminPin can detect plaintext vs hashed. */
export async function hashPin(pin: string): Promise<string> {
  const enc = new TextEncoder();
  const salt = window.crypto.getRandomValues(new Uint8Array(8));
  const keyMaterial = await window.crypto.subtle.importKey(
    'raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']
  );
  const derivedBits = await window.crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: 100_000, hash: 'SHA-256' },
    keyMaterial, 128
  );
  const hashHex = bufToHex(new Uint8Array(derivedBits));
  const saltHex = bufToHex(salt);
  return `pinhash$${saltHex}$${hashHex}`;
}

/** Verify a PIN against stored value. Auto-migrates plaintext → hashed on first
 *  successful match (transparent to caller, no session break). */
export async function verifyAdminPin(pin: string): Promise<boolean> {
  const saved = localStorage.getItem('brewmaster_admin_pin');
  if (!saved) return false; // Fail-closed: require PIN setup

  // Hashed format: pinhash$<salt>$<hash>
  if (saved.startsWith('pinhash$')) {
    const parts = saved.split('$');
    if (parts.length !== 3) return false;
    const saltHex = parts[1];
    const expectedHash = parts[2];
    const salt = hexToBuf(saltHex);
    const enc = new TextEncoder();
    const keyMaterial = await window.crypto.subtle.importKey(
      'raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']
    );
    const derivedBits = await window.crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: salt as BufferSource, iterations: 100_000, hash: 'SHA-256' },
      keyMaterial, 128
    );
    return bufToHex(new Uint8Array(derivedBits)) === expectedHash;
  }

  // Legacy plaintext — compare directly, then auto-migrate on match.
  if (pin === saved) {
    const hashed = await hashPin(pin);
    localStorage.setItem('brewmaster_admin_pin', hashed);
    cloudPersist('brewmaster_admin_pin', hashed);
    return true;
  }

  return false;
}

export function getTaxRate(): number {
  const saved = localStorage.getItem(LS_TAX_RATE_KEY);
  if (saved !== null) {
    const rate = parseFloat(saved);
    if (!isNaN(rate)) return rate;
  }
  return 0.1; // Default to 10%
}

export function setTaxRate(rate: number): void {
  const v = rate.toString();
  localStorage.setItem(LS_TAX_RATE_KEY, v);
  cloudPersist(LS_TAX_RATE_KEY, v);
}

/**
 * Read a stored credential record.
 *
 * A corrupt/unparseable value returns a sentinel rather than null. That
 * distinction matters: null means "no credential was ever set", which is what
 * unlocks the one-time bootstrap password. If damaged JSON also returned null,
 * corrupting localStorage on an existing install would silently re-open the
 * default-password door. The sentinel keeps hasStoredCredentials true, so the
 * bootstrap stays closed and the login simply fails.
 */
function readStoredCredentials(key: string): { username?: string; hash?: string; salt?: string; password?: string } | null {
  const saved = localStorage.getItem(key);
  if (!saved) return null;
  try {
    const parsed = JSON.parse(saved);
    if (parsed && typeof parsed === 'object') return parsed;
  } catch {
    console.error(`[settingsConfig] Stored credentials at ${key} are corrupt.`);
  }
  return { hash: '__corrupt__' };
}

export function getAdminCredentials() {
  return readStoredCredentials(LS_ADMIN_CREDS_KEY);
}

/**
 * Persist a new cashier credential. When cloud sync is configured and a session
 * is active, the D1 write must be PERMITTED (current role is manager) before
 * localStorage is touched — otherwise D1 keeps the old hash and the next login
 * mints against it, producing a 401 that bricks the cloud session. The UI
 * should prevent reaching this path from a cashier session, but this check is
 * defense-in-depth.
 *
 * @throws {Error} with code `credential_sync_denied` when the current session
 *   role cannot push this key to D1 — the caller must surface the error
 *   without altering localStorage.
 */
export async function setAdminCredentials(username: string, password: string): Promise<void> {
  const { canPushSettingKey } = await import('../services/settingsCloudService');
  const { isCloudConfigured } = await import('../services/cloudConfig');
  // Only gate on role when cloud sync is live — a purely offline install has no
  // D1 divergence risk and must remain self-service.
  if (isCloudConfigured() && !canPushSettingKey(LS_ADMIN_CREDS_KEY)) {
    const err = new Error(
      'credential_sync_denied: تغيير كلمة المرور يحتاج صلاحية مدير. ' +
      '/ Changing login passwords requires manager access.'
    );
    err.name = 'CredentialSyncDenied';
    throw err;
  }
  const { hash, salt } = await hashPassword(password);
  const payload = JSON.stringify({ username, hash, salt });
  localStorage.setItem(LS_ADMIN_CREDS_KEY, payload);
  cloudPersist(LS_ADMIN_CREDS_KEY, payload);
  // Setting a real password dismisses the default-password warning.
  if (password !== BOOTSTRAP_PASSWORD) clearMustChangePassword();
}

export async function verifyAdminCredentials(_username: string, password: string): Promise<boolean> {
  const branchCfg = getBranchConfig();
  let saved = getAdminCredentials();

  // If credentials are not in localStorage yet (e.g. fresh browser / cleared cache), hydrate settings immediately
  if (!saved) {
    try {
      const { hydrateSettingsFromCloud } = await import('../services/settingsCloudService');
      await hydrateSettingsFromCloud();
      saved = getAdminCredentials();
    } catch {
      // ignore
    }
  }

  const hasStoredCredentials = !!(saved && (saved.hash || saved.password));
  if (saved) {
    if (saved.hash && saved.salt) {
      const computed = await hashPassword(password, saved.salt);
      if (computed.hash === saved.hash) return true;
    }
    if (saved.password && saved.password === password) return true;
  }

  // First-run bootstrap: when no admin credentials have ever been stored, allow the
  // well-known setup password ('123') exactly once and persist it as a hashed
  // credential. From then on the bootstrap door is closed — changing the password in
  // Settings, or storing any other credential, removes this fallback permanently.
  if (!hasStoredCredentials && branchCfg.password === '' && password === BOOTSTRAP_PASSWORD) {
    await setAdminCredentials('admin', BOOTSTRAP_PASSWORD);
    // Flag that the user logged in via the default bootstrap password so the
    // UI can force a password change before any other action.
    localStorage.setItem('brewmaster_must_change_password', 'true');
    return true;
  }

  void branchCfg;
  return false;
}

export function getManagerCredentials() {
  return readStoredCredentials(LS_MANAGER_CREDS_KEY);
}

/**
 * Persist a new manager credential. Same defense-in-depth as setAdminCredentials:
 * refuse to update localStorage unless the D1 write is permitted.
 *
 * @throws {Error} with code `credential_sync_denied` when the current session
 *   role cannot push this key to D1.
 */
export async function setManagerCredentials(username: string, password: string): Promise<void> {
  const { canPushSettingKey } = await import('../services/settingsCloudService');
  const { isCloudConfigured } = await import('../services/cloudConfig');
  if (isCloudConfigured() && !canPushSettingKey(LS_MANAGER_CREDS_KEY)) {
    const err = new Error(
      'credential_sync_denied: تغيير كلمة المرور يحتاج صلاحية مدير. ' +
      '/ Changing login passwords requires manager access.'
    );
    err.name = 'CredentialSyncDenied';
    throw err;
  }
  const { hash, salt } = await hashPassword(password);
  const payload = JSON.stringify({ username, hash, salt });
  localStorage.setItem(LS_MANAGER_CREDS_KEY, payload);
  cloudPersist(LS_MANAGER_CREDS_KEY, payload);
  // Setting a real password dismisses the default-password warning.
  if (password !== BOOTSTRAP_PASSWORD) clearMustChangePassword();
}

export async function verifyManagerCredentials(_username: string, password: string): Promise<boolean> {
  const branchCfg = getBranchConfig();
  let saved = getManagerCredentials();

  // If credentials are not in localStorage yet (e.g. fresh browser / cleared cache), hydrate settings immediately
  if (!saved) {
    try {
      const { hydrateSettingsFromCloud } = await import('../services/settingsCloudService');
      await hydrateSettingsFromCloud();
      saved = getManagerCredentials();
    } catch {
      // ignore
    }
  }

  const hasStoredCredentials = !!(saved && (saved.hash || saved.password));
  if (saved) {
    if (saved.hash && saved.salt) {
      const computed = await hashPassword(password, saved.salt);
      if (computed.hash === saved.hash) return true;
    }
    if (saved.password && saved.password === password) return true;
  }

  // First-run bootstrap for manager: only when no manager credentials have ever been
  // stored and the branch password hasn't been customized, allow '123' once and persist
  // it so this fallback never reopens afterward.
  if (!hasStoredCredentials && branchCfg.password === '' && password === BOOTSTRAP_PASSWORD) {
    await setManagerCredentials('manager', BOOTSTRAP_PASSWORD);
    localStorage.setItem('brewmaster_must_change_password', 'true');
    return true;
  }

  void branchCfg;
  return false;
}



export function getBranchConfig(): BranchConfig {
  const saved = localStorage.getItem(LS_BRANCH_CONFIG_KEY);
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      return {
        // Single-branch system: the stored id is always the one branch.
        branchId: MAIN_BRANCH_ID,
        branchName: parsed.branchName || DEFAULT_BRANCH_CONFIG.branchName,
        email: parsed.email || DEFAULT_BRANCH_CONFIG.email,
        password: parsed.password || DEFAULT_BRANCH_CONFIG.password,
      };
    } catch {}
  }
  return DEFAULT_BRANCH_CONFIG;
}

export function setBranchConfig(config: BranchConfig): void {
  // Single-branch system: the branch id is fixed and cannot be reassigned.
  const payload = JSON.stringify({ ...config, branchId: MAIN_BRANCH_ID });
  localStorage.setItem(LS_BRANCH_CONFIG_KEY, payload);
  cloudPersist(LS_BRANCH_CONFIG_KEY, payload);
}

export function getStoreConfig(): StoreConfig {
  const saved = localStorage.getItem(LS_STORE_CONFIG_KEY);
  if (saved) {
    try {
      return { ...DEFAULT_STORE_CONFIG, ...JSON.parse(saved) };
    } catch {}
  }
  return DEFAULT_STORE_CONFIG;
}

export function setStoreConfig(config: StoreConfig): void {
  const payload = JSON.stringify(config);
  localStorage.setItem(LS_STORE_CONFIG_KEY, payload);
  cloudPersist(LS_STORE_CONFIG_KEY, payload);
}

export function getTelegramConfig(): TelegramConfig {
  const saved = localStorage.getItem(LS_TELEGRAM_CONFIG_KEY);
  if (saved) {
    try {
      return { ...DEFAULT_TELEGRAM_CONFIG, ...JSON.parse(saved) };
    } catch {}
  }
  return DEFAULT_TELEGRAM_CONFIG;
}

export function setTelegramConfig(config: TelegramConfig): void {
  // SECURITY: the Telegram bot token is a plaintext credential. It is stored
  // DEVICE-LOCAL only and is deliberately NOT pushed to Cloudflare D1 — a synced
  // token sat in a shared settings row that every authenticated device (incl. a
  // cashier till) could read, and it was copied into every snapshot payload. The
  // daily report is sent from the manager's own device, which reads these
  // localStorage values directly, so keeping them local does not break sending.
  // (These keys were also removed from DURABLE_SETTING_KEYS so persist/hydrate/
  // snapshot never carry them to the cloud.) There is intentionally no cloudPersist
  // here anymore.
  localStorage.setItem(LS_TELEGRAM_CONFIG_KEY, JSON.stringify(config));
  // Mirror the legacy flat keys read by telegramService.getStoredConfig().
  if (config.botToken) {
    localStorage.setItem('brewmaster_telegram_bot_token', config.botToken);
  } else {
    localStorage.removeItem('brewmaster_telegram_bot_token');
  }
  if (config.chatId) {
    localStorage.setItem('brewmaster_telegram_chat_id', config.chatId);
  } else {
    localStorage.removeItem('brewmaster_telegram_chat_id');
  }
}

export function hasAdminPin(): boolean {
  return !!localStorage.getItem('brewmaster_admin_pin');
}

/** True when the user logged in via the default bootstrap password ('123').
 *  The dashboard should force a password-change prompt until this is cleared. */
export function mustChangePassword(): boolean {
  return localStorage.getItem('brewmaster_must_change_password') === 'true';
}

/** Call after the user sets a real password to dismiss the forced-change prompt. */
export function clearMustChangePassword(): void {
  localStorage.removeItem('brewmaster_must_change_password');
}
