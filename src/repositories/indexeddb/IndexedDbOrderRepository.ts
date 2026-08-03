import { IOrderRepository } from '../types';
import { Order, OrderStatus } from '../../types/order';
import { withDB, enqueueWrite, SyncRecord } from './db';
import { syncService } from '../../services/syncService';
import { cloudGetCollection, optionalNumber, reserveServerOrderSeq } from '../../services/cloudConfig';
import {
  nextOrderSeq,
  localDayKey,
  parseOrderSeq,
  mergeOrderRecords,
  dayKeyFromIso,
  suffixedTicket,
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
    // Unpaid is the safe default and matches the Worker + D1 schema
    // (cloudflare-worker/src/index.ts, schema DEFAULT 'Unpaid'). Defaulting to
    // 'Paid' counted any row with a missing/empty payment status as collected
    // revenue, inflating sales reports and hiding it from receivables.
    paymentStatus: doc.paymentStatus || 'Unpaid',
    paymentMethod: doc.paymentMethod || doc.payment_method || 'Cash',
    totalAmount,
    ...(taxRate !== undefined ? { taxRate } : {}),
    ...(taxAmount !== undefined ? { taxAmount } : {}),
    ...(grandTotal !== undefined ? { grandTotal } : {}),

    createdAt:
      doc.createdAt ||
      doc.created_at ||
      doc.$createdAt ||
      doc.paidAt ||
      undefined,
    updatedAt: doc.updatedAt || doc.updated_at || undefined,
    paidAt: doc.paidAt || undefined,
    // Round-trips only once D1 has a printedAt column (see optional migration).
    // Until then remote lacks it and mergeOrderRecords keeps the local latch.
    printedAt: doc.printedAt || doc.printed_at || undefined,
    customerPhone: doc.customerPhone || doc.customer_phone || undefined,
    customerId: doc.customerId || doc.customer_id || undefined,
    customerName: doc.customerName || doc.customer_name || undefined,
    companyId: doc.companyId || doc.company_id || undefined,
    companyName: doc.companyName || doc.company_name || undefined,
    billedToType: doc.billedToType || doc.billed_to_type || undefined,
    refundedAt: doc.refundedAt || doc.refunded_at || undefined,
    refundReason: doc.refundReason || doc.refund_reason || undefined,
    cashierName: doc.cashierName || doc.cashier_name || undefined,
    deletedAt: doc.deletedAt || doc.deleted_at || undefined,
    branchId: doc.branch_id || doc.branchId || 'main_branch',
  };
}

