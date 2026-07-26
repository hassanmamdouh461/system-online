/**
 * Server-side authorization for the POS worker.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Before this, the worker had exactly one auth check: `token === env.API_KEY`.
 * Past that line a cashier and a manager were indistinguishable, so a single
 * shared key granted GET/POST/PATCH/DELETE on all nine tables. The
 * manager/cashier split lived only in React routing (`ManagerRoute`), which is
 * cosmetic — `curl` with the same key bypassed it entirely.
 *
 * The role is now derived from WHICH SECRET was presented. The client never
 * declares its own role: a body field like `{ role: 'manager' }` is ignored.
 *
 * DESIGN NOTE — VALUE COMPARISON, NOT KEY PRESENCE
 * ------------------------------------------------
 * The POS is offline-first. `syncService` replays queued writes by sending the
 * WHOLE row (`data: record.data`), not a delta — see syncService.ts and
 * inventoryService.update(). So a cashier's perfectly legitimate stock sync
 * still carries `costPerUnit`, and a normal order sync still carries
 * `refundedAt: undefined`.
 *
 * Rejecting on mere PRESENCE of a protected field would 403 every routine
 * sync and stop the shop. So every guard here compares the SUBMITTED value
 * against the CURRENT stored value and only denies an actual CHANGE. Sending an
 * unchanged protected field is always allowed.
 *
 * All functions are pure and free of I/O so they can be unit-tested without a
 * live D1 binding. The caller loads the existing row and passes it in.
 */

// Role is defined in auth.ts (the credential → role → cookie pipeline) and
// re-exported here so callers can keep importing it from either module.
import type { Role } from "./auth.ts";
export type { Role };

export type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

/** Outcome of an authorization decision. `reason` is safe to show a user. */
export interface Decision {
  allowed: boolean;
  /** Arabic message surfaced to the operator. Never leaks schema details. */
  reason?: string;
  /** Stable machine code for logs and the test harness. */
  code?: string;
}

const ALLOW: Decision = { allowed: true };

function deny(code: string, reason: string): Decision {
  return { allowed: false, code, reason };
}

/**
 * Settings keys a cashier may never WRITE.
 *
 * This closes the worst hole in the old worker. Password hashes and the refund
 * PIN are themselves stored as rows in the `settings` table (see
 * settingsCloudService.DURABLE_SETTING_KEYS) under ids like
 * `global::brewmaster_manager_creds_v1`. With one shared key a cashier could:
 *
 *   PATCH /v1/.../collections/settings/documents/global::brewmaster_manager_creds_v1
 *
 * ...writing a hash of a password they chose, and become manager on every
 * device that hydrates settings. That is full privilege escalation, and it is
 * strictly worse than the DELETE gap.
 *
 * READ is deliberately still permitted: auth is currently client-side, so every
 * device must hydrate these hashes for login to work at all. Blocking reads
 * would break sign-in. Blocking WRITES removes the escalation path. Reading a
 * PBKDF2-100k hash is not equivalent to seizing the account.
 */
export const CASHIER_FORBIDDEN_SETTING_KEYS: readonly string[] = [
  "brewmaster_admin_creds_v2",
  "brewmaster_manager_creds_v1",
  "brewmaster_admin_pin",
  "brewmaster_tax_rate",
  "brewmaster_store_config",
  "brewmaster_branch_config",
  "brewmaster_telegram_config",
  "brewmaster_telegram_bot_token",
  "brewmaster_telegram_chat_id",
];

/**
 * Settings a cashier legitimately writes during a shift. Anything not on this
 * list and not explicitly forbidden is treated as manager-only (fail-closed).
 */
export const CASHIER_ALLOWED_SETTING_KEYS: readonly string[] = [
  "brewmaster_language",
  "pos_tables_list",
  "removed_menu_categories",
  "custom_menu_categories",
];

