# Operational scripts

One-off diagnostic and infrastructure scripts. **None of these are referenced by
`package.json`** — they are run manually by an operator, not by the build.

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
