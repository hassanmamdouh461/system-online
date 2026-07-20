const database = require('./database.cjs');

class OrderRepository {
  getDb() {
    return database.getDb();
  }

  getBranchId() {
    return database.getBranchId();
  }

  getOrders() {
    const sqlite = this.getDb();
    const rows = sqlite.prepare('SELECT * FROM orders ORDER BY CAST(orderNumber AS INTEGER) ASC').all();
    return rows.map(row => {
      let items = [];
      try {
        items = JSON.parse(row.items);
      } catch (e) {
        console.error('[OrderRepository] Failed to parse order items json:', e);
      }
      return {
        id: row.id,
        orderNumber: row.orderNumber,
        tableId: row.tableId,
        items,
        status: row.status,
        paymentStatus: row.paymentStatus,
        paymentMethod: row.paymentMethod || undefined,
        totalAmount: row.totalAmount,
        createdAt: row.createdAt,
        updatedAt: row.updated_at || undefined,
        paidAt: row.paidAt || undefined,
        customerPhone: row.customerPhone || undefined,
        pointsEarned: row.pointsEarned || 0,
        pointsRedeemed: row.pointsRedeemed || 0,
        branchId: row.branch_id || undefined,
        isSynced: Boolean(row.is_synced)
      };
    });
  }

  getOrder(id) {
    const sqlite = this.getDb();
    const row = sqlite.prepare('SELECT * FROM orders WHERE id = ?').get(id);
    if (!row) return null;
    let items = [];
    try {
      items = JSON.parse(row.items);
    } catch {}
    return {
      id: row.id,
      orderNumber: row.orderNumber,
      tableId: row.tableId,
      items,
      status: row.status,
      paymentStatus: row.paymentStatus,
      paymentMethod: row.paymentMethod || undefined,
      totalAmount: row.totalAmount,
      createdAt: row.createdAt,
      updatedAt: row.updated_at || undefined,
      paidAt: row.paidAt || undefined,
      customerPhone: row.customerPhone || undefined,
      pointsEarned: row.pointsEarned || 0,
      pointsRedeemed: row.pointsRedeemed || 0,
      branchId: row.branch_id || undefined,
      isSynced: Boolean(row.is_synced)
    };
  }

  createOrder(order) {
    const sqlite = this.getDb();
    const id = order.id || `ord-${Math.random().toString(36).substr(2, 9)}`;
    const createdAt = order.createdAt || new Date().toISOString();
    const now = new Date().toISOString();
    const branchId = order.branchId || this.getBranchId();
    
    // Calculate sequential order number for today using efficient SQL COUNT
    const todayLocal = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD
    const countToday = sqlite.prepare(
      "SELECT COUNT(*) as count FROM orders WHERE date(createdAt) = ?"
    ).get(todayLocal).count;
    const orderNumber = String(countToday + 1);

    sqlite.prepare(`
      INSERT INTO orders (id, orderNumber, tableId, items, status, paymentStatus, paymentMethod, totalAmount, createdAt, paidAt, customerPhone, pointsEarned, pointsRedeemed, branch_id, is_synced, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
    `).run(
      id,
      orderNumber,
      order.tableId,
      JSON.stringify(order.items),
      order.status,
      order.paymentStatus || 'Unpaid',
      order.paymentMethod || null,
      order.totalAmount,
      createdAt,
      order.paidAt || null,
      order.customerPhone || null,
      order.pointsEarned || 0,
      order.pointsRedeemed || 0,
      branchId,
      now
    );

    // Deduct stock for order items
    try {
      const inventoryRepository = require('./InventoryRepository.cjs');
      inventoryRepository.deductInventoryForOrder(id, order.items, branchId);
    } catch (e) {
      console.error('[OrderRepository] Failed to deduct stock:', e);
    }

    return {
      ...order,
      id,
      orderNumber,
      createdAt,
      updatedAt: now,
      customerPhone: order.customerPhone || undefined,
      pointsEarned: order.pointsEarned || 0,
      pointsRedeemed: order.pointsRedeemed || 0,
      branchId,
      isSynced: false
    };
  }