/**
 * Settings keys a cashier may never READ.
 *
 * This closes the leak the old worker left wide open. `permissions.can()` blocked
 * cashier WRITES to these keys, but every GET returned ALLOW for all roles, so a
 * cashier tab could simply:
 *
 *   fetch('/v1/.../collections/settings/documents/global::brewmaster_manager_creds_v1',
 *         { credentials: 'include' }).then(r => r.json())
 *
 * ...and read the manager PBKDF2 hash + salt (the privilege-escalation target),
 * the refund PIN hash, and — worst — the Telegram bot token IN PLAINTEXT. A read
 * of these is a real breach, so cashier GET responses are filtered against this
 * list in index.ts.
 *
 * NOTE — this is deliberately NARROWER than CASHIER_FORBIDDEN_SETTING_KEYS:
 *   • The cashier's OWN credential (brewmaster_admin_creds_v2) stays readable so
 *     the client can still verify a cashier login; a cashier reading their own
 *     password hash is not an escalation.
 *   • Operational config a cashier needs during a shift (tax rate, store/branch
 *     config for receipts) stays readable.
 * Manager login on a cashier device no longer depends on the cashier being able
 * to read the manager hash — the client falls back to the Worker's server-side
 * password verification (auth.ts resolvePasswordRole), which reads D1 directly.
 */
export const CASHIER_FORBIDDEN_READ_SETTING_KEYS: readonly string[] = [
  "brewmaster_manager_creds_v1",
  "brewmaster_admin_pin",
  "brewmaster_telegram_config",
  "brewmaster_telegram_bot_token",
  "brewmaster_telegram_chat_id",
];

/**
 * Tables whose rows a cashier may not READ at all.
 *
 * A `snapshots` row embeds the ENTIRE settings blob (see snapshotService
 * buildSnapshotPayload → collectLocalSettings), so it carries the manager hash,
 * the refund PIN and the Telegram token inside its JSON payload. Filtering the
 * `settings` collection but leaving `snapshots` open would just move the leak one
 * endpoint over. Nothing on a cashier device reads snapshots (getLatestSnapshot
 * is unused and restoreFromSnapshotIfNeeded is a no-op), so denying the read is
 * zero-impact — a cashier device still WRITES its backups normally.
 */
export const CASHIER_UNREADABLE_TABLES: readonly string[] = ["snapshots"];

/** May this role read a given settings key? Managers read everything. */
export function canReadSettingKey(role: Role, key: string | null | undefined): boolean {
  if (role === "manager") return true;
  if (!key) return true; // rows with no resolvable key are non-sensitive by construction
  return !CASHIER_FORBIDDEN_READ_SETTING_KEYS.includes(String(key).trim());
}

/** May this role read ANY row of a table? Managers read everything. */
export function canReadTable(role: Role, table: string): boolean {
  if (role === "manager") return true;
  return !CASHIER_UNREADABLE_TABLES.includes(table);
}

/**
 * Order fields a cashier may never CHANGE.
 *
 * `refundedAt`/`refundReason` are the refund mechanism itself — without this a
 * cashier could issue a refund via a plain PATCH and skip the PIN prompt, since
 * the PIN check lives in PaymentModal (client-side). `deletedAt` is a soft
 * delete, i.e. DELETE by another name.
 */
export const CASHIER_FROZEN_ORDER_FIELDS: readonly string[] = [
  "refundedAt",
  "refundReason",
  "deletedAt",
];

/**
 * Money fields on an order. A cashier DOES write these when collecting payment
 * (Payment.tsx computes and freezes taxRate/taxAmount/grandTotal in one write),
 * so they cannot be blanket-denied.
 *
 * Instead they are frozen once the order reaches a settled state — see
 * `isOrderSettled`. That prevents editing an already-paid order to skim the
 * difference, without breaking the payment flow itself.
 */
export const ORDER_MONEY_FIELDS: readonly string[] = [
  "totalAmount",
  "taxRate",
  "taxAmount",
  "grandTotal",
  "paymentStatus",
  "paymentMethod",
  "paidAt",
  "items",
];

/**
 * Inventory fields only a manager may change. A cashier must be able to move
 * `stock` (deductStock on sale, restoreStock on cancel) but must not be able to
 * re-price stock or rename items.
 */
export const CASHIER_FROZEN_INVENTORY_FIELDS: readonly string[] = [
  "costPerUnit",
  "minStock",
  "name",
  "unit",
  "deleted_at",
];

/** Tables a cashier may not write to at all. */
const CASHIER_READONLY_TABLES: readonly string[] = [
  "menu_items",
  "recipes",
];

// NOTE: role resolution (from a session cookie, a role-scoped API key, or the
// operator's password) and the constant-time compare now live in auth.ts, the
// single credential → role pipeline. permissions.ts stays pure decision logic:
// given an already-resolved role, decide whether a write is allowed.

