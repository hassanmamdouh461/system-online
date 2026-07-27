# ☁️ BrewMaster Backend — Cloudflare Worker + D1

Edge API for BrewMaster POS. Replaces the old Appwrite backend with:

- **Cloudflare Worker** (`src/index.ts`)
- **Cloudflare D1** (SQLite at the edge)

Authentication is a **credential-gated, role-bearing HttpOnly session cookie**
(see `src/auth.ts`). There is no anonymous access and no shared API key in the
browser — the operator's POS password is verified server-side against PBKDF2
hashes stored in D1, and the resulting role (`manager` | `cashier`) is baked
into an HMAC-signed cookie.

---

## Deploy steps

### 1. Install & login

```bash
cd cloudflare-worker
npm install
npx wrangler login
```

### 2. Create D1 database

```bash
npx wrangler d1 create system-online-db
```

Copy the returned `database_id` into `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "system-online-db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

### 3. Apply schema

Fresh DB:

```bash
npx wrangler d1 execute system-online-db --remote --file=schema.sql
```

Existing DB — apply the migrations **in order** (`schema-migrate-v2.sql` →
`…v12.sql`), each one once. Most are additive `ALTER TABLE`s, **but
`schema-migrate-v10.sql` is a table rebuild that runs `DROP TABLE customers`**
(SQLite cannot drop a column-level `UNIQUE` in place). It is wrapped in a
transaction and is not reversible, so **export a backup before running it**:

```bash
npx wrangler d1 export system-online-db --remote --output=pre-v10.sql
npx wrangler d1 execute system-online-db --remote --file=schema-migrate-v10.sql
```

### 4. Configure the session secret (REQUIRED)

The Worker signs session cookies with `SESSION_SECRET`. Without it the Worker
**fails closed** and refuses to mint sessions (`503`) — it never falls back to a
default. Set it as a secret (never as a `[vars]` entry — `wrangler.toml` is
committed):

```bash
npx wrangler secret put SESSION_SECRET
```

### 5. Deploy

```bash
npx wrangler deploy
```

Example URL: `https://system-online-backend.<your-subdomain>.workers.dev`

### 6. Seed the login credentials (breaks the first-run login deadlock)

The Worker verifies logins against PBKDF2 credential rows in D1
(`brewmaster_manager_creds_v1` ⇒ manager, `brewmaster_admin_creds_v2` ⇒
cashier). On a brand-new D1 those rows do not exist yet — and writing them
normally needs a manager session, which needs the rows. Break that chicken-and-
egg with the seed script (see **Recovery** below). This is a mandatory one-time
step on a fresh deploy, or login will `401` forever.

---

## Connect the frontend

In the project root `.env`:

```env
VITE_CLOUDFLARE_WORKER_URL=https://system-online-backend.<your-subdomain>.workers.dev
```

Then rebuild:

```bash
cd ..
npm run build
```

The frontend needs **only** the Worker URL. It never holds an API key — auth is
the session cookie described above.

---

## API

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `POST` | `/v1/session` | credential | Mint a session cookie (password or role-scoped key) → `200` + `Set-Cookie` |
| `GET` | `/v1/session` | cookie | Status probe → `{ authenticated, role }` (`401` when none) |
| `DELETE` | `/v1/session` | — | Clear the session cookie (logout) |
| `GET` | `/api/health` | public | Liveness + D1 probe (no data), in front of the auth gate |
| `GET` | `/public/menu` | public | Live, available menu items for the QR page (no session) |
| `POST` | `/api/sync` | session | Client sync-queue upsert/delete |
| `GET/POST` | `/v1/databases/:db/collections/:collection/documents` | session | List / create |
| `GET/PATCH/DELETE` | `/v1/databases/:db/collections/:collection/documents/:id` | session | Read / update / delete |

Collections / tables: `menu_items`, `orders`, `customers`, `inventory`,
`companies` (plus `recipes`, `inventory_transactions`, `snapshots`, `settings`).

---

## Security model

**Authentication is mandatory and fail-closed.**

- **`SESSION_SECRET` (required).** HMAC key that signs the session cookie. Unset
  ⇒ the Worker returns `503` for `POST /v1/session` and never mints. Set with
  `npx wrangler secret put SESSION_SECRET`. **Rotation:** if a `SESSION_SECRET`
  value was ever committed (an earlier `fix/cookie-session-backup` branch shipped
  one under `[vars]`) and deployed, treat it as leaked — anyone with that value
  can forge a valid cookie. Rotate it: `npx wrangler secret put SESSION_SECRET`
  with a fresh random value, then redeploy. All existing cookies become invalid
  and users simply log in again.
- **Login credentials live in D1**, not in the Worker: PBKDF2-SHA256 (100k)
  salted hashes under `brewmaster_manager_creds_v1` / `brewmaster_admin_creds_v2`.
  The Worker verifies the typed password against them (`auth.ts`
  `resolvePasswordRole`) and never stores the password. Seed them once (below).
- **Optional headless keys** (`MANAGER_API_KEY`, `CASHIER_API_KEY`) and a
  **transitional legacy `API_KEY`** (⇒ manager, for un-migrated tills) are read
  from Worker secrets if set. The browser POS needs none of them.
- **CORS is fail-closed.** With `ALLOWED_ORIGINS` unset the Worker emits no
  permissive CORS headers (never reflects `*`). It is a `[vars]` entry (public,
  not a secret) — set it to your POS origin(s), comma-separated.
- **CSRF is closed two ways** for cookie-authenticated writes: a strict `Origin`
  allowlist and a double-submit `X-CSRF-Token` (returned in the mint body, bound
  to the session). Header-key callers and GETs are exempt.
- **`REFUND_PIN` (optional).** Lets a cashier escalate a refund via
  `X-Refund-PIN`. Unset ⇒ refunds are manager-only.

Set secrets with `wrangler secret put <NAME>` — never as `[vars]` in
`wrangler.toml` (it is committed to the repo).

---

## Recovery: first-run / locked-out login (401 session-bootstrap deadlock)

Symptom: `GET /api/health` is `200` and D1 has data, but `POST /v1/session`
returns `401` for the correct password, no `Set-Cookie` is issued, and the POS
renders empty. Cause: the credential rows above were never seeded in D1.

Fix — seed them with a password of your choice (the password never leaves your
machine; only a salted PBKDF2 hash is written):

```bash
# from the repo root
MANAGER_PASSWORD='your-strong-manager-pass' \
CASHIER_PASSWORD='your-strong-cashier-pass' \
node scripts/seed-manager-credential.mjs
# → writes seed-credentials.sql

cd cloudflare-worker
npx wrangler d1 execute system-online-db --remote --file=../seed-credentials.sql
```

Then log in on the POS with that password (change it later from Settings — a
normal manager session can now write it). The seed row id is `global::<key>`,
identical to what the POS writes, so a later change replaces it rather than
duplicating it. A CI test (`test/seed-bootstrap.integration.test.mts`) pins the
seed script's KDF to the Worker's verifier so this recovery path can never
silently drift.

---

### Read pagination

Collection reads are unpaginated by default — this is intentional, since
silently returning only the first N orders would under-report revenue in the
manager dashboard. Pagination is opt-in per request:

| Param | Effect |
| --- | --- |
| `?limit=500` | Cap rows returned (hard ceiling 5000) |
| `?offset=500` | Skip rows; only applied alongside `limit` |
| `?since=<ISO>` | Return only rows updated after the timestamp |

---

## Tests

```bash
npm test   # auth, session, seed-bootstrap, permissions, csrf (Node type-strip; no deps)
```
