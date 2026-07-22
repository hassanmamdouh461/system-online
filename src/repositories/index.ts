import { IndexedDbMenuRepository } from './indexeddb/IndexedDbMenuRepository';
import { IndexedDbOrderRepository } from './indexeddb/IndexedDbOrderRepository';
import { IndexedDbCustomerRepository } from './indexeddb/IndexedDbCustomerRepository';
import { IndexedDbCompanyRepository } from './indexeddb/IndexedDbCompanyRepository';

export * from './types';
export * from './indexeddb/db';

export const menuRepository = new IndexedDbMenuRepository();
export const orderRepository = new IndexedDbOrderRepository();
export const customerRepository = new IndexedDbCustomerRepository();
export const companyRepository = new IndexedDbCompanyRepository();
