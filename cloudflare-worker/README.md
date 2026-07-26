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

Existing DB — apply the migrations **in numeric order**, `v2` through `v11`:

```bash
npx wrangler d1 execute system-online-db --remote --file=schema-migrate-v2.sql
# ... v3 through v9 ...
npx wrangler d1 execute system-online-db --remote --file=schema-migrate-v10.sql
npx wrangler d1 execute system-online-db --remote --file=schema-migrate-v11.sql
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

Every other migration (`v2`–`v9`, `v11`) is additive — `ALTER TABLE ADD COLUMN`
or `CREATE TABLE IF NOT EXISTS` only — and safe to re-run.

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

**Authentication is mandatory and fail-closed.** If the `API_KEY` secret is not
set, the Worker returns `503 Service Unavailable` for every request rather than
serving the database unauthenticated. Set it before/after deploying:

```bash
npx wrangler secret put API_KEY
```

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
