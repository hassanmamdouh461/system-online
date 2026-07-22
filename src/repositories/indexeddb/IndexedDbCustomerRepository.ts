import { ICustomerRepository } from '../types';
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
  };
}

function mergeCustomer(local: Customer | undefined, remote: Customer): Customer {
  if (!local) return remote;
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
  };
}

export class IndexedDbCustomerRepository implements ICustomerRepository {
  async getAll(branchId?: string): Promise<Customer[]> {
    let localCustomers = await withDB((db) => db.getAll('customers'));

    if (typeof navigator !== 'undefined' && navigator.onLine) {
      try {
        const remoteDocs = await cloudGetCollection('customers');
        if (remoteDocs && remoteDocs.length > 0) {
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

    if (!branchId || branchId === 'manager' || branchId === 'all') return localCustomers;
    return localCustomers.filter((c) => !c.branchId || c.branchId === branchId);
  }

  async getByPhone(phone: string, branchId?: string): Promise<Customer | null> {
    const cleanPhone = phone.replace(/[\s\-()]/g, '').trim();
    if (!cleanPhone) return null;

    return withDB(async (db) => {
      let customer = await db.getFromIndex('customers', 'by-phone', cleanPhone);
      if (!customer) {
        const all = await db.getAll('customers');
        customer = all.find((c) => {
          const p = (c.phone || '').replace(/[\s\-()]/g, '').trim();
          return (
            p === cleanPhone ||
            (p && cleanPhone && (p.endsWith(cleanPhone) || cleanPhone.endsWith(p)))
          );
        });
      }
      if (!customer) return null;
      if (branchId && branchId !== 'manager' && branchId !== 'all') {
        if (customer.branchId && customer.branchId !== branchId) return null;
      }
      return customer;
    });
  }

  async save(
    customerData: Partial<Customer> & { phone: string },
    branchId?: string
  ): Promise<Customer> {
    return enqueueWrite(async () => {
      return withDB(async (db) => {
        const cleanPhone = (customerData.phone || '').replace(/[\s\-()]/g, '').trim();
        let existing: Customer | undefined;
        if (cleanPhone) {
          existing = await db.getFromIndex('customers', 'by-phone', cleanPhone);
          if (!existing) {
            const all = await db.getAll('customers');
            existing = all.find((c) => {
              const p = (c.phone || '').replace(/[\s\-()]/g, '').trim();
              return p === cleanPhone;
            });
          }
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
        void import('../../services/cloudConfig')
          .then(({ cloudUpsert }) =>
            cloudUpsert('customers', customer.id, customer).then((ok) => {
              if (!ok) void syncService.syncPendingData();
            })
          )
          .catch(() => void syncService.syncPendingData());
        return customer;
      });
    });
  }

  async delete(id: string): Promise<void> {
    await enqueueWrite(async () => {
      await withDB(async (db) => {
        const now = new Date().toISOString();
        await db.delete('customers', id);
        try {
          await db.put('sync_queue', {
            id: `sync_cust_del_${id}_${Date.now()}`,
            type: 'customer',
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
}
