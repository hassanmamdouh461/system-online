import { IndexedDbMenuRepository } from './indexeddb/IndexedDbMenuRepository';
import { IndexedDbOrderRepository } from './indexeddb/IndexedDbOrderRepository';
import { IndexedDbCustomerRepository } from './indexeddb/IndexedDbCustomerRepository';

export * from './types';
export * from './indexeddb/db';

export const menuRepository = new IndexedDbMenuRepository();
export const orderRepository = new IndexedDbOrderRepository();
export const customerRepository = new IndexedDbCustomerRepository();
