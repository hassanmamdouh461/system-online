# Fix: 401 Unauthorized on every collection (`api.engaz.tech`)

> **الخلاصة (TL;DR):** كل طلبات `GET /v1/databases/default/collections/*/documents`
> بترجع **401** لأن الـ Worker مش عارف يعمل **mint** لـ session cookie. السبب
> (اتأكد live على الـ remote يوم 2026-07-27): كل مفتاح اعتماد كان متخزّن في
> `settings` **3 مرات** بـ `id` مختلفة (`global::`, `main_branch::`, `manager::`)
> و**hash مختلف** لكل نسخة. الـ Worker بقرأ `WHERE key = ? ORDER BY updated_at
> DESC LIMIT 1`، ولأن `updated_at` فاضي/متماثل فالترتيب **غير محدّد** → بيقرأ
> hash عشوائي → الباسورد بيفشل → مفيش cookie → كل قراءة 401. الحل النهائي =
> **تنظيف الصفوف اليتيمة** (`cloudflare-worker/cleanup-orphan-creds.sql`) + **زرع
> (seed) صف واحد بـ `global::`** بالباسورد الحقيقي عبر `scripts/seed-manager-credential.mjs`
> + `wrangler` (محتاج صلاحية Cloudflare وباسورد المالك — خطوة يدوية خارج صلاحيات
> الأتمتة).

## Symptom

Browser console shows, repeatedly:

```
api.engaz.tech/v1/databases/default/collections/<name>/documents  401 (Unauthorized)
[cloud] GET <name> failed: HTTP 401
[hydrateFromCloud] {ok: true, configured: true, orders: 0, menu: 0, customers: 0, …}
```

Every collection (`orders`, `menu_items`, `customers`, `companies`, `inventory`,
`settings`, `recipes`, `inventory_transactions`) returns 401, so the POS renders
empty even though D1 contains data.

## Root cause — duplicate credential rows + non-deterministic read (NOT a missing row / Worker / CORS / secret bug)

> **Correction (2026-07-27):** an earlier version of this section claimed the
> credential rows were *absent* from D1. That was wrong — they were present, but
> **triplicated with conflicting hashes**, and the Worker read them
> non-deterministically. The cleanup step below (`cleanup-orphan-creds.sql`) is
> therefore **required**, not optional; seeding alone does not fix the 401.

Confirmed by live probing of the deployed Worker on 2026-07-27:

| Probe | Result | Meaning |
|-------|--------|---------|
| `GET /api/health` | `200 {ok:true, db:"ok", orderCount:8, lastWriteAt:"2026-07-26T21:41:03Z"}` | Worker is deployed, D1 is bound and **has data**. |
| `POST /v1/session` (empty body, `Origin: https://pos.engaz.tech`) | `401 "Valid credentials required to start a session."` | Session route works, CORS is correct, and **`SESSION_SECRET` is configured** (a missing secret would fail-closed with `503`, not `401`). |
| `GET /v1/session` (no cookie) | `401 {authenticated:false}` | Expected — no session yet. |
| `SELECT id,key FROM settings WHERE key LIKE 'brewmaster_%creds%'` | **3 rows per key** (`global::`, `main_branch::`, `manager::`) with **different hashes** | The actual cause — see below. |

So the Worker, D1, `SESSION_SECRET`, and CORS are all **healthy**. The failure is
that the password verification reads the wrong row:

1. `cloudFetch` (src/services/cloudConfig.ts) calls `ensureCloudSession()` before
   every request. Auth rides an HttpOnly cookie via `credentials: 'include'`.
2. `ensureCloudSession()` mints a cookie by `POST /v1/session` **only when it holds
   the operator password in memory**. The Worker verifies that password against the
   PBKDF2 hash stored in D1 `settings` (`brewmaster_manager_creds_v1` ⇒ manager,
   `brewmaster_admin_creds_v2` ⇒ cashier) — see `cloudflare-worker/src/auth.ts` →
   `resolvePasswordRole`.
3. **Each credential key had THREE rows** — `global::<key>`,
   `main_branch::<key>`, `manager::<key>` — each carrying a *different* PBKDF2
   hash. The POS client writes credentials with **one** id only:
   `global::<key>` (`settingsCloudService.ts` → `settingDocId`, because both keys
   are in `DURABLE_SETTING_KEYS`). The other two prefixes are orphans left by an
   older code revision.
