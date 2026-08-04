/**
 * Full-system snapshot backup to Cloudflare D1.
 * Runs every 2 hours + on demand. Keeps last 10 per branch on the worker.
 */
import {
  cloudGetCollection,
  cloudUpsert,
  getBranchIdHeader,
  getCsrfToken,
  getRoleIntent,
  isCloudConfigured,
  normalizeBranchId,
} from './cloudConfig';
import { withDB } from '../repositories/indexeddb/db';
import { DURABLE_SETTING_KEYS } from './settingsCloudService';

const INTERVAL_MS = 2 * 60 * 60 * 1000;
/**
 * Floor between two AUTOMATIC snapshots, enforced across every tab on this
 * origin (the stamp lives in localStorage). The 2h interval alone did not bound
 * anything: each tab owns its own timer and each reload restarts the 30s
 * post-boot fire, so a till with the POS, the manager dashboard and the QR menu
 * open wrote several backups a minute. Manual snapshots ignore this.
 */
const MIN_AUTO_SNAPSHOT_GAP_MS = 30 * 60 * 1000;
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
  // brewmaster_telegram_config is NOT in DURABLE_SETTING_KEYS (it would be a
  // plaintext token in every snapshot payload) — so this loop never picks it
  // up. The token's only cloud copy is the single encrypted settings row
  // written by telegramCloudService. Snapshots are never used to restore it.
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

/** True when the payload carries no business rows at all. */
function isEmptySnapshotPayload(p: SnapshotPayload): boolean {
  return (
    (p.orders?.length || 0) === 0 &&
    (p.menu_items?.length || 0) === 0 &&
    (p.customers?.length || 0) === 0 &&
    (p.companies?.length || 0) === 0 &&
    (p.inventory?.length || 0) === 0
  );
}

/**
 * Is there a cloud session this device can actually write with?
 *
 * `isCloudConfigured()` only says a Worker URL exists — it says nothing about
 * whether we are signed in. An automatic snapshot fired before login has no
 * session to write with, so it can only ever produce a 401/403.
 */
function hasWritableSession(): boolean {
  return !!getRoleIntent() && !!getCsrfToken();
}

function readLastSnapshotTime(): number {
  try {
    const raw = localStorage.getItem(LS_LAST_SNAPSHOT);
    const t = raw ? new Date(raw).getTime() : 0;
    return Number.isFinite(t) ? t : 0;
  } catch {
    return 0;
  }
}