/** An order whose money fields are locked to a cashier. */
export function isOrderSettled(row: Record<string, any> | null | undefined): boolean {
  if (!row) return false;
  const status = String(row.paymentStatus || "").trim();
  return status === "Paid" || status === "Refunded";
}

/**
 * Loose equality for sync payloads.
 *
 * The same logical value arrives in different shapes depending on the path it
 * took: D1 returns numbers as numbers but JSON may carry "12.5"; absent fields
 * appear as `undefined` from the client and `null` from D1; booleans are stored
 * as 0/1. Treating those as changes would 403 legitimate syncs, so all of them
 * are normalized before comparison.
 */
export function valuesEqual(submitted: unknown, current: unknown): boolean {
  const nil = (v: unknown) => v === null || v === undefined || v === "";
  if (nil(submitted) && nil(current)) return true;
  if (nil(submitted) || nil(current)) return false;

  if (typeof submitted === "boolean" || typeof current === "boolean") {
    const toBool = (v: unknown) => v === true || v === 1 || v === "1" || v === "true";
    return toBool(submitted) === toBool(current);
  }

  const ns = Number(submitted);
  const nc = Number(current);
  if (Number.isFinite(ns) && Number.isFinite(nc)) {
    // Currency tolerance: float round-trips through JSON must not read as edits.
    return Math.abs(ns - nc) < 1e-9;
  }

  if (typeof submitted === "object" || typeof current === "object") {
    try {
      return JSON.stringify(submitted) === JSON.stringify(current);
    } catch {
      return false;
    }
  }

  return String(submitted).trim() === String(current).trim();
}

/**
 * Fields the caller is actually trying to change, ignoring no-op resends.
 * This is what makes whole-object sync compatible with field-level rules.
 */
export function changedFields(
  submitted: Record<string, any>,
  current: Record<string, any> | null | undefined
): string[] {
  const changed: string[] = [];
  for (const key of Object.keys(submitted || {})) {
    if (key === "id") continue;
    // A brand-new row changes everything it declares.
    if (!current) {
      changed.push(key);
      continue;
    }
    if (!valuesEqual(submitted[key], current[key])) changed.push(key);
  }
  return changed;
}

/** Extract the settings key being written, from the row or its document id. */
export function settingKeyFrom(
  submitted: Record<string, any> | null | undefined,
  docId: string | null | undefined,
  current?: Record<string, any> | null
): string | null {
  const direct = submitted?.key ?? current?.key;
  if (direct) return String(direct).trim();
  if (docId) {
    // Ids are namespaced: `global::brewmaster_admin_pin` or `<branch>::<key>`.
    const idx = String(docId).indexOf("::");
    if (idx >= 0) return String(docId).slice(idx + 2).trim();
    return String(docId).trim();
  }
  return null;
}

export interface AuthzContext {
  role: Role;
  table: string;
  method: HttpMethod;
  /** Document id for single-row operations. */
  docId?: string | null;
  /** Sanitized payload the caller wants to write. */
  submitted?: Record<string, any> | null;
  /** Row currently stored in D1, or null when creating. */
  current?: Record<string, any> | null;
  /** True when the caller proved refund authority (valid server-side PIN). */
  refundEscalated?: boolean;
}

/**
 * THE single authorization decision. Called once per request, before any
 * database mutation. A manager is unrestricted; every rule below narrows the
 * cashier.
 */
export function can(ctx: AuthzContext): Decision {
  const { role, table, method } = ctx;

  if (role === "manager") return ALLOW;

  // ---- Cashier rules ----

  // Reads stay open. The POS needs orders, menu and inventory to function, and
  // login needs to hydrate settings. Read restrictions belong to the
  // server-side-auth phase, not here.
  if (method === "GET") return ALLOW;

  // Hard delete is manager-only. This is the check the user asked for:
  // a cashier cookie on DELETE /v1/.../orders/x must return 403.
  if (method === "DELETE") {
    return deny(
      "cashier_delete_forbidden",
      "الحذف غير مسموح لصلاحية الكاشير — تحتاج صلاحية مدير."
    );
  }

  // Menu and recipes are catalog data: manager-only writes.
  if (CASHIER_READONLY_TABLES.includes(table)) {
    return deny(
      "cashier_catalog_readonly",
      "تعديل المنيو والوصفات غير مسموح لصلاحية الكاشير."
    );
  }

  // Snapshots: ALLOWED for cashiers.
  //
  // `startSnapshotScheduler` runs on every device without a role check
  // (App.tsx), so blocking cashiers would silently stop backups whenever the
  // cashier till is the only device left open — which is the common case.
  // The snapshot payload is built entirely from data the cashier already reads
  // (orders, menu, inventory, settings including password hashes that are
  // needed for client-side login). `restoreFromSnapshotIfNeeded` is a no-op
  // (returns false), and there is no manual restore UI, so a forged snapshot
  // cannot be weaponized into a privilege escalation today.
  // If a restore path is ever added, gate it behind manager-only.

  if (table === "settings") return canWriteSetting(ctx);
  if (table === "orders") return canWriteOrder(ctx);
  if (table === "inventory") return canWriteInventory(ctx);

  // customers, companies, inventory_transactions: a cashier creates these
  // during normal service. Deletion is already blocked above.
  return ALLOW;
}

