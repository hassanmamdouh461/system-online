# Operational scripts

One-off diagnostic and infrastructure scripts. Apart from
`seed-manager-credential.mjs` (below), these are run manually by an operator,
not by the build.

## `seed-manager-credential.mjs` — bootstrap the POS login credentials

The supported recovery path for the **first-run / locked-out login deadlock**:
the Worker verifies logins against PBKDF2 credential rows in D1
(`brewmaster_manager_creds_v1` / `brewmaster_admin_creds_v2`), but a fresh D1
has none, so `POST /v1/session` `401`s and the POS renders empty. This script
derives the exact same hash the browser POS produces and emits a ready
`wrangler d1 execute` seed file. The password is supplied at run time and never
committed.

```bash
MANAGER_PASSWORD='…' CASHIER_PASSWORD='…' node scripts/seed-manager-credential.mjs
cd cloudflare-worker
npx wrangler d1 execute system-online-db --remote --file=../seed-credentials.sql
# also exposed as: npm run seed:creds   (from cloudflare-worker/)
```

Its KDF is pinned to the Worker by
`cloudflare-worker/test/seed-bootstrap.integration.test.mts`. See
`cloudflare-worker/README.md` → *Recovery* for the full runbook.

## Required environment variables

The Cloudflare scripts previously had the account and zone identifiers hardcoded
in the source. They now read them from the environment and exit if unset:

| Variable | Description |
| --- | --- |
| `CF_ACCOUNT_ID` | Cloudflare account identifier |
| `CF_ZONE_ID` | Cloudflare zone identifier for the domain |

```bash
# bash / macOS / Linux
export CF_ACCOUNT_ID="..."
export CF_ZONE_ID="..."
node scripts/cf-pos-status.cjs
```

```powershell
# PowerShell
$env:CF_ACCOUNT_ID = "..."
$env:CF_ZONE_ID    = "..."
.\scripts\find-host.ps1
```

API tokens are **not** stored here — the scripts read the local Wrangler OAuth
token from your own `.wrangler/config/default.toml`, so you must be logged in
with `npx wrangler login` first.

## A note on the diagnostic scripts

Several scripts (`check-customers.mjs`, `check-orders-now.mjs`,
`verify-cloud-counts.mjs`) query **live production data** and print customer
records to the terminal. Treat their output as personal data: don't paste it
into tickets, chat, or screenshots.
