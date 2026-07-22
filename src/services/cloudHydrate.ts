/**
 * Boot-time cloud hydration — restores D1 → IndexedDB/localStorage after browser wipe.
 * Uses the hardened IDB layer (withDB / enqueueWrite / putMany) so it never
 * closes the connection while POS is creating orders.
 */
import { getDB, putMany, enqueueWrite, withDB } from '../repositories/indexeddb/db';
import { cloudGetCollection, isCloudConfigured, optionalNumber } from './cloudConfig';
import { hydrateSettingsFromCloud, pushAllLocalSettingsToCloud } from './settingsCloudService';
import type { Order } from '../types/order';
import type { MenuItem } from '../types/menu';
import type { Customer } from '../types/customer';
import type { Company } from '../types/company';
import { parseOrderSeq, mergeOrderRecords } from '../utils/orderNumber';

function mapOrder(doc: any): Order {
  let items = doc.items;
  if (typeof items === 'string') {
    try {
      items = JSON.parse(items || '[]');
    } catch {
      items = [];
    }
  }
  if (!Array.isArray(items)) items = [];

  const totalAmount = optionalNumber(doc.totalAmount ?? doc.total_amount) ?? 0;
  const taxRate = optionalNumber(doc.taxRate ?? doc.tax_rate);
  const taxAmount = optionalNumber(doc.taxAmount ?? doc.tax_amount);
  const grandTotal = optionalNumber(doc.grandTotal ?? doc.grand_total);

  // Never invent ticket numbers from document ids (timestamps).
  const rawNum = String(doc.orderNumber ?? doc.order_number ?? '');
  const seq = parseOrderSeq(rawNum);
  const orderNumber = seq !== null ? String(seq) : '';

  return {
    id: String(doc.id || doc.$id),
    orderNumber,
    tableId: doc.tableId || 'Takeaway',
    items,
    status: (doc.status as Order['status']) || 'Completed',
    paymentStatus: (doc.paymentStatus as Order['paymentStatus']) || 'Paid',
    paymentMethod: (doc.paymentMethod || doc.payment_method || 'Cash') as Order['paymentMethod'],
    totalAmount,
    ...(taxRate !== undefined ? { taxRate } : {}),
    ...(taxAmount !== undefined ? { taxAmount } : {}),
    ...(grandTotal !== undefined ? { grandTotal } : {}),
    pointsEarned: optionalNumber(doc.pointsEarned),
    pointsRedeemed: optionalNumber(doc.pointsRedeemed),
    createdAt: doc.createdAt || doc.$createdAt || new Date().toISOString(),
    updatedAt: doc.updatedAt || doc.updated_at || undefined,
    paidAt: doc.paidAt || undefined,
    customerPhone: doc.customerPhone || doc.customer_phone || undefined,
    customerId: doc.customerId || doc.customer_id || undefined,
    customerName: doc.customerName || doc.customer_name || undefined,
    companyId: doc.companyId || doc.company_id || undefined,
    companyName: doc.companyName || doc.company_name || undefined,
    billedToType: doc.billedToType || doc.billed_to_type || undefined,
    refundedAt: doc.refundedAt || doc.refunded_at || undefined,
    refundReason: doc.refundReason || doc.refund_reason || undefined,
    branchId: doc.branch_id || doc.branchId || 'main_branch',
  };
}

function mapMenu(doc: any): MenuItem {
  return {
    id: String(doc.id || doc.$id),
    name: doc.name || 'صنف',
    price: optionalNumber(doc.price) ?? 0,
    category: doc.category || 'عام',
    description: doc.description,
    image: doc.image,
    available: doc.available === 1 || doc.available === true || doc.available === '1',
    branchId: doc.branch_id || doc.branchId,
  };
}

