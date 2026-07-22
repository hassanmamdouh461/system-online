/**
 * Full-system snapshot backup to Cloudflare D1.
 * Runs every 2 hours + on demand. Keeps last 10 per branch on the worker.
 */
import {
  cloudGetCollection,
  cloudUpsert,
  getBranchIdHeader,
  isCloudConfigured,
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
  const branch = branchId || getBranchIdHeader() || 'main_branch';
  const [orders, menu_items, customers, companies, inventory] = await withDB(async (db) => {
    return Promise.all([
      db.getAll('orders'),
      db.getAll('menu_items'),
      db.getAll('customers'),
      db.getAll('companies'),
      db.getAll('inventory'),
    ]);
  });

  return {
    version: 1,
    createdAt: new Date().toISOString(),
    branchId: branch,
    orders,
    menu_items,
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
export async function restoreFromSnapshotIfNeeded(hydrateResult: {
  orders: number;
  menu: number;
  customers: number;
  settings?: number;
}): Promise<boolean> {
  // Only restore if everything looks wiped
  if (hydrateResult.orders > 0 || hydrateResult.menu > 0 || hydrateResult.customers > 0) {
    return false;
  }
  const snap = await getLatestSnapshot();
  if (!snap) return false;

  try {
    const { putMany, enqueueWrite } = await import('../repositories/indexeddb/db');
    await enqueueWrite(async () => {
      if (snap.orders?.length) await putMany('orders', snap.orders);
      if (snap.menu_items?.length) await putMany('menu_items', snap.menu_items);
      if (snap.customers?.length) await putMany('customers', snap.customers);
      if (snap.companies?.length) await putMany('companies', snap.companies);
      if (snap.inventory?.length) await putMany('inventory', snap.inventory);
    });

    if (snap.settings) {
      for (const [k, v] of Object.entries(snap.settings)) {
        try {
          localStorage.setItem(k, v);
        } catch {
          // ignore
        }
      }
    }
    if (snap.recipes) {
      try {
        localStorage.setItem('web_menu_recipes_store', JSON.stringify(snap.recipes));
      } catch {
        // ignore
      }
    }
    if (snap.inventory_transactions?.length) {
      try {
        localStorage.setItem(
          'pos_inventory_transactions_web_store',
          JSON.stringify(snap.inventory_transactions)
        );
      } catch {
        // ignore
      }
    }
    console.info('[snapshot] restored from backup', snap.createdAt);
    return true;
  } catch (e) {
    console.warn('[snapshot] restore failed:', e);
    return false;
  }
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
