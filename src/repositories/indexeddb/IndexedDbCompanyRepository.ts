import { DeleteOutcome, ICompanyRepository } from '../types';
import { Company } from '../../types/company';
import { withDB, enqueueWrite } from './db';
import { syncService } from '../../services/syncService';
import { cloudGetCollection } from '../../services/cloudConfig';

export class IndexedDbCompanyRepository implements ICompanyRepository {
  async getAll(_branchId?: string): Promise<Company[]> {
    let localCompanies = await withDB((db) => db.getAll('companies'));

    if (typeof navigator !== 'undefined' && navigator.onLine) {
      try {
        const remoteDocs = await cloudGetCollection('companies');
        if (remoteDocs && remoteDocs.length > 0) {
          // Pending tombstones: any not-yet-synced queue row carrying a
          // deletedAt (the new tombstone path) or a legacy action:'delete'.
          const pendingDeletes = new Set<string>();
          await withDB(async (db) => {
            const queue = await db.getAll('sync_queue');
            for (const item of queue) {
              if (item.type !== 'company' || item.synced === 1) continue;
              const qid = item.data?.id || item.data?.documentId;
              if (!qid) continue;
              if (item.data?.deletedAt || item.action === 'delete') {
                pendingDeletes.add(qid);
              }
            }
          });

          await enqueueWrite(async () => {
            await withDB(async (db) => {
              const existing = await db.getAll('companies');
              const byId = new Map(existing.map((c) => [c.id, c]));
              const tx = db.transaction('companies', 'readwrite');
              for (const doc of remoteDocs) {
                const docId = String(doc.id || doc.$id);
                if (pendingDeletes.has(docId)) continue;

                let tags = doc.tags;
                if (typeof tags === 'string') {
                  try {
                    tags = JSON.parse(tags || '[]');
                  } catch {
                    tags = [];
                  }
                }
                const remote: Company = {
                  id: docId,
                  name: doc.name || 'شركة',
                  tags: Array.isArray(tags) ? tags : [],
                  phone: doc.phone,
                  notes: doc.notes,
                  branchId: doc.branch_id || doc.branchId,
                  createdAt: doc.createdAt || doc.created_at || new Date().toISOString(),
                  updatedAt: doc.updatedAt || doc.updated_at || new Date().toISOString(),
                  deletedAt: doc.deleted_at || doc.deletedAt || undefined,
                };
                const local = byId.get(docId);
                // Resolve the soft-delete tombstone: newer deletedAt wins so a
                // delete on any device is not resurrected by a stale copy.
                const localDeletedAt = local?.deletedAt;
                const remoteDeletedAt = remote.deletedAt;
                const effectiveDeletedAt =
                  !localDeletedAt
                    ? remoteDeletedAt
                    : !remoteDeletedAt
                      ? localDeletedAt
                      : new Date(localDeletedAt).getTime() >= new Date(remoteDeletedAt).getTime()
                        ? localDeletedAt
                        : remoteDeletedAt;
                const merged: Company = local
                  ? {
                      ...local,
                      ...remote,
                      id: docId,
                      name: remote.name?.trim() || local.name,
                      phone: remote.phone || local.phone,
                      notes: remote.notes || local.notes,
                      tags:
                        Array.isArray(remote.tags) && remote.tags.length > 0
                          ? remote.tags
                          : local.tags,
                      deletedAt: effectiveDeletedAt || undefined,
                    }
                  : remote;
                await tx.store.put(merged);
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

    // Always hide soft-deleted companies from consumers.
    const live = (localCompanies as Company[]).filter((c) => !c.deletedAt);
    // Single-branch system: no branch filtering.
    return live;
  }

  async getById(id: string): Promise<Company | null> {
    return withDB(async (db) => {
      const company = await db.get('companies', id);
      if (!company) return null;
      // A soft-deleted company must not be returned to callers.
      if (company.deletedAt) return null;
      return company;
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
          // Preserve an existing tombstone across saves so a cache write cannot
          // resurrect a soft-deleted company. Only an explicit deletedAt in the
          // payload clears it.
          deletedAt:
            companyData.deletedAt !== undefined
              ? companyData.deletedAt
              : existing?.deletedAt,
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

  async delete(id: string): Promise<DeleteOutcome> {
    const tombstone: Company = await enqueueWrite(async () => {
      return withDB(async (db) => {
        const now = new Date().toISOString();
        const existing = (await db.get('companies', id)) as Company | undefined;
        // Soft-delete: write a tombstone row instead of hard-deleting, so a
        // later cloud pull / hydrate cannot resurrect the company (and the
        // OnAccount receivables attached to it). Carrying the NOT NULL name
        // keeps the worker upsert from 500'ing.
        const ts: Company = {
          ...(existing || ({
            id,
            name: 'deleted',
            tags: [],
            createdAt: now,
          } as Company)),
          id,
          deletedAt: now,
          updatedAt: now,
        };
        await db.put('companies', ts);
        try {
          await db.put('sync_queue', {
            id: `sync_co_del_${id}_${Date.now()}`,
            type: 'company',
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
    // learns the company was deleted. Do NOT hard-delete afterwards: that
    // would wipe the very tombstone we just wrote (same fix as inventory).
    //
    // The OUTCOME is returned to the caller instead of being swallowed. A
    // tombstone that never reached D1 lives only in this browser's IndexedDB +
    // sync_queue: clearing the cache wipes both and the next hydrate resurrects
    // the company (with its OnAccount receivables). The screen used to report
    // «تم حذف الشركة» in exactly that case, so the operator learned about the
    // resurrection days later. Now the failure is reported at delete time.
    try {
      const { cloudUpsertWithOutcome, ackSyncQueueForEntity, describeCloudWriteFailure } =
        await import('../../services/cloudConfig');
      const outcome = await cloudUpsertWithOutcome('companies', id, tombstone);
      if (outcome.kind === 'ok') {
        await ackSyncQueueForEntity(id);
        return { synced: true };
      }
      void syncService.syncPendingData();
      return { synced: false, reason: describeCloudWriteFailure(outcome) };
    } catch (err) {
      console.warn('[company] tombstone push failed:', err);
      void syncService.syncPendingData();
      return {
        synced: false,
        reason: 'تعذّر تأكيد الحذف على السحاب — العملية في طابور المزامنة.',
      };
    }
  }
}