function mapCustomer(doc: any): Customer | null {
  const phone = String(doc.phone || '').trim();
  if (!phone) return null;
  let tags = doc.tags;
  if (typeof tags === 'string') {
    try {
      tags = JSON.parse(tags || '[]');
    } catch {
      tags = [];
    }
  }
  return {
    id: String(doc.id || doc.$id),
    name: doc.name || 'عميل',
    phone,
    points: optionalNumber(doc.points) ?? 0,
    companyId: doc.companyId || doc.company_id,
    tags: Array.isArray(tags) ? tags : [],
    notes: doc.notes,
    branchId: doc.branch_id || doc.branchId,
    createdAt: doc.createdAt || doc.$createdAt || new Date().toISOString(),
    updatedAt: doc.updatedAt || doc.updated_at || new Date().toISOString(),
  };
}

function mapCompany(doc: any): Company {
  let tags = doc.tags;
  if (typeof tags === 'string') {
    try {
      tags = JSON.parse(tags || '[]');
    } catch {
      tags = [];
    }
  }
  return {
    id: String(doc.id || doc.$id),
    name: doc.name || 'شركة',
    tags: Array.isArray(tags) ? tags : [],
    phone: doc.phone,
    notes: doc.notes,
    branchId: doc.branch_id || doc.branchId,
    createdAt: doc.createdAt || doc.created_at || new Date().toISOString(),
    updatedAt: doc.updatedAt || doc.updated_at || new Date().toISOString(),
  };
}

export type HydrateResult = {
  ok: boolean;
  configured: boolean;
  orders: number;
  menu: number;
  customers: number;
  companies: number;
  inventory: number;
  settings: number;
  recipes: number;
  transactions: number;
  error?: string;
};

let hydratePromise: Promise<HydrateResult> | null = null;
let lastSuccessAt = 0;

const WEB_RECIPES_STORAGE_KEY = 'web_menu_recipes_store';
const WEB_TX_KEY = 'pos_inventory_transactions_web_store';

