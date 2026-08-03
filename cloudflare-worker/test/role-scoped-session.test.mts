/**
 * Regression guard: a manager must not be downgraded to cashier by a sibling tab.
 *
 * THE BUG THIS LOCKS DOWN
 * -----------------------
 * Sessions used to live in ONE cookie named `pos_session`. Cookies are scoped to
 * the DOMAIN, not the tab, so a shop running the till and the manager dashboard
 * in the same browser had a single slot for two roles: whichever tab logged in
 * last owned the role for both. A cashier sign-in therefore overwrote the
 * manager's session, and from that moment every manager write came back
 *
 *   403 cashier_catalog_readonly
 *   "تعديل المنيو والوصفات غير مسموح لصلاحية الكاشير"
 *
 * on the manager-dashboard — deleting a menu item appeared to work locally but
 * the tombstone was refused by the Worker and retired by the sync queue, so D1
 * never learned about it and the till never saw the change.
 *
 * THE CONTRACT NOW
 *   1. Each role gets its OWN cookie: pos_session_manager / pos_session_cashier.
 *   2. A request states which one it means with `X-Role-Intent`; the header only
 *      SELECTS among cookies the browser already holds — the role still comes
 *      from the HMAC-signed cookie, so it grants no authority by itself.
 *   3. A forged/mismatched role cookie is ignored (a `pos_session_manager`
 *      cookie carrying a cashier payload is not accepted as a manager).
 *   4. The legacy shared cookie is still ACCEPTED (rollout) but is CLEARED by
 *      every mint so it stops shadowing role cookies.
 *
 *   node --experimental-strip-types test/role-scoped-session.test.mts
 */

import assert from "node:assert/strict";
import {
  authenticate,
  handleSessionRoutes,
  mintSessionToken,
  SESSION_COOKIE,
  SESSION_COOKIE_BY_ROLE,
  ROLE_INTENT_HEADER,
} from "../src/auth.ts";

let passed = 0;
function ok(cond: unknown, label: string) {
  assert.ok(cond, label);
  passed++;
  console.log("  ✓", label);
}

const CORS = { "Access-Control-Allow-Origin": "https://pos.engaz.tech" };
const env: any = { SESSION_SECRET: "role-scoped-test-secret" };

/** All Set-Cookie values on a response, whatever the runtime's header shape. */
function setCookies(res: Response): string[] {
  const h: any = res.headers;
  if (typeof h.getSetCookie === "function") return h.getSetCookie();
  return (res.headers.get("Set-Cookie") || "").split(/,\s*(?=[A-Za-z0-9_-]+=)/);
}

function cookieNamed(res: Response, name: string): string | null {
  for (const raw of setCookies(res)) {
    const first = String(raw).split(";")[0].trim();
    if (first.startsWith(`${name}=`)) return first.slice(name.length + 1);
  }
  return null;
}

function req(cookieHeader: string, intent?: string): Request {
  const headers: Record<string, string> = { Cookie: cookieHeader };
  if (intent) headers[ROLE_INTENT_HEADER] = intent;
  return new Request("https://api.engaz.tech/v1/x", { headers });
}

