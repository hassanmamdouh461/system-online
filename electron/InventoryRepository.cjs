const database = require('./database.cjs');

class InventoryRepository {
  getDb() {
    return database.getDb();
  }

  getBranchId() {
    return database.getBranchId();
  }

  // ─── Inventory Items CRUD ───────────────────────────────────────────────────
  
  getInventory(branchId) {
    const sqlite = this.getDb();
    const activeBranch = branchId || this.getBranchId();
    // Get all items.
    const rows = sqlite.prepare('SELECT * FROM inventory').all();
    return rows.map(row => ({
      id: row.id,
      name: row.name,
      unit: row.unit,
      stock: row.stock,
      minStock: row.minStock,
      costPerUnit: row.costPerUnit,
      branchId: row.branch_id || undefined,
      isSynced: Boolean(row.is_synced),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }

  createInventoryItem(item) {
    const sqlite = this.getDb();
    const id = item.id || `inv-${Math.random().toString(36).substr(2, 9)}`;
    const now = new Date().toISOString();
    const branchId = item.branchId || this.getBranchId();

    sqlite.prepare(`
      INSERT INTO inventory (id, name, unit, stock, minStock, costPerUnit, branch_id, is_synced, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
    `).run(
      id,
      item.name,
      item.unit,
      item.stock || 0,
      item.minStock || 0,
      item.costPerUnit || 0,
      branchId,
      now,
      now
    );

    // If initial stock is greater than 0, create an initial 'IN' transaction
    if (item.stock > 0) {
      const txId = `tx-${Math.random().toString(36).substr(2, 9)}`;
      sqlite.prepare(`
        INSERT INTO inventory_transactions (id, itemId, type, quantity, referenceId, createdAt, branch_id, is_synced, notes)
        VALUES (?, ?, 'IN', ?, 'INITIAL', ?, ?, 0, 'Initial stock setup')
      `).run(
        txId,
        id,
        item.stock,
        now,
        branchId
      );
    }

    return this.getInventoryItem(id);
  }

  updateInventoryItem(id, data) {
    const sqlite = this.getDb();
    const fields = [];
    const values = [];

    if (data.name !== undefined) { fields.push('name = ?'); values.push(data.name); }
    if (data.unit !== undefined) { fields.push('unit = ?'); values.push(data.unit); }
    if (data.stock !== undefined) { fields.push('stock = ?'); values.push(Number(data.stock)); }
    if (data.minStock !== undefined) { fields.push('minStock = ?'); values.push(Number(data.minStock)); }
    if (data.costPerUnit !== undefined) { fields.push('costPerUnit = ?'); values.push(Number(data.costPerUnit)); }
    if (data.branchId !== undefined) { fields.push('branch_id = ?'); values.push(data.branchId); }

    const now = new Date().toISOString();
    fields.push('updated_at = ?'); values.push(now);
    fields.push('is_synced = 0');

    if (fields.length === 0) return this.getInventoryItem(id);

    values.push(id);
    sqlite.prepare(`
      UPDATE inventory SET ${fields.join(', ')} WHERE id = ?
    `).run(...values);

    return this.getInventoryItem(id);
  }

  getInventoryItem(id) {
    const sqlite = this.getDb();
    const row = sqlite.prepare('SELECT * FROM inventory WHERE id = ?').get(id);
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      unit: row.unit,
      stock: row.stock,
      minStock: row.minStock,
      costPerUnit: row.costPerUnit,
      branchId: row.branch_id || undefined,
      isSynced: Boolean(row.is_synced),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  deleteInventoryItem(id) {
    const sqlite = this.getDb();
    sqlite.transaction(() => {
      sqlite.prepare('DELETE FROM inventory WHERE id = ?').run(id);
      sqlite.prepare('DELETE FROM menu_recipes WHERE inventoryItemId = ?').run(id);
      sqlite.prepare('DELETE FROM inventory_transactions WHERE itemId = ?').run(id);
    })();
  }

  // ─── Inventory Transactions ────────────────────────────────────────────────
  
  getInventoryTransactions(itemId, branchId) {
    const sqlite = this.getDb();
    let query = 'SELECT t.*, i.name as itemName, i.unit as itemUnit FROM inventory_transactions t JOIN inventory i ON t.itemId = i.id';
    const params = [];

    if (itemId) {
      query += ' WHERE t.itemId = ?';
      params.push(itemId);
    }

    query += itemId ? ' ORDER BY t.createdAt DESC' : ' ORDER BY t.createdAt DESC LIMIT 200';
    const rows = sqlite.prepare(query).all(...params);
    return rows.map(row => ({
      id: row.id,
      itemId: row.itemId,
      itemName: row.itemName,
      itemUnit: row.itemUnit,
      type: row.type,
      quantity: row.quantity,
      referenceId: row.referenceId || undefined,
      createdAt: row.createdAt,
      branchId: row.branch_id || undefined,
      isSynced: Boolean(row.is_synced),
      notes: row.notes || undefined
    }));
  }

  createInventoryTransaction(tx) {
    const sqlite = this.getDb();
    const id = tx.id || `tx-${Math.random().toString(36).substr(2, 9)}`;
    const now = new Date().toISOString();
    const branchId = tx.branchId || this.getBranchId();

    sqlite.transaction(() => {
      // 1. Insert transaction
      sqlite.prepare(`
        INSERT INTO inventory_transactions (id, itemId, type, quantity, referenceId, createdAt, branch_id, is_synced, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
      `).run(
        id,
        tx.itemId,
        tx.type,
        Number(tx.quantity),
        tx.referenceId || null,
        now,
        branchId,
        tx.notes || null
      );

      // 2. Adjust stock in inventory table
      let stockChange = Number(tx.quantity);
      if (tx.type === 'OUT') {
        stockChange = -stockChange; // Subtract quantity for OUT
      }

      sqlite.prepare(`
        UPDATE inventory 
        SET stock = stock + ?, updated_at = ?, is_synced = 0 
        WHERE id = ?
      `).run(stockChange, now, tx.itemId);
    })();

    return { ...tx, id, createdAt: now, branchId };
  }

  // ─── Menu Recipes (Ingredients Mapping) ────────────────────────────────────

  getMenuItemRecipe(menuItemId) {
    const sqlite = this.getDb();
    const rows = sqlite.prepare(`
      SELECT r.*, i.name as itemName, i.unit as itemUnit, i.costPerUnit
      FROM menu_recipes r
      JOIN inventory i ON r.inventoryItemId = i.id
      WHERE r.menuItemId = ?
    `).all(menuItemId);
    
    return rows.map(row => ({
      menuItemId: row.menuItemId,
      inventoryItemId: row.inventoryItemId,
      itemName: row.itemName,
      itemUnit: row.itemUnit,
      costPerUnit: row.costPerUnit,
      quantity: row.quantity
    }));
  }

  getMenuRecipes() {
    const sqlite = this.getDb();
    const rows = sqlite.prepare('SELECT * FROM menu_recipes').all();
    return rows.map(row => ({
      menuItemId: row.menuItemId,
      inventoryItemId: row.inventoryItemId,
      quantity: row.quantity
    }));
  }

  saveMenuRecipe(menuItemId, ingredients) {
    const sqlite = this.getDb();
    sqlite.transaction(() => {
      // Delete existing ingredients mapping
      sqlite.prepare('DELETE FROM menu_recipes WHERE menuItemId = ?').run(menuItemId);

      // Insert new ingredients
      if (ingredients && ingredients.length > 0) {
        const insert = sqlite.prepare(`
          INSERT INTO menu_recipes (menuItemId, inventoryItemId, quantity)
          VALUES (?, ?, ?)
        `);
        for (const ing of ingredients) {
          insert.run(menuItemId, ing.inventoryItemId, Number(ing.quantity));
        }
      }
    })();

    return this.getMenuItemRecipe(menuItemId);
  }

  getRecipeCost(menuItemId) {
    const sqlite = this.getDb();
    const row = sqlite.prepare(`
      SELECT SUM(r.quantity * i.costPerUnit) as totalCost
      FROM menu_recipes r
      JOIN inventory i ON r.inventoryItemId = i.id
      WHERE r.menuItemId = ?
    `).get(menuItemId);
    return row ? (row.totalCost || 0) : 0;
  }

  // ─── Live Inventory Deduction on Order Create/Cancel ─────────────────────────

  deductInventoryForOrder(orderId, orderItems, branchId) {
    const sqlite = this.getDb();
    const now = new Date().toISOString();
    const activeBranch = branchId || this.getBranchId();

    sqlite.transaction(() => {
      for (const item of orderItems) {
        const mItemId = item.menuItemId || item.id; // handle case where ID might be menuItemId or direct ID
        // Get recipe ingredients for this menu item
        const recipe = sqlite.prepare('SELECT * FROM menu_recipes WHERE menuItemId = ?').all(mItemId);
        
        for (const ing of recipe) {
          const qtyUsed = ing.quantity * item.quantity;
          
          // Deduct from stock
          sqlite.prepare(`
            UPDATE inventory 
            SET stock = stock - ?, updated_at = ?, is_synced = 0 
            WHERE id = ?
          `).run(qtyUsed, now, ing.inventoryItemId);

          // Log OUT transaction
          const txId = `tx-${Math.random().toString(36).substr(2, 9)}`;
          sqlite.prepare(`
            INSERT INTO inventory_transactions (id, itemId, type, quantity, referenceId, createdAt, branch_id, is_synced, notes)
            VALUES (?, ?, 'OUT', ?, ?, ?, ?, 0, ?)
          `).run(
            txId,
            ing.inventoryItemId,
            qtyUsed,
            orderId,
            now,
            activeBranch,
            `Order Item: ${item.name} x${item.quantity}`
          );
        }
      }
    })();
  }

  restoreInventoryForOrder(orderId, branchId) {
    const sqlite = this.getDb();
    const now = new Date().toISOString();
    const activeBranch = branchId || this.getBranchId();

    sqlite.transaction(() => {
      // Find OUT transactions recorded for this order
      const transactions = sqlite.prepare(`
        SELECT * FROM inventory_transactions 
        WHERE referenceId = ? AND type = 'OUT'
      `).all(orderId);

      for (const tx of transactions) {
        // Put stock back
        sqlite.prepare(`
          UPDATE inventory 
          SET stock = stock + ?, updated_at = ?, is_synced = 0 
          WHERE id = ?
        `).run(tx.quantity, now, tx.itemId);

        // Log compensating IN transaction
        const revTxId = `tx-${Math.random().toString(36).substr(2, 9)}`;
        sqlite.prepare(`
          INSERT INTO inventory_transactions (id, itemId, type, quantity, referenceId, createdAt, branch_id, is_synced, notes)
          VALUES (?, ?, 'IN', ?, ?, ?, ?, 0, ?)
        `).run(
          revTxId,
          tx.itemId,
          tx.quantity,
          orderId,
          now,
          activeBranch,
          `Revert cancelled order transaction`
        );
      }
    })();
  }

  getUnsyncedInventory() {
    const sqlite = this.getDb();
    const rows = sqlite.prepare('SELECT * FROM inventory WHERE is_synced = 0').all();
    return rows.map(row => ({
      id: row.id,
      name: row.name,
      unit: row.unit,
      stock: row.stock,
      minStock: row.minStock,
      costPerUnit: row.costPerUnit,
      branch_id: row.branch_id || 'branch_1',
      is_synced: row.is_synced,
      created_at: row.created_at,
      updated_at: row.updated_at
    }));
  }

  markInventorySynced(ids) {
    if (ids.length === 0) return;
    const sqlite = this.getDb();
    const stmt = sqlite.prepare('UPDATE inventory SET is_synced = 1 WHERE id = ?');
    sqlite.transaction(() => {
      for (const id of ids) {
        stmt.run(id);
      }
    })();
  }
}

module.exports = new InventoryRepository();