function applyRecipesFromCloud(docs: any[]): number {
  if (!docs.length) return 0;
  const store: Record<string, any[]> = {};
  try {
    const raw = localStorage.getItem(WEB_RECIPES_STORAGE_KEY);
    if (raw) Object.assign(store, JSON.parse(raw));
  } catch {
    // ignore
  }
  for (const doc of docs) {
    const menuItemId = String(doc.menuItemId || doc.menu_item_id || '');
    const inventoryItemId = String(doc.inventoryItemId || doc.inventory_item_id || '');
    if (!menuItemId || !inventoryItemId) continue;
    if (!store[menuItemId]) store[menuItemId] = [];
    // replace same ingredient if present
    store[menuItemId] = store[menuItemId].filter((x) => x.inventoryItemId !== inventoryItemId);
    store[menuItemId].push({
      inventoryItemId,
      quantity: Number(doc.quantity) || 0,
      unit: doc.unit,
      menuItemId,
    });
  }
  try {
    localStorage.setItem(WEB_RECIPES_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // ignore
  }
  return docs.length;
}

function applyTransactionsFromCloud(docs: any[]): number {
  if (!docs.length) return 0;
  let list: any[] = [];
  try {
    const raw = localStorage.getItem(WEB_TX_KEY);
    if (raw) list = JSON.parse(raw);
  } catch {
    list = [];
  }
  const byId = new Map(list.map((t) => [t.id, t]));
  for (const doc of docs) {
    const id = String(doc.id || doc.$id || '');
    if (!id) continue;
    byId.set(id, {
      id,
      itemId: doc.itemId || doc.item_id,
      itemName: doc.itemName || doc.item_name,
      type: doc.type,
      quantity: Number(doc.quantity) || 0,
      unit: doc.unit,
      referenceId: doc.referenceId || doc.reference_id,
      notes: doc.notes,
      branchId: doc.branchId || doc.branch_id,
      createdAt: doc.createdAt || doc.created_at || new Date().toISOString(),
    });
  }
  const merged = Array.from(byId.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  if (merged.length > 2000) merged.length = 2000;
  try {
    localStorage.setItem(WEB_TX_KEY, JSON.stringify(merged));
  } catch {
    // ignore
  }
  return docs.length;
}

export async function hydrateFromCloud(force = false): Promise<HydrateResult> {
  if (!force && hydratePromise && Date.now() - lastSuccessAt < 30_000) {
    return hydratePromise;
  }

  const run = (async (): Promise<HydrateResult> => {
    const empty: HydrateResult = {
      ok: false,
      configured: isCloudConfigured(),
      orders: 0,
      menu: 0,
      customers: 0,
      companies: 0,
      inventory: 0,
      settings: 0,
      recipes: 0,
      transactions: 0,
    };

    if (!isCloudConfigured()) {
      return { ...empty, error: 'Cloud worker URL not configured' };
    }
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return { ...empty, configured: true, error: 'Offline' };
    }

    try {
      await getDB();

      // Settings first so tax/PIN/branch restore before UI reads them
      const settingsCount = await hydrateSettingsFromCloud();

      const [orders, menu, customers, companies, inventory, recipes, transactions] =
        await Promise.all([
          cloudGetCollection('orders'),
          cloudGetCollection('menu_items'),
          cloudGetCollection('customers'),
          cloudGetCollection('companies'),
          cloudGetCollection('inventory'),
          cloudGetCollection('recipes'),
          cloudGetCollection('inventory_transactions'),
        ]);

      const result: HydrateResult = {
        ok: true,
        configured: true,
        orders: 0,
        menu: 0,
        customers: 0,
        companies: 0,
        inventory: 0,
        settings: settingsCount,
        recipes: 0,
        transactions: 0,
      };

      await enqueueWrite(async () => {
        // Orders: smart-merge so cloud empty fields / 1000-series tickets never wipe local
        if (orders && orders.length > 0) {
          result.orders = await withDB(async (db) => {
            const existing = await db.getAll('orders');
            const localById = new Map(existing.map((o) => [o.id, o]));
            const tx = db.transaction('orders', 'readwrite');
            let n = 0;
            for (const doc of orders) {
              const remote = mapOrder(doc);
              if (!remote.id) continue;
              const local = localById.get(remote.id);
              const merged = mergeOrderRecords(local, remote) as Order;
              try {
                await tx.store.put(merged);
                n++;
              } catch (e) {
                console.warn('[hydrate] skip bad order row:', e);
              }
            }
            await tx.done;
            return n;
          });
        }
        if (menu && menu.length > 0) {
          result.menu = await putMany(
            'menu_items',
            menu.map(mapMenu).filter((m) => !!m.id)
          );
        }
        if (customers && customers.length > 0) {
          // Merge customers: keep local name/companyId when cloud sends placeholder «عميل»
          result.customers = await withDB(async (db) => {
            const existing = await db.getAll('customers');
            const byId = new Map(existing.map((c) => [c.id, c]));
            const byPhone = new Map(
              existing
                .filter((c) => c.phone)
                .map((c) => [String(c.phone).replace(/[\s\-()]/g, ''), c])
            );
            const mapped = customers
              .map(mapCustomer)
              .filter((c): c is Customer => !!c && !!c.id);
            const tx = db.transaction('customers', 'readwrite');
            let n = 0;
            for (const remote of mapped) {
              const phoneKey = String(remote.phone || '').replace(/[\s\-()]/g, '');
              const local =
                byId.get(remote.id) ||
                (phoneKey ? byPhone.get(phoneKey) : undefined);
              const isPlaceholder = (s?: string) => {
                const t = (s || '').trim().toLowerCase();
                return !t || t === 'عميل' || t === 'customer';
              };
              const merged: Customer = local
                ? {
                    ...local,
                    ...remote,
                    id: local.id || remote.id,
                    name:
                      !isPlaceholder(remote.name)
                        ? remote.name
                        : !isPlaceholder(local.name)
                          ? local.name
                          : remote.name || local.name || 'عميل',
                    phone: remote.phone || local.phone,
                    companyId: remote.companyId || local.companyId,
                    points:
                      typeof remote.points === 'number'
                        ? Math.max(remote.points, local.points || 0)
                        : local.points,
                    tags:
                      Array.isArray(remote.tags) && remote.tags.length > 0
                        ? remote.tags
                        : local.tags,
                    notes: remote.notes || local.notes,
                  }
                : remote;
              try {
                await tx.store.put(merged);
                n++;
              } catch (e) {
                console.warn('[hydrate] skip bad customer:', e);
              }
            }
            await tx.done;
            return n;
          });
        }
        if (companies && companies.length > 0) {
          result.companies = await withDB(async (db) => {
            const existing = await db.getAll('companies');
            const byId = new Map(existing.map((c) => [c.id, c]));
            const mapped = companies.map(mapCompany).filter((c) => !!c.id);
            const tx = db.transaction('companies', 'readwrite');
            let n = 0;
            for (const remote of mapped) {
              const local = byId.get(remote.id);
              const merged: Company = local
                ? {
                    ...local,
                    ...remote,
                    name: remote.name?.trim() || local.name,
                    phone: remote.phone || local.phone,
                    notes: remote.notes || local.notes,
                    tags:
                      Array.isArray(remote.tags) && remote.tags.length > 0
                        ? remote.tags
                        : local.tags,
                  }
                : remote;
              try {
                await tx.store.put(merged);
                n++;
              } catch (e) {
                console.warn('[hydrate] skip bad company:', e);
              }
            }
            await tx.done;
            return n;
          });
        }
        if (inventory && inventory.length > 0) {
          result.inventory = await putMany(
            'inventory',
            inventory.map((doc: any) => ({
              id: String(doc.id || doc.$id),
              name: doc.name || 'عنصر',
              unit: doc.unit || 'وحدة',
              stock: optionalNumber(doc.stock) ?? 0,
              minStock: optionalNumber(doc.minStock) ?? 0,
              costPerUnit: optionalNumber(doc.costPerUnit) ?? 0,
              branchId: doc.branch_id || doc.branchId,
              createdAt: doc.createdAt || doc.created_at || new Date().toISOString(),
              updatedAt: doc.updatedAt || doc.updated_at || new Date().toISOString(),
            }))
          );
        }
      });

      if (recipes && recipes.length > 0) {
        result.recipes = applyRecipesFromCloud(recipes);
      }
      if (transactions && transactions.length > 0) {
        result.transactions = applyTransactionsFromCloud(transactions);
      }

      // Bootstrap reverse: if D1 menu empty but local has items, push them
      if ((!menu || menu.length === 0) && typeof navigator !== 'undefined' && navigator.onLine) {
        try {
          const localMenu = await withDB((db) => db.getAll('menu_items'));
          if (localMenu.length > 0) {
            const { menuRepository } = await import('../repositories');
            if (typeof (menuRepository as any).bootstrapPushAll === 'function') {
              await (menuRepository as any).bootstrapPushAll(localMenu);
            }
          }
        } catch (e) {
          console.warn('[hydrate] menu bootstrap push skipped:', e);
        }
      }

      // If no settings on cloud but local has durable keys, push them
      if (settingsCount === 0) {
        void pushAllLocalSettingsToCloud();
      }

      lastSuccessAt = Date.now();
      console.info('[hydrateFromCloud]', result);
      return result;
    } catch (err: any) {
      console.error('[hydrateFromCloud] failed:', err);
      hydratePromise = null;
      lastSuccessAt = 0;
      return {
        ...empty,
        configured: true,
        error: err?.message || String(err),
      };
    }
  })();

  hydratePromise = run;
  const result = await run;
  if (!result.ok) {
    hydratePromise = null;
  }
  return result;
}

export function resetHydrateCache() {
  hydratePromise = null;
  lastSuccessAt = 0;
}