function canWriteSetting(ctx: AuthzContext): Decision {
  const key = settingKeyFrom(ctx.submitted, ctx.docId, ctx.current);

  if (!key) {
    return deny(
      "setting_key_unknown",
      "تعديل إعداد غير معروف غير مسموح لصلاحية الكاشير."
    );
  }

  if (CASHIER_FORBIDDEN_SETTING_KEYS.includes(key)) {
    return deny(
      "cashier_sensitive_setting",
      "تعديل الإعدادات الحساسة (كلمات المرور، الضريبة، بيانات المحل) يحتاج صلاحية مدير."
    );
  }

  if (!CASHIER_ALLOWED_SETTING_KEYS.includes(key)) {
    // Fail-closed: an unrecognized key is treated as sensitive.
    return deny(
      "cashier_unknown_setting",
      "هذا الإعداد يحتاج صلاحية مدير."
    );
  }

  return ALLOW;
}

function canWriteOrder(ctx: AuthzContext): Decision {
  const submitted = ctx.submitted || {};
  const current = ctx.current || null;
  const changed = changedFields(submitted, current);

  // Refund fields: a real change requires proven escalation.
  const touchingRefund = changed.filter((f) =>
    CASHIER_FROZEN_ORDER_FIELDS.includes(f)
  );

  if (touchingRefund.length > 0) {
    const onlyRefundMarkers = touchingRefund.every(
      (f) => f === "refundedAt" || f === "refundReason"
    );

    if (onlyRefundMarkers && ctx.refundEscalated) {
      // PIN verified server-side: this is the sanctioned escalation path.
      return ALLOW;
    }

    if (touchingRefund.includes("deletedAt")) {
      return deny(
        "cashier_soft_delete_forbidden",
        "حذف الطلب غير مسموح لصلاحية الكاشير — تحتاج صلاحية مدير."
      );
    }

    return deny(
      "refund_requires_escalation",
      "الاسترجاع يحتاج رمز تصعيد صحيح أو صلاحية مدير."
    );
  }

  // Money fields freeze once the order is settled, so a paid order cannot be
  // quietly re-priced. Before settlement the cashier must write them — that is
  // the payment step itself.
  if (isOrderSettled(current)) {
    const frozen = changed.filter((f) => ORDER_MONEY_FIELDS.includes(f));
    if (frozen.length > 0) {
      return deny(
        "settled_order_immutable",
        "لا يمكن تعديل مبالغ طلب مدفوع — تحتاج صلاحية مدير."
      );
    }
  }

  return ALLOW;
}

function canWriteInventory(ctx: AuthzContext): Decision {
  const submitted = ctx.submitted || {};
  const current = ctx.current || null;

  // Creating a new inventory item is manager-only.
  if (!current) {
    return deny(
      "cashier_inventory_create_forbidden",
      "إضافة أصناف المخزون تحتاج صلاحية مدير."
    );
  }

  const changed = changedFields(submitted, current);
  const frozen = changed.filter((f) =>
    CASHIER_FROZEN_INVENTORY_FIELDS.includes(f)
  );

  if (frozen.length > 0) {
    return deny(
      "cashier_inventory_field_forbidden",
      "تعديل تكلفة أو بيانات صنف المخزون يحتاج صلاحية مدير."
    );
  }

  // `stock` moves in both directions: deductStock on sale, restoreStock on
  // order cancel. Both are legitimate cashier actions.
  return ALLOW;
}
