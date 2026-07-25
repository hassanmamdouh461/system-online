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
    return rows.map(row => this._rowToOrder(row));
  }

  getOrder(id) {
    const sqlite = this.getDb();
    const row = sqlite.prepare('SELECT * FROM orders WHERE id = ?').get(id);
    if (!row) return null;
    return this._rowToOrder(row);
  }

  // Centralized row -> order object mapper so every read returns the full
  // field set (financial snapshot, customer/company billing, refund, tombstone).
  // Callers (Manager dashboard, reports, sync) previously saw only a subset,
  // which made Electron under-report tax/grandTotal and drop OnAccount billing.
  _rowToOrder(row) {
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
      taxRate: row.taxRate === null || row.taxRate === undefined ? undefined : row.taxRate,
      taxAmount: row.taxAmount === null || row.taxAmount === undefined ? undefined : row.taxAmount,
      grandTotal: row.grandTotal === null || row.grandTotal === undefined ? undefined : row.grandTotal,
      createdAt: row.createdAt,
      updatedAt: row.updated_at || undefined,
      paidAt: row.paidAt || undefined,
      customerPhone: row.customerPhone || undefined,
      customerId: row.customerId || undefined,
      customerName: row.customerName || undefined,
      companyId: row.companyId || undefined,
      companyName: row.companyName || undefined,
      billedToType: row.billedToType || undefined,
      pointsEarned: row.pointsEarned || 0,
      pointsRedeemed: row.pointsRedeemed || 0,
      refundedAt: row.refundedAt || undefined,
      refundReason: row.refundReason || undefined,
      deletedAt: row.deletedAt || undefined,
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
    // Prefer a clean short ticket from the caller; otherwise count-based next.
    const providedNum = String(order.orderNumber || '').trim();
    const orderNumber = /^\d{1,5}$/.test(providedNum) ? providedNum : String(countToday + 1);

    sqlite.prepare(`
      INSERT INTO orders (
        id, orderNumber, tableId, items, status, paymentStatus, paymentMethod,
        totalAmount, taxRate, taxAmount, grandTotal,
        createdAt, paidAt,
        customerPhone, customerId, customerName,
        companyId, companyName, billedToType,
        pointsEarned, pointsRedeemed, refundedAt, refundReason, deletedAt,
        branch_id, is_synced, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
    `).run(
      id,
      orderNumber,
      order.tableId,
      JSON.stringify(order.items),
      order.status,
      order.paymentStatus || 'Unpaid',
      order.paymentMethod || null,
      order.totalAmount,
      order.taxRate === undefined ? null : order.taxRate,
      order.taxAmount === undefined ? null : order.taxAmount,
      order.grandTotal === undefined ? null : order.grandTotal,
      createdAt,
      order.paidAt || null,
      order.customerPhone || null,
      order.customerId || null,
      order.customerName || null,
      order.companyId || null,
      order.companyName || null,
      order.billedToType || null,
      order.pointsEarned || 0,
      order.pointsRedeemed || 0,
      order.refundedAt || null,
      order.refundReason || null,
      order.deletedAt || null,
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
    if (data.taxRate !== undefined) { fields.push('taxRate = ?'); values.push(data.taxRate === null ? null : data.taxRate); }
    if (data.taxAmount !== undefined) { fields.push('taxAmount = ?'); values.push(data.taxAmount === null ? null : data.taxAmount); }
    if (data.grandTotal !== undefined) { fields.push('grandTotal = ?'); values.push(data.grandTotal === null ? null : data.grandTotal); }
    if (data.createdAt !== undefined) { fields.push('createdAt = ?'); values.push(data.createdAt); }
    if (data.paidAt !== undefined) { fields.push('paidAt = ?'); values.push(data.paidAt); }
    if (data.customerPhone !== undefined) { fields.push('customerPhone = ?'); values.push(data.customerPhone); }
    if (data.customerId !== undefined) { fields.push('customerId = ?'); values.push(data.customerId); }
    if (data.customerName !== undefined) { fields.push('customerName = ?'); values.push(data.customerName); }
    if (data.companyId !== undefined) { fields.push('companyId = ?'); values.push(data.companyId); }
    if (data.companyName !== undefined) { fields.push('companyName = ?'); values.push(data.companyName); }
    if (data.billedToType !== undefined) { fields.push('billedToType = ?'); values.push(data.billedToType); }
    if (data.pointsEarned !== undefined) { fields.push('pointsEarned = ?'); values.push(data.pointsEarned); }
    if (data.pointsRedeemed !== undefined) { fields.push('pointsRedeemed = ?'); values.push(data.pointsRedeemed); }
    if (data.refundedAt !== undefined) { fields.push('refundedAt = ?'); values.push(data.refundedAt); }
    if (data.refundReason !== undefined) { fields.push('refundReason = ?'); values.push(data.refundReason); }
    if (data.deletedAt !== undefined) { fields.push('deletedAt = ?'); values.push(data.deletedAt); }
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
    // OnAccount = receivable (no paidAt). Cash/Card = settled revenue.
    if (method === 'OnAccount') {
      sqlite
        .prepare(
          "UPDATE orders SET paymentStatus = 'OnAccount', paymentMethod = 'OnAccount', paidAt = NULL, updated_at = ?, is_synced = 0 WHERE id = ?"
        )
        .run(now, id);
    } else {
      sqlite
        .prepare(
          "UPDATE orders SET paymentStatus = 'Paid', paymentMethod = ?, paidAt = ?, updated_at = ?, is_synced = 0 WHERE id = ?"
        )
        .run(method, now, now, id);
    }
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
        INSERT INTO orders (
          id, orderNumber, tableId, items, status, paymentStatus, paymentMethod,
          totalAmount, taxRate, taxAmount, grandTotal,
          createdAt, paidAt,
          customerPhone, customerId, customerName,
          companyId, companyName, billedToType,
          pointsEarned, pointsRedeemed, refundedAt, refundReason, deletedAt,
          branch_id, is_synced, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
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
          order.taxRate === undefined ? null : order.taxRate,
          order.taxAmount === undefined ? null : order.taxAmount,
          order.grandTotal === undefined ? null : order.grandTotal,
          createdAt,
          order.paidAt || null,
          order.customerPhone || null,
          order.customerId || null,
          order.customerName || null,
          order.companyId || null,
          order.companyName || null,
          order.billedToType || null,
          order.pointsEarned || 0,
          order.pointsRedeemed || 0,
          order.refundedAt || null,
          order.refundReason || null,
          order.deletedAt || null,
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
    return rows.map(row => this._rowToOrder(row));
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

    // Insert/upsert with the FULL field set the worker persists.
    // Previously this hardcoded status='Ready', paymentStatus='Paid',
    // tableId='Takeaway', paidAt=createdAt and renumbered every order 1..N,
    // which (a) counted unpaid / refunded / cancelled orders as collected
    // revenue and (b) wiped the real kitchen status and payment timestamp.
    // Now every field is taken from the cloud row, defaulting only when the
    // cloud value is genuinely missing — and paymentStatus defaults to
    // 'Unpaid' (the safe, non-revenue default) instead of 'Paid'.
    const insert = sqlite.prepare(`
      INSERT INTO orders (
        id, orderNumber, tableId, items, status, paymentStatus, paymentMethod,
        totalAmount, taxRate, taxAmount, grandTotal,
        createdAt, updated_at, paidAt,
        customerPhone, customerId, customerName,
        companyId, companyName, billedToType,
        pointsEarned, pointsRedeemed, refundedAt, refundReason, deletedAt,
        branch_id, is_synced
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      ON CONFLICT(id) DO UPDATE SET
        orderNumber = excluded.orderNumber,
        tableId = excluded.tableId,
        status = excluded.status,
        paymentStatus = excluded.paymentStatus,
        paymentMethod = excluded.paymentMethod,
        totalAmount = excluded.totalAmount,
        taxRate = excluded.taxRate,
        taxAmount = excluded.taxAmount,
        grandTotal = excluded.grandTotal,
        items = excluded.items,
        paidAt = excluded.paidAt,
        customerPhone = excluded.customerPhone,
        customerId = excluded.customerId,
        customerName = excluded.customerName,
        companyId = excluded.companyId,
        companyName = excluded.companyName,
        billedToType = excluded.billedToType,
        pointsEarned = excluded.pointsEarned,
        pointsRedeemed = excluded.pointsRedeemed,
        refundedAt = excluded.refundedAt,
        refundReason = excluded.refundReason,
        deletedAt = excluded.deletedAt,
        branch_id = excluded.branch_id,
        updated_at = excluded.updated_at
    `);

    // Keep a local payment win: if the local row is Paid more recently than the
    // cloud row (cashier just settled it here), do not let a stale cloud pull
    // downgrade it back to Unpaid/OnAccount and lose the revenue record.
    const getLocalPaid = sqlite.prepare('SELECT paidAt, paymentStatus, updated_at FROM orders WHERE id = ?');

    const runTx = sqlite.transaction((orders) => {
      for (const order of orders) {
        // Single-branch system: every pulled order belongs to this branch.
        const orderBranchId = branchId;

        const id = order.$id;
        if (!id) continue;
        const createdAt = order.$createdAt;
        const updatedAt = order.$updatedAt || createdAt;

        // Preserve the real orderNumber from the cloud; only fall back to a
        // per-pull sequence when the cloud value is empty/junk (never invent
        // numbers from the document id, which is a timestamp).
        const rawNum = String(order.orderNumber || '').trim();
        const orderNumber = /^\d{1,5}$/.test(rawNum) ? rawNum : '';

        const local = getLocalPaid.get(id);
        const localPaidMs = local && local.paidAt ? new Date(local.paidAt).getTime() : 0;
        const remotePaidMs = order.paidAt ? new Date(order.paidAt).getTime() : 0;
        const localWinsPayment =
          local &&
          local.paymentStatus === 'Paid' &&
          Number.isFinite(localPaidMs) &&
          (!order.paidAt || (Number.isFinite(remotePaidMs) && localPaidMs > remotePaidMs));

        const paymentStatus = localWinsPayment
          ? 'Paid'
          : (order.paymentStatus || 'Unpaid');
        const paidAt = localWinsPayment ? local.paidAt : (order.paidAt || null);
        const paymentMethod = localWinsPayment
          ? (local.paymentStatus === 'Paid' ? (order.paymentMethod || 'Cash') : (order.paymentMethod || 'Cash'))
          : (order.paymentMethod || 'Cash');

        let items = order.items;
        if (items && typeof items !== 'string') {
          try { items = JSON.stringify(items); } catch (_) { items = '[]'; }
        }
        if (!items) items = '[]';

        insert.run(
          id,
          orderNumber || null,
          order.tableId || 'Takeaway',
          items,
          order.status || 'New',
          paymentStatus,
          paymentMethod,
          Number(order.totalAmount) || 0,
          order.taxRate === undefined ? null : order.taxRate,
          order.taxAmount === undefined ? null : order.taxAmount,
          order.grandTotal === undefined ? null : order.grandTotal,
          createdAt,
          updatedAt,
          paidAt,
          order.customerPhone || null,
          order.customerId || null,
          order.customerName || null,
          order.companyId || null,
          order.companyName || null,
          order.billedToType || null,
          order.pointsEarned === undefined ? 0 : Number(order.pointsEarned) || 0,
          order.pointsRedeemed === undefined ? 0 : Number(order.pointsRedeemed) || 0,
          order.refundedAt || null,
          order.refundReason || null,
          order.deletedAt || null,
          orderBranchId,
          updatedAt
        );
      }
    });

    runTx(pulledOrders);
  }

  getDailyReportStats() {
    const sqlite = this.getDb();
    
    // Query basic daily summary in local timezone.
    // Revenue uses grandTotal when present (frozen tax snapshot — accurate),
    // otherwise totalAmount + taxAmount, so tax is never lost on older rows.
    // totalUnpaid now also covers OnAccount (charge-to-ledger) receivables,
    // not just open Unpaid bills.
    const summary = sqlite.prepare(`
      SELECT 
        COUNT(*) as totalOrders,
        SUM(CASE WHEN paymentStatus = 'Paid' THEN
          CASE WHEN grandTotal IS NOT NULL AND grandTotal > 0 THEN grandTotal
               ELSE totalAmount + COALESCE(taxAmount, 0) END
          ELSE 0 END) as totalRevenue,
        SUM(CASE WHEN paymentStatus IN ('Unpaid','OnAccount') THEN totalAmount ELSE 0 END) as totalUnpaid,
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
