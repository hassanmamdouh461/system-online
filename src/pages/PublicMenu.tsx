import React, { useState, useEffect } from 'react';
import { Coffee, Search, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { menuService } from '../services/menuService';
import { MenuItem } from '../types/menu';

const PAGE_BACKGROUND_URL = 'https://images.unsplash.com/photo-1447933601403-0c6688de566e?q=80&w=1000';

const CATEGORY_TRANSLATIONS: Record<string, string> = {
  'Hot Coffee': 'قهوة ساخنة',
  'Iced Coffee': 'قهوة باردة',
  'Frappe': 'فرابيه',
  'Milkshakes': 'ميلك شيك',
  'Kitchen': 'مأكولات',
  'Bar': 'مشروبات'
};

const ITEM_TRANSLATIONS: Record<string, { name: string; desc: string }> = {
  'espresso': { name: 'إسبيريسو', desc: 'جرعة مركزة وغنية من حبوب البن الإيطالية الفاخرة.' },
  'double espresso': { name: 'إسبيريسو دبل', desc: 'جرعة مزدوجة من الإسبريسو الغني والمركز.' },
  'cortado': { name: 'كورتادو', desc: 'أجزاء متساوية من الإسبريسو والحليب الدافئ الناعم.' },
  'flat white': { name: 'فلات وايت', desc: 'جرعة مزدوجة من الإسبريسو القوي مع طبقة رقيقة من رغوة الحليب.' },
  'cafe latte': { name: 'لاتيه', desc: 'جرعة إسبريسو مع الحليب المبخر وطبقة خفيفة من الرغوة.' },
  'latte': { name: 'لاتيه', desc: 'جرعة إسبريسو مع الحليب المبخر وطبقة خفيفة من الرغوة.' },
  'cappuccino': { name: 'كابوتشينو', desc: 'قهوة إيطالية كلاسيكية مع رغوة حليب كثيفة وغنية.' },
  'spanish latte': { name: 'سبانش لاتيه', desc: 'إسبريسو مع الحليب المكثف المحلى والحليب المبخر.' },
  'americano': { name: 'أمريكانو', desc: 'جرعات إسبريسو مخففة بالماء الساخن لمذاق ناعم.' },
  'cafe mocha': { name: 'كافيه موكا', desc: 'إسبريسو ممزوج بالشوكولاتة الغنية والحليب الساخن.' },
  'turkish coffee': { name: 'قهوة تركي', desc: 'بن مطحون ناعم ومحضر في وعاء قهوة تقليدي.' },
  'french coffee': { name: 'قهوة فرنساوي', desc: 'قهوة تركية تقليدية محضرة بالحليب.' },
  'iced americano': { name: 'أمريكانو بارد', desc: 'جرعات إسبريسو فوق الثلج مع الماء البارد.' },
  'iced latte': { name: 'لاتيه بارد', desc: 'إسبريسو مثلج مع حليب بارد فوق الثلج.' },
  'iced spanish latte': { name: 'سبانش لاتيه بارد', desc: 'إسبريسو مثلج مع الحليب المكثف المحلى والحليب البارد.' },
  'iced caramel macchiato': { name: 'كراميل ماكياتو بارد', desc: 'لاتيه فانيليا مثلج مع صوص الكراميل اللذيذ.' },
  'iced mocha': { name: 'موكا باردة', desc: 'شوكولاتة غنية وإسبريسو وحليب بارد يقدم مع الثلج.' },
  'cold brew': { name: 'كولد برو', desc: 'بن فاخر منقوع في الماء البارد لمدة 18 ساعة.' },
  'iced pistachio latte': { name: 'بستاشيو لاتيه بارد', desc: 'إسبريسو مع صوص البستاشيو اللذيذ والحليب والثلج.' },
  'mocha frappe': { name: 'موكا فرابيه', desc: 'فرابيه موكا مثلجة مغطاة بالكريمة المخفوقة.' },
  'caramel frappe': { name: 'كراميل فرابيه', desc: 'قهوة مثلجة ممزوجة بصلصة الكراميل الغنية وحلوة المذاق.' },
  'coffee frappe': { name: 'قهوة فرابيه', desc: 'قهوة مثلجة كلاسيكية ممزوجة بالثلج والحليب.' },
  'oreo frappe': { name: 'أوريو فرابيه', desc: 'بسكويت أوريو ممزوج بالقهوة والحليب وصوص الشوكولاتة.' },
  'oreo milkshake': { name: 'ميلك شيك أوريو', desc: 'ميلك شيك كريمي مع بسكويت أوريو والآيس كريم.' },
  'strawberry milkshake': { name: 'ميلك شيك فراولة', desc: 'فراولة طازجة ممزوجة بآيس كريم الفانيليا والحليب.' },
  'chocolate milkshake': { name: 'ميلك شيك شوكولاتة', desc: 'ميلك شيك كريمي غني بالشوكولاتة السويسرية الفاخرة.' },
  'vanilla milkshake': { name: 'ميلك شيك فانيليا', desc: 'ميلك شيك كلاسيكي بنكهة الفانيليا الطبيعية الفاخرة.' },
  'mango milkshake': { name: 'ميلك شيك مانجو', desc: 'مانجو استوائية ممزوجة بآيس كريم الفانيليا الكريمي.' },
  'green tea': { name: 'شاي أخضر', desc: 'شاي أخضر ياباني عضوي محضر ساخناً.' },
  'karak tea': { name: 'شاي كرك', desc: 'شاي أسود مع الحليب المبخر والهيل والزعفران.' },
  'mint lemonade': { name: 'عصير ليمون بالنعناع', desc: 'عصير ليمون طازج ممزوج بالثلج والنعناع الأخضر.' },
  'peach iced tea': { name: 'شاي مثلج بالخوخ', desc: 'شاي أسود مثلج بنكهة الخوخ اللذيذة.' },
  'passion fruit mojito': { name: 'موهيتو باشون فروت', desc: 'مزيج منعش من الليمون والنعناع الطازج والباشون فروت والصودا.' }
};

export default function PublicMenu() {
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [selectedCategory, setSelectedCategory] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  // Smart categorize an item based on its name if it has old-format category
  const smartCategorize = (item: MenuItem): MenuItem => {
    const cat = item.category || '';
    if (cat.includes('|')) {
      const menuCat = cat.split('|')[0];
      if (menuCat !== 'Bar' && menuCat !== 'Kitchen' && menuCat !== 'All' && menuCat !== 'ساندوتشات' && menuCat !== 'مقبلات' && menuCat !== 'حلويات') {
        return item; // Already good
      }
    }
    
    const nameLower = (item.name || '').toLowerCase();
    let menuCategory = 'Hot Coffee';
    let prepDest = 'Bar';
    
    const frappeKw = ['frappe', 'frappé'];
    const milkshakeKw = ['milkshake', 'milk shake'];
    const icedKw = ['iced', 'cold brew', 'cold', 'mint lemonade', 'peach iced', 'passion fruit', 'mojito', 'lemonade'];
    
    if (frappeKw.some(k => nameLower.includes(k))) {
      menuCategory = 'Frappe';
    } else if (milkshakeKw.some(k => nameLower.includes(k))) {
      menuCategory = 'Milkshakes';
    } else if (icedKw.some(k => nameLower.includes(k))) {
      menuCategory = 'Iced Coffee';
    } else {
      menuCategory = 'Hot Coffee';
    }
    
    return { ...item, category: `${menuCategory}|${prepDest}` };
  };

  const drinksCategories = React.useMemo(() => {
    const unique = new Set<string>();
    unique.add('Hot Coffee');
    unique.add('Iced Coffee');
    unique.add('Frappe');
    unique.add('Milkshakes');
    
    items.forEach(item => {
      const parts = item.category ? item.category.split('|') : [];
      const menuCat = parts[0] || '';
      if (menuCat && menuCat !== 'All' && menuCat !== 'Kitchen' && menuCat !== 'ساندوتشات' && menuCat !== 'مقبلات' && menuCat !== 'حلويات') {
        unique.add(menuCat);
      }
    });
    return Array.from(unique);
  }, [items]);

  const activeCategories = React.useMemo(() => {
    return drinksCategories.map(cat => ({
      id: cat,
      name: CATEGORY_TRANSLATIONS[cat] || cat
    }));
  }, [drinksCategories]);

  useEffect(() => {
    document.title = 'قائمة المشروبات';
    async function loadMenu() {
      try {
        setLoading(true);
        const fetchedItems = await menuService.getAll();
        const categorizedItems = fetchedItems.map(smartCategorize);
        setItems(categorizedItems);
      } catch (err) {
        console.error('Error fetching public menu:', err);
        setError('تعذر تحميل القائمة. يرجى المحاولة مرة أخرى.');
      } finally {
        setLoading(false);
      }
    }
    loadMenu();
  }, []);

  useEffect(() => {
    if (drinksCategories.length > 0 && !selectedCategory) {
      setSelectedCategory(drinksCategories[0]);
    }
  }, [drinksCategories, selectedCategory]);

  const filteredItems = items.filter(item => {
    // If searching, ignore category filter and show all matching items
    if (searchQuery.trim().length > 0) {
      const key = item.name.toLowerCase().trim();
      const translation = ITEM_TRANSLATIONS[key];
      const arName = translation ? translation.name : item.name;
      const arDesc = translation ? translation.desc : (item.description || '');

      return item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
             arName.includes(searchQuery) ||
             (item.description && item.description.toLowerCase().includes(searchQuery.toLowerCase())) ||
             arDesc.includes(searchQuery);
    }

    const menuCat = item.category ? item.category.split('|')[0] : '';
    return menuCat === selectedCategory;
  });

  const DRINKS_BG = 'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?q=80&w=1000';

  return (
    <div className="min-h-screen bg-mocha-50 pb-12 font-sans relative" dir="rtl">
      {/* Background Watermark Image */}
      <div 
        className="fixed inset-0 bg-cover bg-center opacity-[0.09] pointer-events-none z-0 transition-all duration-500"
        style={{ backgroundImage: `url(${PAGE_BACKGROUND_URL})` }}
      />

      {/* Top Banner / Hero - Always fixed */}
      <header className="relative bg-gradient-to-b from-mocha-950 to-mocha-900 text-white py-12 px-6 overflow-hidden rounded-b-[2.5rem] shadow-xl min-h-[180px] flex items-center justify-center z-10">
        {/* Dynamic header background image */}
        <div 
          className="absolute inset-0 bg-cover bg-center transition-all duration-700 ease-in-out opacity-30"
          style={{ backgroundImage: `url(${DRINKS_BG})` }}
        />
        {/* Dark overlay */}
        <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black/60 z-0" />

        <div className="max-w-md tablet:max-w-2xl lg:max-w-3xl mx-auto flex flex-col items-center text-center relative z-10">
          {/* Logo */}
          <div className="w-16 h-16 bg-white/10 border border-white/20 rounded-full flex items-center justify-center mb-4 shadow-inner backdrop-blur-sm">
            <Coffee className="w-9 h-9 text-caramel" />
          </div>

          <h1 className="text-3xl font-black tracking-tight mb-2 text-white">
            بروماستر
          </h1>
          <p className="text-mocha-200 text-sm max-w-xs font-medium">
            قائمة المشروبات الفاخرة
          </p>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="max-w-md tablet:max-w-2xl lg:max-w-3xl mx-auto px-4 tablet:px-6 mt-6 relative z-10">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20">
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
              className="mb-4"
            >
              <Coffee className="w-12 h-12 text-mocha-600" />
            </motion.div>
            <p className="text-mocha-800 font-bold animate-pulse text-center">جاري تحضير القائمة...</p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <AlertCircle className="w-16 h-16 text-red-500 mb-4" />
            <h2 className="text-xl font-bold text-gray-900 mb-2">{error}</h2>
            <button
              onClick={() => window.location.reload()}
              className="mt-4 px-6 py-2.5 bg-mocha-700 text-white rounded-xl font-bold shadow-md hover:bg-mocha-800 transition-colors"
            >
              إعادة المحاولة
            </button>
          </div>
        ) : (
          <>
            {/* Search */}
            <div className="relative mb-6 shadow-sm">
              <div className="absolute inset-y-0 right-3 flex items-center pointer-events-none">
                <Search className="h-5 w-5 text-mocha-400" />
              </div>
              <input
                type="text"
                placeholder="قولنا تحب تشرب ايه النهارده"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full py-3 pr-10 pl-4 bg-white border border-mocha-100 rounded-2xl focus:outline-none focus:ring-2 focus:ring-caramel focus:border-transparent text-sm shadow-inner transition-all text-right font-bold"
              />
            </div>

            {/* Search Results (if searching) */}
            {searchQuery.trim().length > 0 ? (
              <div className="space-y-4">
                <div className="flex justify-between items-center px-1">
                  <span className="text-xs text-mocha-500 font-bold">نتائج البحث ({filteredItems.length})</span>
                  <button 
                    onClick={() => setSearchQuery('')}
                    className="text-xs text-red-500 font-bold hover:underline"
                  >
                    إلغاء البحث
                  </button>
                </div>
                
                <motion.div 
                  key="search-results"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="space-y-3"
                >
                  <AnimatePresence mode="popLayout">
                    {filteredItems.map((item, index) => {
                      const key = item.name.toLowerCase().trim();
                      const translation = ITEM_TRANSLATIONS[key];
                      const displayName = translation ? translation.name : item.name;
                      const displayDesc = translation ? translation.desc : item.description;

                      return (
                        <motion.div
                          key={item.id}
                          initial={{ opacity: 0, y: 24, scale: 0.96 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: -12, scale: 0.95 }}
                          transition={{
                            duration: 0.35,
                            delay: index * 0.05,
                            ease: [0.22, 1, 0.36, 1]
                          }}
                          whileHover={{ y: -3, scale: 1.01 }}
                          whileTap={{ scale: 0.98 }}
                          className="bg-white rounded-2xl border border-mocha-100/60 p-4 shadow-sm flex flex-col transition-shadow duration-300 hover:shadow-md"
                        >
                          <div className="flex justify-between items-start gap-2">
                            <h3 className="font-extrabold text-gray-900 text-base">{displayName}</h3>
                            <span className="font-black text-mocha-700 text-base whitespace-nowrap">{item.price.toFixed(2)} ج.م</span>
                          </div>
                          {displayDesc && <p className="text-gray-500 text-xs mt-1.5 font-medium leading-relaxed">{displayDesc}</p>}
                        </motion.div>
                      );
                    })}
                  </AnimatePresence>
                </motion.div>

                {filteredItems.length === 0 && (
                  <div className="text-center py-12">
                    <p className="text-sm font-bold text-mocha-900">لم يتم العثور على نتائج للبحث</p>
                  </div>
                )}
              </div>
            ) : (
              /* Categories Carousel & Items list */
              <div className="space-y-4">
                {/* Category tabs */}
                <div className="flex items-center gap-2 overflow-x-auto hide-scrollbar pb-1.5 scroll-smooth">
                  {activeCategories.map(cat => {
                    const isSelected = selectedCategory === cat.id;
                    return (
                      <button
                        key={cat.id}
                        onClick={() => setSelectedCategory(cat.id)}
                        className={`px-4 py-2 rounded-xl text-xs font-black whitespace-nowrap transition-all duration-200 ${
                          isSelected
                            ? 'bg-mocha-700 text-white shadow-md shadow-mocha-700/25 scale-105'
                            : 'bg-white text-mocha-800 border border-mocha-100/50 hover:bg-mocha-100'
                        }`}
                      >
                        {cat.name}
                      </button>
                    );
                  })}
                </div>

                {/* Menu Items List */}
                <motion.div 
                  key={selectedCategory}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="space-y-3 mt-2"
                >
                  <AnimatePresence mode="popLayout">
                    {filteredItems.map((item, index) => {
                      const key = item.name.toLowerCase().trim();
                      const translation = ITEM_TRANSLATIONS[key];
                      const displayName = translation ? translation.name : item.name;
                      const displayDesc = translation ? translation.desc : item.description;

                      return (
                        <motion.div
                          key={item.id}
                          initial={{ opacity: 0, y: 24, scale: 0.96 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: -12, scale: 0.95 }}
                          transition={{
                            duration: 0.35,
                            delay: index * 0.05,
                            ease: [0.22, 1, 0.36, 1]
                          }}
                          whileHover={{ y: -3, scale: 1.01 }}
                          whileTap={{ scale: 0.98 }}
                          className="bg-white rounded-2xl border border-mocha-100/60 p-4 shadow-sm relative overflow-hidden flex flex-col transition-shadow duration-300 hover:shadow-md"
                        >
                          <div className="flex justify-between items-start gap-2">
                            <h3 className="font-extrabold text-gray-900 text-base">{displayName}</h3>
                            <span className="font-black text-mocha-700 text-base whitespace-nowrap">{item.price.toFixed(2)} ج.م</span>
                          </div>
                          {displayDesc && <p className="text-gray-500 text-xs mt-1.5 font-medium leading-relaxed">{displayDesc}</p>}
                        </motion.div>
                      );
                    })}
                  </AnimatePresence>
                </motion.div>

                {/* Empty State */}
                {filteredItems.length === 0 && (
                  <div className="text-center py-12">
                    <p className="text-sm font-bold text-mocha-900">لا توجد أصناف في هذا القسم حالياً</p>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </main>

      {/* Footer */}
      <footer className="text-center mt-12 px-4 relative z-10">
        <p className="text-xs text-mocha-400 font-bold">
          بروماستر © ٢٠٢٦ - تم الصنع بحب ☕
        </p>
      </footer>
    </div>
  );
}
