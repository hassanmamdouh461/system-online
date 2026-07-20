const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getMenu: () => ipcRenderer.invoke('db:get-menu'),
  createMenuItem: (item) => ipcRenderer.invoke('db:create-menu-item', item),
  updateMenuItem: (id, data) => ipcRenderer.invoke('db:update-menu-item', id, data),
  deleteMenuItem: (id) => ipcRenderer.invoke('db:delete-menu-item', id),
  resetMenu: (defaults) => ipcRenderer.invoke('db:reset-menu', defaults),
  
  getOrders: () => ipcRenderer.invoke('db:get-orders'),
  createOrder: (order) => ipcRenderer.invoke('db:create-order', order),
  updateOrderStatus: (id, status) => ipcRenderer.invoke('db:update-order-status', id, status),
  completeOrderPayment: (id, method) => ipcRenderer.invoke('db:complete-order-payment', id, method),
  updateOrder: (id, data) => ipcRenderer.invoke('db:update-order', id, data),
  deleteOrder: (id) => ipcRenderer.invoke('db:delete-order', id),
  resetOrders: (defaults) => ipcRenderer.invoke('db:reset-orders', defaults),
  getDailyReportStats: () => ipcRenderer.invoke('db:get-daily-report-stats'),
  sendDailyReportToTelegram: () => ipcRenderer.invoke('telegram:send-daily-report'),

  getCustomers: () => ipcRenderer.invoke('db:get-customers'),
  getCustomerByPhone: (phone) => ipcRenderer.invoke('db:get-customer-by-phone', phone),
  saveCustomer: (customer) => ipcRenderer.invoke('db:save-customer', customer),
  deleteCustomer: (id) => ipcRenderer.invoke('db:delete-customer', id),

  getSettings: () => ipcRenderer.invoke('db:get-settings'),
  saveSetting: (key, value) => ipcRenderer.invoke('db:save-setting', key, value),
  deleteSetting: (key) => ipcRenderer.invoke('db:delete-setting', key),

  // Inventory APIs
  getInventory: (branchId) => ipcRenderer.invoke('db:get-inventory', branchId),
  createInventoryItem: (item) => ipcRenderer.invoke('db:create-inventory-item', item),
  updateInventoryItem: (id, data) => ipcRenderer.invoke('db:update-inventory-item', id, data),
  deleteInventoryItem: (id) => ipcRenderer.invoke('db:delete-inventory-item', id),
  
  getInventoryTransactions: (itemId, branchId) => ipcRenderer.invoke('db:get-inventory-transactions', itemId, branchId),
  createInventoryTransaction: (tx) => ipcRenderer.invoke('db:create-inventory-transaction', tx),
  
  getMenuRecipes: () => ipcRenderer.invoke('db:get-menu-recipes'),
  getMenuItemRecipe: (menuItemId) => ipcRenderer.invoke('db:get-menu-item-recipe', menuItemId),
  saveMenuRecipe: (menuItemId, ingredients) => ipcRenderer.invoke('db:save-menu-recipe', menuItemId, ingredients),
  getRecipeCost: (menuItemId) => ipcRenderer.invoke('db:get-recipe-cost', menuItemId),

  // Sync Engine APIs
  getSyncStatus: () => ipcRenderer.invoke('sync:get-status'),
  triggerSync: () => ipcRenderer.invoke('sync:trigger-now'),
  onSyncStatusUpdate: (callback) => {
    const listener = (event, status) => callback(status);
    ipcRenderer.on('sync:status-update', listener);
    return () => ipcRenderer.removeListener('sync:status-update', listener);
  },
  
  // Manager Dashboard cloud bypass APIs
  getManagerOrders: () => ipcRenderer.invoke('db:get-manager-orders'),
  getManagerCustomers: () => ipcRenderer.invoke('db:get-manager-customers')
});
