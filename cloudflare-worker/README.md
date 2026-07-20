# ☁️ BrewMaster Backend - Cloudflare D1 Migration Guide
# ☁️ دليل ترحيل BrewMaster إلى Cloudflare D1

This guide explains how to set up, initialize, and deploy the new Cloudflare D1 database and worker backend to replace Appwrite.

يشرح هذا الدليل كيفية إعداد وتهيئة ونشر قاعدة بيانات Cloudflare D1 والـ Worker الجديد كبديل كامل لـ Appwrite.

---

## 🚀 Steps to Deploy / خطوات النشر

### 1. Authenticate with Cloudflare / تسجيل الدخول إلى Cloudflare
Open your terminal inside the `cloudflare-worker` directory and run:
افتح سطر الأوامر (Terminal) داخل مجلد `cloudflare-worker` ونفذ الأمر التالي:
```bash
npx wrangler login
```
This will open your browser to log in to your Cloudflare account.
سيفتح هذا المتصفح لتسجيل الدخول إلى حسابك في كلود فلير.

### 2. Create the D1 Database / إنشاء قاعدة بيانات D1
Run the following command to create your SQLite database on Cloudflare:
نفذ الأمر التالي لإنشاء قاعدة البيانات السحابية:
```bash
npx wrangler d1 create brewmaster-db
```
**Example Output / مثال للمخرجات:**
```
✅ Successfully created DB 'brewmaster-db' on namespace ...
[[d1_databases]]
binding = "DB"
database_name = "brewmaster-db"
database_id = "xxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

### 3. Update Configuration / تحديث الإعدادات
Copy the generated `database_id` from the output above, open [wrangler.toml](file:///c:/Users/DELL/whtool/system333/cloudflare-worker/wrangler.toml), and replace `REPLACE_WITH_YOUR_D1_DATABASE_ID` with your actual ID:
انسخ الـ `database_id` الناتج من الخطوة السابقة، ثم افتح ملف [wrangler.toml](file:///c:/Users/DELL/whtool/system333/cloudflare-worker/wrangler.toml) واستبدل `REPLACE_WITH_YOUR_D1_DATABASE_ID` بالمعرّف الفعلي:
```toml
database_id = "xxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

### 4. Create Tables (Initialize Schema) / إنشاء الجداول (تهيئة قاعدة البيانات)
Run the migration script to create the necessary tables in your remote D1 database:
قم بتنفيذ أمر الترحيل لإنشاء الجداول اللازمة داخل قاعدة البيانات سحابياً:
```bash
npx wrangler d1 execute brewmaster-db --remote --file=schema.sql
```

### 5. Deploy the Worker / نشر الـ Worker
Now deploy your backend worker API to Cloudflare:
الآن، قم بنشر الـ Worker الخاص بك على شبكة كلود فلير العالمية:
```bash
npx wrangler deploy
```
Once deployed, Cloudflare will display your live endpoint URL.
**Example / مثال:**
`https://brewmaster-backend.<your-username>.workers.dev`

---

## 🛠️ Update Application Configuration / تحديث إعدادات التطبيق

Once you have your Cloudflare Worker URL:
1. Open the project environment variables or update the hardcoded endpoints:
   - In [electron/mockApiService.cjs](file:///c:/Users/DELL/whtool/system333/electron/mockApiService.cjs): Update `ENDPOINT` to your Cloudflare Worker URL (e.g. `https://brewmaster-backend.<your-username>.workers.dev`).
   - In [src/services/menuService.ts](file:///c:/Users/DELL/whtool/system333/src/services/menuService.ts): Update `APPWRITE_ENDPOINT`.
   - In [src/pages/ManagerDashboard.tsx](file:///c:/Users/DELL/whtool/system333/src/pages/ManagerDashboard.tsx): Update `APPWRITE_ENDPOINT`.
   - In [src/components/ui/DatabaseStatus.tsx](file:///c:/Users/DELL/whtool/system333/src/components/ui/DatabaseStatus.tsx): Update connection checks URL.
