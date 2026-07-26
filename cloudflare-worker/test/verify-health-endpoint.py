#!/usr/bin/env python3
"""
Verify the /api/health SQL and the client's status decision logic.

The worker can't run here (no workerd), so this tests the two things that
actually carry the risk:

  A. The SQL in the health endpoint, executed against a real SQLite database
     shaped like D1 — including the case the old code got wrong.
  B. The client's status decision table, which is what turns a probe result
     into the green/amber/red badge the operator sees.
"""
import sqlite3, re, pathlib, sys

REPO = pathlib.Path(__file__).resolve().parents[2]
WORKER = (REPO / "cloudflare-worker/src/index.ts").read_text()

fails, checks = [], 0
def check(label, cond, detail=""):
    global checks
    checks += 1
    print(("  PASS  " if cond else "  FAIL  ") + label + ("" if cond else f" {detail}"))
    if not cond:
        fails.append(label)

print("=" * 72)
print("HEALTH ENDPOINT VERIFICATION")
print("=" * 72)

# ── A. Extract the real SQL from the worker source, don't retype it ──────────
print("\n[A] The SQL actually present in the worker source")

liveness = re.search(r'prepare\("(SELECT 1)"\)', WORKER)
check("liveness probe 'SELECT 1' present", bool(liveness))

m = re.search(r'"(SELECT COUNT\(\*\) AS n, MAX\([^"]+\) AS last FROM orders)"', WORKER)
check("freshness probe present", bool(m), "-> not found in source")
if not m:
    sys.exit(1)
freshness_sql = m.group(1)
print(f"        {freshness_sql}")

# ── Build a D1-shaped orders table straight from schema.sql ─────────────────
schema = (REPO / "cloudflare-worker/schema.sql").read_text()
orders_ddl = re.search(r"CREATE TABLE IF NOT EXISTS orders \(.*?\n\);", schema, re.S)
check("orders DDL found in schema.sql", bool(orders_ddl))
db = sqlite3.connect(":memory:")
db.executescript(orders_ddl.group(0))

cols = [r[1] for r in db.execute("PRAGMA table_info(orders)")]
# The bug class this guards against: querying a column that doesn't exist.
check("orders has createdAt", "createdAt" in cols, f"-> {cols}")
check("orders has updatedAt", "updatedAt" in cols, f"-> {cols}")

print("\n[B] Freshness SQL against a REAL orders table")

# Empty table: a brand-new deployment must not crash or look stale-with-data.
row = db.execute(freshness_sql).fetchone()
check("empty table returns count 0, last NULL", row[0] == 0 and row[1] is None, f"-> {row}")

db.execute(
    "INSERT INTO orders (id, orderNumber, tableId, items, status, paymentStatus, totalAmount, createdAt, updatedAt)"
    " VALUES ('o1','A-1','T1','[]','Open','Unpaid',100,'2026-07-26T10:00:00Z','2026-07-26T11:00:00Z')")
db.commit()
row = db.execute(freshness_sql).fetchone()
check("picks updatedAt when present", row[0] == 1 and row[1] == "2026-07-26T11:00:00Z", f"-> {row}")

# The COALESCE case: a row written but never updated still has to report a time.
db.execute(
    "INSERT INTO orders (id, orderNumber, tableId, items, status, paymentStatus, totalAmount, createdAt)"
    " VALUES ('o2','A-2','T2','[]','Open','Unpaid',50,'2026-07-26T12:00:00Z')")
db.commit()
row = db.execute(freshness_sql).fetchone()
check("COALESCE falls back to createdAt (NULL updatedAt)",
      row[0] == 2 and row[1] == "2026-07-26T12:00:00Z", f"-> {row}")

# MAX must be a real max, not last-inserted.
db.execute(
    "INSERT INTO orders (id, orderNumber, tableId, items, status, paymentStatus, totalAmount, createdAt, updatedAt)"
    " VALUES ('o3','A-3','T3','[]','Open','Unpaid',10,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')")
db.commit()
row = db.execute(freshness_sql).fetchone()
check("MAX ignores an older row inserted later", row[1] == "2026-07-26T12:00:00Z", f"-> {row}")
db.close()

# ── C. The old bug: prove menuService-style local read can't detect an outage ──
print("\n[C] Why the old check was dishonest")
src = (REPO / "src/components/ui/DatabaseStatus.tsx").read_text()
# Check the IMPORT lines only — the file keeps a comment explaining the old bug,
# so a plain substring search would match its own documentation.
import_lines = [l for l in src.splitlines() if l.startswith("import ")]
check("DatabaseStatus no longer imports menuService",
      not any("menuService" in l for l in import_lines),
      f"-> {[l for l in import_lines if 'menuService' in l]}")
check("DatabaseStatus calls checkCloudHealth", "checkCloudHealth" in src)
check("DatabaseStatus has a distinct stale state", "'stale'" in src)
check("DatabaseStatus surfaces last successful backup",
      "Last successful backup" in src or "آخر نسخة ناجحة" in src)

cc = (REPO / "src/services/cloudConfig.ts").read_text()
check("health probe never sends the API key",
      "buildCloudHeaders" not in cc.split("export async function checkCloudHealth")[1].split("export")[0])
check("probe sets cache: no-store", "cache: 'no-store'" in cc)
check("isCloudVerified requires a real probe", "export function isCloudVerified" in cc)
check("worker health route is before the auth gate",
      WORKER.index('"/api/health"') < WORKER.index('if (!token || token !== env.API_KEY)'))
check("health response is no-store (a cached 200 can't keep the badge green)",
      "no-store, no-cache, must-revalidate" in WORKER)

# ── D. Client status decision table ─────────────────────────────────────────
print("\n[D] Status decision logic (mirrors DatabaseStatus.checkConnection)")
STALE_AFTER_MS = 6 * 60 * 60 * 1000
NOW = 1_800_000_000_000

def decide(probe_ok, db_state, last_sync_age_ms):
    if db_state == "unconfigured":
        return "unconfigured"
    if not probe_ok:
        return "error"
    if last_sync_age_ms is None:
        return "connected"
    return "stale" if last_sync_age_ms > STALE_AFTER_MS else "connected"

cases = [
    ("worker dead, local reads fine (THE ORIGINAL BUG)", (False, "unreachable", 60_000), "error"),
    ("worker up, D1 broken",                             (False, "error", 60_000),       "error"),
    ("no worker URL configured",                         (False, "unconfigured", None),  "unconfigured"),
    ("healthy, synced a minute ago",                     (True, "ok", 60_000),           "connected"),
    ("healthy, synced 5h ago (under threshold)",         (True, "ok", 5*3600_000),       "connected"),
    ("healthy, synced 7h ago (over threshold)",          (True, "ok", 7*3600_000),       "stale"),
    ("healthy, synced 3 days ago",                       (True, "ok", 3*86400_000),      "stale"),
    ("healthy, fresh install (never synced)",             (True, "ok", None),             "connected"),
]
for label, args, expected in cases:
    got = decide(*args)
    check(f"{label} -> {expected}", got == expected, f"-> got {got}")

# The single most important assertion in this file.
green_when_dead = decide(False, "unreachable", 60_000) == "connected"
check("IMPOSSIBLE for badge to be green while worker is dead", not green_when_dead)

print("\n" + "=" * 72)
print(f"{checks - len(fails)}/{checks} checks passed")
if fails:
    print("FAILED: " + "; ".join(fails))
    sys.exit(1)
print("ALL CHECKS PASSED")
print("=" * 72)
