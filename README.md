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
- **Live Kanban Board** — Visual order pipeline: `New → Preparing → Ready`
- **Smart Payment Flow** — Cashier screen with unpaid/paid lists, cash/card tracking
- **POS Cashier** — Create orders, optional customer phone, print tickets
- **Customers & Companies** — Profiles, tags, affiliation, transaction history
- **Inventory + Recipes** — Stock levels, auto-deduct on sales, low-stock alerts
- **Manager Analytics** — Multi-branch aware reports (Paid orders only)
- **Public QR Menu** — Customer-facing menu at `/public-menu`
- **Telegram reports** — Optional sales reports via a configured bot (Settings → Telegram)
- **Bilingual UI** — Arabic / English with RTL support
- **Responsive** — Desktop sidebar, tablet breakpoints, mobile bottom-nav

### ⚙️ Technical Features
- **Offline-first** — IndexedDB (via `idb`) with a durable sync queue
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

Default login: username `admin` / password `123` (change in Settings).

### Build SPA

```bash
npm run build
npm run preview
```

### Quality checks

```bash
npm run typecheck   # TypeScript, no emit
npm run lint        # ESLint
npm run test        # Vitest unit tests
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
npx wrangler deploy
```

Then set `VITE_CLOUDFLARE_WORKER_URL` to the deployed Worker URL and rebuild the frontend.

API surface:
- `POST /api/sync` — upsert/delete from the client sync queue
- Appwrite-compatible REST style under `/v1/databases/.../collections/{menu_items|orders|customers|inventory|companies}/documents`

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

- **Auth is client-side** for demo/local POS use — change the default password before any real deployment. Passwords are stored **hashed** (PBKDF2 / SHA-256 / random salt via Web Crypto); the one-time `123` bootstrap password only works until a real password is set, after which it is permanently disabled.
- **The Cloudflare Worker is fail-closed.** It refuses every request with `503` unless an `API_KEY` secret is configured, rejects requests whose `X-API-Key` header does not match (`401`), and only emits CORS headers for origins listed in `ALLOWED_ORIGINS` (no wildcard reflection). Configure both secrets before exposing it to the internet.
- Seed data (menu + inventory) is applied automatically on first IndexedDB open — no separate seed script required.

---

## 📄 License

This project is licensed under the **MIT License**.

---

<div align="center">

**Built with ☕ and TypeScript**

</div>
