import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Package, History, Plus, Search, Trash2, Edit2, 
  Scale, AlertTriangle, CheckCircle2, ArrowUpRight, 
  ArrowDownRight, RefreshCw, X, HelpCircle, TrendingUp
} from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { inventoryService } from '../services/inventoryService';
import { menuService } from '../services/menuService';
import { InventoryItem, InventoryTransaction, RecipeIngredient } from '../global';
import { MenuItem } from '../types/menu';

export default function Inventory() {
  const { t, isRtl } = useLanguage();
  const [activeTab, setActiveTab] = useState<'stock' | 'history'>('stock');
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [transactions, setTransactions] = useState<InventoryTransaction[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [recipes, setRecipes] = useState<RecipeIngredient[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Modals state
  const [isItemModalOpen, setIsItemModalOpen] = useState(false);
  const [isAdjustModalOpen, setIsAdjustModalOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);
  
  // Forms state
  const [itemForm, setItemForm] = useState({
    name: '',
    unit: 'kg',
    stock: '0',
    minStock: '1',
    costPerUnit: '0'
  });
  
  const [adjustForm, setAdjustForm] = useState({
    quantity: '',
    type: 'IN' as 'IN' | 'OUT' | 'ADJUST',
    notes: ''
  });

  const fetchData = async () => {
    setLoading(true);
    try {
      const [invData, txData, menuData, recipeData] = await Promise.all([
        inventoryService.getAll(),
        inventoryService.getTransactions(),
        menuService.getAll().catch(() => []),
        inventoryService.getMenuRecipes().catch(() => [])
      ]);
      setInventory(invData);
      setTransactions(txData);
      setMenuItems(menuData);
      setRecipes(recipeData);
    } catch (error) {
      console.error('Failed to load inventory data:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // 100% Dynamic & Automatic proportional F&B cost-weighted revenue yield calculation for ALL inventory items
  const itemYields = useMemo(() => {
    const yields: Record<string, number> = {};

    // 1. Build lookup maps of all inventory items
    const invMapById = new Map<string, InventoryItem>();
    inventory.forEach(item => {
      invMapById.set(item.id, item);
    });

    // Helper to find matching inventory item for any recipe ingredient
    const resolveInvItem = (inventoryItemId: string): InventoryItem | undefined => {
      if (invMapById.has(inventoryItemId)) {
        return invMapById.get(inventoryItemId);
      }
      // Fallback matching by canonical seed ID mapping (inv_b_1 .. inv_b_24)
      if (inventoryItemId.startsWith('inv_b_')) {
        const num = parseInt(inventoryItemId.replace('inv_b_', ''), 10);
        if (!isNaN(num) && num > 0 && num <= inventory.length) {
          return inventory[num - 1];
        }
      }
      return undefined;
    };

    // 2. Map unit costs for each inventory item
    const getUnitCost = (invItemId: string): number => {
      const found = resolveInvItem(invItemId);
      return found?.costPerUnit && found.costPerUnit > 0 ? found.costPerUnit : 1;
    };

    // 3. Group recipes by menuItemId
    const menuRecipeMap: Record<string, RecipeIngredient[]> = {};
    recipes.forEach(r => {
      if (r.menuItemId) {
        if (!menuRecipeMap[r.menuItemId]) menuRecipeMap[r.menuItemId] = [];
        menuRecipeMap[r.menuItemId].push(r);
      }
    });

    // 4. Map menu items by String(id)
    const menuMap = new Map(menuItems.map(m => [String(m.id), m]));

    // 5. Compute total recipe cost for every menu item
    const menuTotalCostMap = new Map<string, number>();
    Object.entries(menuRecipeMap).forEach(([mId, ingList]) => {
      const totalCost = ingList.reduce((sum, ing) => {
        const cost = getUnitCost(ing.inventoryItemId);
        return sum + (ing.quantity * cost);
      }, 0);
      menuTotalCostMap.set(mId, totalCost > 0 ? totalCost : 1);
    });

    // 6. Map recipe entries to target inventory items
    const invRecipesMap = new Map<string, { menuItemId: string; quantity: number }[]>();

    recipes.forEach(r => {
      const invItem = resolveInvItem(r.inventoryItemId);
      const targetId = invItem ? invItem.id : r.inventoryItemId;

      if (!invRecipesMap.has(targetId)) {
        invRecipesMap.set(targetId, []);
      }
      invRecipesMap.get(targetId)!.push({
        menuItemId: String(r.menuItemId),
        quantity: r.quantity
      });
    });

    // 7. Dynamically calculate expected unit revenue yield for EVERY inventory item automatically
    inventory.forEach(item => {
      const itemRecipes = invRecipesMap.get(item.id) || [];
      const itemUnitCost = item.costPerUnit && item.costPerUnit > 0 ? item.costPerUnit : 1;

      if (itemRecipes.length === 0) {
        // Default standard 2.5x margin multiplier for newly created unlinked raw materials
        yields[item.id] = itemUnitCost * 2.5;
        return;
      }

      let totalUnitYield = 0;
      let validCount = 0;

      itemRecipes.forEach(rec => {
        const menuItem = menuMap.get(String(rec.menuItemId));
        const totalRecipeCost = menuTotalCostMap.get(String(rec.menuItemId)) || 1;
        if (menuItem && rec.quantity > 0) {
          const itemCostInRecipe = rec.quantity * itemUnitCost;
          const costShareFraction = itemCostInRecipe / totalRecipeCost;
          const allocatedRevenue = costShareFraction * menuItem.price;
          const unitYield = allocatedRevenue / rec.quantity;
          totalUnitYield += unitYield;
          validCount++;
        }
      });

      if (validCount > 0) {
        yields[item.id] = totalUnitYield / validCount;
      } else {
        yields[item.id] = itemUnitCost * 2.5;
      }
    });

    return yields;
  }, [inventory, recipes, menuItems]);

  // Filtered Stock list
  const filteredStock = useMemo(() => {
    return inventory.filter(item => {
      const matchesSearch = item.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                            t(item.name).toLowerCase().includes(searchQuery.toLowerCase());
      return matchesSearch;
    });
  }, [inventory, searchQuery, t]);

  // Filtered Transaction history
  const filteredTransactions = useMemo(() => {
    return transactions.filter(tx => {
      const itemName = tx.itemName || '';
      const matchesSearch = itemName.toLowerCase().includes(searchQuery.toLowerCase()) || 
                            t(itemName).toLowerCase().includes(searchQuery.toLowerCase()) ||
                            (tx.referenceId && tx.referenceId.toLowerCase().includes(searchQuery.toLowerCase())) ||
                            (tx.notes && tx.notes.toLowerCase().includes(searchQuery.toLowerCase()));
      return matchesSearch;
    });
  }, [transactions, searchQuery, t]);

  // Total Inventory Cost Value
  const totalValue = useMemo(() => {
    return inventory.reduce((sum, item) => sum + (item.stock * item.costPerUnit), 0);
  }, [inventory]);

  // Low stock warning count
  const lowStockCount = useMemo(() => {
    return inventory.filter(item => item.stock <= item.minStock).length;
  }, [inventory]);

  // Total Potential Profit
  const totalPotentialProfit = useMemo(() => {
    return inventory.reduce((sum, item) => {
      const avgYield = itemYields[item.id] || 0;
      const potSales = item.stock * avgYield;
      const potProfit = potSales > 0 ? Math.max(potSales - (item.stock * item.costPerUnit), 0) : 0;
      return sum + potProfit;
    }, 0);
  }, [inventory, itemYields]);

  const handleOpenItemModal = (item?: InventoryItem) => {
    if (item) {
      setSelectedItem(item);
      setItemForm({
        name: item.name,
        unit: item.unit,
        stock: item.stock.toString(),
        minStock: item.minStock.toString(),
        costPerUnit: item.costPerUnit.toString()
      });
    } else {
      setSelectedItem(null);
      setItemForm({
        name: '',
        unit: 'kg',
        stock: '0',
        minStock: '1',
        costPerUnit: '0'
      });
    }
    setIsItemModalOpen(true);
  };

  const handleSaveItem = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const data = {
        name: itemForm.name,
        unit: itemForm.unit,
        stock: parseFloat(itemForm.stock),
        minStock: parseFloat(itemForm.minStock),
        costPerUnit: parseFloat(itemForm.costPerUnit)
      };

      if (selectedItem) {
        await inventoryService.update(selectedItem.id, data);
      } else {
        await inventoryService.create(data);
      }
      setIsItemModalOpen(false);
      fetchData();
    } catch (error) {
      alert(t('Failed to save stock item'));
    }
  };

  const handleOpenAdjustModal = (item: InventoryItem) => {
    setSelectedItem(item);
    setAdjustForm({
      quantity: '',
      type: 'IN',
      notes: ''
    });
    setIsAdjustModalOpen(true);
  };

  const handleSaveAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedItem) return;
    try {
      const qty = parseFloat(adjustForm.quantity);
      if (isNaN(qty) || qty <= 0) {
        alert(t('Please enter a valid quantity greater than 0'));
        return;
      }

      await inventoryService.createTransaction({
        itemId: selectedItem.id,
        itemName: selectedItem.name,
        type: adjustForm.type,
        quantity: qty,
        unit: selectedItem.unit,
        notes: adjustForm.notes,
        referenceId: 'MANUAL'
      });
      setIsAdjustModalOpen(false);
      fetchData();
    } catch (error) {
      alert(t('Failed to adjust stock level'));
    }
  };

  const handleDeleteItem = async (id: string) => {
    if (confirm(t('Are you sure you want to delete this item? This will also remove its history and recipes mapping.'))) {
      try {
        await inventoryService.delete(id);
        fetchData();
      } catch (error) {
        alert(t('Failed to delete item'));
      }
    }
  };

  return (
    <div className="space-y-4 md:space-y-6 text-gray-900">
      
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-lg md:text-2xl font-bold text-gray-900">{t('Inventory Management')}</h1>
          <p className="text-xs md:text-sm text-gray-500">{t('Manage raw materials, stock levels, and recipes.')}</p>
        </div>
        <div className="flex gap-2">
          <button 
            onClick={fetchData}
            className="p-2.5 rounded-xl border border-gray-200 hover:bg-gray-50 text-gray-700 bg-white active:scale-95 transition-all shadow-sm"
            title={t('Refresh')}
          >
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
          </button>
          <button 
            onClick={() => handleOpenItemModal()}
            className="bg-mocha-700 hover:bg-mocha-800 text-white px-4 py-2.5 rounded-xl font-semibold flex items-center justify-center gap-2 shadow-lg shadow-mocha-500/20 transition-all active:scale-95 text-sm"
          >
            <Plus size={16} />
            {t('Add Stock Item')}
          </button>
        </div>
      </div>

      {/* ── Stats Row ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 tablet:grid-cols-4 lg:grid-cols-4 gap-4">
        <div className="bg-white/95 border border-gray-100 rounded-2xl p-5 shadow-sm flex items-center gap-4">
          <div className="bg-amber-50 text-amber-600 p-3 rounded-xl">
            <Package size={24} />
          </div>
          <div>
            <p className="text-xs text-gray-400 font-semibold">{t('TOTAL ITEMS')}</p>
            <p className="text-xl md:text-2xl font-bold text-gray-800">{inventory.length}</p>
          </div>
        </div>

        <div className="bg-white/95 border border-gray-100 rounded-2xl p-5 shadow-sm flex items-center gap-4">
          <div className={`p-3 rounded-xl ${lowStockCount > 0 ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'}`}>
            <AlertTriangle size={24} />
          </div>
          <div>
            <p className="text-xs text-gray-400 font-semibold">{t('LOW STOCK WARNINGS')}</p>
            <p className={`text-xl md:text-2xl font-bold ${lowStockCount > 0 ? 'text-red-600' : 'text-green-600'}`}>
              {lowStockCount}
            </p>
          </div>
        </div>

        <div className="bg-white/95 border border-gray-100 rounded-2xl p-5 shadow-sm flex items-center gap-4">
          <div className="bg-blue-50 text-blue-600 p-3 rounded-xl">
            <Scale size={24} />
          </div>
          <div>
            <p className="text-xs text-gray-400 font-semibold">{t('TOTAL VALUE (EST)')}</p>
            <p className="text-xl md:text-2xl font-bold text-gray-800">
              EGP {totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
          </div>
        </div>

        <div className="bg-white/95 border border-gray-100 rounded-2xl p-5 shadow-sm flex items-center gap-4">
          <div className="bg-emerald-50 text-emerald-600 p-3 rounded-xl">
            <TrendingUp size={24} />
          </div>
          <div>
            <p className="text-xs text-gray-400 font-semibold">{t('TOTAL EXPECTED PROFIT')}</p>
            <p className="text-xl md:text-2xl font-bold text-emerald-600">
              EGP {totalPotentialProfit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
          </div>
        </div>
      </div>

      {/* ── Tabs & Search Bar ─────────────────────────────────────────────── */}
      <div className="bg-white p-3 rounded-2xl shadow-sm border border-gray-100 flex flex-col md:flex-row md:items-center justify-between gap-3 sticky top-0 z-10">
        <div className="flex gap-1.5 bg-gray-100/80 p-1 rounded-xl w-fit">
          <button
            onClick={() => setActiveTab('stock')}
            className={`px-4 py-2 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors flex items-center gap-1.5 ${
              activeTab === 'stock'
                ? 'bg-white text-mocha-800 shadow-sm'
                : 'text-gray-500 hover:text-gray-900'
            }`}
          >
            <Package size={14} />
            {t('Stock Levels')}
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`px-4 py-2 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors flex items-center gap-1.5 ${
              activeTab === 'history'
                ? 'bg-white text-mocha-800 shadow-sm'
                : 'text-gray-500 hover:text-gray-900'
            }`}
          >
            <History size={14} />
            {t('Transaction History')}
          </button>
        </div>

        <div className="relative flex-1 max-w-md">
          <Search className={`absolute top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4 ${isRtl ? 'right-3' : 'left-3'}`} />
          <input
            type="text"
            placeholder={activeTab === 'stock' ? t('Search stock items...') : t('Search history logs...')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={`w-full py-2 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-caramel focus:border-transparent text-sm ${isRtl ? 'pr-9 pl-4' : 'pl-9 pr-4'}`}
          />
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center h-64 bg-white/50 backdrop-blur-sm rounded-2xl border border-gray-100">
          <RefreshCw className="animate-spin text-mocha-600 mb-2 w-8 h-8" />
          <span className="text-sm text-gray-500">{t('Loading inventory...')}</span>
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          {activeTab === 'stock' ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100 text-gray-500 font-semibold">
                    <th className="p-4">{t('Item Name')}</th>
                    <th className="p-4 text-center">{t('Unit')}</th>
                    <th className="p-4 text-center">{t('Current Stock')}</th>
                    <th className="p-4 text-center">{t('Min Stock Warning')}</th>
                    <th className="p-4 text-center">{t('Cost Per Unit')}</th>
                    <th className="p-4 text-center">{t('Estimated Cost')}</th>
                    <th className="p-4 text-center">{t('Potential Sales')}</th>
                    <th className="p-4 text-center">{t('Potential Profit')}</th>
                    <th className="p-4 text-right">{t('Action')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredStock.map((item) => {
                    const isLow = item.stock <= item.minStock;
                    const avgYield = itemYields[item.id] || 0;
                    const potSales = item.stock * avgYield;
                    const potProfit = potSales > 0 ? Math.max(potSales - (item.stock * item.costPerUnit), 0) : 0;
                    
                    return (
                      <tr key={item.id} className="hover:bg-gray-50/50 transition-colors">
                        <td className="p-4 font-semibold text-gray-900">{t(item.name)}</td>
                        <td className="p-4 text-center text-gray-500 font-medium">{t(item.unit)}</td>
                        <td className={`p-4 text-center font-bold ${isLow ? 'text-red-600 bg-red-50/30 rounded-lg' : 'text-gray-800'}`}>
                          {item.stock.toFixed(2)}
                          {isLow && <span className="block text-[10px] text-red-500 font-semibold">{t('Low Stock')}</span>}
                        </td>
                        <td className="p-4 text-center text-gray-500">{item.minStock.toFixed(2)}</td>
                        <td className="p-4 text-center font-medium text-gray-700">EGP {item.costPerUnit.toFixed(2)}</td>
                        <td className="p-4 text-center font-bold text-gray-800">
                          EGP {(item.stock * item.costPerUnit).toFixed(2)}
                        </td>
                        <td className="p-4 text-center font-bold text-emerald-600">
                          EGP {potSales.toFixed(2)}
                        </td>
                        <td className="p-4 text-center font-bold text-sky-600">
                          EGP {potProfit.toFixed(2)}
                        </td>
                        <td className="p-4 text-right">
                          <div className="flex justify-end items-center gap-1.5">
                            <button
                              onClick={() => handleOpenAdjustModal(item)}
                              className="px-3 py-1.5 bg-mocha-50 text-mocha-700 rounded-lg text-xs font-semibold hover:bg-mocha-100 transition-colors"
                            >
                              {t('Adjust Stock')}
                            </button>
                            <button
                              onClick={() => handleOpenItemModal(item)}
                              className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                              title={t('Edit')}
                            >
                              <Edit2 size={15} />
                            </button>
                            <button
                              onClick={() => handleDeleteItem(item.id)}
                              className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                              title={t('Delete')}
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {filteredStock.length === 0 && (
                    <tr>
                      <td colSpan={9} className="p-8 text-center text-gray-400">
                        {t('No stock items found')}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100 text-gray-500 font-semibold">
                    <th className="p-4">{t('Date & Time')}</th>
                    <th className="p-4">{t('Item Name')}</th>
                    <th className="p-4 text-center">{t('Transaction Type')}</th>
                    <th className="p-4 text-center">{t('Quantity')}</th>
                    <th className="p-4 text-center">{t('Reference')}</th>
                    <th className="p-4">{t('Notes')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredTransactions.map((tx) => {
                    const isIncoming = tx.type === 'IN';
                    const isOutgoing = tx.type === 'OUT';
                    return (
                      <tr key={tx.id} className="hover:bg-gray-50/50 transition-colors">
                        <td className="p-4 text-gray-500 whitespace-nowrap">
                          {new Date(tx.createdAt).toLocaleString()}
                        </td>
                        <td className="p-4 font-semibold text-gray-900">{t(tx.itemName || '')}</td>
                        <td className="p-4 text-center">
                          {isIncoming && (
                            <span className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full font-semibold bg-green-50 text-green-600 border border-green-100">
                              <ArrowUpRight size={12} />
                              {t('Incoming (Stock In)')}
                            </span>
                          )}
                          {isOutgoing && (
                            <span className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full font-semibold bg-orange-50 text-orange-600 border border-orange-100">
                              <ArrowDownRight size={12} />
                              {t('Outgoing (Order/Sold)')}
                            </span>
                          )}
                          {!isIncoming && !isOutgoing && (
                            <span className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full font-semibold bg-blue-50 text-blue-600 border border-blue-100">
                              <Scale size={12} />
                              {t('Adjusted (Stock Count)')}
                            </span>
                          )}
                        </td>
                        <td className="p-4 text-center font-bold text-gray-800">
                          {isOutgoing ? '-' : '+'}{tx.quantity.toFixed(2)} {t(tx.itemUnit || '')}
                        </td>
                        <td className="p-4 text-center font-mono text-xs text-gray-500">
                          {tx.referenceId}
                        </td>
                        <td className="p-4 text-gray-600 max-w-xs truncate" title={tx.notes}>
                          {tx.notes || '-'}
                        </td>
                      </tr>
                    );
                  })}
                  {filteredTransactions.length === 0 && (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-gray-400">
                        {t('No transactions logged yet')}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── MODAL: Create/Edit Stock Item ─────────────────────────────────── */}
      {isItemModalOpen && createPortal(
        <AnimatePresence>
          <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsItemModalOpen(false)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white rounded-2xl w-full max-w-md tablet:max-w-xl shadow-xl relative z-10 overflow-hidden"
            >
              <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                <h2 className="text-lg font-bold text-gray-900">
                  {selectedItem ? t('Edit Stock Item') : t('Add Stock Item')}
                </h2>
                <button 
                  onClick={() => setIsItemModalOpen(false)}
                  className="p-2 hover:bg-gray-100 rounded-full transition-colors text-gray-500"
                >
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={handleSaveItem} className="p-6 space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">{t('Item Name')}</label>
                  <input
                    type="text"
                    required
                    value={itemForm.name}
                    onChange={(e) => setItemForm({ ...itemForm, name: e.target.value })}
                    className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-caramel focus:border-transparent transition-all"
                    placeholder="e.g. Espresso Beans"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">{t('Unit')}</label>
                    <select
                      value={itemForm.unit}
                      onChange={(e) => setItemForm({ ...itemForm, unit: e.target.value })}
                      className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-caramel focus:border-transparent transition-all bg-white"
                    >
                      <option value="kg">{t('kg')}</option>
                      <option value="g">{t('g')}</option>
                      <option value="liter">{t('liter')}</option>
                      <option value="ml">{t('ml')}</option>
                      <option value="piece">{t('piece')}</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">{t('Cost Per Unit')}</label>
                    <input
                      type="number"
                      step="0.01"
                      required
                      value={itemForm.costPerUnit}
                      onChange={(e) => setItemForm({ ...itemForm, costPerUnit: e.target.value })}
                      className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-caramel focus:border-transparent transition-all"
                      placeholder="0.00"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">{t('Current Stock')}</label>
                    <input
                      type="number"
                      step="0.001"
                      required
                      disabled={!!selectedItem} // Stock should be modified via adjustments for logged history
                      value={itemForm.stock}
                      onChange={(e) => setItemForm({ ...itemForm, stock: e.target.value })}
                      className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-caramel focus:border-transparent transition-all disabled:bg-gray-50 disabled:text-gray-400"
                      placeholder="0.0"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">{t('Min Stock Warning')}</label>
                    <input
                      type="number"
                      step="0.01"
                      required
                      value={itemForm.minStock}
                      onChange={(e) => setItemForm({ ...itemForm, minStock: e.target.value })}
                      className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-caramel focus:border-transparent transition-all"
                      placeholder="1.00"
                    />
                  </div>
                </div>

                <div className="flex gap-3 pt-4 border-t border-gray-100">
                  <button
                    type="button"
                    onClick={() => setIsItemModalOpen(false)}
                    className="flex-1 px-4 py-2 rounded-xl border border-gray-200 text-gray-700 font-medium hover:bg-gray-50 transition-colors"
                  >
                    {t('Cancel')}
                  </button>
                  <button
                    type="submit"
                    className="flex-1 px-4 py-2 rounded-xl bg-mocha-700 text-white font-medium hover:bg-mocha-800 shadow-lg shadow-mocha-500/20 transition-colors"
                  >
                    {t('Save Changes')}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        </AnimatePresence>,
        document.body
      )}

      {/* ── MODAL: Adjust Stock Level ────────────────────────────────────── */}
      {isAdjustModalOpen && selectedItem && createPortal(
        <AnimatePresence>
          <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsAdjustModalOpen(false)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 0 }}
              className="bg-white rounded-2xl w-full max-w-md tablet:max-w-xl shadow-xl relative z-10 overflow-hidden"
            >
              <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                <div className="flex flex-col">
                  <h2 className="text-lg font-bold text-gray-900">{t('Adjust Stock Level')}</h2>
                  <p className="text-xs text-gray-400 font-medium">{t(selectedItem.name)} ({selectedItem.stock.toFixed(2)} {selectedItem.unit})</p>
                </div>
                <button 
                  onClick={() => setIsAdjustModalOpen(false)}
                  className="p-2 hover:bg-gray-100 rounded-full transition-colors text-gray-500"
                >
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={handleSaveAdjustment} className="p-6 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">{t('Transaction Type')}</label>
                    <select
                      value={adjustForm.type}
                      onChange={(e) => setAdjustForm({ ...adjustForm, type: e.target.value as 'IN' | 'OUT' | 'ADJUST' })}
                      className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-caramel focus:border-transparent transition-all bg-white"
                    >
                      <option value="IN">{t('Incoming (Stock In)')}</option>
                      <option value="OUT">{t('Outgoing (Order/Sold)')}</option>
                      <option value="ADJUST">{t('Adjusted (Stock Count)')}</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">
                      {t('Quantity')} ({selectedItem.unit})
                    </label>
                    <input
                      type="number"
                      step="0.001"
                      required
                      value={adjustForm.quantity}
                      onChange={(e) => setAdjustForm({ ...adjustForm, quantity: e.target.value })}
                      className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-caramel focus:border-transparent transition-all"
                      placeholder="0.00"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">{t('Notes')}</label>
                  <textarea
                    rows={3}
                    value={adjustForm.notes}
                    onChange={(e) => setAdjustForm({ ...adjustForm, notes: e.target.value })}
                    className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-caramel focus:border-transparent transition-all resize-none"
                    placeholder={t('e.g. Weekly inventory audit / purchase invoice #124')}
                  />
                </div>

                {/* Real-time Potential Selling & Profit calculation card */}
                {(() => {
                  const qtyVal = parseFloat(adjustForm.quantity) || 0;
                  const itemCost = selectedItem.costPerUnit;
                  const itemYield = itemYields[selectedItem.id] || 0;

                  const totalTxCost = qtyVal * itemCost;
                  const totalTxSales = qtyVal * itemYield;
                  const totalTxProfit = totalTxSales > 0 ? Math.max(totalTxSales - totalTxCost, 0) : 0;

                  if (qtyVal <= 0) return null;

                  if (adjustForm.type === 'OUT') {
                    return (
                      <div className="bg-orange-50/50 border border-orange-100 p-4 rounded-xl space-y-2 text-xs">
                        <div className="flex justify-between font-bold text-gray-700">
                          <span>{t('Total Cost Value')}:</span>
                          <span>EGP {totalTxCost.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between font-bold text-orange-700">
                          <span>{t('Potential Value Loss')}:</span>
                          <span>EGP {totalTxSales.toFixed(2)}</span>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div className="bg-emerald-50/50 border border-emerald-100 p-4 rounded-xl space-y-2 text-xs">
                      <div className="flex justify-between font-bold text-gray-700">
                        <span>{t('Total Cost Value')}:</span>
                        <span>EGP {totalTxCost.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between font-bold text-emerald-700">
                        <span>{t('Potential Selling Value')}:</span>
                        <span>EGP {totalTxSales.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between font-bold text-sky-700">
                        <span>{t('Expected Potential Profit')}:</span>
                        <span>EGP {totalTxProfit.toFixed(2)}</span>
                      </div>
                    </div>
                  );
                })()}

                <div className="flex gap-3 pt-4 border-t border-gray-100">
                  <button
                    type="button"
                    onClick={() => setIsAdjustModalOpen(false)}
                    className="flex-1 px-4 py-2 rounded-xl border border-gray-200 text-gray-700 font-medium hover:bg-gray-50 transition-colors"
                  >
                    {t('Cancel')}
                  </button>
                  <button
                    type="submit"
                    className="flex-1 px-4 py-2 rounded-xl bg-mocha-700 text-white font-medium hover:bg-mocha-800 shadow-lg shadow-mocha-500/20 transition-colors"
                  >
                    {t('Save Changes')}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        </AnimatePresence>,
        document.body
      )}
      
    </div>
  );
}
