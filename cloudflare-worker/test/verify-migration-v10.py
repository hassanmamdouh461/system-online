#!/usr/bin/env python3
"""
Prove schema-migrate-v10.sql is correct against a realistic D1 database.

Simulates the actual production history: schema.sql (pre-v10, WITH UNIQUE(phone))
-> v7 indexes -> v9 deleted_at -> then applies v10 and asserts:
  1. It executes without error.
  2. Zero rows are lost, and every field value survives byte-for-byte.
  3. UNIQUE(phone) is really gone (a duplicate phone now inserts).
  4. Indexes are restored.
  5. The final column set matches the worker's ALLOWED_COLUMNS.customers exactly.
  6. A failure mid-migration rolls back cleanly (transaction safety).
"""
import sqlite3, sys, re, pathlib

REPO = pathlib.Path(__file__).resolve().parents[2]
V10 = (REPO / "cloudflare-worker/schema-migrate-v10.sql").read_text()

# The worker's authoritative contract: ALLOWED_COLUMNS.customers in src/index.ts
WORKER_COLUMNS = ["id", "name", "phone", "company_id", "tags", "notes",
                  "createdAt", "updated_at", "branch_id", "deleted_at"]

# Production shape BEFORE v10: original schema.sql + v9's ALTER.
PRE_V10 = """
CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT UNIQUE NOT NULL,
  company_id TEXT,
  tags TEXT,
  notes TEXT,
  createdAt TEXT NOT NULL,
  updated_at TEXT,
  branch_id TEXT DEFAULT 'default'
);
CREATE INDEX IF NOT EXISTS idx_customers_phone   ON customers(phone);
CREATE INDEX IF NOT EXISTS idx_customers_company ON customers(company_id);
CREATE INDEX IF NOT EXISTS idx_customers_updated ON customers(updated_at);
ALTER TABLE customers ADD COLUMN deleted_at TEXT;
"""

# Realistic rows: arabic names, NULLs, JSON tags, a tombstone, quotes, unicode.
ROWS = [
    ("c1", "أحمد محمود",      "01001234567", "co1",  '["vip","regular"]', "دفع كاش",      "2026-01-05T10:00:00Z", "2026-06-01T10:00:00Z", "default", None),
    ("c2", "Sara O'Brien",    "01109876543", None,   '[]',                None,            "2026-02-11T09:30:00Z", None,                   "default", None),
    ("c3", "مطعم الشام",       "01223334444", "co2",  '["company"]',       'has "quotes"',  "2026-03-01T12:00:00Z", "2026-07-20T08:00:00Z", "default", "2026-07-21T00:00:00Z"),
    ("c4", "Zeinab ✅ Ali",    "01555556666", None,   None,                "emoji test",    "2026-04-15T15:45:00Z", "2026-07-01T11:11:11Z", "default", None),
]

def build(path):
    db = sqlite3.connect(path)
    db.executescript(PRE_V10)
    db.executemany(
        "INSERT INTO customers (id,name,phone,company_id,tags,notes,createdAt,updated_at,branch_id,deleted_at)"
        " VALUES (?,?,?,?,?,?,?,?,?,?)", ROWS)
    db.commit()
    return db

def snapshot(db):
    cur = db.execute("SELECT " + ",".join(WORKER_COLUMNS) + " FROM customers ORDER BY id")
    return cur.fetchall()

fails, checks = [], 0
def check(label, cond, detail=""):
    global checks
    checks += 1
    if cond:
        print(f"  PASS  {label}")
    else:
        print(f"  FAIL  {label} {detail}")
        fails.append(label)

print("=" * 72)
print("v10 MIGRATION VERIFICATION")
print("=" * 72)

# ---- Guard: the pre-v10 schema really does reject duplicate phones ----
print("\n[0] Confirm the bug exists BEFORE v10 (duplicate phone must fail)")
db = build(":memory:")
before = snapshot(db)
try:
    db.execute("INSERT INTO customers (id,name,phone,createdAt) VALUES ('dup','Dup','01001234567','2026-07-01T00:00:00Z')")
    check("pre-v10 rejects duplicate phone", False, "-> insert unexpectedly SUCCEEDED")
except sqlite3.IntegrityError as e:
    check("pre-v10 rejects duplicate phone (the bug)", "UNIQUE" in str(e).upper(), f"-> {e}")
db.close()

# ---- Apply v10 ----
print("\n[1] Apply v10")
db = build(":memory:")
before = snapshot(db)
try:
    db.executescript(V10)
    check("v10 executes without error", True)
except Exception as e:
    check("v10 executes without error", False, f"-> {type(e).__name__}: {e}")
    print("\nABORT: migration failed to run.")
    sys.exit(1)

# ---- Data integrity ----
print("\n[2] Data integrity")
after = snapshot(db)
check(f"row count preserved ({len(before)} rows)", len(before) == len(after),
      f"-> before={len(before)} after={len(after)}")
check("every field survives byte-for-byte", before == after,
      f"\n        before={before}\n        after ={after}")