// Single-branch system: every order belongs to the one branch, so there is
// nothing to filter. Kept as a pass-through so call sites stay unchanged.
function filterByBranch(orders: Order[], _branchId?: string): Order[] {
  return orders;
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
    // Always hide soft-deleted orders from consumers.
    const live = (localOrders as Order[]).filter(o => !o.deletedAt);
    return filterByBranch(live, branchId);
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

    // Always hide soft-deleted orders from consumers.
    const live = (localOrders as Order[]).filter(o => !o.deletedAt);
    return filterByBranch(live, branchId);
  }

  /**
   * Enforce daily ticket numbers 1..N per local calendar day (midnight reset model).
   * Always rewrites junk / empty / inflated legacy counters (1000+).
   * Queues cloud upserts so D1 stops re-sending old numbers on next hydrate.
   */
  async renumberIfNeeded(): Promise<number> {
    return enqueueWrite(async () => {
      return withDB(async (db) => {
        const all = (await db.getAll('orders')) as Order[];
        if (all.length === 0) return 0;

        const byDay = new Map<string, Order[]>();
        for (const o of all) {
          const key = dayKeyFromIso(o.createdAt) || 'unknown';
          if (!byDay.has(key)) byDay.set(key, []);
          byDay.get(key)!.push(o);
        }

        const now = new Date().toISOString();
        // Build the full change plan in memory FIRST. A day whose only "dirty"
        // tickets are frozen (printed) — or that is already clean — yields no
        // changes and therefore opens no transaction and enqueues no sync rows.
        const plan: Array<{ order: Order; newNumber: string }> = [];

        for (const [, dayOrders] of byDay) {
          if (!dayNeedsRenumber(dayOrders)) continue;

          // createdAt order = the order tickets were actually issued in.
          const sorted = [...dayOrders].sort(
            (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
          );

          const taken = new Set<string>();     // display labels already claimed
          const takenBase = new Set<number>(); // numeric bases claimed by a holder

          // A printed order's number is authoritative and immutable.
          const isFrozen = (o: Order) =>
            !!o.printedAt && parseOrderSeq(o.orderNumber) !== null;
          const isCleanBase = (n: number | null): n is number =>
            n !== null && n > 0 && n < 1000 && n <= sorted.length + 50;

          // Pass 1 — reserve every printed/frozen ticket's number. Never changed.
          for (const o of sorted) {
            if (!isFrozen(o)) continue;
            const label = String(o.orderNumber);
            taken.add(label);
            const n = parseOrderSeq(label);
            if (n !== null) takenBase.add(n);
          }

          // Pass 2 — assign movable (unprinted) tickets in issue order.
          let seq = 1;
          for (const o of sorted) {
            if (isFrozen(o)) continue;
            const n = parseOrderSeq(o.orderNumber);
            let target: string;

            if (isCleanBase(n) && !takenBase.has(n)) {
              // Already a good, unique daily number — keep it (no churn).
              target = String(n);
              takenBase.add(n);
              taken.add(target);
            } else if (n !== null && takenBase.has(n)) {
              // CONFLICT with an already-claimed (usually printed) number →
              // give THIS order a -A suffix instead of shifting anyone else.
              target = suffixedTicket(n, taken);
              taken.add(target);
            } else {
              // Junk / empty / inflated legacy counter → next free sequential.
              while (takenBase.has(seq)) seq++;
              target = String(seq);
              takenBase.add(seq);
              taken.add(target);
              seq++;
            }

            if (String(o.orderNumber || '') !== target) {
              plan.push({ order: o, newNumber: target });
            }
          }
        }

        if (plan.length === 0) return 0;

        const updatedOrders: Order[] = [];
        const tx = db.transaction(['orders', 'sync_queue'], 'readwrite');
        for (const { order, newNumber } of plan) {
          const updated: Order = { ...order, orderNumber: newNumber, updatedAt: now };
          await tx.objectStore('orders').put(updated);
          updatedOrders.push(updated);
          try {
            await tx.objectStore('sync_queue').put({
              id: `sync_renum_${order.id}_${Date.now()}_${newNumber}`,
              type: 'order',
              action: 'update',
              data: updated,
              timestamp: now,
              synced: 0,
            } as SyncRecord);
          } catch {
            // non-fatal
          }
        }
        await tx.done;

        // Queue-only cloud push: the queue rows above are drained by
        // syncPendingData. No direct cloudUpsert here (avoids racing the queue).
        if (updatedOrders.length > 0) {
          void syncService.syncPendingData();
        }

        return updatedOrders.length;
      });
    });
  }

  /**
   * Set printedAt the first time a customer receipt is printed for this order.
   * Set-once latch — once printed, renumberIfNeeded will never touch its number.
   */
  async markPrinted(id: string): Promise<void> {
    await enqueueWrite(async () => {
      await withDB(async (db) => {
        const existing = (await db.get('orders', id)) as Order | undefined;
        if (!existing || existing.printedAt) return; // missing or already latched
        const now = new Date().toISOString();
        const updated: Order = { ...existing, printedAt: now, updatedAt: now };
        await db.put('orders', updated);
        try {
          await db.put('sync_queue', {
            id: `sync_print_${id}_${Date.now()}`,
            type: 'order',
            action: 'update',
            data: updated,
            timestamp: now,
            synced: 0,
          } as SyncRecord);
        } catch {
          // non-fatal
        }
        void import('../../services/cloudConfig').then(({ cloudUpsert }) =>
          cloudUpsert('orders', updated.id, updated).then((ok) => {
            if (!ok) void syncService.syncPendingData();
          })
        ).catch(() => void syncService.syncPendingData());
      });
    });
  }

  async create(orderData: Omit<Order, 'id'>, branchId?: string): Promise<Order> {
    return enqueueWrite(async () => {
      return withDB(async (db) => {
        const id = `ord_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        const now = new Date().toISOString();

        const allOrders = await db.getAll('orders') as Order[];
        // Always assign a short sequential ticket number (1, 2, 3...).
        // Ignore huge digit strings that came from timestamps / document ids.
        const provided = parseOrderSeq(orderData.orderNumber);
        // Multi-device: ask the Worker for today's atomic sequence first, so two
        // tills never issue the same ticket number. Offline → local heuristic.
        const serverSeq = provided ?? (await reserveServerOrderSeq(
          localDayKey(orderData.createdAt ? new Date(orderData.createdAt) : new Date())
        ).catch(() => null));
        const base = provided ?? serverSeq ?? nextOrderSeq(allOrders);
        // Never reuse a number already printed on a customer receipt TODAY: if the
        // computed base collides with a printed ticket, take a -A suffix instead
        // (nextOrderSeq normally returns max+1, so this only guards edge reuses).
        const todayKey = dayKeyFromIso(orderData.createdAt || now) ?? dayKeyFromIso(now);
        const printedToday = new Set<string>();
        for (const o of allOrders) {
          if (o.printedAt && dayKeyFromIso(o.createdAt) === todayKey) {
            printedToday.add(String(o.orderNumber));
          }
        }
        const cleanNum = suffixedTicket(base, printedToday);

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
          // MUST be stamped at creation, not only on update().
          //
          // The Worker's last-writer-wins guard is `WHERE excluded.updatedAt >
          // orders.updatedAt`. An order inserted WITHOUT updatedAt lands in D1
          // with updatedAt = NULL, and in SQL every comparison against NULL is
          // NULL — never TRUE. So the conflict update never applied and the row
          // froze forever: paying, refunding, cancelling or advancing the status
          // all came back `200 {stale:true}` while D1 kept the original Unpaid
          // copy. Money collected at the till never reached the cloud.
          updatedAt: orderData.updatedAt || now,
          paidAt: orderData.paidAt,
          customerPhone: orderData.customerPhone,
          customerId: orderData.customerId,
          customerName: orderData.customerName,
          companyId: orderData.companyId,
          companyName: orderData.companyName,
          billedToType: orderData.billedToType,
          cashierName: orderData.cashierName ? String(orderData.cashierName).trim() || undefined : undefined,

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

  async update(
    id: string,
    data: Partial<Omit<Order, 'id'>>
  ): Promise<Order> {
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

  async completeWithPayment(
    id: string,
    method: 'Cash' | 'Card' | 'OnAccount',
    patch?: Partial<Omit<Order, 'id'>>,
  ): Promise<Order> {
    // `patch` folds any caller-supplied fields (customer info, frozen tax /
    // grandTotal) into the SAME write, so completing a payment is a single
    // IndexedDB put + single cloud upsert — instead of a separate updateOrder()
    // followed by a second write here (two writes/uploads + a race for one
    // payment). Payment fields are spread last so they always win over `patch`.
    // OnAccount = charge to customer/company credit (receivable). Cash/Card = settled revenue.
    if (method === 'OnAccount') {
      return this.update(id, {
        ...patch,
        paymentStatus: 'OnAccount',
        paymentMethod: 'OnAccount',
      });
    }
    return this.update(id, {
      ...patch,
      paymentStatus: 'Paid',
      paymentMethod: method,
      paidAt: new Date().toISOString(),
    });
  }

  async delete(id: string): Promise<void> {
    let tombstone: Order | undefined;
    await enqueueWrite(async () => {
      await withDB(async (db) => {
        const now = new Date().toISOString();
        // Soft-delete: write a tombstone row instead of hard-deleting.
        // This prevents cloud hydrate from resurrecting the order.
        const existing = await db.get('orders', id) as Order | undefined;
        tombstone = {
          ...(existing || {} as Order),
          id,
          deletedAt: now,
          updatedAt: now,
        };
        await db.put('orders', tombstone);
        // Push tombstone as an update so D1 also marks it deleted.
        try {
          await db.put('sync_queue', {
            id: `sync_del_${id}_${Date.now()}`,
            type: 'order',
            action: 'update',
            data: tombstone,
            timestamp: now,
            synced: 0,
          });
        } catch {
          // ignore
        }
      });
    });

    // Push the tombstone to the cloud NOW so it persists in D1 and every other
    // device learns the order was deleted. Previously this relied solely on
    // syncPendingData() draining the queue: if the browser closed first, the
    // tombstone never reached D1 and the "deleted" order reappeared on the
    // next hydrate on every device (same fix as the customer repository).
    if (!tombstone) return;
    try {
      const { cloudUpsert, ackSyncQueueForEntity } = await import('../../services/cloudConfig');
      const ok = await cloudUpsert('orders', id, tombstone as unknown as Record<string, any>);
      if (ok) {
        await ackSyncQueueForEntity(id);
      } else {
        void syncService.syncPendingData();
      }
    } catch {
      void syncService.syncPendingData();
    }
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