  updateOrder(id, data) {
    const sqlite = this.getDb();
    const fields = [];
    const values = [];
    
    if (data.orderNumber !== undefined) { fields.push('orderNumber = ?'); values.push(data.orderNumber); }
    if (data.tableId !== undefined) { fields.push('tableId = ?'); values.push(data.tableId); }
    if (data.items !== undefined) { fields.push('items = ?'); values.push(JSON.stringify(data.items)); }
    if (data.status !== undefined) { fields.push('status = ?'); values.push(data.status); }
    if (data.paymentStatus !== undefined) { fields.push('paymentStatus = ?'); values.push(data.paymentStatus); }
    if (data.paymentMethod !== undefined) { fields.push('paymentMethod = ?'); values.push(data.paymentMethod); }
    if (data.totalAmount !== undefined) { fields.push('totalAmount = ?'); values.push(data.totalAmount); }
    if (data.createdAt !== undefined) { fields.push('createdAt = ?'); values.push(data.createdAt); }
    if (data.paidAt !== undefined) { fields.push('paidAt = ?'); values.push(data.paidAt); }
    if (data.customerPhone !== undefined) { fields.push('customerPhone = ?'); values.push(data.customerPhone); }
    if (data.pointsEarned !== undefined) { fields.push('pointsEarned = ?'); values.push(data.pointsEarned); }
    if (data.pointsRedeemed !== undefined) { fields.push('pointsRedeemed = ?'); values.push(data.pointsRedeemed); }
    if (data.branchId !== undefined) { fields.push('branch_id = ?'); values.push(data.branchId); }
    
    // Always mark as unsynced and update timestamp on mutation
    const now = new Date().toISOString();
    fields.push('updated_at = ?'); values.push(now);
    fields.push('is_synced = 0');
    
    if (fields.length === 0) return this.getOrder(id);
    
    values.push(id);
    sqlite.prepare(`
      UPDATE orders SET ${fields.join(', ')} WHERE id = ?
    `).run(...values);
    
    return this.getOrder(id);
  }

  updateOrderStatus(id, status) {
    const sqlite = this.getDb();
    const now = new Date().toISOString();
    
    const currentOrder = this.getOrder(id);
    if (!currentOrder) return null;
    
    const oldStatus = currentOrder.status;
    
    sqlite.prepare('UPDATE orders SET status = ?, updated_at = ?, is_synced = 0 WHERE id = ?').run(status, now, id);
    
    // Check transitions for stock adjustments
    if (status === 'Cancelled' && oldStatus !== 'Cancelled') {
      try {
        const inventoryRepository = require('./InventoryRepository.cjs');
        inventoryRepository.restoreInventoryForOrder(id, currentOrder.branchId || this.getBranchId());
      } catch (e) {
        console.error('[OrderRepository] Failed to restore stock on cancellation:', e);
      }
    } else if (oldStatus === 'Cancelled' && status !== 'Cancelled') {
      try {
        const inventoryRepository = require('./InventoryRepository.cjs');
        inventoryRepository.deductInventoryForOrder(id, currentOrder.items, currentOrder.branchId || this.getBranchId());
      } catch (e) {
        console.error('[OrderRepository] Failed to re-deduct stock on activation:', e);
      }
    }
    
    return this.getOrder(id);
  }

  completeOrderPayment(id, method) {
    const sqlite = this.getDb();
    const now = new Date().toISOString();
    sqlite.prepare("UPDATE orders SET paymentStatus = 'Paid', paymentMethod = ?, paidAt = ?, updated_at = ?, is_synced = 0 WHERE id = ?").run(method, now, now, id);
    return this.getOrder(id);
  }

  deleteOrder(id) {
    const sqlite = this.getDb();
    sqlite.prepare('DELETE FROM orders WHERE id = ?').run(id);
  }

  resetOrders(defaults) {
    const sqlite = this.getDb();
    const now = new Date().toISOString();
    const branchId = this.getBranchId();
    
    const runTransaction = sqlite.transaction((orders) => {
      sqlite.prepare('DELETE FROM orders').run();
      const insert = sqlite.prepare(`
        INSERT INTO orders (id, orderNumber, tableId, items, status, paymentStatus, paymentMethod, totalAmount, createdAt, paidAt, customerPhone, pointsEarned, pointsRedeemed, branch_id, is_synced, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
      `);
      
      const created = [];
      for (const order of orders) {
        const id = order.id || `ord-${Math.random().toString(36).substr(2, 9)}`;
        const createdAt = order.createdAt || now;
        insert.run(
          id,
          order.orderNumber,
          order.tableId,
          JSON.stringify(order.items),
          order.status,
          order.paymentStatus || 'Unpaid',
          order.paymentMethod || null,
          order.totalAmount,
          createdAt,
          order.paidAt || null,
          order.customerPhone || null,
          order.pointsEarned || 0,
          order.pointsRedeemed || 0,
          branchId,
          now
        );
        created.push({ ...order, id, createdAt, updatedAt: now, branchId, isSynced: false });
      }
      return created;
    });

    return runTransaction(defaults);
  }

