-- D1 Schema for BrewMaster POS Central Database

DROP TABLE IF EXISTS menu_items;
CREATE TABLE menu_items (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  price REAL NOT NULL,
  category TEXT NOT NULL,
  description TEXT,
  image TEXT,
  available INTEGER NOT NULL DEFAULT 1,
  branch_id TEXT DEFAULT 'default'
);

DROP TABLE IF EXISTS orders;
CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  orderNumber TEXT NOT NULL,
  tableId TEXT NOT NULL,
  items TEXT NOT NULL, -- JSON string array of items
  status TEXT NOT NULL,
  paymentStatus TEXT NOT NULL DEFAULT 'Unpaid',
  paymentMethod TEXT,
  totalAmount REAL NOT NULL,
  createdAt TEXT NOT NULL,
  paidAt TEXT,
  branch_id TEXT DEFAULT 'default'
);

DROP TABLE IF EXISTS customers;
CREATE TABLE customers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT UNIQUE NOT NULL,
  points REAL NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL,
  branch_id TEXT DEFAULT 'default'
);

DROP TABLE IF EXISTS inventory;
CREATE TABLE inventory (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  unit TEXT NOT NULL,
  stock REAL NOT NULL DEFAULT 0,
  minStock REAL NOT NULL DEFAULT 0,
  costPerUnit REAL NOT NULL DEFAULT 0,
  branch_id TEXT DEFAULT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
