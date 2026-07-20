import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Plus, Minus, ShoppingBag, Search, Trash2 } from 'lucide-react';
import { MenuItem } from '../../types/menu';
import { OrderItem } from '../../types/order';

interface NewOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  menuItems: MenuItem[];
  onSubmit: (tableId: string, items: OrderItem[]) => Promise<void>;
}

export function NewOrderModal({ isOpen, onClose, menuItems, onSubmit }: NewOrderModalProps) {
  const [tableId, setTableId] = useState('Dine-in');
  const [cart, setCart] = useState<Map<string, number>>(new Map());
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>('All');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const categories = useMemo(() => {
    const cats = Array.from(new Set(menuItems.map(i => i.category ? i.category.split('|')[0] : '')));
    return ['All', ...cats.filter(c => c)];
  }, [menuItems]);

  const filtered = useMemo(() => {
    return menuItems.filter(item => {
      const menuCat = item.category ? item.category.split('|')[0] : '';
      const matchCat = activeCategory === 'All' || menuCat === activeCategory;
      const matchSearch = item.name.toLowerCase().includes(search.toLowerCase());
      return matchCat && matchSearch && item.available;
    });
  }, [menuItems, activeCategory, search]);

  const cartItems: OrderItem[] = useMemo(() => {
    return Array.from(cart.entries())
      .filter(([, qty]) => qty > 0)
      .map(([id, qty]) => {
        const menuItem = menuItems.find(m => m.id === id)!;
        return { id, name: menuItem.name, quantity: qty, price: menuItem.price };
      });
  }, [cart, menuItems]);

  const totalAmount = cartItems.reduce((sum, i) => sum + i.price * i.quantity, 0);

  const setQty = (id: string, delta: number) => {
    setCart(prev => {
      const next = new Map(prev);
      const cur = next.get(id) ?? 0;
      const updated = cur + delta;
      if (updated <= 0) next.delete(id);
      else next.set(id, updated);
      return next;
    });
  };

  const handleSubmit = async () => {
    if (!tableId.trim() || cartItems.length === 0) return;
    setIsSubmitting(true);
    try {
      await onSubmit(tableId.trim(), cartItems);
      // Reset
      setTableId('Dine-in');
      setCart(new Map());
      setSearch('');
      setActiveCategory('All');
      onClose();
    } catch (e) {
      console.error('Failed to create order:', e);
      alert('Failed to create order. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    if (isSubmitting) return;
    setTableId('Dine-in');
    setCart(new Map());
    setSearch('');
    setActiveCategory('All');
    onClose();
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          onClick={handleClose}
        />

        <motion.div
          initial={{ opacity: 0, y: 60 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 60 }}
          transition={{ type: 'spring', damping: 28, stiffness: 300 }}
          className="relative z-50 w-full sm:max-w-2xl bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[95dvh] sm:max-h-[90dvh] overflow-hidden"
        >
          {/* Header */}
          <div className="px-4 sm:px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50 shrink-0">
            <div>
              <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                <ShoppingBag size={20} className="text-mocha-700" />
                New Order
              </h2>
              <p className="text-xs text-gray-500">Select items and choose order type</p>
            </div>
            <button onClick={handleClose} className="p-2 hover:bg-gray-200 rounded-full transition-colors">
              <X size={20} />
            </button>
          </div>

          <div className="flex flex-col sm:flex-row flex-1 overflow-hidden">
            {/* LEFT — Menu picker */}
            <div className="flex-1 flex flex-col overflow-hidden border-b sm:border-b-0 sm:border-r border-gray-100">
              {/* Search */}
              <div className="px-4 pt-3 pb-2 shrink-0">
                <div className="relative">
                  <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search menu..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="w-full pl-9 pr-4 py-2 text-sm bg-gray-100 rounded-lg outline-none focus:ring-2 focus:ring-mocha-300"
                  />
                </div>
              </div>

              {/* Category tabs */}
              <div className="overflow-x-auto hide-scrollbar px-4 pb-2 shrink-0">
                <div className="flex gap-1.5 min-w-max">
                  {categories.map(cat => (
                    <button
                      key={cat}
                      onClick={() => setActiveCategory(cat)}
                      className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
                        activeCategory === cat
                          ? 'bg-mocha-700 text-white'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>

              {/* Menu items grid */}
              <div className="flex-1 overflow-y-auto p-3 grid grid-cols-2 md:grid-cols-3 gap-2 content-start">
                {filtered.map(item => {
                  const qty = cart.get(item.id) ?? 0;
                  return (
                    <div
                      key={item.id}
                      className={`bg-white border rounded-xl p-2.5 flex flex-col justify-between gap-1.5 transition-all ${
                        qty > 0 ? 'border-mocha-400 shadow-sm' : 'border-gray-100'
                      }`}
                    >
                      <div className="flex-1">
                        <p className="text-xs font-semibold text-gray-900 truncate">{item.name}</p>
                        <p className="text-[10px] text-gray-500 font-medium px-1.5 py-0.5 bg-gray-100 rounded-full w-max mt-0.5">{item.category}</p>
                        <p className="text-xs text-mocha-700 font-bold mt-1">${item.price.toFixed(2)}</p>
                      </div>
                      <div className="flex items-center justify-between">
                        {qty === 0 ? (
                          <button
                            onClick={() => setQty(item.id, 1)}
                            className="w-full py-1 bg-mocha-700 text-white rounded-lg text-xs font-medium hover:bg-mocha-800 flex items-center justify-center gap-1"
                          >
                            <Plus size={12} /> Add
                          </button>
                        ) : (
                          <div className="flex items-center gap-2 w-full justify-between">
                            <button
                              onClick={() => setQty(item.id, -1)}
                              className="w-7 h-7 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center"
                            >
                              <Minus size={12} />
                            </button>
                            <span className="text-sm font-bold text-mocha-700">{qty}</span>
                            <button
                              onClick={() => setQty(item.id, 1)}
                              className="w-7 h-7 rounded-full bg-mocha-700 hover:bg-mocha-800 text-white flex items-center justify-center"
                            >
                              <Plus size={12} />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
                {filtered.length === 0 && (
                  <div className="col-span-2 md:col-span-3 text-center py-10 text-gray-400 text-sm">No items found</div>
                )}
              </div>
            </div>

            {/* RIGHT — Cart + Table */}
            <div className="sm:w-64 flex flex-col shrink-0">
              {/* Order Type input */}
              <div className="px-4 py-3 border-b border-gray-100 shrink-0">
                <label className="block text-xs font-semibold text-gray-700 mb-1.5">Order Type / نوع الطلب *</label>
                <div className="grid grid-cols-2 gap-2 bg-gray-100 p-1 rounded-lg">
                  <button
                    type="button"
                    onClick={() => setTableId('Dine-in')}
                    className={`py-1.5 rounded-md text-xs font-bold transition-all ${
                      tableId === 'Dine-in'
                        ? 'bg-white text-mocha-700 shadow-sm'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    Dine-in / مطعم
                  </button>
                  <button
                    type="button"
                    onClick={() => setTableId('Takeaway')}
                    className={`py-1.5 rounded-md text-xs font-bold transition-all ${
                      tableId === 'Takeaway'
                        ? 'bg-white text-mocha-700 shadow-sm'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    Takeaway / take away
                  </button>
                </div>
              </div>

              {/* Cart items */}
              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  Order Summary {cartItems.length > 0 && `(${cartItems.length} items)`}
                </p>
                {cartItems.length === 0 ? (
                  <p className="text-xs text-gray-400 text-center py-6">No items added yet</p>
                ) : (
                  cartItems.map(item => (
                    <div key={item.id} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-gray-800 truncate">{item.name}</p>
                        <p className="text-xs text-gray-500">${item.price.toFixed(2)} × {item.quantity}</p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="text-xs font-bold text-mocha-700">${(item.price * item.quantity).toFixed(2)}</span>
                        <button
                          onClick={() => setCart(prev => { const next = new Map(prev); next.delete(item.id); return next; })}
                          className="p-1 text-gray-400 hover:text-red-500 transition-colors"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Total + Submit */}
              <div className="p-4 border-t border-gray-100 space-y-3 shrink-0">
                <div className="flex justify-between text-sm font-bold">
                  <span>Total</span>
                  <span className="text-mocha-700">${totalAmount.toFixed(2)}</span>
                </div>
                <button
                  onClick={handleSubmit}
                  disabled={cartItems.length === 0 || !tableId.trim() || isSubmitting}
                  className="w-full py-4 bg-mocha-600 text-white rounded-2xl font-extrabold text-base hover:bg-mocha-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 shadow-lg shadow-mocha-500/10 border border-mocha-700/20"
                >
                  {isSubmitting ? 'Creating...' : 'Place Order / إرسال الطلب'}
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
