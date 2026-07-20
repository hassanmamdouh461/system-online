<div align="center">

# ☕ BrewMaster
### Full-Stack Coffee Shop Point-of-Sale System

*Built for real cafés. Engineered for scale.*

[![React](https://img.shields.io/badge/React-18-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://reactjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-5-646CFF?style=for-the-badge&logo=vite&logoColor=white)](https://vitejs.dev/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-3-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![Appwrite](https://img.shields.io/badge/Appwrite-BaaS-FD366E?style=for-the-badge&logo=appwrite&logoColor=white)](https://appwrite.io/)
[![Framer Motion](https://img.shields.io/badge/Framer_Motion-Animations-0055FF?style=for-the-badge&logo=framer&logoColor=white)](https://www.framer.com/motion/)

</div>

---

## 🎬 Demo & Screenshots

> **🚀 [Live Demo — Try it now](https://cafeflow.appwrite.network/reports)**

| Dashboard | Kanban Orders | Payment |
|:---------:|:-------------:|:-------:|
| ![Dashboard](./public/screenshots/dashboard.png) | ![Orders](./public/screenshots/orders.png) | ![Payment](./public/screenshots/payment.png) |

| Menu Management | Reports & Analytics |
|:---------------:|:-------------------:|
| ![Menu](./public/screenshots/menu.png) | ![Reports](./public/screenshots/reports.png) |

---

## ✨ Features

### 🏪 Business Features
- **Live Kanban Board** — Visual order pipeline: `New → Preparing → Ready`, drag-free with real-time sync
- **Smart Payment Flow** — Cashier screen with sortable unpaid orders, cash/card method tracking, and instant status updates
- **Dynamic Analytics Dashboard** — Revenue, order count, and peak-hour insights with configurable time filters (Today / This Week / This Month)
- **Menu Management** — Full CRUD for menu items with image support and category organization
- **Reports Page** — Weekly/monthly financial summaries, strictly calculated from **Paid** orders only
- **Responsive Design** — Full desktop sidebar + mobile bottom-nav with swipe gestures, works on any tablet or phone

### ⚙️ Technical Features
- **Real-time multi-device sync** via Appwrite Realtime WebSocket subscriptions
- **Smart Auth** with `Remember Me` — persists session to `localStorage` or `sessionStorage` based on user preference
- **Framer Motion** powered animations for order card entrance/exit, modal transitions, and page changes
- **Performance-optimized Kanban** using `useMemo` single-pass grouping (see [Challenges Conquered](#-challenges-conquered))
- **Appwrite SDK bug workaround** using direct REST API for PATCH operations (see [Challenges Conquered](#-challenges-conquered))
- **forwardRef** on animated components to silence React ref warnings in `AnimatePresence`

---

## 🏛️ System Architecture & Core Logic

### The Separation of Concerns Principle

> ⚠️ **This is the most important architectural decision in this system.**

Most café POS systems make a critical accounting mistake: they treat *"order status"* and *"payment status"* as the same thing. BrewMaster solves this with a strict two-flow architecture:

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

**Why this matters in the real world:**

| Scenario | Naive POS | BrewMaster |
|----------|-----------|------------|
| Order delivered but not yet paid | Counted as revenue ❌ | Not counted as revenue ✅ |
| Order paid but still being prepared | Missing from kitchen board ❌ | Visible on both screens ✅ |
| End-of-day revenue report | Inflated / inaccurate ❌ | Strictly from `Paid` orders ✅ |

> 💡 **Revenue is never recognized until an order's `paymentStatus` is `"paid"`** — regardless of its kitchen status. This mirrors standard hospitality accounting practice.

---

## 🧗 Challenges Conquered

### 1. Appwrite SDK v22 Bug — `t.isBigNumber is not a function`

While integrating Appwrite's Node.js SDK for document updates, a blocking runtime error surfaced deep inside the SDK internals:

```
TypeError: t.isBigNumber is not a function
```

**Investigation:** The bug was traced to Appwrite SDK v22's internal serialization of numeric fields using a misconfigured `bignumber.js` dependency — broken in certain Node/Vite environments.

**Solution:** Rather than downgrading the entire SDK and losing Realtime capabilities, I **reverse-engineered the Appwrite REST API spec** and replaced all `databases.updateDocument()` calls with direct `fetch()` calls to the Appwrite REST endpoint, using the project's API key. The Realtime subscription (which is unaffected) was kept on the SDK. This gave us:
- ✅ Fully working PATCH operations
- ✅ Realtime sync preserved
- ✅ Zero dependency changes

```typescript
// Direct REST PATCH — bypassing broken SDK method
await fetch(`${APPWRITE_ENDPOINT}/databases/${DB_ID}/collections/${COL_ID}/documents/${docId}`, {
  method: 'PATCH',
  headers: { 'X-Appwrite-Project': PROJECT_ID, 'X-Appwrite-Key': API_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ data: payload })
});
```

---

### 2. Kanban Performance — Single-Pass `useMemo` Grouping

The initial Kanban implementation used three separate `Array.filter()` calls to group orders by status (`new`, `preparing`, `ready`). With a large order list, this meant **three full iterations** of the array on every render cycle.

**Solution:** Replaced the three filters with a single `useMemo` that performs **one pass** using `Array.reduce()`:

```typescript
const groupedOrders = useMemo(() => {
  return orders.reduce((acc, order) => {
    acc[order.status].push(order);
    return acc;
  }, { new: [], preparing: [], ready: [] } as GroupedOrders);
}, [orders]);
```

**Result:** Rendering complexity dropped from `O(3n)` to `O(n)`, eliminating multi-filtering bottlenecks and making column re-renders surgical and isolated.

---

## 🛠️ Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Framework** | React 18 + TypeScript | Component architecture, type safety |
| **Build Tool** | Vite 5 | Lightning-fast HMR and optimized production builds |
| **Styling** | Tailwind CSS v3 | Utility-first dark-theme UI |
| **Animations** | Framer Motion | Page transitions, card animations, modal UX |
| **Backend / BaaS** | Appwrite | Database, Auth, Realtime subscriptions, File Storage |
| **State** | React Context + Custom Hooks | Lightweight global state without Redux overhead |
| **Deployment** | Netlify | CI/CD from GitHub, custom headers, SPA redirects |

---

## 🚀 Getting Started

### Prerequisites
- Node.js `>= 18`
- An [Appwrite](https://appwrite.io/) project (Cloud or Self-Hosted)

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/your-username/brewmaster-pos.git
cd brewmaster-pos

# 2. Install dependencies
npm install
```

### Environment Setup

Create a `.env` file in the project root:

```env
VITE_APPWRITE_ENDPOINT=https://cloud.appwrite.io/v1
VITE_APPWRITE_PROJECT_ID=your_project_id
VITE_APPWRITE_DATABASE_ID=your_database_id
VITE_APPWRITE_ORDERS_COLLECTION_ID=your_orders_collection_id
VITE_APPWRITE_MENU_COLLECTION_ID=your_menu_collection_id
VITE_APPWRITE_API_KEY=your_server_api_key
```

### Seed Demo Data *(Optional)*

```bash
# Populate the database with demo menu items and orders
npx tsx scripts/seed-appwrite.ts
```

### Run Development Server

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## 📁 Project Structure

```
src/
├── components/        # Reusable UI components (layout, orders, menu, payment)
├── context/           # React Context providers (Auth, Data)
├── hooks/             # Custom hooks (useOrders, useMenu, useAnalytics, ...)
├── lib/               # Appwrite client configuration
├── pages/             # Route-level page components
├── services/          # Data access layer (ordersService, menuService)
└── types/             # TypeScript interfaces and type definitions
```

---

## 📄 License

This project is licensed under the **MIT License** — see the [LICENSE](./LICENSE) file for details.

---

<div align="center">

**Built with ☕ and TypeScript**

*If this project helped you, consider giving it a ⭐*

</div>