tomb = db.execute("SELECT deleted_at FROM customers WHERE id='c3'").fetchone()[0]
check("v9 tombstone preserved", tomb == "2026-07-21T00:00:00Z", f"-> {tomb!r}")
arabic = db.execute("SELECT name FROM customers WHERE id='c1'").fetchone()[0]
check("unicode/arabic intact", arabic == "أحمد محمود", f"-> {arabic!r}")

# ---- The actual fix ----
print("\n[3] The fix: UNIQUE(phone) is gone")
ddl = db.execute("SELECT sql FROM sqlite_master WHERE name='customers'").fetchone()[0]
# Strip `-- ...` comments first: the migration keeps an explanatory
# "-- was: phone TEXT UNIQUE NOT NULL" note, which is not a real constraint.
ddl_code = re.sub(r"--[^\n]*", "", ddl)
check("DDL has no UNIQUE constraint (comments stripped)",
      "UNIQUE" not in ddl_code.upper(), f"-> {ddl_code}")
try:
    db.execute("INSERT INTO customers (id,name,phone,createdAt) VALUES "
               "('c5','Second Device','01001234567','2026-07-26T00:00:00Z')")
    check("duplicate phone now inserts (sync no longer stalls)", True)
except sqlite3.IntegrityError as e:
    check("duplicate phone now inserts", False, f"-> still rejected: {e}")
# id must STILL be unique
try:
    db.execute("INSERT INTO customers (id,name,phone,createdAt) VALUES "
               "('c1','Clash','09999999999','2026-07-26T00:00:00Z')")
    check("PRIMARY KEY(id) still enforced", False, "-> duplicate id was accepted!")
except sqlite3.IntegrityError:
    check("PRIMARY KEY(id) still enforced", True)
# NOT NULL must survive
try:
    db.execute("INSERT INTO customers (id,name,phone,createdAt) VALUES ('c6',NULL,'0100','x')")
    check("NOT NULL(name) still enforced", False, "-> NULL name accepted!")
except sqlite3.IntegrityError:
    check("NOT NULL(name) still enforced", True)

# ---- Indexes ----
print("\n[4] Indexes restored")
idx = {r[0] for r in db.execute(
    "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='customers'")}
for want in ("idx_customers_phone", "idx_customers_company", "idx_customers_updated"):
    check(f"{want} exists", want in idx, f"-> found {sorted(idx)}")

# ---- Column contract ----
print("\n[5] Column set matches worker ALLOWED_COLUMNS.customers")
cols = [r[1] for r in db.execute("PRAGMA table_info(customers)")]
check("exact column list matches worker", cols == WORKER_COLUMNS,
      f"\n        worker={WORKER_COLUMNS}\n        table ={cols}")
check("dormant 'points' column dropped", "points" not in cols, f"-> {cols}")
check("no leftover customers_new table",
      not db.execute("SELECT name FROM sqlite_master WHERE name='customers_new'").fetchone())
db.close()

# ---- Transaction safety: legacy DB WITH points, and a forced failure ----
print("\n[6] Transaction safety / rollback")
db = build(":memory:")
db.execute("ALTER TABLE customers ADD COLUMN points REAL NOT NULL DEFAULT 0")
db.execute("UPDATE customers SET points=42 WHERE id='c1'")
db.commit()
legacy_before = snapshot(db)
try:
    db.executescript(V10)
    ok = snapshot(db) == legacy_before
    check("legacy DB that HAS points migrates fine (points dropped)", ok,
          f"\n        before={legacy_before}\n        after ={snapshot(db)}")
    check("points really gone on legacy DB",
          "points" not in [r[1] for r in db.execute("PRAGMA table_info(customers)")])
except Exception as e:
    check("legacy DB with points migrates", False, f"-> {type(e).__name__}: {e}")
db.close()

# Forced failure: a DB missing deleted_at (v9 not applied) must NOT destroy data.
db = sqlite3.connect(":memory:")
db.executescript(PRE_V10.replace("ALTER TABLE customers ADD COLUMN deleted_at TEXT;", ""))
db.executemany(
    "INSERT INTO customers (id,name,phone,company_id,tags,notes,createdAt,updated_at,branch_id)"
    " VALUES (?,?,?,?,?,?,?,?,?)", [r[:9] for r in ROWS])
db.commit()
n_before = db.execute("SELECT COUNT(*) FROM customers").fetchone()[0]
try:
    db.executescript(V10)
    check("v9-less DB is rejected (not silently corrupted)", False,
          "-> migration SUCCEEDED when it should have failed")
except sqlite3.OperationalError as e:
    survived = db.execute("SELECT COUNT(*) FROM customers").fetchone()[0]
    check("v9-less DB fails loudly", "deleted_at" in str(e), f"-> {e}")
    check(f"original data intact after failure ({n_before} rows)", survived == n_before,
          f"-> {survived}/{n_before}")
db.close()

print("\n" + "=" * 72)
print(f"{checks - len(fails)}/{checks} checks passed")
if fails:
    print("FAILED: " + "; ".join(fails))
    sys.exit(1)
print("ALL CHECKS PASSED")
print("=" * 72)