  getUnsyncedOrders() {
    const sqlite = this.getDb();
    const rows = sqlite.prepare('SELECT * FROM orders WHERE is_synced = 0').all();
    return rows.map(row => {
      let items = [];
      try {
        items = JSON.parse(row.items);
      } catch (e) {
        console.error('[OrderRepository] Failed to parse order items json:', e);
      }
      return {
        id: row.id,
        orderNumber: row.orderNumber,
        tableId: row.tableId,
        items,
        status: row.status,
        paymentStatus: row.paymentStatus,
        paymentMethod: row.paymentMethod || undefined,
        totalAmount: row.totalAmount,
        createdAt: row.createdAt,
        updatedAt: row.updated_at || undefined,
        paidAt: row.paidAt || undefined,
        customerPhone: row.customerPhone || undefined,
        pointsEarned: row.pointsEarned || 0,
        pointsRedeemed: row.pointsRedeemed || 0,
        branchId: row.branch_id || undefined,
        isSynced: Boolean(row.is_synced)
      };
    });
  }

  markOrdersSynced(ids) {
    if (!ids || ids.length === 0) return;
    const sqlite = this.getDb();
    const stmt = sqlite.prepare('UPDATE orders SET is_synced = 1 WHERE id = ?');
    const runTx = sqlite.transaction((idList) => {
      for (const id of idList) {
        stmt.run(id);
      }
    });
    runTx(ids);
  }

  upsertPulledOrders(pulledOrders) {
    if (!pulledOrders || pulledOrders.length === 0) return;
    const sqlite = this.getDb();
    const branchId = this.getBranchId();

    const insert = sqlite.prepare(`
      INSERT INTO orders (id, orderNumber, tableId, items, status, paymentStatus, paymentMethod, totalAmount, createdAt, paidAt, branch_id, is_synced, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        paymentStatus = excluded.paymentStatus,
        paymentMethod = excluded.paymentMethod,
        totalAmount = excluded.totalAmount,
        items = excluded.items,
        branch_id = excluded.branch_id,
        updated_at = excluded.updated_at
    `);

    const runTx = sqlite.transaction((orders) => {
      // Sort orders by $createdAt ascending to assign sequential order numbers
      orders.sort((a, b) => new Date(a.$createdAt).getTime() - new Date(b.$createdAt).getTime());

      let i = 1;
      for (const order of orders) {
        const orderBranchId = order.branch_id || 'default';
        // Filter by branch_id if we are logged in as a specific branch (manager sees all)
        if (branchId !== 'manager' && orderBranchId !== branchId) {
          continue;
        }

        const id = order.$id;
        const createdAt = order.$createdAt;
        const updatedAt = order.$updatedAt;
        const totalAmount = Number(order.total_amount) || 0;
        const paymentMethod = order.payment_method || 'Cash';
        const items = order.items; // JSON string

        const orderNumber = String(i++);

        insert.run(
          id,
          orderNumber,
          'Takeaway', // default
          items,
          'Ready', // status
          'Paid', // paymentStatus
          paymentMethod,
          totalAmount,
          createdAt,
          createdAt, // paidAt
          orderBranchId,
          updatedAt
        );
      }
    });

    runTx(pulledOrders);
  }

  getDailyReportStats() {
    const sqlite = this.getDb();
    
    // Query basic daily summary in local timezone
    const summary = sqlite.prepare(`
      SELECT 
        COUNT(*) as totalOrders,
        SUM(CASE WHEN paymentStatus = 'Paid' THEN totalAmount ELSE 0 END) as totalRevenue,
        SUM(CASE WHEN paymentStatus = 'Unpaid' THEN totalAmount ELSE 0 END) as totalUnpaid,
        SUM(CASE WHEN paymentMethod = 'Cash' AND paymentStatus = 'Paid' THEN totalAmount ELSE 0 END) as cashRevenue,
        SUM(CASE WHEN paymentMethod = 'Card' AND paymentStatus = 'Paid' THEN totalAmount ELSE 0 END) as cardRevenue
      FROM orders 
      WHERE date(createdAt, 'localtime') = date('now', 'localtime')
    `).get();

    // Query items sold in local timezone
    const rows = sqlite.prepare(`
      SELECT items FROM orders 
      WHERE date(createdAt, 'localtime') = date('now', 'localtime')
        AND paymentStatus = 'Paid'
    `).all();

    const itemsMap = {};
    for (const row of rows) {
      try {
        const items = JSON.parse(row.items);
        for (const item of items) {
          const qty = Number(item.quantity) || 0;
          itemsMap[item.name] = (itemsMap[item.name] || 0) + qty;
        }
      } catch (e) {
        console.error('[OrderRepository] Failed to parse items json in getDailyReportStats:', e);
      }
    }

    const itemsSold = Object.entries(itemsMap).map(([name, quantity]) => ({ name, quantity }));

    return {
      date: new Date().toLocaleDateString('en-CA'),
      totalOrders: summary.totalOrders || 0,
      totalRevenue: summary.totalRevenue || 0,
      totalUnpaid: summary.totalUnpaid || 0,
      cashRevenue: summary.cashRevenue || 0,
      cardRevenue: summary.cardRevenue || 0,
      itemsSold
    };
  }
}

module.exports = new OrderRepository();
