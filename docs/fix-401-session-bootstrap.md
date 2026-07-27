# Fix: 401 Unauthorized on every collection (`api.engaz.tech`)

> **الخلاصة (TL;DR):** كل طلبات `GET /v1/databases/default/collections/*/documents`
> بترجع **401** لأن الـ Worker مش عارف يعمل **mint** لـ session cookie. السبب: صف
> بيانات دخول المدير/الكاشير **مش موجود في قاعدة D1** (`settings`)، فالتحقق من
> الباسورد بيفشل → مفيش cookie → كل قراءة 401. الحل النهائي = **زرع (seed) صف
> الاعتماد في D1** عن طريق `scripts/seed-manager-credential.mjs` + `wrangler` (محتاج
> صلاحية Cloudflare وباسورد المالك — خطوة يدوية خارج صلاحيات الأتمتة).

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

## Root cause — a credential bootstrap deadlock (NOT a Worker/CORS/secret bug)

Confirmed by live probing of the deployed Worker on 2026-07-27:

| Probe | Result | Meaning |
|-------|--------|---------|
| `GET /api/health` | `200 {ok:true, db:"ok", orderCount:8, lastWriteAt:"2026-07-26T21:41:03Z"}` | Worker is deployed, D1 is bound and **has data**. |
| `POST /v1/session` (empty body, `Origin: https://pos.engaz.tech`) | `401 "Valid credentials required to start a session."` | Session route works, CORS is correct, and **`SESSION_SECRET` is configured** (a missing secret would fail-closed with `503`, not `401`). |
| `GET /v1/session` (no cookie) | `401 {authenticated:false}` | Expected — no session yet. |

So the Worker, D1, `SESSION_SECRET`, and CORS are all **healthy**. The failure is
that the client can never obtain a session cookie:

1. `cloudFetch` (src/services/cloudConfig.ts) calls `ensureCloudSession()` before
   every request. Auth rides an HttpOnly cookie via `credentials: 'include'`.
2. `ensureCloudSession()` mints a cookie by `POST /v1/session` **only when it holds
   the operator password in memory**. The Worker verifies that password against the
   PBKDF2 hash stored in D1 `settings` (`brewmaster_manager_creds_v1` ⇒ manager,
   `brewmaster_admin_creds_v2` ⇒ cashier) — see `cloudflare-worker/src/auth.ts` →
   `resolvePasswordRole`.
3. **That credential row is absent from D1.** With no row, `resolvePasswordRole`
   returns `null` ⇒ mint returns 401 ⇒ no cookie ⇒ the auth gate in
   `cloudflare-worker/src/index.ts` rejects every collection read with 401.

It is a chicken-and-egg deadlock: writing the credential row to D1 needs a manager
session, and minting a manager session needs that row. The app still *appears*
logged in because `AuthContext.login()` can pass on the **local** (localStorage)
credential hash, but the parallel cloud mint silently fails — hence "logged in, but
everything is 401 and empty".

Secondary noise: `src/App.tsx` (~line 277) calls `hydrateFromCloud(true)`
unconditionally at boot — before any login — so the 401 storm fires even on the
login screen. Fixing the deadlock removes the storm for authenticated users; gating
boot hydration behind an authenticated, mintable session is an optional follow-up.

## The fix (server-side — requires Cloudflare access + the owner's password)

The repo already ships the tool for this: `scripts/seed-manager-credential.mjs`
(added in commit `f0ee649`). It derives the exact PBKDF2 hash the POS/Worker use and
emits a `wrangler d1 execute` seed file. The password never leaves the machine and is
never committed.

### 1. Seed the MANAGER credential

```bash
# from repo root — choose the real manager password
MANAGER_PASSWORD='YOUR_MANAGER_PASSWORD' node scripts/seed-manager-credential.mjs
# → writes seed-manager.sql

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