async function main() {
  console.log("\n1) a mint writes the ROLE cookie and evicts the legacy one");
  const mint = await handleSessionRoutes(
    new Request("https://api.engaz.tech/v1/session", {
      method: "POST",
      headers: { "X-API-Key": "mgr-key" },
    }),
    { ...env, MANAGER_API_KEY: "mgr-key" },
    CORS
  );
  ok(mint?.status === 200, "manager key mints a session");
  const managerCookie = cookieNamed(mint!, SESSION_COOKIE_BY_ROLE.manager);
  ok(!!managerCookie, "Set-Cookie includes pos_session_manager");
  ok(cookieNamed(mint!, SESSION_COOKIE) === "", "legacy pos_session is cleared by the mint");

  // Two live sessions in ONE browser, exactly like a till tab + a dashboard tab.
  const mgrToken = (await mintSessionToken(env, "manager"))!.token;
  const cashToken = (await mintSessionToken(env, "cashier"))!.token;
  const bothCookies =
    `${SESSION_COOKIE_BY_ROLE.manager}=${mgrToken}; ${SESSION_COOKIE_BY_ROLE.cashier}=${cashToken}`;

  console.log("\n2) the role intent decides which of the two sessions is used");
  const asManager = await authenticate(req(bothCookies, "manager"), env);
  ok(asManager?.role === "manager", "X-Role-Intent: manager → manager (was downgraded before)");
  const asCashier = await authenticate(req(bothCookies, "cashier"), env);
  ok(asCashier?.role === "cashier", "X-Role-Intent: cashier → cashier");

  console.log("\n3) a cashier login in a sibling tab no longer downgrades the manager");
  // The cashier tab mints; the browser keeps BOTH cookies. The manager tab's
  // next write still authenticates as a manager.
  const cashierMint = await handleSessionRoutes(
    new Request("https://api.engaz.tech/v1/session", {
      method: "POST",
      headers: { "X-API-Key": "cash-key", [ROLE_INTENT_HEADER]: "cashier" },
    }),
    { ...env, CASHIER_API_KEY: "cash-key" },
    CORS
  );
  ok(cashierMint?.status === 200, "cashier tab mints its own session");
  const freshCashier = cookieNamed(cashierMint!, SESSION_COOKIE_BY_ROLE.cashier);
  ok(!!freshCashier, "cashier mint sets pos_session_cashier, not the manager cookie");
  ok(
    cookieNamed(cashierMint!, SESSION_COOKIE_BY_ROLE.manager) === null,
    "cashier mint never touches the manager cookie"
  );
  const managerStillManager = await authenticate(
    req(`${SESSION_COOKIE_BY_ROLE.manager}=${mgrToken}; ${SESSION_COOKIE_BY_ROLE.cashier}=${freshCashier}`, "manager"),
    env
  );
  ok(managerStillManager?.role === "manager", "manager tab keeps its role after the cashier login");

  console.log("\n4) the intent header cannot MANUFACTURE a role");
  const cashierOnly = await authenticate(
    req(`${SESSION_COOKIE_BY_ROLE.cashier}=${cashToken}`, "manager"),
    env
  );
  ok(
    cashierOnly?.role === "cashier",
    "asking for manager with only a cashier cookie still authenticates as cashier"
  );
  ok(
    (await authenticate(req("", "manager"), env)) === null,
    "intent alone, with no cookie, authenticates nothing"
  );

  console.log("\n5) a role cookie carrying the other role's payload is ignored");
  const swapped = await authenticate(
    req(`${SESSION_COOKIE_BY_ROLE.manager}=${cashToken}`, "manager"),
    env
  );
  ok(swapped === null, "cashier token planted in the manager cookie is rejected");

  console.log("\n6) the legacy shared cookie still authenticates (rollout safety)");
  const legacy = await authenticate(req(`${SESSION_COOKIE}=${mgrToken}`), env);
  ok(legacy?.role === "manager", "pos_session=<manager token> → manager");

  console.log("\n7) logout is intent-scoped: one role signs out, the other stays");
  const logout = await handleSessionRoutes(
    new Request("https://api.engaz.tech/v1/session", {
      method: "DELETE",
      headers: { [ROLE_INTENT_HEADER]: "manager" },
    }),
    env,
    CORS
  );
  ok(logout?.status === 200, "DELETE /v1/session → 200");
  ok(
    cookieNamed(logout!, SESSION_COOKIE_BY_ROLE.manager) === "",
    "manager cookie is cleared"
  );
  ok(
    cookieNamed(logout!, SESSION_COOKIE_BY_ROLE.cashier) === null,
    "cashier cookie is left alone — the till stays signed in"
  );

  console.log(`\n✅ role-scoped-session: ${passed} assertions passed\n`);
}

main().catch((err) => {
  console.error("\n❌ role-scoped-session FAILED:", err);
  process.exit(1);
});
