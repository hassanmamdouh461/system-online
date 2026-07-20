const dns = require('dns');
dns.setServers(['8.8.8.8', '1.1.1.1']);

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const db = require('./database.cjs');
const SyncEngine = require('./syncEngine.cjs');
const orderRepository = require('./OrderRepository.cjs');
const menuRepository = require('./MenuRepository.cjs');
const customerRepository = require('./CustomerRepository.cjs');
const inventoryRepository = require('./InventoryRepository.cjs');
const mockApi = require('./mockApiService.cjs');
const telegramService = require('./telegramService.cjs');

let mainWindow;
let syncEngine;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false, // Prevent white flash on startup
    backgroundColor: '#111827', // Match the application dark background
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  const isDev = !app.isPackaged;

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // Show window only when content is ready to paint to prevent white flash
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', function () {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  // Initialize the local SQLite database on startup
  db.initDatabase();

  // Initialize the Sync Engine background worker
  syncEngine = new SyncEngine(db, (status) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('sync:status-update', status);
    }
  });

  // Register IPC handlers for renderer database requests
  ipcMain.handle('db:get-menu', () => menuRepository.getMenu());
  ipcMain.handle('db:create-menu-item', (event, item) => menuRepository.createMenuItem(item));
  ipcMain.handle('db:update-menu-item', (event, id, data) => menuRepository.updateMenuItem(id, data));
  ipcMain.handle('db:delete-menu-item', (event, id) => menuRepository.deleteMenuItem(id));
  ipcMain.handle('db:reset-menu', (event, defaults) => menuRepository.resetMenu(defaults));

  ipcMain.handle('db:get-orders', () => orderRepository.getOrders());
  ipcMain.handle('db:create-order', (event, order) => orderRepository.createOrder(order));
  ipcMain.handle('db:update-order-status', (event, id, status) => orderRepository.updateOrderStatus(id, status));
  ipcMain.handle('db:complete-order-payment', (event, id, method) => orderRepository.completeOrderPayment(id, method));
  ipcMain.handle('db:update-order', (event, id, data) => orderRepository.updateOrder(id, data));
  ipcMain.handle('db:delete-order', (event, id) => orderRepository.deleteOrder(id));
  ipcMain.handle('db:reset-orders', (event, defaults) => orderRepository.resetOrders(defaults));

  ipcMain.handle('db:get-customers', () => customerRepository.getCustomers());
  ipcMain.handle('db:get-customer-by-phone', (event, phone) => customerRepository.getCustomerByPhone(phone));
  ipcMain.handle('db:save-customer', (event, customer) => customerRepository.saveCustomer(customer));
  ipcMain.handle('db:delete-customer', (event, id) => customerRepository.deleteCustomer(id));
  
  // Manager Dashboard cloud fetch handlers
  ipcMain.handle('db:get-manager-orders', () => mockApi.getManagerOrders());
  ipcMain.handle('db:get-manager-customers', () => mockApi.getManagerCustomers());

  ipcMain.handle('db:get-settings', () => db.getSettings());
  ipcMain.handle('db:save-setting', (event, key, value) => db.saveSetting(key, value));
  ipcMain.handle('db:delete-setting', (event, key) => db.deleteSetting(key));

  // Inventory & Recipe handlers
  ipcMain.handle('db:get-inventory', (event, branchId) => inventoryRepository.getInventory(branchId));
  ipcMain.handle('db:create-inventory-item', (event, item) => inventoryRepository.createInventoryItem(item));
  ipcMain.handle('db:update-inventory-item', (event, id, data) => inventoryRepository.updateInventoryItem(id, data));
  ipcMain.handle('db:delete-inventory-item', (event, id) => inventoryRepository.deleteInventoryItem(id));
  
  ipcMain.handle('db:get-inventory-transactions', (event, itemId, branchId) => inventoryRepository.getInventoryTransactions(itemId, branchId));
  ipcMain.handle('db:create-inventory-transaction', (event, tx) => inventoryRepository.createInventoryTransaction(tx));
  
  ipcMain.handle('db:get-menu-recipes', () => inventoryRepository.getMenuRecipes());
  ipcMain.handle('db:get-menu-item-recipe', (event, menuItemId) => inventoryRepository.getMenuItemRecipe(menuItemId));
  ipcMain.handle('db:save-menu-recipe', (event, menuItemId, ingredients) => inventoryRepository.saveMenuRecipe(menuItemId, ingredients));
  ipcMain.handle('db:get-recipe-cost', (event, menuItemId) => inventoryRepository.getRecipeCost(menuItemId));

  // Sync IPC Handlers
  ipcMain.handle('sync:get-status', () => syncEngine.getStatus());
  ipcMain.handle('sync:trigger-now', () => syncEngine.syncNow());

  // Telegram IPC Handlers
  ipcMain.handle('db:get-daily-report-stats', () => orderRepository.getDailyReportStats());
  ipcMain.handle('telegram:send-daily-report', () => telegramService.sendDailyReport());

  createWindow();

  // Start background syncing loop after window creation
  syncEngine.start();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  if (syncEngine) {
    syncEngine.stop();
  }
});
