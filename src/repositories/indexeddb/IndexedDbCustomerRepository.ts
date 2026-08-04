import { DeleteOutcome, ICustomerRepository, SaveOutcome } from '../types';
import { Customer } from '../../types/customer';
import { withDB, enqueueWrite } from './db';
import { syncService } from '../../services/syncService';
import { cloudGetCollection } from '../../services/cloudConfig';

function isPlaceholderName(name?: string): boolean {
  const t = (name || '').trim().toLowerCase();
  return !t || t === 'عميل' || t === 'customer';
}

function mapRemoteCustomer(doc: any): Customer | null {
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
    points: Number(doc.points) || 0,
    companyId: doc.companyId || doc.company_id,
    tags: Array.isArray(tags) ? tags : [],
    notes: doc.notes,
    branchId: doc.branch_id || doc.branchId,
    createdAt: doc.createdAt || doc.$createdAt || new Date().toISOString(),
    updatedAt: doc.updatedAt || doc.updated_at || new Date().toISOString(),
    deletedAt: doc.deleted_at || doc.deletedAt || undefined,
  };
}

function mergeCustomer(local: Customer | undefined, remote: Customer): Customer {
  if (!local) return remote;
  // Resolve the soft-delete tombstone: whichever side has a NEWER deletedAt wins
  // so a delete on any device is not resurrected by a stale copy on another.
  const localDeletedAt = local.deletedAt;
  const remoteDeletedAt = remote.deletedAt;
  const effectiveDeletedAt =
    !localDeletedAt
      ? remoteDeletedAt
      : !remoteDeletedAt
        ? localDeletedAt
        : new Date(localDeletedAt).getTime() >= new Date(remoteDeletedAt).getTime()
          ? localDeletedAt
          : remoteDeletedAt;
  return {
    ...local,
    ...remote,
    id: local.id || remote.id,
    name:
      !isPlaceholderName(remote.name)
        ? remote.name
        : !isPlaceholderName(local.name)
          ? local.name
          : remote.name || local.name || 'عميل',
    phone: remote.phone || local.phone,
    companyId: remote.companyId || local.companyId,
    points:
      typeof remote.points === 'number'
        ? Math.max(remote.points, local.points || 0)
        : local.points || 0,
    tags:
      Array.isArray(remote.tags) && remote.tags.length > 0 ? remote.tags : local.tags || [],
    notes: remote.notes || local.notes,
    createdAt: local.createdAt || remote.createdAt,
    deletedAt: effectiveDeletedAt || undefined,
  };
}

export class IndexedDbCustomerRepository implements ICustomerRepository {
  async getAll(_branchId?: string): Promise<Customer[]> {
    let localCustomers = await withDB((db) => db.getAll('customers'));

    if (typeof navigator !== 'undefined' && navigator.onLine) {
      try {
        const remoteDocs = await cloudGetCollection('customers');
        if (remoteDocs && remoteDocs.length > 0) {
          // Pending tombstones: any not-yet-synced queue row carrying a
          // deletedAt (the new tombstone path) or a legacy action:'delete'.
          const pendingDeletes = new Set<string>();
          await withDB(async (db) => {
            const queue = await db.getAll('sync_queue');
            for (const item of queue) {
              if (item.type !== 'customer' || item.synced === 1) continue;
              const qid = item.data?.id || item.data?.documentId;
              if (!qid) continue;
              if (item.data?.deletedAt || item.action === 'delete') {
                pendingDeletes.add(qid);
              }
            }
          });

          await enqueueWrite(async () => {
            await withDB(async (db) => {
              const existing = await db.getAll('customers');
              const byId = new Map(existing.map((c) => [c.id, c]));
              const byPhone = new Map(
                existing
                  .filter((c) => c.phone)
                  .map((c) => [String(c.phone).replace(/[\s\-()]/g, ''), c])
              );
              const tx = db.transaction('customers', 'readwrite');
              for (const doc of remoteDocs) {
                const remote = mapRemoteCustomer(doc);
                if (!remote) continue;
                if (pendingDeletes.has(remote.id)) continue;
                const phoneKey = String(remote.phone || '').replace(/[\s\-()]/g, '');
                const local =
                  byId.get(remote.id) ||
                  (phoneKey ? byPhone.get(phoneKey) : undefined);
                await tx.store.put(mergeCustomer(local, remote));
              }
              await tx.done;
            });
          });
          localCustomers = await withDB((db) => db.getAll('customers'));
        }
      } catch (e) {
        console.warn('[IndexedDbCustomerRepository] remote merge skipped:', e);
      }
    }

    // Always hide soft-deleted customers from consumers.
    const live = (localCustomers as Customer[]).filter((c) => !c.deletedAt);
    // Single-branch system: no branch filtering.
    return live;
  }