4. `readCredsRecord` (`auth.ts`) ran `SELECT value FROM settings WHERE key = ?
   ORDER BY updated_at DESC LIMIT 1`. Because every row's `updated_at` was empty
   or equal, that `ORDER BY` is a **tie** and SQLite returns an **arbitrary** row.
   The Worker therefore compared the typed password against a random one of the
   three hashes → `resolvePasswordRole` returned `null` ⇒ mint returned 401 ⇒ no
   cookie ⇒ the auth gate in `cloudflare-worker/src/index.ts` rejected every
   collection read with 401.

**The fix is two steps, both required:** (a) delete the orphaned rows so
`global::` is the single source of truth, and (b) reseed `global::` with the
operator's real password. The read query is also hardened to be deterministic
(`WHERE id = 'global::' || key`) so the class of bug cannot recur — see
`cloudflare-worker/src/auth.ts`.

Secondary noise: `src/App.tsx` (~line 277) calls `hydrateFromCloud(true)`
unconditionally at boot — before any login — so the 401 storm fires even on the
login screen. Fixing the deadlock removes the storm for authenticated users; gating
boot hydration behind an authenticated, mintable session is an optional follow-up.

## The fix (server-side — requires Cloudflare access + the owner's password)

**Two phases, both required:** first remove the orphaned duplicate rows so
`global::` is the only credential row the Worker can read, then (re)seed it with
the operator's real password. Seeding alone does NOT fix the 401 — the Worker would
still read an arbitrary orphan at the next request.

> The repo already ships both tools: `cloudflare-worker/cleanup-orphan-creds.sql`
> (added with this fix) and `scripts/seed-manager-credential.mjs` (commit `f0ee649`,
> which derives the exact PBKDF2 hash the POS/Worker use and emits a `wrangler d1
> execute` seed file). The password never leaves the machine and is never committed.

### 0. Clean up the orphaned credential rows (REQUIRED — do this first)

```bash
# from cloudflare-worker/ — deletes the 4 orphaned rows (main_branch::/*, manager::/*)
# and keeps the global:: rows. Business data is untouched.
cd cloudflare-worker
npx wrangler d1 execute system-online-db --remote --file=cleanup-orphan-creds.sql
```

Verify exactly one row per key remains:
```bash
npx wrangler d1 execute system-online-db --remote \
  --command "SELECT id,key FROM settings WHERE key LIKE 'brewmaster_%creds%';"
# expect exactly two rows, both with id = 'global::<key>'
```

### 1. Seed the MANAGER credential

```bash
# from repo root — choose the real manager password
MANAGER_PASSWORD='YOUR_MANAGER_PASSWORD' node scripts/seed-manager-credential.mjs
# → writes seed-manager.sql (INSERT OR REPLACE on global::brewmaster_manager_creds_v1)

cd cloudflare-worker
npx wrangler d1 execute system-online-db --remote --file=../seed-manager.sql
```

### 2. Seed the CASHIER/ADMIN credential (the main POS login screen)

```bash
# from repo root — choose the real cashier password
KEY=brewmaster_admin_creds_v2 MANAGER_PASSWORD='YOUR_CASHIER_PASSWORD' \
  OUT=seed-cashier.sql node scripts/seed-manager-credential.mjs

cd cloudflare-worker
npx wrangler d1 execute system-online-db --remote --file=../seed-cashier.sql
```

> Seed with the **same passwords the operators actually type** at login. If a
> browser still holds an *old* local hash, log out / clear site data so the typed
> password is the one verified against the freshly-seeded D1 hash.

### 3. Verify

```bash
# expect authenticated:true + a Set-Cookie: pos_session=...
curl -i -X POST https://api.engaz.tech/v1/session \
  -H 'Content-Type: application/json' \
  -H 'Origin: https://pos.engaz.tech' \
  -d '{"password":"YOUR_MANAGER_PASSWORD"}'
```

Then reload the POS and confirm the collection GETs return `200` and data appears.
After first login you can change passwords from **Settings** — a normal manager
session can now write the credential rows itself.

## Optional follow-ups (client hardening — safe to do later)

- Gate `hydrateFromCloud(true)` in `src/App.tsx` behind `isAuthenticated` so an
  unauthenticated boot doesn't 401-storm.
- When `ensureCloudSession()` cannot mint (no in-memory password **and** no valid
  cookie), surface a clear "session expired — please sign in again" toast instead of
  silently returning empty data (see `src/services/cloudConfig.ts` /
  `src/context/DataContext.tsx`).
