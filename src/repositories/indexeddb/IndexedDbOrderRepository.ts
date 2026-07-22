import { IOrderRepository } from '../types';
import { Order, OrderStatus } from '../../types/order';
import { withDB, enqueueWrite, SyncRecord } from './db';
import { syncService } from '../../services/syncService';
import { cloudGetCollection, optionalNumber } from '../../services/cloudConfig';
import {
  nextOrderSeq,
  parseOrderSeq,
  mergeOrderRecords,
  dayKeyFromIso,
} from '../../utils/orderNumber';

const DAILY_TICKET_SOFT_MAX = 500;

function mapRemoteOrder(doc: any): Order {
  let parsedItems = doc.items;
  if (typeof parsedItems === 'string') {
    try {
      parsedItems = JSON.parse(parsedItems || '[]');
    } catch {
      parsedItems = [];
    }
  }
  if (!Array.isArray(parsedItems)) parsedItems = [];

  const totalAmount = optionalNumber(doc.totalAmount ?? doc.total_amount) ?? 0;
  const taxRate = optionalNumber(doc.taxRate ?? doc.tax_rate);
  const taxAmount = optionalNumber(doc.taxAmount ?? doc.tax_amount);
  const grandTotal = optionalNumber(doc.grandTotal ?? doc.grand_total);

  // Never use document id (timestamps) as orderNumber — only short sequential values.
  const rawNum = String(doc.orderNumber ?? doc.order_number ?? '');
  const seq = parseOrderSeq(rawNum);
  const orderNumber = seq !== null ? String(seq) : '';

  return {
    id: String(doc.id || doc.$id),
    orderNumber,
    tableId: doc.tableId || 'Takeaway',
    items: parsedItems,
    status: (doc.status as OrderStatus) || 'Completed',
    paymentStatus: doc.paymentStatus || 'Paid',
    paymentMethod: doc.paymentMethod || doc.payment_method || 'Cash',
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

function filterByBranch(orders: Order[], branchId?: string): Order[] {
  if (!branchId || branchId === 'manager' || branchId === 'all') return orders;
  return orders.filter(
    (order) =>
      !order.branchId ||
      order.branchId === branchId ||
      order.branchId === 'default' ||
      (branchId === 'main_branch' &&
        (order.branchId === 'default' || order.branchId === 'branch_1')) ||
      (branchId === 'default' &&
        (order.branchId === 'main_branch' || order.branchId === 'branch_1'))
  );
}

function sanitizeItems(items: Order['items']): Order['items'] {
  return (items || []).map((it) => ({
    id: String(it.id || ''),
    name: String(it.name || ''),
    quantity: Number(it.quantity) || 0,
    price: Number(it.price) || 0,
    ...(it.menuItemId ? { menuItemId: String(it.menuItemId) } : {}),
    ...(it.status ? { status: it.status } : {}),
    ...(it.category ? { category: String(it.category) } : {}),
  }));
}

function dayNeedsRenumber(dayOrders: Order[]): boolean {
  if (dayOrders.length === 0) return false;

  const seqs: number[] = [];
  for (const o of dayOrders) {
    const n = parseOrderSeq(o.orderNumber);
    if (n === null) return true;
    seqs.push(n);
  }

  const max = Math.max(...seqs);
  // Legacy 1000-series counters (or any inflated ticket) → rewrite to 1..N for the day
  if (max >= 1000) return true;
  // Max far above how many tickets that day actually has
  if (max > dayOrders.length + 50) return true;
  if (max > DAILY_TICKET_SOFT_MAX && max > dayOrders.length * 2) return true;
  // Duplicates
  if (new Set(seqs).size !== seqs.length) return true;
  return false;
}

export class IndexedDbOrderRepository implements IOrderRepository {
  /** Pure local read — no cloud round-trip. */
  async getAllLocal(branchId?: string): Promise<Order[]> {
    const localOrders = await withDB((db) => db.getAll('orders'));
    return filterByBranch(localOrders, branchId);
  }

  async getAll(branchId?: string): Promise<Order[]> {
    // Local-first read (never depends on cloud for POS to work)
    let localOrders = await withDB((db) => db.getAll('orders'));

    // Best-effort cloud merge (non-blocking for failures)
    if (typeof navigator !== 'undefined' && navigator.onLine) {
      try {
        const remoteDocs = await cloudGetCollection('orders');
        if (remoteDocs && remoteDocs.length > 0) {
          await enqueueWrite(async () => {
            await withDB(async (db) => {
              const existing = await db.getAll('orders');
              const localById = new Map(existing.map((o) => [o.id, o]));
              const tx = db.transaction('orders', 'readwrite');
              for (const doc of remoteDocs) {
                const remote = mapRemoteOrder(doc);
                if (!remote.id) continue;
                const local = localById.get(remote.id);
                // Smart merge: never let remote empty wipe local company/customer/ticket
                // and never re-inflate renumbered tickets from cloud 1000-series
                await tx.store.put(mergeOrderRecords(local, remote) as Order);
              }
              await tx.done;
            });
          });
          localOrders = await withDB((db) => db.getAll('orders'));
        }
      } catch (e) {
        console.warn('[IndexedDbOrderRepository] remote merge skipped:', e);
      }
    }

    return filterByBranch(localOrders, branchId);
  }

  /**
   * Enforce daily ticket numbers 1..N per local calendar day (midnight reset model).
   * Always rewrites junk / empty / inflated legacy counters (1000+).
   * Queues cloud upserts so D1 stops re-sending old numbers on next hydrate.
   */
  async renumberIfNeeded(): Promise<number> {
    return enqueueWrite(async () => {
      return withDB(async (db) => {
        const all = await db.getAll('orders');
        if (all.length === 0) return 0;

        const byDay = new Map<string, Order[]>();
        for (const o of all) {
          const key = dayKeyFromIso(o.createdAt) || 'unknown';
          if (!byDay.has(key)) byDay.set(key, []);
          byDay.get(key)!.push(o);
        }

        let needs = false;
        for (const [, dayOrders] of byDay) {
          if (dayNeedsRenumber(dayOrders)) {
            needs = true;
            break;
          }
        }
        if (!needs) return 0;

        let changed = 0;
        const updatedOrders: Order[] = [];
        const now = new Date().toISOString();
        const tx = db.transaction(['orders', 'sync_queue'], 'readwrite');
        for (const [, dayOrders] of byDay) {
          // Only rewrite days that actually need it (leave clean historical days alone)
          if (!dayNeedsRenumber(dayOrders)) continue;

          dayOrders.sort(
            (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
          );
          let seq = 1;
          for (const o of dayOrders) {
            const next = String(seq);
            if (String(o.orderNumber || '') !== next) {
              const updated: Order = { ...o, orderNumber: next, updatedAt: now };
              await tx.objectStore('orders').put(updated);
              updatedOrders.push(updated);
              try {
                await tx.objectStore('sync_queue').put({
                  id: `sync_renum_${o.id}_${Date.now()}_${seq}`,
                  type: 'order',
                  action: 'update',
                  data: updated,
                  timestamp: now,
                  synced: 0,
                } as SyncRecord);
              } catch {
                // non-fatal
              }
              changed++;
            }
            seq++;
          }
        }
        await tx.done;

        // Push renumbered tickets to cloud so next hydrate doesn't reintroduce 1000
        if (updatedOrders.length > 0) {
          void import('../../services/cloudConfig')
            .then(async ({ cloudUpsert }) => {
              for (const o of updatedOrders) {
                try {
                  await cloudUpsert('orders', o.id, o);
                } catch {
                  // queue will retry
                }
              }
              void syncService.syncPendingData();
            })
            .catch(() => void syncService.syncPendingData());
        }

        return changed;
      });
    });
  }

  async create(orderData: Omit<Order, 'id'>, branchId?: string): Promise<Order> {
    return enqueueWrite(async () => {
      return withDB(async (db) => {
        const id = `ord_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        const now = new Date().toISOString();

        const allOrders = await db.getAll('orders');
        // Always assign a short sequential ticket number (1, 2, 3...).
        // Ignore huge digit strings that came from timestamps / document ids.
        const provided = parseOrderSeq(orderData.orderNumber);
        const cleanNum = String(provided ?? nextOrderSeq(allOrders));

        const newOrder: Order = {
          id,
          orderNumber: cleanNum,
          tableId: String(orderData.tableId || 'Takeaway'),
          items: sanitizeItems(orderData.items),
          status: orderData.status || 'New',
          paymentStatus: orderData.paymentStatus || 'Unpaid',
          paymentMethod: orderData.paymentMethod,
          totalAmount: Number(orderData.totalAmount) || 0,
          taxRate: typeof orderData.taxRate === 'number' ? orderData.taxRate : undefined,
          taxAmount: typeof orderData.taxAmount === 'number' ? orderData.taxAmount : undefined,
          grandTotal: typeof orderData.grandTotal === 'number' ? orderData.grandTotal : undefined,
          createdAt: orderData.createdAt || now,
          paidAt: orderData.paidAt,
          customerPhone: orderData.customerPhone,
          customerId: orderData.customerId,
          customerName: orderData.customerName,
          companyId: orderData.companyId,
          companyName: orderData.companyName,
          billedToType: orderData.billedToType,
          pointsEarned: orderData.pointsEarned,
          pointsRedeemed: orderData.pointsRedeemed,
          branchId: branchId || orderData.branchId || 'main_branch',
        };

        // Critical path: order only
        await db.put('orders', newOrder);

        // Secondary: sync queue (must not fail the order)
        try {
          const syncRec: SyncRecord = {
            id: `sync_${id}`,
            type: 'order',
            action: 'create',
            data: newOrder,
            timestamp: now,
            synced: 0,
          };
          await db.put('sync_queue', syncRec);
        } catch (syncErr) {
          console.warn('[IndexedDbOrderRepository] sync_queue write failed (order saved):', syncErr);
        }

        // Cloud-first: try immediate D1 upsert (non-blocking for cashier)
        void import('../../services/cloudConfig').then(({ cloudUpsert }) =>
          cloudUpsert('orders', newOrder.id, newOrder).then((ok) => {
            if (!ok) void syncService.syncPendingData();
          })
        ).catch(() => void syncService.syncPendingData());

        return newOrder;
      });
    });
  }

  async update(id: string, data: Partial<Omit<Order, 'id'>>): Promise<Order> {
    return enqueueWrite(async () => {
      return withDB(async (db) => {
        const existing = await db.get('orders', id);
        if (!existing) throw new Error(`Order ${id} not found`);

        const updated: Order = {
          ...existing,
          ...data,
          id,
          items: data.items ? sanitizeItems(data.items) : existing.items,
          updatedAt: new Date().toISOString(),
        };
        const now = new Date().toISOString();

        await db.put('orders', updated);

        try {
          await db.put('sync_queue', {
            id: `sync_${id}_${Date.now()}`,
            type: 'order',
            action: 'update',
            data: updated,
            timestamp: now,
            synced: 0,
          });
        } catch (syncErr) {
          console.warn('[IndexedDbOrderRepository] sync_queue update failed:', syncErr);
        }

        void import('../../services/cloudConfig').then(({ cloudUpsert }) =>
          cloudUpsert('orders', updated.id, updated).then((ok) => {
            if (!ok) void syncService.syncPendingData();
          })
        ).catch(() => void syncService.syncPendingData());

        return updated;
      });
    });
  }

  async updateStatus(id: string, status: OrderStatus): Promise<Order> {
    return this.update(id, { status });
  }

  async completeWithPayment(id: string, method: 'Cash' | 'Card' | 'OnAccount'): Promise<Order> {
    // OnAccount = charge to customer/company credit (receivable). Cash/Card = settled revenue.
    if (method === 'OnAccount') {
      return this.update(id, {
        paymentStatus: 'OnAccount',
        paymentMethod: 'OnAccount',
      });
    }
    return this.update(id, {
      paymentStatus: 'Paid',
      paymentMethod: method,
      paidAt: new Date().toISOString(),
    });
  }

  async delete(id: string): Promise<void> {
    await enqueueWrite(async () => {
      await withDB(async (db) => {
        const now = new Date().toISOString();
        await db.delete('orders', id);
        try {
          await db.put('sync_queue', {
            id: `sync_del_${id}_${Date.now()}`,
            type: 'order',
            action: 'delete',
            data: { id },
            timestamp: now,
            synced: 0,
          });
        } catch {
          // ignore
        }
        void syncService.syncPendingData();
      });
    });
  }

  async resetToDefaults(defaults: Omit<Order, 'id'>[], branchId?: string): Promise<Order[]> {
    await enqueueWrite(async () => {
      await withDB(async (db) => {
        await db.clear('orders');
      });
    });
    const created: Order[] = [];
    for (const item of defaults) {
      created.push(await this.create(item, branchId));
    }
    return created;
  }
}
