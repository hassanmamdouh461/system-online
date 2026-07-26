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

Existing DB — apply the migrations **in numeric order**, `v2` through `v12`
(`v11` is intentionally skipped — see the note below):

```bash
npx wrangler d1 execute system-online-db --remote --file=schema-migrate-v2.sql
# ... v3 through v9 ...
npx wrangler d1 execute system-online-db --remote --file=schema-migrate-v10.sql
# v11 is intentionally skipped (superseded server-auth migration — see note below)
npx wrangler d1 execute system-online-db --remote --file=schema-migrate-v12.sql
```

There is no migration-tracking table, so applying these is manual and **order
matters**. Each file's header comment states its prerequisite and how to verify
it landed.

⚠️ **`v10` is the one destructive migration.** SQLite cannot drop a column-level
constraint in place, so removing `UNIQUE` from `customers.phone` requires a table
rebuild (`CREATE` → copy → `DROP TABLE customers` → `RENAME`). It is wrapped in a
transaction and rolls back on any error, but it is not reversible once committed.
Export a backup first:

```bash
npx wrangler d1 export system-online-db --remote --output=pre-v10-backup.sql
```

`v10` also drops the dormant `customers.points` column left over from the removed
loyalty feature. If your database still holds values there, export them first:

```bash
npx wrangler d1 execute system-online-db --remote \
  --command="SELECT id, points FROM customers WHERE points > 0;"
```

Migrations `v2`–`v9` are additive — `ALTER TABLE ADD COLUMN` or `CREATE TABLE IF
NOT EXISTS` only.

**`v11` is intentionally absent.** It was a server-side authentication migration
(`auth_users`, `login_attempts`) belonging to a session-auth approach that was
**superseded by the API-key role model** (see `SECURITY-DEPLOY.md`). Do **not**
apply it on fresh installs. If an existing database already created those tables
from an earlier run, they are **inert** — no worker code reads them — and can be
left in place.

`v12` is a data-only backfill that rounds already-stored money columns to the
piaster with `ROUND()`; it changes no schema, is idempotent, and is safe to
re-run.

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

## Security note

**Authentication is mandatory and fail-closed.** If no API key secret is set,
the Worker returns `503 Service Unavailable` for every request rather than
serving the database unauthenticated.

### Role-based authorization

The caller's **role is derived from which secret it presents** — the client never
declares its own role, so a tampered `localStorage` session cannot grant server
rights:

```bash
npx wrangler secret put MANAGER_API_KEY   # full rights
npx wrangler secret put CASHIER_API_KEY   # constrained by the permission matrix
npx wrangler secret put REFUND_PIN        # cashier refund escalation
```

A cashier key cannot delete anything, edit the menu or recipes, create inventory
items, re-price stock, write sensitive settings (password hashes, PIN, tax rate,
store config), or refund without a valid `X-Refund-PIN`. Every decision lives in
[`src/permissions.ts`](./src/permissions.ts) as pure, testable functions, and is
enforced at a single `authorize()` call site in `src/index.ts`.

Full matrix, deployment order and verification steps:
**[SECURITY-DEPLOY.md](./SECURITY-DEPLOY.md)**

```bash
npm test   # 88 matrix checks + 39 end-to-end checks, no install needed
```

> **`API_KEY` is deprecated.** It still authenticates *as manager* so installs
> already in the field keep working during rollout, and logs a warning on every
> use. Delete it (`npx wrangler secret delete API_KEY`) once the real keys are
> distributed — until then the authorization split is not fully enforced.

Clients must send the key as either `Authorization: Bearer <key>` or
`X-API-Key: <key>`. In the app it is entered by the operator under
Settings → Cloud Sync and stored in `localStorage`; it is deliberately **not**
read from a `VITE_*` variable, because those are inlined into the public
JavaScript bundle.

CORS is also fail-closed: with `ALLOWED_ORIGINS` unset, no permissive CORS
headers are emitted (the Worker never reflects `*`). Set it to a comma-separated
allowlist of your front-end origins.

### Read pagination

Collection reads are unpaginated by default — this is intentional, since
silently returning only the first N orders would under-report revenue in the
manager dashboard. Pagination is opt-in per request:

| Param | Effect |
| --- | --- |
| `?limit=500` | Cap rows returned (hard ceiling 5000) |
| `?offset=500` | Skip rows; only applied alongside `limit` |
| `?since=<ISO>` | Return only rows updated after the timestamp |