  async getByPhone(phone: string, _branchId?: string): Promise<Customer | null> {
    const cleanPhone = phone.replace(/[\s\-()]/g, '').trim();
    if (!cleanPhone) return null;

    return withDB(async (db) => {
      let customer = await db.getFromIndex('customers', 'by-phone', cleanPhone);
      // A phone number can now legitimately match MORE THAN ONE row: the
      // tombstone of a deleted customer, plus the fresh customer created when
      // the same number was re-added (see `save`). The 'by-phone' index returns
      // an arbitrary one of them, so landing on the dead row is a coin flip.
      // Returning early on that row would report "no such customer" while the
      // live account sits right next to it — the till would then keep creating
      // duplicates on every lookup. Rescan and prefer the live row.
      if (!customer || customer.deletedAt) {
        const all = await db.getAll('customers');
        const matches = all.filter((c) => {
          const p = (c.phone || '').replace(/[\s\-()]/g, '').trim();
          return (
            p === cleanPhone ||
            (p && cleanPhone && (p.endsWith(cleanPhone) || cleanPhone.endsWith(p)))
          );
        });
        customer = matches.find((c) => !c.deletedAt) || customer || matches[0];
      }
      if (!customer) return null;
      // A soft-deleted customer must not be returned to callers (it would be
      // treated as a live account and accumulate points / receivables again).
      if (customer.deletedAt) return null;
      // Single-branch system: no branch filtering on phone lookup.
      return customer;
    });
  }

  async save(
    customerData: Partial<Customer> & { phone: string },
    branchId?: string
  ): Promise<Customer> {
    return (await this.saveWithOutcome(customerData, branchId)).record;
  }

