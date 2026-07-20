// Keys for localStorage
const LS_TAX_RATE_KEY = 'brewmaster_tax_rate';
const LS_ADMIN_CREDS_KEY = 'brewmaster_admin_creds';
const LS_BRANCH_CONFIG_KEY = 'brewmaster_branch_config';

export interface BranchConfig {
  branchId: string;
  branchName: string;
  email: string;
  password: string;
}

const DEFAULT_BRANCH_CONFIG: BranchConfig = {
  branchId: 'default',
  branchName: 'Main Branch',
  email: 'admin@branch.local',
  password: '123',
};

export function getTaxRate(): number {
  const saved = localStorage.getItem(LS_TAX_RATE_KEY);
  if (saved !== null) {
    const rate = parseFloat(saved);
    if (!isNaN(rate)) return rate;
  }
  return 0.1; // Default to 10%
}

export function setTaxRate(rate: number): void {
  localStorage.setItem(LS_TAX_RATE_KEY, rate.toString());
}

export function getAdminCredentials() {
  const saved = localStorage.getItem(LS_ADMIN_CREDS_KEY);
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (parsed.username && parsed.password) {
        return parsed;
      }
    } catch {
      // JSON parse error, ignore and fallback
    }
  }
  return { username: 'admin', password: '123' }; // Default credentials
}

export function setAdminCredentials(username: string, password: string): void {
  localStorage.setItem(LS_ADMIN_CREDS_KEY, JSON.stringify({ username, password }));
}

/**
 * Get the branch configuration for this POS instance.
 * Stored in localStorage and synced to Electron SQLite settings table.
 */
export function getBranchConfig(): BranchConfig {
  const saved = localStorage.getItem(LS_BRANCH_CONFIG_KEY);
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (parsed.branchId && parsed.email && parsed.password) {
        return { ...DEFAULT_BRANCH_CONFIG, ...parsed };
      }
    } catch {
      // JSON parse error, ignore and fallback
    }
  }
  return { ...DEFAULT_BRANCH_CONFIG };
}

/**
 * Save the branch configuration.
 * This is automatically synced to the Electron SQLite settings table
 * via the Storage.prototype monkeypatch in main.tsx.
 * Also persists the branch_id separately so database.cjs getBranchId() picks it up.
 */
export function setBranchConfig(config: Partial<BranchConfig>): void {
  const current = getBranchConfig();
  const updated = { ...current, ...config };
  localStorage.setItem(LS_BRANCH_CONFIG_KEY, JSON.stringify(updated));
  // Also persist branch_id as a standalone key for database.cjs getBranchId()
  localStorage.setItem('branch_id', updated.branchId);
}

// ─── Telegram Config ────────────────────────────────────────────────────────
export interface TelegramConfig {
  botToken: string;
  chatId: string;
  reportTime: string; // e.g., "23:00"
  enabled: boolean;
}

const DEFAULT_TELEGRAM_CONFIG: TelegramConfig = {
  botToken: '',
  chatId: '',
  reportTime: '23:00',
  enabled: false,
};

const LS_TELEGRAM_CONFIG_KEY = 'brewmaster_telegram_config';

export function getTelegramConfig(): TelegramConfig {
  const saved = localStorage.getItem(LS_TELEGRAM_CONFIG_KEY);
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      return { ...DEFAULT_TELEGRAM_CONFIG, ...parsed };
    } catch {
      // JSON parse error, fallback
    }
  }
  return { ...DEFAULT_TELEGRAM_CONFIG };
}

export function setTelegramConfig(config: Partial<TelegramConfig>): void {
  const current = getTelegramConfig();
  const updated = { ...current, ...config };
  localStorage.setItem(LS_TELEGRAM_CONFIG_KEY, JSON.stringify(updated));
}

