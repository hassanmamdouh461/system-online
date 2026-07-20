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
    return rows.map(row => ({
      id: row.id,
      name: row.name,
      phone: row.phone,
      points: row.points,
      createdAt: row.createdAt,
      updatedAt: row.updated_at || undefined,
      branchId: row.branch_id || undefined,
      isSynced: Boolean(row.is_synced)
    }));
  }

  getCustomerByPhone(phone) {
    const sqlite = this.getDb();
    const row = sqlite.prepare('SELECT * FROM customers WHERE phone = ?').get(phone);
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      phone: row.phone,
      points: row.points,
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
      sqlite.prepare('UPDATE customers SET name = ?, points = ?, updated_at = ?, is_synced = 0 WHERE phone = ?').run(
        customer.name || existing.name,
        customer.points !== undefined ? customer.points : existing.points,
        now,
        customer.phone
      );
      return this.getCustomerByPhone(customer.phone);
    } else {
      const id = customer.id || `cust-${Math.random().toString(36).substr(2, 9)}`;
      const createdAt = customer.createdAt || now;
      const branchId = customer.branchId || this.getBranchId();
      sqlite.prepare('INSERT INTO customers (id, name, phone, points, createdAt, branch_id, is_synced, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)')
        .run(id, customer.name || 'Customer', customer.phone, customer.points || 0, createdAt, branchId, now);
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
    return rows.map(row => ({
      id: row.id,
      name: row.name,
      phone: row.phone,
      points: row.points,
      createdAt: row.createdAt,
      updatedAt: row.updated_at || undefined,
      branchId: row.branch_id || undefined,
      isSynced: Boolean(row.is_synced)
    }));
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