  async saveWithOutcome(
    customerData: Partial<Customer> & { phone: string },
    branchId?: string
  ): Promise<SaveOutcome<Customer>> {
    return enqueueWrite(async () => {
      return withDB(async (db) => {
        const cleanPhone = (customerData.phone || '').replace(/[\s\-()]/g, '').trim();
        let existing: Customer | undefined;
        if (cleanPhone) {
          existing = await db.getFromIndex('customers', 'by-phone', cleanPhone);
          // A phone can match several rows once a deleted customer's number has
          // been re-added: the tombstone plus the new customer. The index hands
          // back an arbitrary one, so always prefer a LIVE row — otherwise a
          // second save on the same number would see the tombstone again and
          // mint yet another customer.
          if (!existing || existing.deletedAt) {
            const all = await db.getAll('customers');
            const matches = all.filter((c) => {
              const p = (c.phone || '').replace(/[\s\-()]/g, '').trim();
              return p === cleanPhone;
            });
            existing = matches.find((c) => !c.deletedAt) || existing || matches[0];
          }
        }

        /**
         * RE-ADDING A DELETED CUSTOMER'S PHONE STARTS A NEW CUSTOMER.
         *
         * This block used to do the opposite: any save that landed on a
         * tombstoned row with a real name simply CLEARED `deletedAt`. The row
         * came back to life under its original id, carrying its original
         * `points` and `createdAt` — and, far worse, every OnAccount receivable
         * and every historical order still pointed at that id. So typing an old
         * customer's phone into the POS silently reopened a debt ledger that
         * belonged to a deleted account, and handed the walk-in whoever now owns
         * that number a stranger's loyalty balance.
         *
         * A deletion is a statement that this account is over. Honouring it
         * means the number may be reused, but the IDENTITY may not: mint a new
         * id, start points at zero, and leave the tombstone exactly where it is
         * (both locally and in D1) so the old orders and debts stay attached to
         * the dead id and never surface on the new customer.
         *
         * Two saves must still target the dead row rather than fork:
         *  - `deletedAt` in the payload — that IS the delete path writing the
         *    tombstone.
         *  - an explicit `id` — the caller is addressing one specific row, e.g.
         *    customersService.lookupByPhone caching a live D1 doc by its id.
         *    Forking there would duplicate the cloud's own record.
         */
        const explicitlyAddressed =
          customerData.id !== undefined || customerData.deletedAt !== undefined;
        const startedNewIdentity = !!existing?.deletedAt && !explicitlyAddressed;
        if (startedNewIdentity) {
          // Dropping `existing` is what makes the rest of this function build a
          // brand-new customer: fresh id, points 0, fresh createdAt, no
          // tombstone, and a 'create' sync row instead of an 'update'.
          existing = undefined;
        }

        const now = new Date().toISOString();
        const id =
          existing?.id ||
          customerData.id ||
          `cust_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

        // Don't overwrite a real local name with placeholder «عميل»
        const incomingName = customerData.name;
        const name =
          incomingName !== undefined
            ? !isPlaceholderName(incomingName)
              ? incomingName
              : !isPlaceholderName(existing?.name)
                ? existing!.name
                : incomingName || existing?.name || 'عميل'
            : existing?.name || 'عميل';

        const customer: Customer = {
          id,
          name,
          phone: customerData.phone,
          points:
            customerData.points !== undefined
              ? customerData.points
              : existing?.points || 0,
          companyId:
            customerData.companyId !== undefined
              ? customerData.companyId
              : existing?.companyId,
          tags: customerData.tags !== undefined ? customerData.tags : existing?.tags || [],
          notes:
            customerData.notes !== undefined ? customerData.notes : existing?.notes,
          branchId: branchId || customerData.branchId || existing?.branchId,
          createdAt: existing?.createdAt || now,
          updatedAt: now,
          // Tombstone handling. NOTE: a save that lands on a tombstone no longer
          // clears it — the re-add forked into a new id above, and this row is
          // that new customer, which has no tombstone to begin with. The old
          // expression cleared `deletedAt` in place, which is precisely how a
          // deleted account came back with its points and its OnAccount debts.
          // - An explicit deletedAt in the payload (the delete path) wins.
          // - Otherwise preserve any existing tombstone, so a stray cache write
          //   or a hydrate of the dead doc cannot resurrect a deleted record.
          deletedAt:
            customerData.deletedAt !== undefined
              ? customerData.deletedAt
              : existing?.deletedAt,
          isSynced: false,
        };

        await db.put('customers', customer);
        try {
          await db.put('sync_queue', {
            id: `sync_cust_${id}_${Date.now()}`,
            type: 'customer',
            action: existing ? 'update' : 'create',
            data: customer,
            timestamp: now,
            synced: 0,
          });
        } catch (e) {
          console.warn('[customer] sync_queue failed:', e);
        }

        // Confirm the write against D1 rather than firing and forgetting it —
        // same rule as the delete path. A customer that exists only in this
        // browser is lost when site data is cleared, and for a re-add that is
        // especially misleading: the operator was just told "this is a NEW
        // customer, points start at zero", and after a cache clear the till
        // would find nothing at all for that number.
        let synced = false;
        let reason: string | undefined;
        try {
          const { cloudUpsertWithOutcome, describeCloudWriteFailure } = await import(
            '../../services/cloudConfig'
          );
          const outcome = await cloudUpsertWithOutcome('customers', customer.id, customer);
          synced = outcome.kind === 'ok';
          if (!synced) {
            reason = describeCloudWriteFailure(outcome);
            // Leave the queue row pending and let the durable queue retry it.
            // Never ack a write that did not land.
            void syncService.syncPendingData();
          }
        } catch {
          reason = 'مفيش اتصال بالسحاب — العملية في طابور المزامنة.';
          void syncService.syncPendingData();
        }

        return { record: customer, synced, reason, startedNewIdentity };
      });
    });
  }

  async delete(id: string): Promise<DeleteOutcome> {
    const tombstone: Customer = await enqueueWrite(async () => {
      return withDB(async (db) => {
        const now = new Date().toISOString();
        const existing = (await db.get('customers', id)) as Customer | undefined;
        // Soft-delete: write a tombstone row instead of hard-deleting, so a
        // later cloud pull / hydrate cannot resurrect the customer (matches
        // orders / menu_items / inventory). Carrying the NOT NULL phone keeps
        // the worker upsert from 500'ing.
        const ts: Customer = {
          ...(existing || ({
            id,
            name: 'deleted',
            phone: `__deleted_${id}`,
            points: 0,
            tags: [],
            createdAt: now,
          } as Customer)),
          id,
          deletedAt: now,
          updatedAt: now,
        };
        await db.put('customers', ts);
        try {
          await db.put('sync_queue', {
            id: `sync_cust_del_${id}_${Date.now()}`,
            type: 'customer',
            action: 'update',
            data: ts,
            timestamp: now,
            synced: 0,
          });
        } catch {
          // ignore
        }
        return ts;
      });
    });

    // Push the tombstone to the cloud so it persists in D1 and every device
    // learns the customer was deleted. Do NOT hard-delete afterwards: that
    // would wipe the very tombstone we just wrote (same fix as inventory).
    //
    // The OUTCOME is returned rather than swallowed: a tombstone that never
    // reached D1 exists only in this browser (IndexedDB + sync_queue), so
    // clearing the cache loses the deletion and the next hydrate brings the
    // customer back with his old points and receivables. The screen used to
    // report «تم حذف العميل» in exactly that case.
    try {
      const { cloudUpsertWithOutcome, ackSyncQueueForEntity, describeCloudWriteFailure } =
        await import('../../services/cloudConfig');
      const outcome = await cloudUpsertWithOutcome('customers', id, tombstone);
      if (outcome.kind === 'ok') {
        await ackSyncQueueForEntity(id);
        return { synced: true };
      }
      void syncService.syncPendingData();
      return { synced: false, reason: describeCloudWriteFailure(outcome) };
    } catch (err) {
      console.warn('[customer] tombstone push failed:', err);
      void syncService.syncPendingData();
      return {
        synced: false,
        reason: 'تعذّر تأكيد الحذف على السحاب — العملية في طابور المزامنة.',
      };
    }
  }
}
