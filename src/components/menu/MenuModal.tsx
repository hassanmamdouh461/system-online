import React, { useState, useEffect, useMemo } from 'react';
import { X, Plus, Trash2, Info } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { MenuItem } from '../../types/menu';
import { useLanguage } from '../../context/LanguageContext';
import { inventoryService } from '../../services/inventoryService';
import { InventoryItem } from '../../global';

interface MenuModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (item: Omit<MenuItem, 'id'> | MenuItem, recipeIngredients: any[]) => void;
  initialData?: MenuItem | null;
  existingItems: MenuItem[];
}

export function MenuModal({ isOpen, onClose, onSave, initialData, existingItems }: MenuModalProps) {
  const { t } = useLanguage();
  const [activeTab, setActiveTab] = useState<'general' | 'recipe'>('general');
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const [mappedIngredients, setMappedIngredients] = useState<Array<{ inventoryItemId: string; quantity: number }>>([]);
  const [loading, setLoading] = useState(false);

  const [showNewCategoryInput, setShowNewCategoryInput] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [preparation, setPreparation] = useState('Bar');

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    price: '',
    category: 'Hot Coffee', // Default category
    image: '',
    available: true,
  });

  const existingCategories = useMemo(() => {
    const unique = new Set<string>();
    unique.add('Hot Coffee');
    unique.add('Iced Coffee');
    unique.add('Frappe');
    unique.add('Milkshakes');
    
    if (existingItems) {
      existingItems.forEach(item => {
        if (item.category) {
          const menuCat = item.category.split('|')[0];
          if (menuCat && menuCat !== 'All' && menuCat !== 'Kitchen' && menuCat !== 'Bar') {
            unique.add(menuCat);
          }
        }
      });
    }
    return Array.from(unique);
  }, [existingItems]);

  useEffect(() => {
    const loadRecipeAndInventory = async () => {
      setLoading(true);
      try {
        const inv = await inventoryService.getAll();
        setInventoryItems(inv);

        if (initialData) {
          const recipe = await inventoryService.getMenuItemRecipe(initialData.id);
          setMappedIngredients(recipe.map(r => ({
            inventoryItemId: r.inventoryItemId,
            quantity: r.quantity
          })));
        } else {
          setMappedIngredients([]);
        }
      } catch (err) {
        console.error('Failed to load recipe/inventory items:', err);
      } finally {
        setLoading(false);
      }
    };
    
    if (isOpen) {
      loadRecipeAndInventory();
      setActiveTab('general');
    }
  }, [initialData, isOpen]);

  useEffect(() => {
    if (initialData) {
      const parts = initialData.category.split('|');
      const menuCat = parts[0];
      const prepArea = parts[1] || 'Bar';

      setFormData({
        name: initialData.name,
        description: initialData.description,
        price: initialData.price.toString(),
        category: menuCat,
        image: initialData.image || '',
        available: initialData.available,
      });
      setPreparation(prepArea);
      setShowNewCategoryInput(false);
      setNewCategoryName('');
    } else {
      setFormData({
        name: '',
        description: '',
        price: '',
        category: 'Hot Coffee',
        image: '',
        available: true,
      });
      setPreparation('Bar');
      setShowNewCategoryInput(false);
      setNewCategoryName('');
    }
  }, [initialData, isOpen]);

  const calculatedCost = useMemo(() => {
    return mappedIngredients.reduce((sum, ing) => {
      const invItem = inventoryItems.find(i => i.id === ing.inventoryItemId);
      return sum + (invItem ? invItem.costPerUnit * ing.quantity : 0);
    }, 0);
  }, [mappedIngredients, inventoryItems]);

  const marginStats = useMemo(() => {
    const price = parseFloat(formData.price) || 0;
    const profit = price - calculatedCost;
    const percentage = price > 0 ? (profit / price) * 100 : 0;
    return { profit, percentage };
  }, [formData.price, calculatedCost]);

  const addIngredientRow = () => {
    if (inventoryItems.length === 0) return;
    setMappedIngredients(prev => [...prev, { inventoryItemId: inventoryItems[0].id, quantity: 0 }]);
  };

  const updateIngredientRow = (index: number, itemId: string, qty: number) => {
    setMappedIngredients(prev => prev.map((item, i) => i === index ? { inventoryItemId: itemId, quantity: qty } : item));
  };

  const removeIngredientRow = (index: number) => {
    setMappedIngredients(prev => prev.filter((_, i) => i !== index));
  };

  const handleCategoryChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    if (val === 'CREATE_NEW') {
      setShowNewCategoryInput(true);
      setFormData(prev => ({ ...prev, category: '' }));
    } else {
      setShowNewCategoryInput(false);
      setFormData(prev => ({ ...prev, category: val }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const menuCategory = showNewCategoryInput ? newCategoryName.trim() : formData.category;
      if (!menuCategory) {
        alert(t('Category is required') || 'يرجى تحديد أو كتابة اسم القسم');
        return;
      }
      const finalCategory = `${menuCategory}|${preparation}`;

      const defaultImage = ['Hot Coffee', 'Iced Coffee', 'Frappe', 'Milkshakes', 'Bar'].includes(menuCategory)
        ? 'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=400'
        : 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400';
      const finalImage = defaultImage;

      const validIngredients = mappedIngredients.filter(ing => ing.quantity > 0);

      await onSave({
        ...formData,
        category: finalCategory,
        image: finalImage,
        price: parseFloat(formData.price),
        ...(initialData ? { id: initialData.id } : {}),
      } as MenuItem, validIngredients);
      
      onClose();
    } catch (err) {
      console.error('Failed to save menu item:', err);
      alert(t('Failed to save item. Please try again.'));
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        />
        
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="bg-white rounded-2xl w-full max-w-lg shadow-xl relative z-10 overflow-hidden"
        >
          <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
            <h2 className="text-xl font-bold text-gray-900">
              {initialData ? t('Edit Item') : t('Add New Item')}
            </h2>
            <button 
              onClick={onClose}
              className="p-2 hover:bg-gray-100 rounded-full transition-colors text-gray-500"
            >
              <X size={20} />
            </button>
          </div>

          <div className="flex border-b border-gray-100 bg-gray-50/20">
            <button
              type="button"
              onClick={() => setActiveTab('general')}
              className={`flex-1 py-3 text-center text-sm font-semibold border-b-2 transition-all ${
                activeTab === 'general'
                  ? 'border-mocha-700 text-mocha-800 bg-white'
                  : 'border-transparent text-gray-500 hover:text-gray-900 hover:bg-gray-50/30'
              }`}
            >
              {t('Item Details')}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('recipe')}
              className={`flex-1 py-3 text-center text-sm font-semibold border-b-2 transition-all ${
                activeTab === 'recipe'
                  ? 'border-mocha-700 text-mocha-800 bg-white'
                  : 'border-transparent text-gray-500 hover:text-gray-900 hover:bg-gray-50/30'
              }`}
            >
              {t('Ingredients & Recipe')}
            </button>
          </div>

          <form onSubmit={handleSubmit} className="p-6 flex flex-col">
            <div className="space-y-4">
              {activeTab === 'general' ? (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{t('Item Name')}</label>
                    <input
                      type="text"
                      required
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-caramel focus:border-transparent transition-all"
                      placeholder={t('e.g. Spanish Latte')}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{t('Description')}</label>
                    <textarea
                      rows={3}
                      value={formData.description}
                      onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                      className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-caramel focus:border-transparent transition-all resize-none"
                      placeholder={t('Brief description of the item...')}
                    />
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">{t('Price') || 'السعر'}</label>
                      <input
                        type="number"
                        step="0.01"
                        required
                        value={formData.price}
                        onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                        className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-caramel focus:border-transparent transition-all text-sm"
                        placeholder="0.00"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">{t('Category') || 'قسم المنيو'}</label>
                      <select
                        value={showNewCategoryInput ? 'CREATE_NEW' : formData.category}
                        onChange={handleCategoryChange}
                        className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-caramel focus:border-transparent transition-all bg-white text-sm"
                      >
                        {existingCategories.map(category => (
                          <option key={category} value={category}>{t(category) || category}</option>
                        ))}
                        <option value="CREATE_NEW">{t('Add new category...') || '+ إضافة قسم جديد...'}</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">{t('Preparation Destination') || 'مكان التحضير (الكاشير)'}</label>
                      <select
                        value={preparation}
                        onChange={(e) => setPreparation(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-caramel focus:border-transparent transition-all bg-white text-sm font-bold text-mocha-800"
                      >
                        <option value="Bar">بار (Bar)</option>
                        <option value="Kitchen">مطبخ (Kitchen)</option>
                      </select>
                    </div>
                  </div>

                  {showNewCategoryInput && (
                    <div className="animate-fadeIn">
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        {t('New Category Name') || 'اسم القسم الجديد'}
                      </label>
                      <input
                        type="text"
                        required
                        placeholder={t('e.g. Tea, Desserts') || 'مثال: شاي، حلويات'}
                        value={newCategoryName}
                        onChange={(e) => {
                          setNewCategoryName(e.target.value);
                          setFormData(prev => ({ ...prev, category: e.target.value }));
                        }}
                        className="w-full px-4 py-2 rounded-xl border border-mocha-300 focus:outline-none focus:ring-2 focus:ring-caramel focus:border-transparent transition-all bg-white text-sm font-bold"
                      />
                    </div>
                  )}
                </>
              ) : (
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-gray-400 font-semibold uppercase">{t('Recipe Ingredients')}</span>
                    <button
                      type="button"
                      onClick={addIngredientRow}
                      className="text-xs text-mocha-700 hover:text-mocha-800 font-bold flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-mocha-50 hover:bg-mocha-100 transition-colors"
                    >
                      <Plus size={14} />
                      {t('Add Ingredient')}
                    </button>
                  </div>

                  {mappedIngredients.length === 0 ? (
                    <div className="text-center py-8 text-gray-400 bg-gray-50 rounded-xl border border-dashed border-gray-200 p-4">
                      <Info size={24} className="mx-auto mb-2 text-gray-300" />
                      <p className="text-xs leading-relaxed">
                        {t('No ingredients mapped yet. Add ingredients below to calculate costs.')}
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
                      {mappedIngredients.map((ing, idx) => {
                        const currentInvItem = inventoryItems.find(i => i.id === ing.inventoryItemId);
                        return (
                          <div key={idx} className="flex gap-2 items-center bg-gray-50 p-2 rounded-xl border border-gray-100">
                            <select
                               value={ing.inventoryItemId}
                               onChange={(e) => updateIngredientRow(idx, e.target.value, ing.quantity)}
                               className="flex-1 px-3 py-1.5 rounded-lg border border-gray-200 text-xs focus:outline-none bg-white font-medium"
                            >
                              {inventoryItems.map(item => (
                                <option key={item.id} value={item.id}>{t(item.name) || item.name}</option>
                              ))}
                            </select>

                            <div className="flex items-center gap-1.5 w-24">
                              <input
                                type="number"
                                step="0.001"
                                required
                                value={ing.quantity || ''}
                                onChange={(e) => updateIngredientRow(idx, ing.inventoryItemId, parseFloat(e.target.value) || 0)}
                                className="w-full px-2 py-1.5 rounded-lg border border-gray-200 text-xs focus:outline-none text-center font-bold"
                                placeholder="0"
                              />
                              <span className="text-[10px] text-gray-400 font-semibold whitespace-nowrap">
                                {currentInvItem ? t(currentInvItem.unit) : ''}
                              </span>
                            </div>

                            <button
                              type="button"
                              onClick={() => removeIngredientRow(idx)}
                              className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <div className="bg-mocha-50/50 rounded-xl p-3 border border-mocha-100 flex flex-col gap-1.5 text-xs text-mocha-900 mt-2">
                    <div className="flex justify-between items-center font-medium">
                      <span>{t('Recipe Cost')}:</span>
                      <span className="font-bold text-gray-800">EGP {calculatedCost.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between items-center font-medium">
                      <span>{t('Potential Margin')}:</span>
                      <span className={`font-bold ${marginStats.profit >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                        EGP {marginStats.profit.toFixed(2)} ({marginStats.percentage.toFixed(0)}%)
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="flex gap-3 pt-4 border-t border-gray-100 mt-6">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 px-4 py-2 rounded-xl border border-gray-200 text-gray-700 font-medium hover:bg-gray-50 transition-colors"
              >
                {t('Cancel')}
              </button>
              <button
                type="submit"
                className="flex-1 px-4 py-2 rounded-xl bg-mocha-700 text-white font-medium hover:bg-mocha-800 shadow-lg shadow-mocha-500/20 transition-colors"
              >
                {initialData ? t('Save Changes') : t('Create Item')}
              </button>
            </div>
          </form>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
