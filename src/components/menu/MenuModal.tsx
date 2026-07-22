import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
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

function getIngredientBaseQty(qty: number, selectedUnit: string, baseUnit: string): number {
  const sel = (selectedUnit || '').trim().toLowerCase();
  const base = (baseUnit || '').trim().toLowerCase();

  const isSelKg = sel === 'كجم' || sel === 'kg';
  const isSelG = sel === 'جرام' || sel === 'g' || sel === 'جم';
  const isBaseKg = base === 'كجم' || base === 'kg';
  const isBaseG = base === 'جرام' || base === 'g' || base === 'جم';

  if (isBaseKg && isSelG) return qty / 1000;
  if (isBaseG && isSelKg) return qty * 1000;

  const isSelL = sel === 'لتر' || sel === 'l';
  const isSelMl = sel === 'مل' || sel === 'ml';
  const isBaseL = base === 'لتر' || base === 'l';
  const isBaseMl = base === 'مل' || base === 'ml';

  if (isBaseL && isSelMl) return qty / 1000;
  if (isBaseMl && isSelL) return qty * 1000;

  return qty;
}

export function MenuModal({ isOpen, onClose, onSave, initialData, existingItems }: MenuModalProps) {
  const { t } = useLanguage();
  const [activeTab, setActiveTab] = useState<'general' | 'recipe'>('general');
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const [mappedIngredients, setMappedIngredients] = useState<Array<{ inventoryItemId: string; quantity: number; unit?: string }>>([]);
  const [loading, setLoading] = useState(false);

  const [preparation, setPreparation] = useState('Bar');
  const [showNewCategoryInput, setShowNewCategoryInput] = useState(false);
  const [isCategoryDropdownOpen, setIsCategoryDropdownOpen] = useState(false);
  const [removedCategories, setRemovedCategories] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('removed_menu_categories') || '[]');
    } catch { return []; }
  });
  const categoryDropdownRef = React.useRef<HTMLDivElement>(null);

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    price: '',
    category: 'General', // Default category
    image: '',
    available: true,
  });

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (categoryDropdownRef.current && !categoryDropdownRef.current.contains(e.target as Node)) {
        setIsCategoryDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

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
            quantity: r.quantity,
            unit: r.unit || r.itemUnit || ''
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
      setIsCategoryDropdownOpen(false);
    }
  }, [initialData, isOpen]);

  const availableCategories = useMemo(() => {
    const defaults = [
      { value: 'Hot Coffee', label: 'قهوة ساخنة (Hot Coffee)' },
      { value: 'Iced Coffee', label: 'قهوة باردة (Iced Coffee)' },
      { value: 'Frappe', label: 'فرابيه (Frappe)' },
      { value: 'Milkshakes', label: 'ميلك شيك (Milkshakes)' },
      { value: 'Juices', label: 'عصائر ومشروبات (Juices)' },
      { value: 'Desserts', label: 'حلويات (Desserts)' },
      { value: 'Food', label: 'مأكولات (Food)' }
    ];
    
    const set = new Set(defaults.map(d => d.value));
    const list = [...defaults];

    (existingItems || []).forEach(item => {
      const cat = item.category ? item.category.split('|')[0] : '';
      if (cat && !set.has(cat) && cat !== 'Bar' && cat !== 'Kitchen' && cat !== 'All' && cat !== 'General') {
        set.add(cat);
        list.push({ value: cat, label: cat });
      }
    });

    // Filter out removed categories
    return list.filter(cat => !removedCategories.includes(cat.value));
  }, [existingItems, removedCategories]);

  const handleRemoveCategory = (catValue: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = [...removedCategories, catValue];
    setRemovedCategories(updated);
    localStorage.setItem('removed_menu_categories', JSON.stringify(updated));
    // If the removed category was the selected one, reset to first available
    if (formData.category === catValue) {
      const remaining = availableCategories.filter(c => c.value !== catValue);
      setFormData(prev => ({ ...prev, category: remaining.length > 0 ? remaining[0].value : 'Hot Coffee' }));
    }
  };

  useEffect(() => {
    if (initialData) {
      const parts = initialData.category.split('|');
      const menuCat = parts[0] || 'Hot Coffee';

      const isKnown = availableCategories.some(c => c.value === menuCat);
      if (!isKnown && menuCat !== 'General') {
        setShowNewCategoryInput(true);
        setFormData({
          name: initialData.name,
          description: initialData.description,
          price: initialData.price.toString(),
          category: menuCat,
          image: initialData.image || '',
          available: initialData.available,
        });
      } else {
        setShowNewCategoryInput(false);
        setFormData({
          name: initialData.name,
          description: initialData.description,
          price: initialData.price.toString(),
          category: menuCat === 'General' ? 'Hot Coffee' : menuCat,
          image: initialData.image || '',
          available: initialData.available,
        });
      }
      setPreparation('Bar');
    } else {
      setShowNewCategoryInput(false);
      setFormData({
        name: '',
        description: '',
        price: '',
        category: availableCategories.length > 0 ? availableCategories[0].value : 'Hot Coffee',
        image: '',
        available: true,
      });
      setPreparation('Bar');
    }
  }, [initialData, isOpen, availableCategories]);

  const calculatedCost = useMemo(() => {
    return mappedIngredients.reduce((sum, ing) => {
      const invItem = inventoryItems.find(i => i.id === ing.inventoryItemId);
      if (!invItem) return sum;
      const baseQty = getIngredientBaseQty(ing.quantity, ing.unit || invItem.unit || 'كجم', invItem.unit || 'كجم');
      return sum + (invItem.costPerUnit * baseQty);
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
    const first = inventoryItems[0];
    setMappedIngredients(prev => [...prev, { inventoryItemId: first.id, quantity: 0, unit: first.unit || 'كجم' }]);
  };

  const updateIngredientRow = (index: number, itemId: string, qty: number, unit?: string) => {
    setMappedIngredients(prev => prev.map((item, i) => {
      if (i !== index) return item;
      const invItem = inventoryItems.find(it => it.id === itemId);
      return {
        inventoryItemId: itemId,
        quantity: qty,
        unit: unit !== undefined ? unit : (item.unit || invItem?.unit || 'كجم')
      };
    }));
  };

  const removeIngredientRow = (index: number) => {
    setMappedIngredients(prev => prev.filter((_, i) => i !== index));
  };

  const handleSelectCategory = (catValue: string) => {
    setShowNewCategoryInput(false);
    setFormData(prev => ({ ...prev, category: catValue }));
    setIsCategoryDropdownOpen(false);
  };

  const handleCreateNewCategory = () => {
    setShowNewCategoryInput(true);
    setFormData(prev => ({ ...prev, category: '' }));
    setIsCategoryDropdownOpen(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const menuCategory = formData.category.trim() || 'Hot Coffee';
      const finalCategory = `${menuCategory}|Bar`;

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

  const selectedCategoryLabel = availableCategories.find(c => c.value === formData.category)?.label || formData.category;

  return createPortal(
    <AnimatePresence>
      <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
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
                      className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-caramel focus:border-transparent transition-all bg-white text-gray-900 placeholder-gray-400 font-medium"
                      placeholder={t('e.g. Spanish Latte')}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{t('Description')}</label>
                    <textarea
                      rows={3}
                      value={formData.description}
                      onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                      className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-caramel focus:border-transparent transition-all resize-none bg-white text-gray-900 placeholder-gray-400 font-medium"
                      placeholder={t('Brief description of the item...')}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">{t('Price') || 'السعر'}</label>
                      <input
                        type="number"
                        step="0.01"
                        required
                        value={formData.price}
                        onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                        className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-caramel focus:border-transparent transition-all text-sm bg-white text-gray-900 placeholder-gray-400 font-bold"
                        placeholder="0.00"
                      />
                    </div>

                    <div ref={categoryDropdownRef} className="relative">
                      <label className="block text-sm font-medium text-gray-700 mb-1">{t('Category') || 'التصنيف'}</label>
                      
                      {/* Custom dropdown trigger */}
                      <button
                        type="button"
                        onClick={() => setIsCategoryDropdownOpen(!isCategoryDropdownOpen)}
                        className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-caramel focus:border-transparent transition-all bg-white text-sm font-bold text-gray-900 text-right flex items-center justify-between gap-1"
                      >
                        <svg className={`w-3.5 h-3.5 text-gray-400 transition-transform shrink-0 ${isCategoryDropdownOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" /></svg>
                        <span className="truncate">{showNewCategoryInput ? 'تصنيف جديد...' : selectedCategoryLabel}</span>
                      </button>

                      {/* Custom dropdown menu */}
                      {isCategoryDropdownOpen && (
                        <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-xl z-50 max-h-56 overflow-y-auto"
                          style={{ minWidth: '220px' }}
                        >
                          {availableCategories.map(cat => (
                            <div
                              key={cat.value}
                              className={`flex items-center justify-between gap-1 px-3 py-2 cursor-pointer text-sm font-medium transition-colors group ${
                                formData.category === cat.value && !showNewCategoryInput
                                  ? 'bg-mocha-50 text-mocha-800'
                                  : 'text-gray-700 hover:bg-gray-50'
                              }`}
                              onClick={() => handleSelectCategory(cat.value)}
                            >
                              <button
                                type="button"
                                onClick={(e) => handleRemoveCategory(cat.value, e)}
                                className="p-1 rounded-md text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors opacity-0 group-hover:opacity-100 shrink-0"
                                title="حذف التصنيف"
                              >
                                <X size={13} />
                              </button>
                              <span className="truncate text-right flex-1">{cat.label}</span>
                            </div>
                          ))}
                          {/* Add new category option */}
                          <div
                            className="flex items-center justify-end gap-1 px-3 py-2 cursor-pointer text-sm font-bold text-mocha-700 hover:bg-mocha-50 transition-colors border-t border-gray-100"
                            onClick={handleCreateNewCategory}
                          >
                            <span>+ إضافة تصنيف جديد...</span>
                          </div>
                        </div>
                      )}

                      {showNewCategoryInput && (
                        <input
                          type="text"
                          required
                          autoFocus
                          value={formData.category}
                          onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                          className="w-full px-3 py-2 mt-2 rounded-xl border border-mocha-200 focus:outline-none focus:ring-2 focus:ring-caramel focus:border-transparent transition-all text-sm bg-mocha-50/50 text-gray-900 placeholder-gray-400 font-bold"
                          placeholder="اسم التصنيف الجديد..."
                        />
                      )}
                    </div>
                  </div>
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
                               onChange={(e) => updateIngredientRow(idx, e.target.value, ing.quantity, ing.unit)}
                               className="flex-1 px-3 py-1.5 rounded-lg border border-gray-200 text-xs focus:outline-none bg-white font-medium min-w-0"
                            >
                              {inventoryItems.map(item => (
                                <option key={item.id} value={item.id}>{t(item.name) || item.name}</option>
                              ))}
                            </select>

                            <div className="flex items-center gap-1.5 w-44 shrink-0">
                              <input
                                type="number"
                                step="0.001"
                                required
                                value={ing.quantity || ''}
                                onChange={(e) => updateIngredientRow(idx, ing.inventoryItemId, parseFloat(e.target.value) || 0, ing.unit)}
                                className="w-20 px-2 py-1.5 rounded-lg border border-gray-200 text-xs focus:outline-none text-center font-bold bg-white"
                                placeholder="0"
                              />

                              <select
                                value={ing.unit || currentInvItem?.unit || 'كجم'}
                                onChange={(e) => updateIngredientRow(idx, ing.inventoryItemId, ing.quantity, e.target.value)}
                                className="px-2 py-1.5 rounded-lg border border-gray-200 text-xs focus:outline-none bg-white font-bold text-gray-800 shrink-0"
                              >
                                <option value="كجم">كجم</option>
                                <option value="جرام">جرام</option>
                                <option value="لتر">لتر</option>
                                <option value="مل">مل</option>
                                <option value="قطعة">قطعة</option>
                              </select>
                            </div>

                            <button
                              type="button"
                              onClick={() => removeIngredientRow(idx)}
                              className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition-colors shrink-0"
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
    </AnimatePresence>,
    document.body
  );
}
