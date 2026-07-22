import React, { useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { MenuItem, CATEGORY_TRANSLATIONS } from '../types/menu';
import { MenuItemCard } from '../components/menu/MenuItemCard';
import { MenuModal } from '../components/menu/MenuModal';
import { motion, AnimatePresence } from 'framer-motion';
import { useMenu } from '../hooks/useMenu';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/ui/Toast';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';

export default function Menu() {
  const toast = useToast();
  const { t, isRtl } = useLanguage();
  const { user } = useAuth();
  const isManager = user?.role === 'manager';

  // Use local SQLite database for data persistence
  const { items, loading, error, addItem, updateItem, deleteItem, toggleAvailability } = useMenu();
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  
  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);

  const dynamicCategories = React.useMemo(() => {
    const set = new Set<string>();
    set.add('All');
    items.forEach(item => {
      const cat = item.category ? item.category.split('|')[0] : '';
      if (cat && cat !== 'Bar' && cat !== 'Kitchen' && cat !== 'General') {
        set.add(cat);
      }
    });
    return Array.from(set);
  }, [items]);

  const filteredItems = items.filter(item => {
    const parts = item.category ? item.category.split('|') : [];
    const menuCat = parts[0] || '';
    const matchesCategory = selectedCategory === 'All' || menuCat === selectedCategory || parts[1] === selectedCategory;
    
    const nameTranslated = t(item.name).toLowerCase();
    const descTranslated = t(item.description || '').toLowerCase();
    const nameOriginal = item.name.toLowerCase();
    const descOriginal = (item.description || '').toLowerCase();
    const query = searchQuery.toLowerCase().trim();
    
    const matchesSearch = nameOriginal.includes(query) || 
                          descOriginal.includes(query) ||
                          nameTranslated.includes(query) ||
                          descTranslated.includes(query);
                          
    return matchesCategory && matchesSearch;
  });

  const handleToggleStatus = async (id: string) => {
    try {
      await toggleAvailability(id);
      toast.success(t('Status updated successfully'));
    } catch (error) {
      console.error('Failed to toggle status:', error);
      toast.error(t('Failed to update item availability'));
    }
  };

  const confirmDelete = (id: string) => {
    setDeleteTargetId(id);
  };

  const handleExecuteDelete = async () => {
    if (!deleteTargetId) return;
    try {
      await deleteItem(deleteTargetId);
      toast.success(t('Item deleted successfully'));
    } catch (error) {
      console.error('Failed to delete item:', error);
      toast.error(t('Failed to delete item'));
    } finally {
      setDeleteTargetId(null);
    }
  };

  const handleEdit = (item: MenuItem) => {
    setEditingItem(item);
    setIsModalOpen(true);
  };

  const handleAddNew = () => {
    setEditingItem(null);
    setIsModalOpen(true);
  };

  const handleSave = async (itemData: MenuItem | Omit<MenuItem, 'id'>, recipeIngredients: any[]) => {
    try {
      let savedItemId = '';
      if ('id' in itemData) {
        // Edit existing
        const { id, ...data } = itemData;
        await updateItem(id, data);
        savedItemId = id;
        toast.success(t('Item updated successfully'));
      } else {
        // Add new
        const newItem = await addItem(itemData);
        if (newItem) {
          savedItemId = newItem.id;
          toast.success(t('Item added successfully'));
        }
      }
      
      if (savedItemId && recipeIngredients) {
        const { inventoryService } = await import('../services/inventoryService');
        await inventoryService.saveMenuRecipe(savedItemId, recipeIngredients);
      }
      
      setIsModalOpen(false);
    } catch (error) {
      console.error('Failed to save item:', error);
      toast.error(t('Failed to save item'));
    }
  };

  // Show error state
  if (error) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <p className="text-red-600 font-semibold mb-2">{t('Failed to load menu')}</p>
          <p className="text-gray-500 text-sm">{error.message}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 md:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <h1 className="text-lg md:text-2xl font-bold text-gray-900">{t('Menu Management')}</h1>
          <p className="text-xs md:text-sm text-gray-500">{t('Manage your coffee beverages and availability.')}</p>
        </div>
        {isManager && (
          <button 
            onClick={handleAddNew}
            className="bg-mocha-700 hover:bg-mocha-800 text-white px-6 md:px-8 py-3.5 md:py-4 rounded-xl font-bold flex items-center justify-center gap-2.5 shadow-lg shadow-mocha-500/30 transition-all active:scale-95 w-full sm:w-auto text-base md:text-lg"
          >
            <Plus size={20} />
            {t('Add New Item')}
          </button>
        )}
      </div>

      {/* Filters & Search */}
      <div className="bg-white p-2 md:p-3 rounded-2xl shadow-sm border border-gray-100 flex flex-col gap-2 sticky top-0 z-10 backdrop-blur-xl bg-white/95">
        {/* Categories - Horizontal scroll on mobile */}
        <div className="flex items-center gap-1.5 overflow-x-auto hide-scrollbar pb-0.5">
          {dynamicCategories.map(category => (
            <button
              key={category}
              onClick={() => setSelectedCategory(category)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                selectedCategory === category
                  ? 'bg-mocha-700 text-white'
                  : 'bg-mocha-100 text-mocha-800 hover:bg-mocha-200'
              }`}
            >
              {category === 'All' ? (isRtl ? 'الكل' : 'All') : (CATEGORY_TRANSLATIONS[category] || t(category) || category)}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative w-full">
          <Search className={`absolute top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4 ${isRtl ? 'right-3' : 'left-3'}`} />
          <input
            type="text"
            placeholder={t('Search items...')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={`w-full py-2 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-caramel focus:border-transparent text-sm ${isRtl ? 'pr-9 pl-4' : 'pl-9 pr-4'}`}
          />
        </div>
      </div>

      {/* Menu Grid — 2 cols on mobile, 3 on small tablet, 4 on large tablet/desktop */}
      <motion.div 
        layout
        className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 tablet:grid-cols-4 xl:grid-cols-4 gap-4 tablet:gap-5 xl:gap-6"
      >
        <AnimatePresence>
          {filteredItems.map(item => (
            <MenuItemCard
              key={item.id}
              item={item}
              onEdit={handleEdit}
              onDelete={confirmDelete}
              onToggleStatus={handleToggleStatus}
              isManager={isManager}
            />
          ))}
        </AnimatePresence>
      </motion.div>

      {filteredItems.length === 0 && (
        <div className="text-center py-10 text-gray-500">
          <div className="bg-gray-100 w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-3">
            <Search className="w-7 h-7 text-gray-400" />
          </div>
          <p className="text-sm font-medium">{t('No items found')}</p>
          <p className="text-xs text-gray-400">{t('Try adjusting your search or filters.')}</p>
        </div>
      )}

      {/* Modal */}
      <MenuModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSave={handleSave}
        initialData={editingItem}
        existingItems={items}
      />

      <ConfirmDialog
        isOpen={!!deleteTargetId}
        title={t('Delete Item')}
        message={t('Are you sure you want to delete this item?')}
        confirmText={t('Delete')}
        cancelText={t('Cancel')}
        onConfirm={handleExecuteDelete}

        onCancel={() => setDeleteTargetId(null)}
      />
    </div>
  );
}
