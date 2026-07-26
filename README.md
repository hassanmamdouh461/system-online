<div align="center">

# ☕ BrewMaster
### Full-Stack Coffee Shop Point-of-Sale System

*Built for real cafés. Engineered for scale.*

[![React](https://img.shields.io/badge/React-18-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://reactjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-5-646CFF?style=for-the-badge&logo=vite&logoColor=white)](https://vitejs.dev/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-3-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![Cloudflare D1](https://img.shields.io/badge/Cloudflare-D1-F38020?style=for-the-badge&logo=cloudflare&logoColor=white)](https://developers.cloudflare.com/d1/)
[![Electron](https://img.shields.io/badge/Electron-29-47848F?style=for-the-badge&logo=electron&logoColor=white)](https://www.electronjs.org/)
[![Framer Motion](https://img.shields.io/badge/Framer_Motion-Animations-0055FF?style=for-the-badge&logo=framer&logoColor=white)](https://www.framer.com/motion/)

</div>

---

## ✨ Features

### 🏪 Business Features
- **Live Kanban Board** — Visual order pipeline: `New → Preparing → Ready`
- **Smart Payment Flow** — Cashier screen with unpaid/paid lists, cash/card tracking
- **POS Cashier** — Create orders, optional customer phone, print tickets
- **Customers & Companies** — Profiles, tags, affiliation, transaction history
- **Inventory + Recipes** — Stock levels, auto-deduct on sales, low-stock alerts
- **Manager Analytics** — Multi-branch aware reports (Paid orders only)
- **Public QR Menu** — Customer-facing menu at `/public-menu`
- **Telegram reports** — Optional daily sales reports (Electron)
- **Bilingual UI** — Arabic / English with RTL support
- **Responsive** — Desktop sidebar, tablet breakpoints, mobile bottom-nav

### ⚙️ Technical Features
- **Offline-first** — IndexedDB (web) / SQLite (Electron) with sync queue
- **Cloud sync** — Cloudflare Worker + D1 via `POST /api/sync`
- **Atomic local writes** — Order + sync-queue entry in one IndexedDB transaction
- **Bounded retries** — Exponential backoff on failed sync (no infinite hammering)
- **Smart Auth** — Remember Me via `localStorage` / `sessionStorage`
- **Framer Motion** animations for cards, modals, and page transitions
- **Performance-optimized Kanban** — single-pass `useMemo` grouping

---

## 🏛️ System Architecture & Core Logic

### The Separation of Concerns Principle

> ⚠️ **This is the most important architectural decision in this system.**

Most café POS systems treat *"order status"* and *"payment status"* as the same thing. BrewMaster keeps them separate:

```
┌─────────────────────────────────┐     ┌──────────────────────────────────┐
│         KITCHEN FLOW            │     │          FINANCIAL FLOW           │
│    (Operational / Workflow)     │     │       (Accounting / Revenue)      │
│                                 │     │                                   │
│   New ──► Preparing ──► Ready   │     │      Unpaid ────────► Paid        │
│                                 │     │                                   │
│  Managed by: Kitchen Staff      │     │  Managed by: Cashier              │
│  Lives on:   Orders Page        │     │  Lives on:   Payment Page         │
└─────────────────────────────────┘     └──────────────────────────────────┘
```

| Scenario | Naive POS | BrewMaster |
|----------|-----------|------------|
| Order delivered but not yet paid | Counted as revenue ❌ | Not counted as revenue ✅ |
| Order paid but still preparing | Missing from kitchen ❌ | Visible on both screens ✅ |
| End-of-day revenue report | Inflated / inaccurate ❌ | Strictly from `Paid` orders ✅ |

> 💡 **Revenue is never recognized until `paymentStatus === "Paid"`** — regardless of kitchen status.

### Runtime paths

```
Web:      React UI → services → IndexedDB → sync_queue → Cloudflare Worker → D1
Desktop:  React UI → electronAPI → SQLite (brewmaster.db) → sync engine → Worker → D1
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

### 2. Kanban Performance — Single-Pass `useMemo` Grouping

The initial board used three `Array.filter()` calls (`O(3n)`). Replaced with one `reduce()` pass:

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
| **Desktop** | Electron 29 + better-sqlite3 | Local SQLite POS |
| **Cloud** | Cloudflare Workers + D1 | Edge API + SQLite at the edge |
| **State** | React Context + hooks | Lightweight global state |
| **Deploy** | Cloudflare Workers (`wrangler-web.toml`) | SPA hosting on `pos.engaz.tech` |

---

## 🚀 Getting Started

### Prerequisites
- Node.js `>= 18`
- (Optional) Cloudflare account — for cloud sync via Worker + D1
- (Optional, desktop) Build tools for native modules if using Electron (`better-sqlite3`)

### Installation

```bash
npm install
```

### Environment Setup

Copy the example env and set your Worker URL:

```bash
copy .env.example .env
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

Default login: username `admin` / password `123` (change in Settings).

### Run (Electron desktop)

```bash
npm run electron:dev
```

Or double-click `run.bat` / `scripts\run.bat` (prepends portable Node path if present).

```bash
# Production-style Electron (loads dist/)
npm run build
npm run electron:start
```

**Electron native module note:** desktop mode needs `better-sqlite3` (listed under `optionalDependencies`). On Windows this requires [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with the **Desktop development with C++** workload, then:

```bash
npm install better-sqlite3
# rebuild for Electron's Node ABI if needed:
npx electron-rebuild -f -w better-sqlite3
```

Web mode (`npm run dev`) does **not** need `better-sqlite3` — it uses IndexedDB.
### Build SPA

```bash
npm run build
npm run preview
```

---

## 🚀 Deployment (production)

This project deploys as **two separate Cloudflare Workers** from the same
`cloudflare-worker/` directory, each with its own wrangler config. Deploying only
one of them is the most common mistake — the frontend and the API are independent.

| What | Config | Live URL |
|---|---|---|
| **Frontend** (SPA, serves `dist/`) | `wrangler-web.toml` | `https://pos.engaz.tech` |
| **API** (Worker + D1) | `wrangler.toml` | `https://api.engaz.tech` |

> `netlify.toml` and `vercel.json` exist in the repo but are **not** the live
> deployment path. The POS is served by `wrangler-web.toml` on the
> `pos.engaz.tech` custom domain.

### Deploy the frontend

The frontend **must be rebuilt before every deploy**: Vite inlines
`VITE_CLOUDFLARE_WORKER_URL` into the bundle at *build* time, not run time, so a
deploy without a fresh build ships the previous URL.

```bash
# from the repo root — .env must contain VITE_CLOUDFLARE_WORKER_URL
npm run build

cd cloudflare-worker
npx wrangler deploy -c wrangler-web.toml   # publishes ../dist to pos.engaz.tech
```

Verify the API URL actually made it into the bundle:

```bash
curl -s https://pos.engaz.tech/ | grep -o 'src="/assets/[^"]*\.js"'
curl -s https://pos.engaz.tech/assets/<file>.js | grep -o 'https://api\.engaz\.tech'
```

If that grep prints nothing, `VITE_CLOUDFLARE_WORKER_URL` was missing at build
time. `getWorkerUrl()` returns `""`, `isCloudConfigured()` is `false`, and
**cloud backup is silently disabled** regardless of authentication.

### Deploy the API worker

```bash
cd cloudflare-worker
npm install
npx wrangler login

# first-time only: create the D1 database and put its id into wrangler.toml
npx wrangler d1 create system-online-db
npx wrangler d1 execute system-online-db --remote --file=schema.sql

npx wrangler deploy                        # uses wrangler.toml → api.engaz.tech

# production hardening — do not skip (see below)
npx wrangler secret put SESSION_SECRET
```

### Two settings that silently break backup if wrong

1. **`ALLOWED_ORIGINS`** (in `wrangler.toml`) must contain the POS origin
   *exactly* — `https://pos.engaz.tech`. CORS is fail-closed, so a mismatched
   origin means the browser discards the session cookie and every sync fails with
   no visible error in the UI.
2. **`SESSION_SECRET`** ships with a placeholder default so a fresh deploy works
   out of the box. Anyone who reads this repo can forge a session cookie while
   that default is in use, so always override it with
   `npx wrangler secret put SESSION_SECRET` in production.

### Post-deploy verification

Authentication is a session cookie — there is **no API key** (see
[`cloudflare-worker/README.md`](./cloudflare-worker/README.md)). Confirm the gate
works end to end:

```bash
# 1. no cookie → expect 401
curl -s -o /dev/null -w "%{http_code}\n" \
  https://api.engaz.tech/v1/databases/default/collections/orders/documents \
  -H "Origin: https://pos.engaz.tech"

# 2. mint a session, then reuse it → expect 200
curl -s -c /tmp/pos.jar -X POST https://api.engaz.tech/v1/session \
  -H "Origin: https://pos.engaz.tech"
curl -s -o /dev/null -w "%{http_code}\n" -b /tmp/pos.jar \
  https://api.engaz.tech/v1/databases/default/collections/orders/documents \
  -H "Origin: https://pos.engaz.tech"
```

Expected: `401` then `200`. The public QR menu stays reachable with no session:
`curl -s https://api.engaz.tech/public/menu`.

### API surface

- `POST` / `GET` / `DELETE` `/v1/session` — mint / probe / clear the session cookie
- `POST /api/sync` — upsert/delete from the client sync queue
- Appwrite-compatible REST style under `/v1/databases/.../collections/{menu_items|orders|customers|inventory|companies}/documents`
- `GET /public/menu` — unauthenticated read for the customer-facing QR menu

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
├── electron/              # Desktop shell, SQLite, IPC, Telegram
├── cloudflare-worker/     # D1 schema + Worker API
├── scripts/               # Launch helpers
├── .env.example           # Worker URL template
└── package.json
```

---

## 🔐 Notes

- **POS login** (cashier/manager password) is client-side, for local POS use —
  change the default password before any real deployment.
- **Cloud auth** is a server-minted, HttpOnly session cookie; there is no API key
  to enter anywhere. It is established automatically, so backup works with zero
  setup. CORS is fail-closed (`ALLOWED_ORIGINS`, never `*`). The session mint
  endpoint takes no credential, so the barrier is the CORS allowlist plus
  `SESSION_SECRET` — a deliberate tradeoff documented in
  [`cloudflare-worker/README.md`](./cloudflare-worker/README.md). For real
  per-user authorization (cashier vs. manager, refund gating), see the
  `feat/server-side-auth` branch.
- Seed data (menu + inventory) is applied automatically on first IndexedDB open — no separate seed script required.

---

## 📄 License

This project is licensed under the **MIT License**.

---

<div align="center">

**Built with ☕ and TypeScript**

</div>
