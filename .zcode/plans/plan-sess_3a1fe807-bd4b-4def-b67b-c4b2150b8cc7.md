# خطة الإصلاح: أمان تخزين الطلبات + ضبط أبعاد التابليت

## الجزء 1: أمان التخزين المؤقت للطلبات (دون لمس مسار الرفع)

### 1.1 Atomicity — كتابة الطلب وصف المزامنة في معاملة واحدة
**ملف**: `src/repositories/indexeddb/IndexedDbOrderRepository.ts`
- **create** (سطور 13-37): حالياً `db.put('orders')` ثم `db.put('sync_queue')` منفصلتين. سأجمعهما في معاملة `readwrite` واحدة على المُخزنين (`['orders','sync_queue']`) بحيث إن انقطعت الصفحة بينهما لا يُحفظ الطلب بلا سجل مزامنة (ولا العكس).
- **update** (سطور 39-58): نفس المعالجة — قراءة+كتابة+طابور في معاملة واحدة.
- **delete** (سطور 73-85): `db.delete('orders')` + كتابة صف الطابور في معاملة واحدة.

### 1.2 Retry بـ exponential backoff في SyncService
**ملف**: `src/services/syncService.ts`
- أضيف حقول `attempts` و `nextRetryAt` و `lastError` على سجل المزامنة (في `db.ts:7-14`).
- عند الفشل (response غير ok أو throw)، نزيد `attempts` ونضبط `nextRetryAt = now + min(30000 * 2^attempts, 30min)` (capped) بدل المحاولة كل 30s للأبد.
- الـ sync loop يقفز السجلات التي `nextRetryAt > now`.

### 1.3 تنظيف السجلات الناجحة بعد فترة احتياطية
**ملف**: `src/services/syncService.ts`
- بعد وضع `synced = 1` نحتفظ بالسجل لمدة احتياطية (مثلاً 24 ساعة) ثم نحذفه. هذا يمنع نمو `sync_queue` بلا حدود مع الإبقاء على إمكانية التدقيق.
- شرط الحذف: `synced === 1 && timestamp < now - 24h`.

### 1.4 إبقاء مسار الرفع الحالي كما هو (بناءً على اختيارك)
- لا ألمس `CLOUDFLARE_WORKER_URL` أو مسار `/api/sync`. الرفع يبقى محاولاً (وحالياً يفشل بـ 404) — لكن الطلبات تبقى **محفوظة بأمان** محلياً ولن تُفقد، وهذا هو المطلوب.
- مع 1.2 الـ retry سيكون bounded بدل المحاولة اللامتناهية، ومع 1.3 لن يكبر الطابور.

### 1.5 تحديث نوع SyncRecord (متوافق مع الداتا الموجودة)
**ملف**: `src/repositories/indexeddb/db.ts`
- أضيف `attempts?`, `nextRetryAt?`, `lastError?` كحقول اختيارية على `SyncRecord` (سطر 7-14). لا أُغيّر رقم إصدار DB ولا أطهر الداتا — الحقول الجديدة بـ optional فلن تكسر السجلات القديمة.

---

## الجزء 2: ضبط أبعاد التابليت (768px–1023px)

### 2.1 استخدام breakpoint الـ `tablet` المعرّف وغير المستخدم
التكوين الحالي في `tailwind.config.js:44-48` يعرف `tablet: 768-1023px` لكنه غير مستخدم إطلاقاً. سأستعمله في الإصلاحات.

### 2.2 Kanban الطلبات (الأهم)
**ملف**: `src/pages/Orders.tsx`
- **سطر 259** `min-w-[900px]`: يُجبر السكرول الأفقي على التابليت. أُغيّر لـ `min-w-[760px] tablet:min-w-[900px] lg:min-w-[900px]` — أي على التابليت العرض الأدنى 760 لاحتواء ~5 أعمدة بـ ~150px داخل عرض ~720px متاح دون سكرول إجباري.
- **سطر 211** الـ height calc `h-[calc(100vh-168px)] md:h-[calc(100vh-114px)]`: أبقيه كما هو (هو desktop/tablet ويأخذ قيمة md)، لكن أتأكد أن الـ flex-1 يحتوي الـ overflow بشكل صحيح.

