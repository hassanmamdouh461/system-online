# ☁️ BrewMaster Backend — Cloudflare Worker + D1

Edge API for BrewMaster POS. Replaces the old Appwrite backend with:

- **Cloudflare Worker** (`src/index.ts`)
- **Cloudflare D1** (SQLite at the edge)

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

Existing DB (safe alters, no DROP):

```bash
npx wrangler d1 execute system-online-db --remote --file=schema-migrate-v2.sql
```

### 4. Deploy Worker

```bash
npx wrangler deploy
```

Example URL:

`https://system-online-backend.<your-subdomain>.workers.dev`

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

Electron reads the same `VITE_CLOUDFLARE_WORKER_URL` from root `.env` (see `electron/mockApiService.cjs`).

---

## API

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/sync` | Client sync queue upsert/delete |
| `GET/POST` | `/v1/databases/:db/collections/:collection/documents` | List / create |
| `GET/PATCH/DELETE` | `/v1/databases/:db/collections/:collection/documents/:id` | Read / update / delete |

Collections / tables: `menu_items`, `orders`, `customers`, `inventory`, `companies`.

---

## Authentication — session cookies (no API key)

Auth is a **server-minted, HttpOnly session cookie**. There is no operator-entered
API key: the browser calls `POST /v1/session`, the Worker signs a session cookie
(HMAC-SHA256), and every later request rides that cookie. The gate is fail-closed
— a valid cookie passes, anything else gets `401`.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/v1/session` | Mint a session (sets the cookie) |
| `GET` | `/v1/session` | Probe: `200 {authenticated:true}` or `401` |
| `DELETE` | `/v1/session` | Clear the session (logout) |

*Why this replaced the API key:* the key was entered under Settings → Cloud Sync,
but that UI was deleted (`53f908d`, `ec257c7`), so the key went permanently blank,
every request `401`'d, and **cloud backup was 100% dead** — data lived only in the
tablet's browser with no way to re-enter the key. A self-establishing session has
no such single point of failure.

Sessions are **stateless**: validity is proven by the HMAC signature plus a 12h
`exp` claim, so there is no `auth_users` table, no migration, and no per-request
DB read. Set a strong signing secret in production:

```bash
npx wrangler secret put SESSION_SECRET   # takes precedence over wrangler.toml [vars]
```

The cookie is `HttpOnly; Secure; SameSite=None` — `SameSite=None` is required
because the POS (`pos.engaz.tech`) and the Worker are different origins, and
`HttpOnly` keeps the token out of reach of JavaScript/XSS. Correspondingly, CORS
must send `Access-Control-Allow-Credentials: true` with a specific (never `*`)
origin, and clients must use `credentials: 'include'`.

**Scope of the barrier (deliberate tradeoff):** the mint endpoint takes no
credential, so anyone who can reach the Worker can obtain a session; for browsers
the barrier is the CORS allowlist, and forging a cookie without going through
`/v1/session` requires `SESSION_SECRET`. This is a *working* backup with a light
barrier, chosen over the prior state of *no backup at all*. If you need real
per-user authorization (cashier vs. manager), see `feat/server-side-auth`.

`API_KEY` is now **optional**. If it is still set, `Authorization: Bearer <key>`
/ `X-API-Key: <key>` continue to be accepted so a half-migrated fleet keeps
syncing; remove the secret to turn that path off. An unset `API_KEY` no longer
503s the Worker.

CORS is also fail-closed: with `ALLOWED_ORIGINS` unset, no permissive CORS
headers are emitted (the Worker never reflects `*`). Set it to a comma-separated
allowlist of your front-end origins.

### Tests

```bash
npm test        # from cloudflare-worker/ — runs the real Worker against a stub D1
```

Covers the acceptance criteria (`401` with no cookie, `200` with one), cookie
attributes, tamper/forgery/expiry rejection, CORS credentials, and the public
menu path. No dependencies required.

### Read pagination

Collection reads are unpaginated by default — this is intentional, since
silently returning only the first N orders would under-report revenue in the
manager dashboard. Pagination is opt-in per request:

| Param | Effect |
| --- | --- |
| `?limit=500` | Cap rows returned (hard ceiling 5000) |
| `?offset=500` | Skip rows; only applied alongside `limit` |
| `?since=<ISO>` | Return only rows updated after the timestamp |
