const database = require('./database.cjs');

class CustomerRepository {
  getDb() {
    return database.getDb();
  }

  getBranchId() {
    return database.getBranchId();
  }

  getCustomers() {
    const sqlite = this.getDb();
    const rows = sqlite.prepare('SELECT * FROM customers ORDER BY createdAt DESC').all();
    return rows.map(row => this._rowToCustomer(row));
  }

  getCustomerByPhone(phone) {
    const sqlite = this.getDb();
    const row = sqlite.prepare('SELECT * FROM customers WHERE phone = ?').get(phone);
    if (!row) return null;
    return this._rowToCustomer(row);
  }

  // Centralized row -> customer mapper so every read returns company
  // affiliation, tags and notes — fields the D1 schema already persists but
  // the Electron layer was silently dropping, so company members and tags
  // never round-tripped through the desktop app.
  _rowToCustomer(row) {
    let tags = row.tags;
    if (typeof tags === 'string') {
      try { tags = JSON.parse(tags || '[]'); } catch (_) { tags = []; }
    }
    return {
      id: row.id,
      name: row.name,
      phone: row.phone,
      points: row.points,
      companyId: row.company_id || undefined,
      tags: Array.isArray(tags) ? tags : [],
      notes: row.notes || undefined,
      createdAt: row.createdAt,
      updatedAt: row.updated_at || undefined,
      branchId: row.branch_id || undefined,
      isSynced: Boolean(row.is_synced)
    };
  }

  saveCustomer(customer) {
    const sqlite = this.getDb();
    const now = new Date().toISOString();
    const existing = sqlite.prepare('SELECT * FROM customers WHERE phone = ?').get(customer.phone);
    
    if (existing) {
      // Persist every updatable field, not just name/points. Previously
      // company affiliation, tags and notes were dropped on every save, so
      // editing a customer on Electron wiped their company link + tags.
      const tagsJson = Array.isArray(customer.tags)
        ? JSON.stringify(customer.tags)
        : (typeof customer.tags === 'string' ? customer.tags : JSON.stringify([]));
      sqlite.prepare(`
        UPDATE customers
        SET name = ?, points = ?, company_id = ?, tags = ?, notes = ?, updated_at = ?, is_synced = 0
        WHERE phone = ?
      `).run(
        customer.name || existing.name,
        customer.points !== undefined ? customer.points : existing.points,
        customer.companyId !== undefined ? (customer.companyId || null) : (existing.company_id || null),
        tagsJson,
        customer.notes !== undefined ? (customer.notes || null) : (existing.notes || null),
        now,
        customer.phone
      );
      return this.getCustomerByPhone(customer.phone);
    } else {
      const id = customer.id || `cust-${Math.random().toString(36).substr(2, 9)}`;
      const createdAt = customer.createdAt || now;
      const branchId = customer.branchId || this.getBranchId();
      const tagsJson = Array.isArray(customer.tags)
        ? JSON.stringify(customer.tags)
        : (typeof customer.tags === 'string' ? customer.tags : JSON.stringify([]));
      sqlite.prepare(`
        INSERT INTO customers (id, name, phone, points, company_id, tags, notes, createdAt, branch_id, is_synced, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
      `).run(
        id,
        customer.name || 'Customer',
        customer.phone,
        customer.points || 0,
        customer.companyId || null,
        tagsJson,
        customer.notes || null,
        createdAt,
        branchId,
        now
      );
      return this.getCustomerByPhone(customer.phone);
    }
  }

  deleteCustomer(id) {
    const sqlite = this.getDb();
    sqlite.prepare('DELETE FROM customers WHERE id = ?').run(id);
  }

  getUnsyncedCustomers() {
    const sqlite = this.getDb();
    const rows = sqlite.prepare('SELECT * FROM customers WHERE is_synced = 0').all();
    return rows.map(row => this._rowToCustomer(row));
  }

  markCustomersSynced(ids) {
    if (!ids || ids.length === 0) return;
    const sqlite = this.getDb();
    const stmt = sqlite.prepare('UPDATE customers SET is_synced = 1 WHERE id = ?');
    const runTx = sqlite.transaction((idList) => {
      for (const id of idList) {
        stmt.run(id);
      }
    });
    runTx(ids);
  }
}

module.exports = new CustomerRepository();
