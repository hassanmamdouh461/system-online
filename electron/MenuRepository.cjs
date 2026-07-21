const database = require('./database.cjs');

class MenuRepository {
  getDb() {
    return database.getDb();
  }

  getBranchId() {
    return database.getBranchId();
  }

  getMenu() {
    const sqlite = this.getDb();
    const rows = sqlite.prepare('SELECT * FROM menu').all();
    return rows.map(row => ({
      id: row.id,
      name: row.name,
      description: row.description,
      price: row.price,
      category: row.category,
      image: row.image,
      available: Boolean(row.available),
      createdAt: row.created_at || undefined,
      updatedAt: row.updated_at || undefined,
      branchId: row.branch_id || undefined,
      isSynced: Boolean(row.is_synced)
    }));
  }

  createMenuItem(item) {
    const sqlite = this.getDb();
    const id = item.id || `menu-${Math.random().toString(36).substr(2, 9)}`;
    const now = new Date().toISOString();
    const branchId = item.branchId || this.getBranchId();

    sqlite.prepare(`
      INSERT INTO menu (id, name, description, price, category, image, available, branch_id, is_synced, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
    `).run(
      id,
      item.name,
      item.description || '',
      item.price,
      item.category,
      item.image || '',
      item.available ? 1 : 0,
      branchId,
      now,
      now
    );
    return { ...item, id, branchId, isSynced: false, createdAt: now, updatedAt: now };
  }

  updateMenuItem(id, data) {
    const sqlite = this.getDb();
    const fields = [];
    const values = [];
    
    if (data.name !== undefined) { fields.push('name = ?'); values.push(data.name); }
    if (data.description !== undefined) { fields.push('description = ?'); values.push(data.description); }
    if (data.price !== undefined) { fields.push('price = ?'); values.push(Number(data.price)); }
    if (data.category !== undefined) { fields.push('category = ?'); values.push(data.category); }
    if (data.image !== undefined) { fields.push('image = ?'); values.push(data.image); }
    if (data.available !== undefined) { fields.push('available = ?'); values.push(data.available ? 1 : 0); }
    if (data.branchId !== undefined) { fields.push('branch_id = ?'); values.push(data.branchId); }
    
    // Always mark as unsynced and update timestamp on mutation
    const now = new Date().toISOString();
    fields.push('updated_at = ?'); values.push(now);
    fields.push('is_synced = 0');
    
    if (fields.length === 0) return this.getMenuItem(id);
    
    values.push(id);
    sqlite.prepare(`
      UPDATE menu SET ${fields.join(', ')} WHERE id = ?
    `).run(...values);
    
    return this.getMenuItem(id);
  }

  getMenuItem(id) {
    const sqlite = this.getDb();
    const row = sqlite.prepare('SELECT * FROM menu WHERE id = ?').get(id);
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      price: row.price,
      category: row.category,
      image: row.image,
      available: Boolean(row.available),
      createdAt: row.created_at || undefined,
      updatedAt: row.updated_at || undefined,
      branchId: row.branch_id || undefined,
      isSynced: Boolean(row.is_synced)
    };
  }

  deleteMenuItem(id) {
    const sqlite = this.getDb();
    sqlite.prepare('DELETE FROM menu WHERE id = ?').run(id);
    
    // Try to delete from Cloudflare D1 database immediately
    try {
      const mockApi = require('./mockApiService.cjs');
      mockApi.deleteMenuItem(id).catch(err => {
        console.warn('[MenuRepository] Async delete from D1 failed:', err.message);
      });
    } catch (e) {
      console.warn('[MenuRepository] Failed to initiate D1 delete:', e.message);
    }
  }

  resetMenu(defaults) {
    const sqlite = this.getDb();
    const now = new Date().toISOString();
    const branchId = this.getBranchId();
    
    const runTransaction = sqlite.transaction((items) => {
      sqlite.prepare('DELETE FROM menu').run();
      const insert = sqlite.prepare(`
        INSERT INTO menu (id, name, description, price, category, image, available, branch_id, is_synced, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
      `);
      
      const created = [];
      for (const item of items) {
        const id = item.id || `menu-${Math.random().toString(36).substr(2, 9)}`;
        insert.run(
          id,
          item.name,
          item.description || '',
          item.price,
          item.category,
          item.image || '',
          item.available ? 1 : 0,
          branchId,
          now,
          now
        );
        created.push({ ...item, id, branchId, isSynced: false, createdAt: now, updatedAt: now });
      }
      return created;
    });

    return runTransaction(defaults);
  }

  getUnsyncedMenu() {
    const sqlite = this.getDb();
    const rows = sqlite.prepare('SELECT * FROM menu WHERE is_synced = 0').all();
    return rows.map(row => ({
      id: row.id,
      name: row.name,
      description: row.description,
      price: row.price,
      category: row.category,
      image: row.image,
      available: Boolean(row.available),
      createdAt: row.created_at || undefined,
      updatedAt: row.updated_at || undefined,
      branchId: row.branch_id || undefined,
      isSynced: Boolean(row.is_synced)
    }));
  }

  markMenuSynced(ids) {
    if (!ids || ids.length === 0) return;
    const sqlite = this.getDb();
    const stmt = sqlite.prepare('UPDATE menu SET is_synced = 1 WHERE id = ?');
    const runTx = sqlite.transaction((idList) => {
      for (const id of idList) {
        stmt.run(id);
      }
    });
    runTx(ids);
  }
}

module.exports = new MenuRepository();
