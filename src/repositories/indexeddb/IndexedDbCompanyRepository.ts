import { ICompanyRepository } from '../types';
import { Company } from '../../types/company';
import { withDB, enqueueWrite } from './db';
import { syncService } from '../../services/syncService';
import { cloudGetCollection } from '../../services/cloudConfig';

export class IndexedDbCompanyRepository implements ICompanyRepository {
  async getAll(branchId?: string): Promise<Company[]> {
    let localCompanies = await withDB((db) => db.getAll('companies'));

    if (typeof navigator !== 'undefined' && navigator.onLine) {
      try {
        const remoteDocs = await cloudGetCollection('companies');
        if (remoteDocs && remoteDocs.length > 0) {
          await enqueueWrite(async () => {
            await withDB(async (db) => {
              const tx = db.transaction('companies', 'readwrite');
              for (const doc of remoteDocs) {
                let tags = doc.tags;
                if (typeof tags === 'string') {
                  try {
                    tags = JSON.parse(tags || '[]');
                  } catch {
                    tags = [];
                  }
                }
                await tx.store.put({
                  id: String(doc.id || doc.$id),
                  name: doc.name || 'شركة',
                  tags: Array.isArray(tags) ? tags : [],
                  phone: doc.phone,
                  notes: doc.notes,
                  branchId: doc.branch_id || doc.branchId,
                  createdAt: doc.createdAt || doc.created_at || new Date().toISOString(),
                  updatedAt: doc.updatedAt || doc.updated_at || new Date().toISOString(),
                });
              }
              await tx.done;
            });
          });
          localCompanies = await withDB((db) => db.getAll('companies'));
        }
      } catch (e) {
        console.warn('[IndexedDbCompanyRepository] remote merge skipped:', e);
      }
    }

    if (!branchId) return localCompanies;
    return localCompanies.filter((c) => !c.branchId || c.branchId === branchId);
  }

  async getById(id: string): Promise<Company | null> {
    return withDB(async (db) => {
      const company = await db.get('companies', id);
      return company || null;
    });
  }

  async save(companyData: Partial<Company> & { name: string }, branchId?: string): Promise<Company> {
    return enqueueWrite(async () => {
      return withDB(async (db) => {
        const now = new Date().toISOString();
        const existing = companyData.id ? await db.get('companies', companyData.id) : null;
        const id =
          existing?.id ||
          companyData.id ||
          `co_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

        const company: Company = {
          id,
          name: companyData.name,
          tags: companyData.tags !== undefined ? companyData.tags : existing?.tags || [],
          phone: companyData.phone !== undefined ? companyData.phone : existing?.phone,
          notes: companyData.notes !== undefined ? companyData.notes : existing?.notes,
          branchId: branchId || companyData.branchId || existing?.branchId,
          createdAt: existing?.createdAt || now,
          updatedAt: now,
          isSynced: false,
        };

        await db.put('companies', company);
        try {
          await db.put('sync_queue', {
            id: `sync_co_${id}_${Date.now()}`,
            type: 'company',
            action: existing ? 'update' : 'create',
            data: company,
            timestamp: now,
            synced: 0,
          });
        } catch (e) {
          console.warn('[company] sync_queue failed:', e);
        }
        void import('../../services/cloudConfig').then(({ cloudUpsert }) =>
          cloudUpsert('companies', company.id, company).then((ok) => {
            if (!ok) void syncService.syncPendingData();
          })
        ).catch(() => void syncService.syncPendingData());
        return company;
      });
    });
  }

  async delete(id: string): Promise<void> {
    await enqueueWrite(async () => {
      await withDB(async (db) => {
        const now = new Date().toISOString();
        await db.delete('companies', id);
        try {
          await db.put('sync_queue', {
            id: `sync_co_del_${id}_${Date.now()}`,
            type: 'company',
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
