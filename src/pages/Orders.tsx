import { useLanguage } from '../context/LanguageContext';
import { useOrders } from '../hooks/useOrders';
import { useMenu } from '../hooks/useMenu';
import { POSView } from '../components/orders/POSView';

import { getTaxRate } from '../utils/settingsConfig';
import { calcGrandTotal, calcTax, sumLineTotals } from '../utils/money';
import { nextOrderSeq } from '../utils/orderNumber';

/**
 * The cashier screen: point of sale only.
 *
 * The kitchen kanban board (New / Preparing / Ready / Cancelled / Completed
 * columns) used to live here behind a second tab, plus a standalone /kitchen
 * route. The operator does not use it — tickets are printed for the bar — so the
 * board, its tab, the status-advancing click handlers and the dedicated route
 * were all removed on request. Nothing else in the app rendered them.
 *
 * The order-status field itself is untouched: POS orders are still created with
 * status 'New' and the payment flow still owns paymentStatus, so reports and
 * invoices keep working exactly as before.
 */
export default function Orders() {
  const { orders, error, addOrder } = useOrders();
  const { language } = useLanguage();
  const { items: menuItems } = useMenu();

  const handleCreatePOSOrder = async (
    tableId: string,
    items: any[],
    paymentStatus: 'Paid' | 'Unpaid' | 'OnAccount' | 'Refunded',
    paymentMethod?: 'Cash' | 'Card' | 'OnAccount',
    paidAmount?: number,
    customerPhone?: string,
    accountMeta?: {
      customerId?: string;
      customerName?: string;
      companyId?: string;
      companyName?: string;
      billedToType?: 'customer' | 'company';
      cashierName?: string;
    }
  ) => {
    // Money math goes through utils/money — never raw `*` / `+` (see money.ts).
    const totalAmount = sumLineTotals(items);
    const taxRate = getTaxRate();
    const taxAmount = calcTax(totalAmount, taxRate);
    const grandTotal = calcGrandTotal(totalAmount, taxAmount);
    void paidAmount;
    const newOrder = await addOrder({
      orderNumber: '',
      tableId,
      items,
      status: 'New',
      paymentStatus,
      paymentMethod,
      totalAmount,
      taxRate,
      taxAmount,
      grandTotal,
      createdAt: new Date().toISOString(),
      paidAt: paymentStatus === 'Paid' ? new Date().toISOString() : undefined,
      customerPhone,
      customerId: accountMeta?.customerId,
      customerName: accountMeta?.customerName,
      companyId: accountMeta?.companyId,
      companyName: accountMeta?.companyName,
      billedToType: accountMeta?.billedToType,
      cashierName: accountMeta?.cashierName,
    });
    if (!newOrder) {
      throw new Error(language === 'ar' ? 'فشل حفظ الطلب' : 'Failed to save order');
    }
    return newOrder;
  };

  if (error) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <p className="text-red-600 font-semibold mb-2">
            {language === 'ar' ? 'فشل تحميل الطلبات' : 'Failed to load orders'}
          </p>
          <p className="text-gray-500 text-sm">{error.message}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-80px)] sm:h-[calc(100vh-90px)] w-full">
      <div className="flex-1 overflow-hidden">
        <POSView
          menuItems={menuItems}
          onCreateOrder={handleCreatePOSOrder}
          estimatedOrderNumber={String(nextOrderSeq(orders))}
        />
      </div>
    </div>
  );
}
