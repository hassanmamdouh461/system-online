import type { Order } from '../types/order';

/**
 * "Linked Orders" on the customers page — orders attributed to a customer or a
 * company account.
 *
 * The card used to be a raw `orders.filter(o => o.customerPhone || o.customerId)`
 * over the whole order table: it kept Cancelled orders, and it ignored company
 * attribution entirely. The customer and company rows underneath it are built
 * from `customerOrders()` / `companyOrders()`, so the card and the rows measured
 * two different things and openly contradicted each other on screen
 * ("Linked Orders = 3" above rows totalling zero).
 *
 * The agreed meaning is: every NON-CANCELLED order attributed to a customer or a
 * company. Counting orders (rather than summing the rows) also means an order
 * billed to a company on behalf of a named member is counted once, not twice.
 */

/** Is this order attributed to a customer or a company account? */
export function isAccountLinkedOrder(order: Pick<Order, 'customerId' | 'customerPhone' | 'companyId'>): boolean {
  return Boolean(order.customerId || order.customerPhone || order.companyId);
}

/** Distinct non-cancelled orders attributed to a customer or a company. */
export function countLinkedOrders(orders: Order[]): number {
  return orders.filter(o => o.status !== 'Cancelled' && isAccountLinkedOrder(o)).length;
}
