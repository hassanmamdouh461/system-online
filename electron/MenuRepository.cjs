const database = require('./database.cjs');

class MenuRepository {
  getDb() {
    return database.getDb();
  }

  getBranchId() {
    return database.getBranchId();
  }

  // Centralized row -> menu item mapper. Includes the soft-delete tombstone
  // (deleted_at) so cloud-deleted items stay hidden on Electron instead of
  // being re-pulled as live, matching the web client behaviour.
  _rowToMenuItem(row) {
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
      deletedAt: row.deleted_at || undefined,
      branchId: row.branch_id || undefined,
      isSynced: Boolean(row.is_synced)
    };
  }

  getMenu() {
    const sqlite = this.getDb();
    // Single-branch system: all menu belongs to this branch.
    const rows = sqlite.prepare('SELECT * FROM menu').all();
    return rows.map(row => this._rowToMenuItem(row));
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
    if (data.deletedAt !== undefined) { fields.push('deleted_at = ?'); values.push(data.deletedAt || null); }
    
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
    return this._rowToMenuItem(row);
  }

  deleteMenuItem(id) {
    const sqlite = this.getDb();
    // Soft-delete: write a tombstone (deleted_at) instead of a hard DELETE,
    // so a later cloud pull cannot resurrect the item. This matches the web
    // client and the worker, which keep deleted_at to propagate deletions.
    const now = new Date().toISOString();
    const existing = sqlite.prepare('SELECT * FROM menu WHERE id = ?').get(id);
    if (existing) {
      sqlite.prepare(`
        UPDATE menu SET deleted_at = ?, updated_at = ?, is_synced = 0 WHERE id = ?
      `).run(now, now, id);
    } else {
      // No local row to tombstone — fall back to a hard delete is pointless,
      // just record nothing. The cloud delete below handles the server side.
    }
    
    // Try to delete from Cloudflare D1 database immediately
    try {
      const d1Sync = require('./d1SyncService.cjs');
      d1Sync.deleteMenuItem(id).catch(err => {
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
    return rows.map(row => this._rowToMenuItem(row));
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