### 2.3 إصلاح OrderDetails (bug الـ drawer النحيف على التابليت)
**ملف**: `src/components/orders/OrderDetails.tsx`
- **سطر 19** `const isMobile = useIsMobile();`: حالياً يرجع `false` للتابليت فيأخذ مسار drawer بـ `max-w-md` (448px) ضيق. أُغيّر الاستدعاء لـ `useIsMobile(1024)` ليعامل التابليت كـ bottom-sheet ملء الشاشة (تجربة لمسية أفضل)، أو أضيف `tablet:max-w-2xl` على فرع الـ drawer.
- **سطر 64** زر "العودة" المخفي `md:hidden`: أضيف `tablet:flex` لو أبقينا الـ drawer.

### 2.4 صفحات الأعمال: إضافة خطوة `tablet:` للمصفوفات
| ملف | سطر | الحالي | المقترح |
|---|---|---|---|
| `Menu.tsx` | 167 | `md:grid-cols-3 xl:grid-cols-4` | `md:grid-cols-3 tablet:grid-cols-4 xl:grid-cols-4` |
| `Inventory.tsx` | 273 | `grid-cols-2 lg:grid-cols-4` | `grid-cols-2 tablet:grid-cols-4 lg:grid-cols-4` |
| `Reports.tsx` | 322/327 | `grid-cols-2 lg:grid-cols-4` | `grid-cols-2 tablet:grid-cols-4 lg:grid-cols-4` |
| `Reports.tsx` | 380/457 | `grid-cols-1 lg:grid-cols-3` | `grid-cols-1 tablet:grid-cols-3 lg:grid-cols-3` |
| `ManagerDashboard.tsx` | 1264 | `grid-cols-2 lg:grid-cols-3` | `grid-cols-2 tablet:grid-cols-3 lg:grid-cols-3` |
| `ManagerDashboard.tsx` | 1269/1375 | `grid-cols-1 lg:grid-cols-3` | `grid-cols-1 tablet:grid-cols-3 lg:grid-cols-3` |
| `ManagerDashboard.tsx` | 1621 | `grid-cols-2 lg:grid-cols-4` | `grid-cols-2 tablet:grid-cols-4 lg:grid-cols-4` |

### 2.5 توسيع الـ Modals الضيقة على التابليت
كل الـ `max-w-md` (448px) تتسع لـ `tablet:max-w-lg` (512px) أو `tablet:max-w-xl`:
- `Inventory.tsx` (531, 654) → `max-w-md tablet:max-w-xl`
- `StoreConfigModal.tsx` (41), `BranchConfigModal.tsx` (67), `ProfileSettingsModal.tsx` (73) → `tablet:max-w-lg`
- `Login.tsx` (104) → `tablet:max-w-lg`

### 2.6 PublicMenu (الأكثر تضرراً بصرياً)
**ملف**: `src/pages/PublicMenu.tsx`
- **سطر 249** `max-w-md mx-auto`: يحدّ المحتوى بـ 448px على تابليت بعرض 1023. أُغيّر لـ `max-w-md tablet:max-w-2xl lg:max-w-3xl mx-auto px-4 tablet:px-6`.
- **سطر 233** (header) و **سطر 340** (grid cards): توسيع متوافق `tablet:max-w-2xl` و `tablet:grid-cols-2`.

### 2.7 إصلاح رؤوس الفلاتر (`flex-col xl:flex-row`)
- `Payment.tsx` (177): `flex-col xl:flex-row` → `flex-col tablet:flex-row`.
- `ManagerDashboard.tsx` (1108): نفس الإصلاح.

---

## الجزء 3: البناء والتشغيل

بعد كل التعديلات:
1. `npm install` (لو ناقص) — سأتحقق أولاً.
2. `npm run build` للتأكد من نجاح TypeScript compile بلا أخطاء.
3. `npm run dev` لتشغيل localhost وإعطائك الـ URL.

---

## ما **لن** ألمسه (بناءً على اختياراتك)
- ❌ POSView / الكاشير layout (غير مطلوب)
- ❌ TopNav (غير مطلوب)
- ❌ مسار الرفع `/api/sync` أو الـ Worker (طلبت إبقاءه)
- ❌ الداتا الموجودة في المتصفح (طلبت إبقاءها)
- ❌ ترقية DB version (كي لا أطهر الداتا)

## ملخص الأمان بعد الإصلاح
✅ الطلب وكتابة طابوره في معاملة واحدة — لا يمكن فصلهما
✅ retry bounded بـ exponential backoff — لا محاولات لا نهائية
✅ تنظيف السجلات الناجحة بعد 24h — الطابور لا يكبر بلا حدود
✅ الحقول الجديدة optional — الداتا الحالية تبقى سليمة
✅ الطلبات تبقى في IndexedDB المُستمر — لا تُفقد عند تحديث/فصل/إغلاق