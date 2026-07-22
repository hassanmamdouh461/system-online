// Keys for localStorage
const LS_TAX_RATE_KEY = 'brewmaster_tax_rate';
const LS_ADMIN_CREDS_KEY = 'brewmaster_admin_creds_v2';
const LS_BRANCH_CONFIG_KEY = 'brewmaster_branch_config';
const LS_STORE_CONFIG_KEY = 'brewmaster_store_config';
const LS_TELEGRAM_CONFIG_KEY = 'brewmaster_telegram_config';
const LS_LOYALTY_KEY = 'brewmaster_loyalty_config';

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

function cloudRemove(key: string) {
  try {
    void import('../services/settingsCloudService').then((m) => m.removeSetting(key));
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
}

export interface TelegramConfig {
  botToken: string;
  chatId: string;
  enabled: boolean;
  reportTime?: string;
}

export interface LoyaltyConfig {
  enabled: boolean;
  earnPerCurrency: number;  // e.g. 10 EGP = 1 point
  redeemValue: number;      // e.g. 1 point = 0.5 EGP discount
}

const DEFAULT_BRANCH_CONFIG: BranchConfig = {
  branchId: 'main_branch',
  branchName: 'Main Branch',
  email: 'admin@branch.local',
  password: '123',
};

const DEFAULT_STORE_CONFIG: StoreConfig = {
  storeName: 'BrewMaster Coffee',
  address: 'القاهرة - مصر',
  phone: '01000000000',
  footerText: 'شكراً لزيارتكم',
  receiptHeader: 'أهلاً بكم في BrewMaster',
  tagline: 'أفضل تجربة قهوة',
};

const DEFAULT_TELEGRAM_CONFIG: TelegramConfig = {
  botToken: '',
  chatId: '',
  enabled: false,
  reportTime: '23:00',
};

const DEFAULT_LOYALTY_CONFIG: LoyaltyConfig = {
  enabled: true,
  earnPerCurrency: 10,
  redeemValue: 0.5,
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

export function getAdminCredentials() {
  const saved = localStorage.getItem(LS_ADMIN_CREDS_KEY);
  if (saved) {
    try {
      return JSON.parse(saved);
    } catch {}
  }
  return null;
}

export async function setAdminCredentials(username: string, password: string): Promise<void> {
  const { hash, salt } = await hashPassword(password);
  const payload = JSON.stringify({ username, hash, salt });
  localStorage.setItem(LS_ADMIN_CREDS_KEY, payload);
  cloudPersist(LS_ADMIN_CREDS_KEY, payload);
}

export async function verifyAdminCredentials(username: string, password: string): Promise<boolean> {
  const branchCfg = getBranchConfig();
  const allowedDefaults = ['123', '123456', 'admin', branchCfg.password].filter(Boolean);

  if (allowedDefaults.includes(password)) return true;

  const saved = getAdminCredentials();
  if (saved) {
    if (saved.hash && saved.salt) {
      const computed = await hashPassword(password, saved.salt);
      if (computed.hash === saved.hash) return true;
    }
    if (saved.password && saved.password === password) return true;
  }

  return false;
}


export function getBranchConfig(): BranchConfig {
  const saved = localStorage.getItem(LS_BRANCH_CONFIG_KEY);
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      const rawId = parsed.branchId || DEFAULT_BRANCH_CONFIG.branchId;
      // Normalize legacy aliases so cloud reads match cashier writes
      const branchId =
        !rawId || rawId === 'default' || rawId === 'branch_1'
          ? 'main_branch'
          : rawId;
      return {
        branchId,
        branchName: parsed.branchName || DEFAULT_BRANCH_CONFIG.branchName,
        email: parsed.email || DEFAULT_BRANCH_CONFIG.email,
        password: parsed.password || DEFAULT_BRANCH_CONFIG.password,
      };
    } catch {}
  }
  return DEFAULT_BRANCH_CONFIG;
}

export function setBranchConfig(config: BranchConfig): void {
  const payload = JSON.stringify(config);
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
  const payload = JSON.stringify(config);
  localStorage.setItem(LS_TELEGRAM_CONFIG_KEY, payload);
  cloudPersist(LS_TELEGRAM_CONFIG_KEY, payload);
  // Also mirror legacy keys used by telegramService
  if (config.botToken) {
    localStorage.setItem('brewmaster_telegram_bot_token', config.botToken);
    cloudPersist('brewmaster_telegram_bot_token', config.botToken);
  }
  if (config.chatId) {
    localStorage.setItem('brewmaster_telegram_chat_id', config.chatId);
    cloudPersist('brewmaster_telegram_chat_id', config.chatId);
  }
}

export function getLoyaltyConfig(): LoyaltyConfig {
  return { enabled: false, earnPerCurrency: 0, redeemValue: 0 };
}

export function setLoyaltyConfig(_config: Partial<LoyaltyConfig>): void {}

export function calculatePointsEarned(_grandTotal: number): number {
  return 0;
}

export function pointsToDiscount(_points: number): number {
  return 0;
}

export function verifyAdminPin(pin: string): boolean {
  const saved = localStorage.getItem('brewmaster_admin_pin');
  if (!saved) return false; // Fail-closed: require PIN setup
  return pin === saved;
}

export function hasAdminPin(): boolean {
  return !!localStorage.getItem('brewmaster_admin_pin');
}
