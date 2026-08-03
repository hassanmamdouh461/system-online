/**
 * A-07 — a cashier-authored snapshot cannot carry forged credentials.
 *
 * Snapshot READS are manager-only, but WRITES must stay open: the backup
 * scheduler runs unattended on every device, and the till is often the only
 * machine left on. That left an indirect escalation path — a cashier POSTs a
 * snapshot whose payload contains a manager credential of their choosing, and
 * the next manager-run restore installs it on every device.
 *
 * The payload is now scrubbed at the write boundary: business rows survive,
 * credential/secret settings are dropped. Manager-authored snapshots are
 * untouched, so real backups stay complete.
 *
 *   node --experimental-strip-types test/snapshot-write-sanitize.test.mts
 */

import assert from "node:assert/strict";
import { sanitizeSnapshotPayload } from "../src/permissions.ts";
import worker from "../src/index.ts";

let passed = 0;
function ok(cond: unknown, label: string) {
  assert.ok(cond, label);
  passed++;
  console.log("  ✓", label);
}

const FORGED = {
  orders: [{ id: "o1", totalAmount: 100 }],
  settings: {
    brewmaster_manager_creds_v1: JSON.stringify({ username: "manager", hash: "attacker" }),
    "global::brewmaster_admin_pin": "1234",
    brewmaster_telegram_bot_token: "123:AAA",
    brewmaster_language: "ar",
    brewmaster_tax_rate: "14",
  },
};

function pure() {
  console.log("\n1) sanitizeSnapshotPayload()");

  const cleaned: any = sanitizeSnapshotPayload("cashier", FORGED);
  ok(!("brewmaster_manager_creds_v1" in cleaned.settings), "manager creds dropped from a cashier payload");
  ok(!("global::brewmaster_admin_pin" in cleaned.settings), "namespaced admin PIN dropped too");
  ok(!("brewmaster_telegram_bot_token" in cleaned.settings), "telegram token dropped");
  ok(cleaned.settings.brewmaster_language === "ar", "harmless settings survive");
  ok(cleaned.settings.brewmaster_tax_rate === "14", "operational settings survive");
  ok(cleaned.orders.length === 1, "business rows survive — the backup is still useful");

  const asManager: any = sanitizeSnapshotPayload("manager", FORGED);
  ok(
    "brewmaster_manager_creds_v1" in asManager.settings,
    "a manager-authored snapshot is untouched (real backups stay complete)"
  );

  const asString = sanitizeSnapshotPayload("cashier", JSON.stringify(FORGED)) as string;
  ok(typeof asString === "string", "string payload in → string payload out");
  ok(!asString.includes("brewmaster_manager_creds_v1"), "string payload is scrubbed too");

  ok(sanitizeSnapshotPayload("cashier", "not json") === "{}", "unparseable payload → empty, never trusted");
  ok(
    JSON.stringify(sanitizeSnapshotPayload("cashier", { orders: [] })) === JSON.stringify({ orders: [] }),
    "payload without a settings block passes through"
  );
}

// ── end-to-end through the Worker ────────────────────────────────────────────
const enc = new TextEncoder();
const bufToHex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");

async function clientHash(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const km = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
  const dk = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 100_000, hash: "SHA-256" },
    km,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt"]
  );
  return { hash: bufToHex(new Uint8Array(await crypto.subtle.exportKey("raw", dk))), salt: bufToHex(salt) };
}

async function e2e() {
  console.log("\n2) end-to-end: cashier POST /collections/snapshots/documents");

  const mgr = await clientHash("mgr-pw");
  const csh = await clientHash("csh-pw");
  const settings: Record<string, string> = {
    brewmaster_manager_creds_v1: JSON.stringify({ username: "manager", ...mgr }),
    brewmaster_admin_creds_v2: JSON.stringify({ username: "admin", ...csh }),
  };
  // Whatever the worker actually persists lands here.
  const written: any[] = [];

  const env: any = {
    SESSION_SECRET: "snapshot-secret",
    ALLOWED_ORIGINS: "https://pos.engaz.tech",
    DB: {
      prepare(sql: string) {
        const st: { args: any[] } = { args: [] };
        return {
          bind(...a: any[]) {
            st.args = a;
            return this;
          },
          async first() {
            if (/FROM settings/i.test(sql)) {
              // auth.ts binds the namespaced document id; accept either shape.
              const raw = String(st.args[0] ?? "");
              const k = raw.includes("::") ? raw.slice(raw.indexOf("::") + 2) : raw;
              if (k && k in settings) return { value: settings[k] };
              return null;
            }
            if (/FROM snapshots/i.test(sql)) return written[written.length - 1] || null;
            return null;
          },
          async all() {
            return { results: [] };
          },
          async run() {
            if (/INSERT INTO snapshots/i.test(sql)) {
              const cols = (/INSERT INTO snapshots \(([^)]+)\)/i.exec(sql)?.[1] || "")
                .split(",")
                .map((c) => c.trim());
              const row: any = {};
              cols.forEach((c, i) => (row[c] = st.args[i]));
              written.push(row);
            }
            return { success: true, meta: { changes: 1 } };
          },
        };
      },
    },
  };

  const mint = async (password: string) => {
    const res = await worker.fetch(
      new Request("https://api.engaz.tech/v1/session", {
        method: "POST",
        headers: { Origin: "https://pos.engaz.tech", "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      }),
      env
    );
    const body: any = await res.json();
    return { cookie: (res.headers.get("Set-Cookie") || "").split(";")[0], csrf: body.csrfToken };
  };

  const post = async (session: { cookie: string; csrf: string }, id: string) =>
    worker.fetch(
      new Request("https://api.engaz.tech/v1/databases/default/collections/snapshots/documents", {
        method: "POST",
        headers: {
          Origin: "https://pos.engaz.tech",
          "Content-Type": "application/json",
          Cookie: session.cookie,
          "X-CSRF-Token": session.csrf,
        },
        body: JSON.stringify({ documentId: id, data: { id, kind: "auto", payload: FORGED } }),
      }),
      env
    );

  const cashier = await mint("csh-pw");
  const res = await post(cashier, "snap-cashier");
  ok(res.status === 201 || res.status === 200, `cashier backup still accepted (got ${res.status})`);
  const storedCashier = written[written.length - 1];
  ok(!!storedCashier, "a snapshot row was persisted");
  ok(
    !String(storedCashier.payload).includes("brewmaster_manager_creds_v1"),
    "persisted payload carries NO manager credential"
  );
  ok(
    !String(storedCashier.payload).includes("brewmaster_telegram_bot_token"),
    "persisted payload carries NO telegram token"
  );
  ok(String(storedCashier.payload).includes("brewmaster_language"), "harmless settings still persisted");
  ok(String(storedCashier.payload).includes("\"o1\""), "business rows still persisted");

  const manager = await mint("mgr-pw");
  await post(manager, "snap-manager");
  const storedManager = written[written.length - 1];
  ok(
    String(storedManager.payload).includes("brewmaster_manager_creds_v1"),
    "manager-authored snapshot is complete"
  );
}

async function main() {
  pure();
  await e2e();
  console.log(`\n✅ snapshot-write-sanitize.test: ${passed} assertions passed\n`);
}

main().catch((err) => {
  console.error("\n❌ snapshot-write-sanitize FAILED:", err);
  process.exit(1);
});
