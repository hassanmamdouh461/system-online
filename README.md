<div align="center">

# ☕ BrewMaster
### Full-Stack Coffee Shop Point-of-Sale System

*Built for real cafés. Engineered for scale.*

[![React](https://img.shields.io/badge/React-18-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://reactjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-5-646CFF?style=for-the-badge&logo=vite&logoColor=white)](https://vitejs.dev/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-3-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![Cloudflare D1](https://img.shields.io/badge/Cloudflare-D1-F38020?style=for-the-badge&logo=cloudflare&logoColor=white)](https://developers.cloudflare.com/d1/)
[![Framer Motion](https://img.shields.io/badge/Framer_Motion-Animations-0055FF?style=for-the-badge&logo=framer&logoColor=white)](https://www.framer.com/motion/)

</div>

---

## ✨ Features

### 🏪 Business Features
- **Smart Payment Flow** — Cashier screen with unpaid/paid lists, cash/card tracking
- **POS Cashier** — Create orders, optional customer phone, print tickets
- **Customers & Companies** — Profiles, tags, affiliation, transaction history
- **Inventory + Recipes** — Stock levels, auto-deduct on sales, low-stock alerts
- **Manager Analytics** — Multi-branch aware reports (Paid orders only)
- **Public QR Menu** — Customer-facing menu at `/public-menu`
- **Telegram reports** — Optional sales reports via a configured bot (Settings → Telegram)
- **Bilingual UI** — Arabic / English with RTL support
- **Responsive** — Top navigation bar on desktop/tablet, mobile bottom-nav (`MobileNav`) on small screens. There is no sidebar.

### ⚙️ Technical Features
- **Offline-first** — IndexedDB (via `idb`) with a durable sync queue
- **Cloud sync** — Cloudflare Worker + D1 via `POST /api/sync`
- **Atomic local writes** — Order + sync-queue entry in one IndexedDB transaction
- **Bounded retries** — Exponential backoff on failed sync (no infinite hammering)
- **Smart Auth** — Remember Me via `localStorage` / `sessionStorage`
- **Framer Motion** animations for cards, modals, and page transitions

---

## 🏛️ System Architecture & Core Logic

### The Separation of Concerns Principle

> ⚠️ **This is the most important architectural decision in this system.**

Most café POS systems treat *"order status"* and *"payment status"* as the same thing. BrewMaster keeps them separate:

```
┌─────────────────────────────────┐     ┌──────────────────────────────────┐
│         ORDER FLOW              │     │          FINANCIAL FLOW           │
│    (Operational / Workflow)     │     │       (Accounting / Revenue)      │
│                                 │     │                                   │
│   New ──► Preparing ──► Ready   │     │      Unpaid ────────► Paid        │
│                                 │     │                                   │
│  Status field on every order    │     │  Managed by: Cashier              │
│  (no on-screen kitchen board)   │     │  Lives on:   Payment Page         │
└─────────────────────────────────┘     └──────────────────────────────────┘
```

| Scenario | Naive POS | BrewMaster |
|----------|-----------|------------|
| Order delivered but not yet paid | Counted as revenue ❌ | Not counted as revenue ✅ |
| Order paid but still preparing | Missing from kitchen ❌ | Visible on both screens ✅ |
| End-of-day revenue report | Inflated / inaccurate ❌ | Strictly from `Paid` orders ✅ |

> 💡 **Revenue is never recognized until `paymentStatus === "Paid"`** — regardless of kitchen status.

### Runtime path

```
Web:  React UI → services → IndexedDB → sync_queue → Cloudflare Worker → D1
```

---

## 🧗 Challenges Conquered

### 1. Offline-safe order persistence

Orders must never disappear if the tab closes mid-write or the cloud endpoint is down.

**Solution:**
- Atomic IndexedDB transaction for `orders` + `sync_queue`
- Exponential backoff + max attempts on upload failure
- Successful sync records retained 24h then cleaned up
- Local data remains source of truth even when Worker is unreachable

### 2. Order Grouping Performance — Single-Pass `useMemo`

Historical: while the kitchen board existed it grouped orders with three `Array.filter()` calls (`O(3n)`), replaced with one `reduce()` pass. The board has since been removed at the operator's request; the same single-pass pattern is still used elsewhere for list grouping:

```typescript
const groupedOrders = useMemo(() => {
  return orders.reduce((acc, order) => {
    acc[order.status].push(order);
    return acc;
  }, { new: [], preparing: [], ready: [] } as GroupedOrders);
}, [orders]);
```

---

## 🛠️ Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Framework** | React 18 + TypeScript | UI + type safety |
| **Build** | Vite 5 | Dev server + production builds |
| **Styling** | Tailwind CSS v3 | Coffee-themed utility UI |
| **Animations** | Framer Motion | Cards, modals, transitions |
| **Web storage** | IndexedDB (`idb`) | Offline-first browser DB |
| **Cloud** | Cloudflare Workers + D1 | Edge API + SQLite at the edge |
| **State** | React Context + hooks | Lightweight global state |
| **Deploy** | Netlify / Vercel / Cloudflare Pages | SPA hosting |

---

## 🚀 Getting Started

### Prerequisites
- Node.js `>= 18`
- (Optional) Cloudflare account — for cloud sync via Worker + D1

### Installation

```bash
npm install
```

### Environment Setup

Copy the example env and set your Worker URL:

```bash
cp .env.example .env      # Windows: copy .env.example .env
```

```env
VITE_CLOUDFLARE_WORKER_URL=https://system-online-backend.YOUR_SUBDOMAIN.workers.dev
```

> The app works fully offline without this variable. Sync simply stays local until a Worker URL is configured.

### Run (Web)

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

**Login.** There is no username field — the login screen takes a password only, and
the role (manager or cashier) is chosen on the screen itself.

On a brand-new install with no credential stored anywhere, the local bootstrap
password `123` is accepted **once** and immediately replaced by a hash of whatever
you set; it is permanently disabled after that. This is a local-only escape hatch.

Once the app is pointed at a Cloudflare Worker, logging in verifies against PBKDF2
hashes stored in **D1**, and a fresh D1 has no credential rows — so every login
returns `401` until you seed them once:

```bash
MANAGER_PASSWORD='…' CASHIER_PASSWORD='…' node scripts/seed-manager-credential.mjs
```

See [Cloudflare Worker / D1](#️-cloudflare-worker--d1) below for the full sequence.
`123` will **not** get you into a cloud-connected install.

### Build SPA

```bash
npm run build
npm run preview
```

### Quality checks

```bash
npm run ci          # everything below, in one shot — run this before committing
```

`npm run ci` is the gate: lint → typecheck → unit tests → Worker tests. It must be
green (0 ESLint errors, all Vitest tests passing, 18/18 Worker test files) before
any change is committed.

The individual steps, if you need to run one in isolation:

```bash
npm run typecheck    # TypeScript, no emit
npm run lint         # ESLint + the money-safety check
npm run test         # Vitest unit tests
npm run test:worker  # Cloudflare Worker test suite
npm run check:money  # money arithmetic must stay inside src/utils/money.ts
```

---

## ☁️ Cloudflare Worker / D1

Backend lives in `cloudflare-worker/`. Full deploy steps: see [`cloudflare-worker/README.md`](./cloudflare-worker/README.md).

Quick path:

```bash
cd cloudflare-worker
npm install
npx wrangler login
npx wrangler d1 create system-online-db
# put database_id into wrangler.toml
npx wrangler d1 execute system-online-db --remote --file=schema.sql
npx wrangler secret put SESSION_SECRET          # REQUIRED — signs session cookies
npx wrangler deploy

# One-time: seed the login credentials into D1, or every login 401s.
# (Password stays local; only a PBKDF2 hash is written.)
cd ..
MANAGER_PASSWORD='…' CASHIER_PASSWORD='…' node scripts/seed-manager-credential.mjs
cd cloudflare-worker
npx wrangler d1 execute system-online-db --remote --file=../seed-credentials.sql
```

Then set `VITE_CLOUDFLARE_WORKER_URL` to the deployed Worker URL and rebuild the frontend.

API surface:
- `POST/GET/DELETE /v1/session` — mint / probe / clear the session cookie (mint requires a valid credential)
- `GET /api/health` — public liveness + D1 probe (no data); `GET /public/menu` — public QR menu
- `POST /api/sync` — upsert/delete from the client sync queue (session required)
- Appwrite-compatible REST style under `/v1/databases/.../collections/{menu_items|orders|customers|inventory|companies}/documents` (session required)

---

## 📁 Project Structure

```
online-system/
├── src/
│   ├── components/        # UI (layout, orders, menu, payment, settings, …)
│   ├── context/           # Auth, Data, Language providers
│   ├── hooks/             # useOrders, useMenu, useAnalytics, …
│   ├── pages/             # Route pages (Orders, Payment, Customers, …)
│   ├── repositories/      # IndexedDB + storage adapters
│   ├── services/          # Business layer + syncService
│   ├── types/             # Order, Menu, Customer, Company, …
│   └── utils/             # settings, receipts, helpers
├── cloudflare-worker/     # D1 schema + Worker API
├── scripts/               # Operational / infra helper scripts
├── .env.example           # Worker URL template
└── package.json
```

---

## 🔐 Notes

- **Auth is a role-bearing session cookie.** The operator signs in with the manager/cashier password; the browser hands it to the Worker (`POST /v1/session`), which verifies it against PBKDF2 (SHA-256, 100k, random salt) hashes stored in D1 and sets an HMAC-signed HttpOnly cookie carrying the role. Passwords are never stored in plaintext, and the client never holds an API key. The one-time `123` bootstrap password is a **local-only** escape hatch: it works on a brand-new install until a real password is set, after which it is permanently disabled, and it is never accepted by the Worker — a cloud-connected install authenticates solely against the seeded D1 hashes.
- **The Cloudflare Worker is fail-closed.** It refuses to mint sessions (`503`) unless the `SESSION_SECRET` secret is set, returns `401` for any request without a valid session cookie (or role-scoped key), and emits CORS headers only for origins in `ALLOWED_ORIGINS` (no wildcard reflection). Cookie writes are additionally CSRF-guarded (strict `Origin` allowlist + double-submit `X-CSRF-Token`). Set `SESSION_SECRET` and `ALLOWED_ORIGINS`, then **seed the login credentials** before use — see [`cloudflare-worker/README.md`](./cloudflare-worker/README.md) (there is no `API_KEY`/`X-API-Key` requirement for the browser POS anymore).
- **First-run login deadlock:** a fresh D1 has no credential rows, so login `401`s until you seed them once with `scripts/seed-manager-credential.mjs` (see the Worker README's Recovery section).
- **There is no automatic seed data.** Automatic seeding of `INITIAL_MENU_ITEMS` and `CLIENT_B_INITIAL_INVENTORY` was deliberately removed (see `src/repositories/indexeddb/db.ts`), because on an existing install it resurrected menu items the operator had already deleted. A fresh install therefore opens on an **empty menu and empty inventory** — this is expected, not a bug. Add items from the Menu and Inventory screens, or restore from a cloud hydrate if the install is pointed at a populated D1.

---

## 📄 License

This project is licensed under the **MIT License**.

---

<div align="center">

**Built with ☕ and TypeScript**

</div>
