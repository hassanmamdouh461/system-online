import { Customer } from '../types/customer';
import { customerRepository } from '../repositories';
import type { DeleteOutcome, SaveOutcome } from '../repositories/types';
import { cloudGetCollection, isCloudConfigured } from './cloudConfig';

function normalizePhone(phone: string): string {
  return phone.replace(/[\s\-()]/g, '').trim();
}

/**
 * Customers Service - local IndexedDB + optional Cloudflare D1 lookup
 */
export const customersService = {
  async getAll(branchId?: string): Promise<Customer[]> {
    try {
      return await customerRepository.getAll(branchId);
    } catch (error) {
      return await customerRepository.getAll(branchId);
    }
  },

  async getByPhone(phone: string, branchId?: string): Promise<Customer | null> {
    const normalized = normalizePhone(phone);
    if (!normalized) return null;
    try {
      return await customerRepository.getByPhone(normalized, branchId);
    } catch (error) {
      return await customerRepository.getByPhone(normalized, branchId);
    }
  },

  /**
   * Lookup: local first, then Cloudflare Worker D1 (if online + configured).
   * If found only on server, cache it locally so future lookups are instant.
   */
  async lookupByPhone(phone: string, branchId?: string): Promise<{
    customer: Customer | null;
    source: 'local' | 'server' | 'none';
  }> {
    const normalized = normalizePhone(phone);
    if (!normalized) return { customer: null, source: 'none' };

    // 1) Local
    try {
      const local = await this.getByPhone(normalized, branchId);
      if (local) return { customer: local, source: 'local' };
    } catch {
      // continue to server
    }

    // 2) Server (Cloudflare D1 via Worker REST)
    // Uses cloudGetCollection() rather than a hand-rolled fetch: the previous
    // call hit /databases/main/ (every other call uses /databases/default/) and
    // sent no auth headers, so this lookup always failed and silently reported
    // the customer as not found.
    if (isCloudConfigured() && typeof navigator !== 'undefined' && navigator.onLine) {
      try {
        const docs = await cloudGetCollection('customers');
        if (docs) {
          // Skip soft-deleted customers: a tombstoned row must not be returned
          // as a live account (it would accumulate points / receivables again).
          const match = docs.find(
            (d: any) => {
              if (d.deleted_at || d.deletedAt) return false;
              return normalizePhone(String(d.phone || '')) === normalized;
            }
          );
          if (match) {
            const remote: Customer = {
              id: match.id || match.$id,
              name: match.name || 'عميل',
              phone: normalized,
              points: Number(match.points) || 0,
              companyId: match.companyId || match.company_id || undefined,
              tags: Array.isArray(match.tags)
                ? match.tags
                : typeof match.tags === 'string'
                  ? (() => { try { return JSON.parse(match.tags); } catch { return []; } })()
                  : [],
              notes: match.notes || undefined,
              createdAt: match.createdAt || match.$createdAt || new Date().toISOString(),
              branchId: match.branchId || match.branch_id || branchId,
            };
            // Cache locally for offline / history
            try {
              await customerRepository.save(remote, branchId);
            } catch {
              // ignore cache failure
            }
            return { customer: remote, source: 'server' };
          }
        }
      } catch (err) {
        console.warn('[customersService] server lookup failed:', err);
      }
    }

    return { customer: null, source: 'none' };
  },

  async save(customer: Partial<Customer> & { phone: string }, branchId?: string): Promise<Customer> {
    return (await this.saveWithOutcome(customer, branchId)).record;
  },

  /**
   * Save a customer and report what actually happened.
   *
   * Two things the plain `save` cannot tell the caller, and both matter on
   * screen:
   *  - `synced` — whether D1 confirmed the row. Same rule as the delete path: a
   *    customer that lives only in this browser dies with the site data.
   *  - `startedNewIdentity` — whether this phone number belonged to a DELETED
   *    customer, so a brand-new customer was created instead of reviving the old
   *    one. The operator must be told, because the points shown are zero and the
   *    old account's receivables are deliberately not attached.
   */
  async saveWithOutcome(
    customer: Partial<Customer> & { phone: string },
    branchId?: string
  ): Promise<SaveOutcome<Customer>> {
    const payload = {
      ...customer,
      phone: normalizePhone(customer.phone),
    };
    // NOTE: no catch-and-retry here. The previous `save` repeated the identical
    // failing call from its catch block, which cannot succeed for a
    // deterministic failure and only hid the real error. The repository already
    // owns queueing and retrying the cloud push.
    return await customerRepository.saveWithOutcome(payload, branchId);
  },

  /**
   * Soft-delete a customer. Returns whether the tombstone was CONFIRMED by the
   * cloud — when it was not, the deletion exists only in this browser and the
   * caller must warn the operator (see DeleteOutcome).
   *
   * The previous body called `customerRepository.delete(id)` a SECOND time from
   * the catch block. A retry that repeats the identical failing call cannot
   * succeed for any deterministic failure (a 403, a missing session), and it hid
   * the real error from the caller — so the screen reported a successful delete
   * either way. The repository already queues + retries the cloud push itself.
   */
  async delete(id: string): Promise<DeleteOutcome> {
    return await customerRepository.delete(id);
  },
};
