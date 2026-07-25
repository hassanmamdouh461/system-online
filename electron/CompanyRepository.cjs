const database = require('./database.cjs');

// Company repository for the Electron (SQLite) layer.
// Mirrors the D1 companies schema so company profiles and their OnAccount
// ledgers round-trip through the desktop app — previously Electron had no
// companies table, so company-billed orders lost their company link on sync.
class CompanyRepository {
  getDb() {
    return database.getDb();
  }

  getBranchId() {
    return database.getBranchId();
  }

  _rowToCompany(row) {
    let tags = row.tags;
    if (typeof tags === 'string') {
      try { tags = JSON.parse(tags || '[]'); } catch (_) { tags = []; }
    }
    return {
      id: row.id,
      name: row.name,
      tags: Array.isArray(tags) ? tags : [],
      phone: row.phone || undefined,
      notes: row.notes || undefined,
      createdAt: row.createdAt,
      updatedAt: row.updated_at || undefined,
      branchId: row.branch_id || undefined,
      isSynced: Boolean(row.is_synced)
    };
  }

  getCompanies() {
    const sqlite = this.getDb();
    // Single-branch system: all companies belong to this branch.
    const rows = sqlite.prepare('SELECT * FROM companies ORDER BY createdAt DESC').all();
    return rows.map(row => this._rowToCompany(row));
  }

  getCompanyById(id) {
    const sqlite = this.getDb();
    const row = sqlite.prepare('SELECT * FROM companies WHERE id = ?').get(id);
    if (!row) return null;
    return this._rowToCompany(row);
  }

  saveCompany(company) {
    const sqlite = this.getDb();
    const now = new Date().toISOString();
    const tagsJson = Array.isArray(company.tags)
      ? JSON.stringify(company.tags)
      : (typeof company.tags === 'string' ? company.tags : JSON.stringify([]));

    if (company.id) {
      const existing = sqlite.prepare('SELECT * FROM companies WHERE id = ?').get(company.id);
      if (existing) {
        sqlite.prepare(`
          UPDATE companies
          SET name = ?, tags = ?, phone = ?, notes = ?, branch_id = ?, updated_at = ?, is_synced = 0
          WHERE id = ?
        `).run(
          company.name || existing.name,
          tagsJson,
          company.phone !== undefined ? (company.phone || null) : existing.phone,
          company.notes !== undefined ? (company.notes || null) : existing.notes,
          company.branchId !== undefined ? (company.branchId || null) : (existing.branch_id || null),
          now,
          company.id
        );
        return this.getCompanyById(company.id);
      }
    }

    const id = company.id || `co-${Math.random().toString(36).substr(2, 9)}`;
    const createdAt = company.createdAt || now;
    const branchId = company.branchId || this.getBranchId();
    sqlite.prepare(`
      INSERT INTO companies (id, name, tags, phone, notes, createdAt, branch_id, is_synced, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
    `).run(id, company.name || 'شركة', tagsJson, company.phone || null, company.notes || null, createdAt, branchId, now);
    return this.getCompanyById(id);
  }

  deleteCompany(id) {
    const sqlite = this.getDb();
    sqlite.prepare('DELETE FROM companies WHERE id = ?').run(id);
  }

  getUnsyncedCompanies() {
    const sqlite = this.getDb();
    const rows = sqlite.prepare('SELECT * FROM companies WHERE is_synced = 0').all();
    return rows.map(row => this._rowToCompany(row));
  }

  markCompaniesSynced(ids) {
    if (!ids || ids.length === 0) return;
    const sqlite = this.getDb();
    const stmt = sqlite.prepare('UPDATE companies SET is_synced = 1 WHERE id = ?');
    sqlite.transaction(() => {
      for (const id of ids) stmt.run(id);
    })();
  }

  // Upsert pulled (cloud) companies, preserving local edits when the local row
  // is newer than the cloud row (last-write-wins on updatedAt).
  upsertPulledCompanies(pulledCompanies) {
    if (!pulledCompanies || pulledCompanies.length === 0) return;
    const sqlite = this.getDb();
    const branchId = this.getBranchId();

    const insert = sqlite.prepare(`
      INSERT INTO companies (id, name, tags, phone, notes, createdAt, branch_id, is_synced, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        tags = excluded.tags,
        phone = excluded.phone,
        notes = excluded.notes,
        branch_id = excluded.branch_id,
        updated_at = excluded.updated_at
    `);

    const getLocal = sqlite.prepare('SELECT updated_at FROM companies WHERE id = ?');

    sqlite.transaction(() => {
      for (const c of pulledCompanies) {
        if (!c.id) continue;
        const local = getLocal.get(c.id);
        const localUpdatedMs = local && local.updated_at ? new Date(local.updated_at).getTime() : 0;
        const remoteUpdatedMs = c.updatedAt ? new Date(c.updatedAt).getTime() : 0;
        // Skip when local is strictly newer (local edit wins).
        if (Number.isFinite(localUpdatedMs) && Number.isFinite(remoteUpdatedMs) && localUpdatedMs > remoteUpdatedMs) {
          continue;
        }
        const tagsJson = Array.isArray(c.tags) ? JSON.stringify(c.tags) : JSON.stringify([]);
        insert.run(
          c.id,
          c.name || 'شركة',
          tagsJson,
          c.phone || null,
          c.notes || null,
          c.createdAt || new Date().toISOString(),
          branchId,
          c.updatedAt || new Date().toISOString()
        );
      }
    })();
  }
}

module.exports = new CompanyRepository();
