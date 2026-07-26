import { Order, getOrderGrandTotal } from '../types/order';
import { Customer } from '../types/customer';
import { sumMoneyBy, roundMoney } from './money';

/**
 * `roundMoney` now lives in `utils/money.ts` — the single home for all money
 * arithmetic. Re-exported here only so existing importers keep working.
 *
 * @deprecated Import from `utils/money` instead.
 */
export { roundMoney };

function phonesMatch(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  const pa = a.replace(/[\s\-()]/g, '').trim();
  const pb = b.replace(/[\s\-()]/g, '').trim();
  if (!pa || !pb) return false;
  return pa === pb || pa.endsWith(pb) || pb.endsWith(pa);
}

function normalizePhone(p?: string): string {
  return (p || '').replace(/[\s\-()]/g, '').trim();
}

/** True when this OnAccount invoice is carried by a company ledger. */
export function isCompanyBilledOrder(order: Order): boolean {
  if (!order) return false;
  
  // Edge Case: Exclude explicitly cancelled or refunded orders
  if (order.status === 'Cancelled' || order.paymentStatus === 'Refunded') return false;
  
  // Must be strictly OnAccount
  if (order.paymentStatus !== 'OnAccount') return false;

  if (order.billedToType === 'customer') return false;
  if (order.billedToType === 'company') return true;
  if (!order.billedToType && order.companyId && order.companyName) return true;
  
  return false;
}

/**
 * Personal customer open credit only (excludes company-billed invoices).
 */
export function getCustomerAccountBalance(
  orders: Order[],
  customer: Pick<Customer, 'id' | 'phone'>,
  taxRate = 0
): number {
  return sumMoneyBy(getCustomerOpenInvoices(orders, customer), o =>
    getOrderGrandTotal(o, taxRate)
  );
}

/**
 * Company open credit:
 * - invoices billed to the company (billedToType=company)
 * - PLUS personal OnAccount of affiliated members (optional, default true for ops visibility)
 */
export function getCompanyAccountBalance(
  orders: Order[],
  companyId: string,
  taxRate = 0,
  memberPhones: string[] = [],
  memberIds: string[] = [],
  includeMemberPersonal = false
): number {
  return sumMoneyBy(
    getCompanyOpenInvoices(orders, companyId, memberPhones, memberIds, includeMemberPersonal),
    o => getOrderGrandTotal(o, taxRate)
  );
}

export function getCustomerOpenInvoices(
  orders: Order[],
  customer: Pick<Customer, 'id' | 'phone'>
): Order[] {
  if (!orders || !customer) return [];
  
  return orders
    .filter(o => {
      // Exclude invalid or non-debt statuses explicitly
      if (o.status === 'Cancelled' || o.paymentStatus === 'Refunded') return false;
      if (o.paymentStatus !== 'OnAccount') return false;
      
      if (isCompanyBilledOrder(o)) return false;
      if (o.customerId && o.customerId === customer.id) return true;
      return phonesMatch(o.customerPhone, customer.phone);
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

/**
 * Open invoices attributed to a company for balance / statement.
 */
export function getCompanyOpenInvoices(
  orders: Order[],
  companyId: string,
  memberPhones: string[] = [],
  memberIds: string[] = [],
  includeMemberPersonal = false
): Order[] {
  if (!orders || !companyId) return [];

  const phoneSet = new Set(memberPhones.map(normalizePhone).filter(Boolean));
  const idSet = new Set(memberIds.filter(Boolean));

  return orders
    .filter(o => {
      // Exclude invalid or non-debt statuses explicitly
      if (o.status === 'Cancelled' || o.paymentStatus === 'Refunded') return false;
      if (o.paymentStatus !== 'OnAccount') return false;

      // Explicitly company-billed
      if (isCompanyBilledOrder(o) && o.companyId === companyId) return true;

      // Personal member debts (affiliated customers)
      if (includeMemberPersonal && !isCompanyBilledOrder(o)) {
        if (o.customerId && idSet.has(o.customerId)) return true;
        if (o.customerPhone && phoneSet.has(normalizePhone(o.customerPhone))) return true;
      }
      return false;
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

/** Strict company-only invoices (no personal member debts). */
export function getCompanyBilledOnlyInvoices(orders: Order[], companyId: string): Order[] {
  return orders
    .filter(o => isCompanyBilledOrder(o) && o.companyId === companyId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}
