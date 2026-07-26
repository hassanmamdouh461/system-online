import { Customer } from '../types/customer';
import { customerRepository } from '../repositories';
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
    const payload = {
      ...customer,
      phone: normalizePhone(customer.phone),
    };
    try {
      return await customerRepository.save(payload, branchId);
    } catch (error) {
      return await customerRepository.save(payload, branchId);
    }
  },

  async delete(id: string): Promise<void> {
    try {
      await customerRepository.delete(id);
    } catch (error) {
      await customerRepository.delete(id);
    }
  },
};
