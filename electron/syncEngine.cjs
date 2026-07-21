const https = require('https');
const mockApi = require('./mockApiService.cjs');

function checkInternet() {
  return new Promise((resolve) => {
    // Light-weight DNS resolved check via Google public DNS over HTTPS
    const req = https.get('https://dns.google', { timeout: 3000 }, (res) => {
      resolve(res.statusCode === 200);
    });
    
    req.on('error', () => {
      resolve(false);
    });
    
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

class SyncEngine {
  constructor(db, onStatusUpdate) {
    this.db = db;
    this.onStatusUpdate = onStatusUpdate;
    this.intervalId = null;
    this.status = {
      state: 'idle', // 'idle' | 'syncing' | 'synced' | 'offline' | 'error'
      lastSyncAt: null,
      pendingCount: 0,
      lastError: null,
    };
    this.isSyncing = false;
  }

  /**
   * Start the sync background loop
   */
  start(intervalMs = 30000) {
    console.log('[syncEngine] Starting Background Sync Worker...');
    
    // Initial stats check and sync
    this.updatePendingCount();
    this.runSyncCycle();

    this.intervalId = setInterval(() => {
      this.runSyncCycle();
    }, intervalMs);
  }

  /**
   * Stop the background loop
   */
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log('[syncEngine] Background Sync Worker stopped.');
    }
  }

  /**
   * Query the SQLite database to get current counts of unsynced records
   */
  updatePendingCount() {
    try {
      const stats = this.db.getSyncStats();
      this.status.pendingCount = stats.totalPending;
      this.emitStatus();
      return stats;
    } catch (e) {
      console.error('[syncEngine] Error getting sync stats:', e);
      return { totalPending: this.status.pendingCount };
    }
  }

  /**
   * Return current sync status
   */
  getStatus() {
    // Refresh stats before returning
    this.updatePendingCount();
    return this.status;
  }

  /**
   * Force an immediate sync cycle
   */
  async syncNow() {
    if (this.isSyncing) {
      console.log('[syncEngine] Sync already in progress, skipping manual trigger.');
      return this.status;
    }
    console.log('[syncEngine] Manual sync trigger received.');
    await this.runSyncCycle();
    return this.status;
  }

  /**
   * Broadcast sync status updates to the registered listener (renderer window)
   */
  emitStatus() {
    if (this.onStatusUpdate) {
      this.onStatusUpdate({ ...this.status });
    }
  }

  /**
   * The core sync logic cycle
   */
  async runSyncCycle() {
    if (this.isSyncing) return;
    this.isSyncing = true;

    // Trigger check for daily Telegram report send in background
    this.checkAndSendTelegramReport().catch(err => {
      console.error('[syncEngine] Auto Telegram report failed:', err);
    });

    try {
      // 1. Check for internet connectivity first
      this.status.state = 'syncing';
      this.emitStatus();
      
      const isOnline = await checkInternet();
      if (!isOnline) {
        console.warn('[syncEngine] Offline: Internet connectivity check failed. Postponing sync.');
        this.status.state = 'offline';
        this.emitStatus();
        this.isSyncing = false;
        return;
      }

      // 2. Pull updates from Cloudflare D1 database
      try {
        console.log('[syncEngine] Pulling updates from Cloudflare D1...');
        const pulledOrders = await mockApi.pullOrders();
        if (pulledOrders && pulledOrders.length > 0) {
          const tempOrderRepository = require('./OrderRepository.cjs');
          tempOrderRepository.upsertPulledOrders(pulledOrders);
          console.log(`[syncEngine] Successfully integrated ${pulledOrders.length} remote orders into local database.`);
        }
      } catch (pullError) {
        console.error('[syncEngine] Failed to pull remote orders:', pullError.message);
      }

      // 3. Update the lastSyncAt timestamp since we successfully reached the server and pulled
      this.status.lastSyncAt = new Date().toISOString();

      // 4. Get current stats of pending local records to push
      const stats = this.updatePendingCount();
      
      if (stats.totalPending === 0) {
        // Nothing to push, sync is complete!
        this.status.state = 'synced';
        this.status.lastError = null;
        this.emitStatus();
        this.isSyncing = false;
        return;
      }

      console.log(`[syncEngine] Online: Found ${stats.totalPending} pending records to push/sync.`);
      
      // 5. Query the actual unsynced records from repositories
      const menuRepository = require('./MenuRepository.cjs');
      const customerRepository = require('./CustomerRepository.cjs');
      const orderRepository = require('./OrderRepository.cjs');

      const unsyncedMenu = menuRepository.getUnsyncedMenu();
      const unsyncedCustomers = customerRepository.getUnsyncedCustomers();
      const unsyncedOrders = orderRepository.getUnsyncedOrders();
      
      // Sync Menu Items
      if (unsyncedMenu.length > 0) {
        await mockApi.pushMenuItems(unsyncedMenu);
        const menuIds = unsyncedMenu.map(item => item.id);
        menuRepository.markMenuSynced(menuIds);
        console.log(`[syncEngine] Marked ${menuIds.length} menu items as synced in local DB.`);
      }

      // Sync Customers
      if (unsyncedCustomers.length > 0) {
        await mockApi.pushCustomers(unsyncedCustomers);
        const customerIds = unsyncedCustomers.map(c => c.id);
        customerRepository.markCustomersSynced(customerIds);
        console.log(`[syncEngine] Marked ${customerIds.length} customers as synced in local DB.`);
      }

      // Sync Orders
      if (unsyncedOrders.length > 0) {
        await mockApi.pushOrders(unsyncedOrders);
        const orderIds = unsyncedOrders.map(o => o.id);
        orderRepository.markOrdersSynced(orderIds);
        console.log(`[syncEngine] Marked ${orderIds.length} orders as synced in local DB.`);
      }

      // Sync Inventory (gracefully wrapped in try-catch to allow graceful bypass if collection is not created yet)
      try {
        const inventoryRepository = require('./InventoryRepository.cjs');
        const unsyncedInventory = inventoryRepository.getUnsyncedInventory();
        if (unsyncedInventory.length > 0) {
          await mockApi.pushInventory(unsyncedInventory);
          const inventoryIds = unsyncedInventory.map(inv => inv.id);
          inventoryRepository.markInventorySynced(inventoryIds);
          console.log(`[syncEngine] Marked ${inventoryIds.length} inventory items as synced in local DB.`);
        }
      } catch (invError) {
        console.warn('[syncEngine] Inventory sync bypassed:', invError.message);
      }

      // 6. Update success status
      this.status.state = 'synced';
      this.status.lastError = null;
      this.updatePendingCount(); // Updates pending count and calls emitStatus()
      
      console.log('[syncEngine] Sync cycle completed successfully.');
    } catch (error) {
      console.error('[syncEngine] Sync cycle failed with error:', error.message);
      this.status.state = 'error';
      this.status.lastError = error.message || 'Unknown synchronization error';
      this.updatePendingCount(); // Updates pending count and calls emitStatus()
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Automatically check and send Telegram report if configured and scheduled time is reached
   */
  async checkAndSendTelegramReport() {
    try {
      const db = require('./database.cjs');
      const settings = db.getSettings();
      
      const configRaw = settings['brewmaster_telegram_config'];
      if (!configRaw) return;

      let config;
      try {
        config = JSON.parse(configRaw);
      } catch (e) {
        return;
      }

      if (!config.enabled || !config.botToken || !config.chatId) return;

      const now = new Date();
      // Format time as "HH:MM" (local time)
      const currentHours = String(now.getHours()).padStart(2, '0');
      const currentMinutes = String(now.getMinutes()).padStart(2, '0');
      const currentTimeStr = `${currentHours}:${currentMinutes}`;
      
      // Target scheduled time
      const scheduledTimeStr = config.reportTime || '23:00';
      
      // Format today's date as "YYYY-MM-DD"
      const todayDateStr = now.toLocaleDateString('en-CA');
      const lastReportDate = settings['telegram_last_report_date'] || '';

      // If current local time is at or after scheduled time, and we haven't sent it today
      if (currentTimeStr >= scheduledTimeStr && lastReportDate !== todayDateStr) {
        console.log(`[syncEngine] Triggering automatic daily Telegram report at ${currentTimeStr} (Scheduled: ${scheduledTimeStr})`);
        
        const telegramService = require('./telegramService.cjs');
        await telegramService.sendDailyReport();
        
        // Save today's date as the last sent report to prevent double sends
        db.saveSetting('telegram_last_report_date', todayDateStr);
        console.log(`[syncEngine] Automatic daily Telegram report sent successfully for ${todayDateStr}.`);
      }
    } catch (error) {
      console.error('[syncEngine] Failed to send automatic Telegram report:', error.message);
    }
  }
}

module.exports = SyncEngine;
