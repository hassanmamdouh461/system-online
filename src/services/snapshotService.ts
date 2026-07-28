/**
 * Full-system snapshot backup to Cloudflare D1.
 * Runs every 2 hours + on demand. Keeps last 10 per branch on the worker.
 */
import {
  cloudGetCollection,
  cloudUpsert,
  getBranchIdHeader,
  isCloudConfigured,
  normalizeBranchId,
} from './cloudConfig';
import { withDB } from '../repositories/indexeddb/db';
import { DURABLE_SETTING_KEYS } from './settingsCloudService';

const INTERVAL_MS = 2 * 60 * 60 * 1000;
const LS_LAST_SNAPSHOT = 'brewmaster_last_snapshot_at';

export type SnapshotPayload = {
  version: 1;
  createdAt: string;
  branchId: string;
  orders: any[];
  menu_items: any[];
  customers: any[];
  companies: any[];
  inventory: any[];
  settings: Record<string, string>;
  recipes: any;
  inventory_transactions: any[];
};

let intervalId: ReturnType<typeof setInterval> | null = null;
let running = false;

function collectLocalSettings(): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof localStorage === 'undefined') return out;
  for (const key of DURABLE_SETTING_KEYS) {
    // Exclude the telegram config from snapshots: it embeds the bot token in
    // plaintext and snapshots are never used to restore it (hydration pulls
    // the live settings row directly). Keeping it out shrinks the token's
    // footprint to a single D1 row instead of every snapshot payload.
    if (key === 'brewmaster_telegram_config') continue;
    try {
      const v = localStorage.getItem(key);
      if (v !== null) out[key] = v;
    } catch {
      // ignore
    }
  }
  return out;
}

function collectRecipes(): any {
  try {
    const raw = localStorage.getItem('web_menu_recipes_store');
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function collectTransactions(): any[] {
  try {
    const raw = localStorage.getItem('pos_inventory_transactions_web_store');
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function buildSnapshotPayload(branchId?: string): Promise<SnapshotPayload> {
  const branch = normalizeBranchId(branchId || getBranchIdHeader() || 'main_branch');
  const [orders, menu_items, customers, companies, inventory] = await withDB(async (db) => {
    return Promise.all([
      db.getAll('orders'),
      db.getAll('menu_items'),
      db.getAll('customers'),
      db.getAll('companies'),
      db.getAll('inventory'),
    ]);
  });

  // NEVER persist soft-deleted menu items into the snapshot — otherwise a
  // restoreFromSnapshotIfNeeded would resurrect exactly the items the user
  // deleted. We keep their tombstone rows (so a restore still knows they're
  // deleted) but they are filtered out of the live set everywhere.
  const menuClean = (menu_items || [])
    .filter((m: any) => m && !m.deletedAt)
    .map((m: any) => {
      // Prevent oversized base64 images from exploding Cloudflare D1 SQL parameter limits
      if (m.image && typeof m.image === 'string' && m.image.startsWith('data:image') && m.image.length > 50000) {
        const { image, ...rest } = m;
        return rest;
      }
      return m;
    });

  // Same protection for orders: never persist soft-deleted (tombstoned) orders.
  const ordersClean = (orders || []).filter((o: any) => o && !o.deletedAt);

  return {
    version: 1,
    createdAt: new Date().toISOString(),
    branchId: branch,
    orders: ordersClean,
    menu_items: menuClean,
    customers,
    companies,
    inventory,
    settings: collectLocalSettings(),
    recipes: collectRecipes(),
    inventory_transactions: collectTransactions(),
  };
}

export async function createSnapshot(
  kind: 'auto' | 'manual' = 'auto',
  branchId?: string
): Promise<{ ok: boolean; id?: string; error?: string }> {
  if (!isCloudConfigured()) return { ok: false, error: 'not configured' };
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { ok: false, error: 'offline' };
  }
  if (running) return { ok: false, error: 'already running' };
  running = true;
  try {
    const payload = await buildSnapshotPayload(branchId);
    const id = `snap_${payload.branchId}_${Date.now()}`;
    const doc = {
      id,
      branchId: payload.branchId,
      payload: JSON.stringify(payload),
      createdAt: payload.createdAt,
      kind,
    };
    const ok = await cloudUpsert('snapshots', id, doc);
    if (ok) {
      try {
        localStorage.setItem(LS_LAST_SNAPSHOT, payload.createdAt);
      } catch {
        // ignore
      }
      console.info('[snapshot] saved', id, kind);
      return { ok: true, id };
    }
    return { ok: false, error: 'upload failed' };
  } catch (err: any) {
    console.warn('[snapshot] failed:', err);
    return { ok: false, error: err?.message || String(err) };
  } finally {
    running = false;
  }
}

export async function getLatestSnapshot(branchId?: string): Promise<SnapshotPayload | null> {
  if (!isCloudConfigured()) return null;
  try {
    const docs = await cloudGetCollection('snapshots');
    if (!docs || !docs.length) return null;
    const branch = branchId || getBranchIdHeader() || 'main_branch';
    const filtered = docs
      .filter((d) => {
        const b = d.branch_id || d.branchId || 'default';
        return b === branch || b === 'main_branch' || b === 'default';
      })
      .sort(
        (a, b) =>
          new Date(b.createdAt || b.created_at || 0).getTime() -
          new Date(a.createdAt || a.created_at || 0).getTime()
      );
    if (!filtered.length) return null;
    let payload = filtered[0].payload;
    if (typeof payload === 'string') {
      try {
        payload = JSON.parse(payload);
      } catch {
        return null;
      }
    }
    return payload as SnapshotPayload;
  } catch (e) {
    console.warn('[snapshot] getLatest failed:', e);
    return null;
  }
}

/**
 * Restore snapshot into IndexedDB + localStorage when cloud collections look empty.
 */
export async function restoreFromSnapshotIfNeeded(_hydrateResult: {
  orders: number;
  menu: number;
  customers: number;
  settings?: number;
}): Promise<boolean> {
  // Do NOT automatically resurrect wiped databases from old snapshots.
  // An empty database is valid when the user clears/resets their system.
  return false;
}


export function startSnapshotScheduler() {
  if (typeof window === 'undefined') return;
  if (intervalId) return;

  // First snapshot ~30s after boot (let hydrate finish)
  setTimeout(() => {
    void createSnapshot('auto');
  }, 30_000);

  intervalId = setInterval(() => {
    void createSnapshot('auto');
  }, INTERVAL_MS);

  // Best-effort snapshot when tab is hidden for a while
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      const last = localStorage.getItem(LS_LAST_SNAPSHOT);
      const lastT = last ? new Date(last).getTime() : 0;
      if (Date.now() - lastT > 30 * 60_000) {
        void createSnapshot('auto');
      }
    }
  });
}

export function getLastSnapshotAt(): string | null {
  try {
    return localStorage.getItem(LS_LAST_SNAPSHOT);
  } catch {
    return null;
  }
}