function writeLastSnapshotStamp(iso: string | null): void {
  try {
    if (iso === null) localStorage.removeItem(LS_LAST_SNAPSHOT);
    else localStorage.setItem(LS_LAST_SNAPSHOT, iso);
  } catch {
    // ignore — the cooldown degrades to per-tab only
  }
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

  // An automatic backup is a background nicety, never worth a failed request.
  // Before this guard the scheduler fired 30s after boot in EVERY branch of the
  // App bootstrap — including the not-signed-in one — so the very first thing a
  // freshly loaded tab did was POST a snapshot with no session behind it. That
  // is the 403 the operator saw in the console on both the cashier and the
  // manager screen. A manual snapshot is an explicit operator action and is
  // allowed to try (and to report a real error) even if this looks unpromising.
  if (kind === 'auto' && !hasWritableSession()) {
    return { ok: false, error: 'no session' };
  }

  // Cross-tab cooldown. LS_LAST_SNAPSHOT is shared by every tab on this origin,
  // so this collapses the storm that three open tabs (or three reloads) used to
  // produce: D1 keeps only the last 10 snapshots per branch, and a burst of
  // near-identical backups evicts genuinely older restore points for nothing.
  const previousStamp = (() => {
    try {
      return localStorage.getItem(LS_LAST_SNAPSHOT);
    } catch {
      return null;
    }
  })();
  if (kind === 'auto') {
    const since = Date.now() - readLastSnapshotTime();
    if (since < MIN_AUTO_SNAPSHOT_GAP_MS) return { ok: false, error: 'too soon' };
  }

  running = true;
  // Claim the slot up front so a sibling tab firing milliseconds later backs off
  // instead of racing us. Rolled back below if this attempt does not land.
  writeLastSnapshotStamp(new Date().toISOString());
  try {
    const payload = await buildSnapshotPayload(branchId);

    // Never upload an empty backup. A tab that snapshots before the cloud
    // hydrate has populated IndexedDB produces a ~200-byte payload with no
    // rows in it; because restoreFromSnapshotIfNeeded restores the LATEST
    // snapshot, letting those through means a fresh device can "restore" a
    // backup that contains nothing while the real ones age out of the ring.
    if (isEmptySnapshotPayload(payload)) {
      writeLastSnapshotStamp(previousStamp);
      return { ok: false, error: 'empty' };
    }

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
      writeLastSnapshotStamp(payload.createdAt);
      console.info('[snapshot] saved', id, kind);
      return { ok: true, id };
    }
    // Failed upload must not consume the cooldown — the next tick should retry.
    writeLastSnapshotStamp(previousStamp);
    return { ok: false, error: 'upload failed' };
  } catch (err: any) {
    writeLastSnapshotStamp(previousStamp);
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

/** Basic shape check before we trust a payload near IndexedDB / localStorage. */
function isValidSnapshotPayload(p: any): p is SnapshotPayload {
  return !!p && typeof p === 'object' && Array.isArray(p.orders) && Array.isArray(p.menu_items);
}

export type RestoreCounts = {
  orders: number;
  menu: number;
  customers: number;
  companies: number;
  inventory: number;
  settings: number;
};

/**
 * Settings keys that carry a secret. These are never written by a restore —
 * see the note in applySnapshotPayload (A-07).
 */
const CREDENTIAL_SETTING_KEYS: readonly string[] = [
  'brewmaster_admin_creds_v2',
  'brewmaster_manager_creds_v1',
  'brewmaster_admin_pin',
  'brewmaster_refund_pin',
  'brewmaster_telegram_config',
  'brewmaster_telegram_bot_token',
  'brewmaster_telegram_chat_id',
  'brewmaster_telegram_config_enc',
];

/** True when a settings key holds a credential/secret (namespaced or bare). */
export function isCredentialSettingKey(key: string): boolean {
  const raw = String(key || '').trim();
  const bare = raw.includes('::') ? raw.slice(raw.indexOf('::') + 2).trim() : raw;
  return CREDENTIAL_SETTING_KEYS.includes(bare);
}

/**
 * Write a snapshot payload back into IndexedDB + localStorage.
 *
 * Restore is MERGE-ONLY by id: live local rows are never cleared, so restoring
 * can only re-materialize missing/stale data — never wipe current work. Rows
 * that carry a `deletedAt` tombstone are skipped (a restore must never
 * resurrect something the operator deleted). Settings are written to
 * localStorage without overwriting keys that already have a local value.
 *
 * Works fully offline on a JSON payload (the Settings Import flow) and is also
 * what the cloud-restore path uses after downloading the latest snapshot.
 */
export async function applySnapshotPayload(payload: SnapshotPayload): Promise<RestoreCounts> {
  const counts: RestoreCounts = {
    orders: 0,
    menu: 0,
    customers: 0,
    companies: 0,
    inventory: 0,
    settings: 0,
  };
  if (!isValidSnapshotPayload(payload)) {
    throw new Error('invalid snapshot payload');
  }

  const liveRows = (rows: any[] | undefined) =>
    (rows || []).filter((r: any) => r && r.id && !r.deletedAt);

  await withDB(async (db) => {
    const mergeInto = async (store: 'orders' | 'menu_items' | 'customers' | 'companies' | 'inventory', rows: any[]) => {
      const tx = db.transaction(store, 'readwrite');
      for (const row of rows) {
        const existing = (await tx.store.get(row.id)) as any;

        // A brand-new id always lands.
        if (!existing) {
          await tx.store.put(row);
          continue;
        }

        // The comment above this code used to promise that an incoming row with
        // no timestamp "only fills a gap", but the arithmetic did not deliver
        // it: an unparseable/missing updatedAt collapsed to 0 on BOTH sides, so
        // `0 >= 0` was true and a timestamp-less snapshot row overwrote a live
        // local row (the local row's own updatedAt is also 0 whenever it is
        // missing or corrupt). Make the promise real — no timestamp means no
        // authority to overwrite anything that already exists.
        const incomingT = Date.parse(row?.updatedAt ?? row?.updated_at ?? '');
        if (!Number.isFinite(incomingT)) continue;

        const existingT = Date.parse(existing?.updatedAt ?? '');
        // A local row with no usable timestamp cannot be proven older, so it
        // is left alone too. Restore is a recovery path, not a merge conflict
        // resolver — when in doubt it must not destroy current work.
        if (!Number.isFinite(existingT)) continue;

        if (incomingT >= existingT) {
          await tx.store.put(row);
        }
      }
      await tx.done;
      return rows.length;
    };

    counts.orders = await mergeInto('orders', liveRows(payload.orders));
    counts.menu = await mergeInto('menu_items', liveRows(payload.menu_items));
    counts.customers = await mergeInto('customers', liveRows(payload.customers));
    counts.companies = await mergeInto('companies', liveRows(payload.companies));
    counts.inventory = await mergeInto('inventory', liveRows(payload.inventory));
  });

  if (typeof localStorage !== 'undefined') {
    for (const [key, value] of Object.entries(payload.settings || {})) {
      try {
        // SECURITY (A-07): credentials are never restored from a snapshot.
        // A snapshot row is writable by a cashier device (the backup scheduler
        // runs unattended on every till), so its settings blob is attacker-
        // influenced input. Installing a password hash / refund PIN / bot token
        // from it would turn "manager restores a backup" into a privilege
        // escalation. Operators re-enter these on the restored device; every
        // other setting is restored normally.
        if (isCredentialSettingKey(key)) continue;
        if (localStorage.getItem(key) === null) {
          localStorage.setItem(
            key,
            typeof value === 'string' ? value : JSON.stringify(value)
          );
          counts.settings++;
        }
      } catch {
        // ignore individual key failures
      }
    }
  }

  if (payload.recipes && typeof localStorage !== 'undefined') {
    try {
      if (localStorage.getItem('web_menu_recipes_store') === null) {
        localStorage.setItem('web_menu_recipes_store', JSON.stringify(payload.recipes));
      }
    } catch {
      // ignore
    }
  }

  return counts;
}

/**
 * Restore snapshot into IndexedDB + localStorage when cloud collections look empty.
 *
 * MANAGER-ONLY: the settings blob inside a snapshot carries password hashes
 * and other sensitive config, so this is gated on the session role (and the
 * Worker independently blocks cashier READS of the snapshots table). When the
 * hydrate found no live rows anywhere — the classic "fresh device / cleared
 * browser" case — the latest cloud snapshot is downloaded and merged back in.
 * A partially-populated database is left alone: an empty store can be a
 * deliberate reset, and auto-resurrecting wiped data was the reason the old
 * version of this function was disabled.
 */
export async function restoreFromSnapshotIfNeeded(_hydrateResult: {
  orders: number;
  menu: number;
  customers: number;
  settings?: number;
}): Promise<boolean> {
  try {
    if (typeof localStorage !== 'undefined') {
      const role = localStorage.getItem('brewmaster_user_role');
      if (role !== 'manager') return false;
    }
    const totalLocal =
      (_hydrateResult?.orders || 0) +
      (_hydrateResult?.menu || 0) +
      (_hydrateResult?.customers || 0);
    if (totalLocal > 0) return false; // device already has data — nothing to rescue

    const latest = await getLatestSnapshot();
    if (!latest || !isValidSnapshotPayload(latest)) return false;

    const counts = await applySnapshotPayload(latest);
    const restored =
      counts.orders + counts.menu + counts.customers + counts.companies + counts.inventory;
    if (restored > 0) {
      console.info('[snapshot] restored latest cloud snapshot', counts);
      return true;
    }
    return false;
  } catch (e) {
    console.warn('[snapshot] restore skipped:', e);
    return false;
  }
}

// The three MANUAL backup entry points that used to live here —
// restoreLatestSnapshotNow, exportLocalBackup and importBackupFromFile — are
// gone along with the Settings card that was their only caller. Backups
// themselves are untouched: createSnapshot still runs on the scheduler, and
// restoreFromSnapshotIfNeeded still rescues a device that boots with an empty
// database. What is gone is the operator-facing export / import / restore-now
// UI, at the operator's request.

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

  // Best-effort snapshot when the tab is hidden. The cross-tab cooldown inside
  // createSnapshot is what keeps this from firing on every tab switch.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      void createSnapshot('auto');
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
