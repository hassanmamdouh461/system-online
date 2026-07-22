import { Order, getOrderGrandTotal } from '../types/order';
import { getTaxRate, getStoreConfig } from './settingsConfig';
import { filterItemsBySection } from './orderSection';
import { formatOrderNumber } from './orderNumber';

/**
 * Write receipt content into a hidden iframe and trigger native browser print dialog.
 * This completely avoids browser popup blockers and blank new tabs.
 */
function printHtml(htmlContent: string) {
  let printIframe = document.getElementById('pos-print-iframe') as HTMLIFrameElement | null;
  
  if (!printIframe) {
    printIframe = document.createElement('iframe');
    printIframe.id = 'pos-print-iframe';
    printIframe.style.position = 'fixed';
    printIframe.style.right = '0';
    printIframe.style.bottom = '0';
    printIframe.style.width = '0px';
    printIframe.style.height = '0px';
    printIframe.style.border = '0px';
    printIframe.style.opacity = '0';
    printIframe.style.pointerEvents = 'none';
    document.body.appendChild(printIframe);
  }

  const iframeWin = printIframe.contentWindow;
  if (iframeWin) {
    const doc = iframeWin.document;
    doc.open();
    doc.write(htmlContent);
    doc.close();

    setTimeout(() => {
      try {
        iframeWin.focus();
        iframeWin.print();
      } catch (err) {
        console.error('Failed to trigger print:', err);
      }
    }, 200);
  }
}

/**
 * Print standard customer receipt
 */
export function printCustomerReceipt(order: Order, lang: 'en' | 'ar' = 'ar') {
  const isRtl = lang === 'ar';
  const ticketNo = formatOrderNumber(order);
  const subtotal = order.totalAmount;
  // Prefer frozen tax snapshot on the order (historical accuracy).
  const taxRate = typeof order.taxRate === 'number' ? order.taxRate : getTaxRate();
  const tax = typeof order.taxAmount === 'number' ? order.taxAmount : subtotal * taxRate;
  const grandTotal =
    typeof order.grandTotal === 'number'
      ? order.grandTotal
      : Math.max(0, subtotal + tax - (order.pointsRedeemed || 0));

  const title = isRtl ? 'فاتورة الدفع' : 'Payment Receipt';
  const tableLabel = isRtl ? 'الطاولة / نوع الطلب' : 'Table / Mode';
  const orderLabel = isRtl ? 'رقم الطلب' : 'Order No.';
  const dateLabel = isRtl ? 'التاريخ' : 'Date';
  const itemLabel = isRtl ? 'الأصناف' : 'Items';
  const subtotalLabel = isRtl ? 'المجموع الفرعي' : 'Subtotal';
  const taxLabel = isRtl ? `الضريبة (${taxRate * 100}%)` : `Tax (${taxRate * 100}%)`;
  const totalLabel = isRtl ? 'الإجمالي المدفوع' : 'TOTAL PAID';
  const totalUnpaidLabel = isRtl ? 'المطلوب سداده' : 'TOTAL DUE';
  const paymentMethodLabel = isRtl ? 'طريقة الدفع' : 'Payment Method';
  const statusLabel = isRtl ? 'الحالة' : 'Status';
  const thankYou = isRtl ? 'شكراً لزيارتكم! بالهناء والشفاء ☕' : 'Thank you for your visit! Enjoy ☕';
  const cashierStamp =
    order.paymentStatus === 'Paid'
      ? isRtl
        ? '✓ مدفوع'
        : '✓ PAID'
      : order.paymentStatus === 'Refunded'
        ? isRtl
          ? '↩ مسترجع'
          : '↩ REFUNDED'
        : order.paymentStatus === 'OnAccount'
          ? isRtl
            ? 'على الحساب'
            : 'ON ACCOUNT'
          : isRtl
            ? 'غير مدفوع'
            : 'UNPAID';

  const store = getStoreConfig();
  const storeName = store.storeName || 'BrewMaster';
  const storeTagline = store.tagline || (isRtl ? 'تجربة قهوة مميزة' : 'Premium Coffee Experience');
  const storePhone = store.phone || '';
  const storeAddress = store.address || '';

  const html = `
    <!DOCTYPE html>
    <html dir="${isRtl ? 'rtl' : 'ltr'}">
    <head>
      <title>${title} - ${formatOrderNumber(order)}</title>
      <meta charset="utf-8">
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
          font-family: 'Arial', 'Courier New', monospace; 
          padding: 10px;
          max-width: 320px;
          margin: 0 auto;
          font-size: 13px;
          color: #000;
          background: #fff;
        }
        .header { 
          text-align: center; 
          border-bottom: 2px dashed #000;
          padding-bottom: 8px;
          margin-bottom: 12px;
        }
        .header h1 { font-size: 20px; margin-bottom: 4px; font-weight: bold; }
        .header p { font-size: 11px; color: #333; }
        .stamp {
          text-align: center;
          font-size: 22px;
          font-weight: bold;
          color: ${order.paymentStatus === 'Paid' ? '#10b981' : order.paymentStatus === 'Refunded' ? '#dc2626' : order.paymentStatus === 'OnAccount' ? '#d97706' : '#ef4444'};
          border: 2px solid ${order.paymentStatus === 'Paid' ? '#10b981' : order.paymentStatus === 'Refunded' ? '#dc2626' : order.paymentStatus === 'OnAccount' ? '#d97706' : '#ef4444'};
          padding: 6px;
          margin: 12px 0;
          border-radius: 6px;
          text-transform: uppercase;
        }
        .info { margin: 12px 0; font-size: 12px; border-bottom: 1px dashed #000; padding-bottom: 8px; }
        .info-row { 
          display: flex; 
          justify-content: space-between;
          margin: 4px 0;
        }
        .items { 
          padding: 8px 0;
          margin: 8px 0;
        }
        .item { 
          display: flex;
          justify-content: space-between;
          margin: 6px 0;
          font-size: 12px;
        }
        .item-name { flex: 1; ${isRtl ? 'padding-left' : 'padding-right'}: 8px; }
        .totals { border-top: 1px dashed #000; padding-top: 8px; margin-top: 12px; }
        .total-row { 
          display: flex;
          justify-content: space-between;
          margin: 4px 0;
        }
        .total-row.grand { 
          font-size: 15px;
          font-weight: bold;
          border-top: 2px solid #000;
          padding-top: 6px;
          margin-top: 6px;
        }
        .payment-info {
          background: #f4f4f5;
          padding: 8px;
          border-radius: 6px;
          margin: 12px 0;
          text-align: center;
          font-size: 12px;
        }
        .footer { 
          text-align: center;
          margin-top: 16px;
          padding-top: 8px;
          border-top: 1px dashed #000;
          font-size: 11px;
        }
        @media print {
          @page { margin: 0; size: auto; }
          body { padding: 5px; width: 100%; max-width: 100%; }
        }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>${storeName}</h1>
        <p>${storeTagline}</p>
        ${storeAddress ? `<p>${storeAddress}</p>` : ''}
        ${storePhone ? `<p>Tel: ${storePhone}</p>` : ''}
      </div>

      <div class="stamp">${cashierStamp}</div>
      
      <div class="info">
        <div class="info-row">
          <strong>${orderLabel}:</strong>
          <span>#${ticketNo}</span>
        </div>
        <div class="info-row">
          <strong>${tableLabel}:</strong>
          <span>${order.tableId === 'Takeaway' || order.tableId === 'Dine-in' ? (isRtl && order.tableId === 'Takeaway' ? 'take away' : isRtl && order.tableId === 'Dine-in' ? 'مطعم' : order.tableId) : order.tableId}</span>
        </div>
        ${order.customerName || order.customerPhone ? `
        <div class="info-row">
          <strong>${isRtl ? 'العميل' : 'Customer'}:</strong>
          <span>${order.customerName || ''}${order.customerName && order.customerPhone ? ' · ' : ''}${order.customerPhone || ''}</span>
        </div>` : ''}
        ${order.companyName || (order.billedToType === 'company' && order.companyId) ? `
        <div class="info-row">
          <strong>${isRtl ? 'الشركة / الحساب' : 'Company / Account'}:</strong>
          <span>${order.companyName || order.companyId}${order.billedToType === 'company' ? (isRtl ? ' (على الحساب)' : ' (on account)') : ''}</span>
        </div>` : (order.paymentStatus === 'OnAccount' ? `
        <div class="info-row">
          <strong>${isRtl ? 'الحساب' : 'Account'}:</strong>
          <span>${isRtl ? 'على الحساب' : 'On account'}</span>
        </div>` : '')}
        <div class="info-row">
          <strong>${dateLabel}:</strong>
          <span>${new Date(order.createdAt).toLocaleString(isRtl ? 'ar-EG' : 'en-US')}</span>
        </div>
      </div>

      <div class="items">
        <h3 style="font-size: 13px; margin-bottom: 6px;">${itemLabel}:</h3>
        ${order.items.map(item => `
          <div class="item">
            <span class="item-name">${item.quantity}x ${item.name}</span>
            <span>${(item.price * item.quantity).toFixed(2)} ${isRtl ? 'ج.م' : 'EGP'}</span>
          </div>
        `).join('')}
      </div>

      <div class="totals">
        <div class="total-row">
          <span>${subtotalLabel}:</span>
          <span>${subtotal.toFixed(2)} ${isRtl ? 'ج.م' : 'EGP'}</span>
        </div>
        <div class="total-row">
          <span>${taxLabel}:</span>
          <span>${tax.toFixed(2)} ${isRtl ? 'ج.م' : 'EGP'}</span>
        </div>
        <div class="total-row grand">
          <span>${order.paymentStatus === 'Paid' ? totalLabel : totalUnpaidLabel}:</span>
          <span>${grandTotal.toFixed(2)} ${isRtl ? 'ج.م' : 'EGP'}</span>
        </div>
      </div>

      ${order.paymentStatus === 'Paid' && order.paymentMethod ? `
        <div class="payment-info">
          <strong>${paymentMethodLabel}:</strong> ${isRtl && order.paymentMethod === 'Cash' ? 'نقداً' : isRtl && order.paymentMethod === 'Card' ? 'بطاقة' : order.paymentMethod}
        </div>
      ` : ''}

      <div class="footer">
        <p>${thankYou}</p>
        <p>${storeName} POS</p>
      </div>
    </body>
    </html>
  `;

  printHtml(html);
}

/**
 * Print kitchen receipt containing food items
 */
export function printKitchenReceipt(order: Order, lang: 'en' | 'ar' = 'ar') {
  const items = filterItemsBySection(order.items, 'kitchen');
  if (items.length === 0) return;

  const isRtl = lang === 'ar';
  const title = isRtl ? 'طلب المطبخ - أكل' : 'KITCHEN TICKET - FOOD';
  const tableLabel = isRtl ? 'الطاولة' : 'Table';
  const orderLabel = isRtl ? 'طلب رقم' : 'Order #';
  const itemsCountLabel = isRtl ? 'عدد الأصناف' : 'Items Count';
  const dateLabel = isRtl ? 'التاريخ' : 'Date';

  const html = `
    <!DOCTYPE html>
    <html dir="${isRtl ? 'rtl' : 'ltr'}">
    <head>
      <title>${title} - ${formatOrderNumber(order)}</title>
      <meta charset="utf-8">
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
          font-family: 'Arial', sans-serif; 
          padding: 8px;
          max-width: 320px;
          margin: 0 auto;
          color: #000;
          background: #fff;
        }
        .header { 
          text-align: center; 
          border-bottom: 3px double #000;
          padding-bottom: 8px;
          margin-bottom: 8px;
        }
        .header h1 { font-size: 18px; font-weight: 900; letter-spacing: 0.5px; }
        .details-box {
          border: 2px solid #000;
          padding: 8px;
          margin-bottom: 10px;
          border-radius: 4px;
        }
        .details-row {
          display: flex;
          justify-content: space-between;
          margin: 4px 0;
          font-size: 14px;
        }
        .large-text {
          font-size: 26px;
          font-weight: 900;
        }
        .items-list {
          margin-top: 10px;
        }
        .item-row {
          display: flex;
          border-bottom: 1px dashed #000;
          padding: 8px 0;
          align-items: center;
        }
        .item-qty {
          font-size: 28px;
          font-weight: 900;
          margin-${isRtl ? 'left' : 'right'}: 15px;
          background: #000;
          color: #fff;
          padding: 2px 8px;
          border-radius: 4px;
          min-width: 48px;
          text-align: center;
        }
        .item-name {
          font-size: 18px;
          font-weight: bold;
          flex: 1;
        }
        .footer {
          margin-top: 20px;
          text-align: center;
          font-size: 12px;
          border-top: 1px dashed #000;
          padding-top: 6px;
        }
        @media print {
          @page { margin: 0; size: auto; }
          body { padding: 5px; width: 100%; max-width: 100%; }
        }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>🍳 ${title}</h1>
      </div>

      <div class="details-box">
        <div class="details-row">
          <span><strong>${orderLabel}:</strong></span>
          <span class="large-text">#${formatOrderNumber(order)}</span>
        </div>
        <div class="details-row">
          <span><strong>${tableLabel}:</strong></span>
          <span class="large-text">${order.tableId === 'Takeaway' || order.tableId === 'Dine-in' ? (isRtl && order.tableId === 'Takeaway' ? 'take away' : isRtl && order.tableId === 'Dine-in' ? 'مطعم' : order.tableId) : order.tableId}</span>
        </div>
        <div class="details-row" style="font-size: 11px; margin-top: 6px;">
          <span>${dateLabel}: ${new Date(order.createdAt).toLocaleString(isRtl ? 'ar-EG' : 'en-US')}</span>
          <span>${itemsCountLabel}: ${items.reduce((sum, i) => sum + i.quantity, 0)}</span>
        </div>
      </div>

      <div class="items-list">
        ${items.map(item => `
          <div class="item-row">
            <span class="item-qty">${item.quantity}</span>
            <span class="item-name">${item.name}</span>
          </div>
        `).join('')}
      </div>

      <div class="footer">
        <p>BrewMaster - Kitchen Printer</p>
      </div>
    </body>
    </html>
  `;

  printHtml(html);
}

/**
 * Print drinks/beverage receipt
 */
export function printDrinksReceipt(order: Order, lang: 'en' | 'ar' = 'ar') {
  const items = filterItemsBySection(order.items, 'drinks');
  if (items.length === 0) return;

  const isRtl = lang === 'ar';
  const title = isRtl ? 'طلب المشروبات - بار' : 'DRINKS TICKET - BAR';
  const tableLabel = isRtl ? 'الطاولة' : 'Table';
  const orderLabel = isRtl ? 'طلب رقم' : 'Order #';
  const itemsCountLabel = isRtl ? 'عدد الأصناف' : 'Items Count';
  const dateLabel = isRtl ? 'التاريخ' : 'Date';

  const html = `
    <!DOCTYPE html>
    <html dir="${isRtl ? 'rtl' : 'ltr'}">
    <head>
      <title>${title} - ${formatOrderNumber(order)}</title>
      <meta charset="utf-8">
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
          font-family: 'Arial', sans-serif; 
          padding: 8px;
          max-width: 320px;
          margin: 0 auto;
          color: #000;
          background: #fff;
        }
        .header { 
          text-align: center; 
          border-bottom: 3px double #000;
          padding-bottom: 8px;
          margin-bottom: 8px;
        }
        .header h1 { font-size: 18px; font-weight: 900; letter-spacing: 0.5px; }
        .details-box {
          border: 2px solid #000;
          padding: 8px;
          margin-bottom: 10px;
          border-radius: 4px;
        }
        .details-row {
          display: flex;
          justify-content: space-between;
          margin: 4px 0;
          font-size: 14px;
        }
        .large-text {
          font-size: 26px;
          font-weight: 900;
        }
        .items-list {
          margin-top: 10px;
        }
        .item-row {
          display: flex;
          border-bottom: 1px dashed #000;
          padding: 8px 0;
          align-items: center;
        }
        .item-qty {
          font-size: 28px;
          font-weight: 900;
          margin-${isRtl ? 'left' : 'right'}: 15px;
          background: #000;
          color: #fff;
          padding: 2px 8px;
          border-radius: 4px;
          min-width: 48px;
          text-align: center;
        }
        .item-name {
          font-size: 18px;
          font-weight: bold;
          flex: 1;
        }
        .footer {
          margin-top: 20px;
          text-align: center;
          font-size: 12px;
          border-top: 1px dashed #000;
          padding-top: 6px;
        }
        @media print {
          @page { margin: 0; size: auto; }
          body { padding: 5px; width: 100%; max-width: 100%; }
        }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>☕ ${title}</h1>
      </div>

      <div class="details-box">
        <div class="details-row">
          <span><strong>${orderLabel}:</strong></span>
          <span class="large-text">#${formatOrderNumber(order)}</span>
        </div>
        <div class="details-row">
          <span><strong>${tableLabel}:</strong></span>
          <span class="large-text">${order.tableId === 'Takeaway' || order.tableId === 'Dine-in' ? (isRtl && order.tableId === 'Takeaway' ? 'take away' : isRtl && order.tableId === 'Dine-in' ? 'مطعم' : order.tableId) : order.tableId}</span>
        </div>
        <div class="details-row" style="font-size: 11px; margin-top: 6px;">
          <span>${dateLabel}: ${new Date(order.createdAt).toLocaleString(isRtl ? 'ar-EG' : 'en-US')}</span>
          <span>${itemsCountLabel}: ${items.reduce((sum, i) => sum + i.quantity, 0)}</span>
        </div>
      </div>

      <div class="items-list">
        ${items.map(item => `
          <div class="item-row">
            <span class="item-qty">${item.quantity}</span>
            <span class="item-name">${item.name}</span>
          </div>
        `).join('')}
      </div>

      <div class="footer">
        <p>BrewMaster - Bar Printer</p>
      </div>
    </body>
    </html>
  `;

  printHtml(html);
}

/**
 * Print all relevant tickets for an order:
 * 1. Customer receipt (Cashier / الكاشير)
 * 2. Kitchen receipt (المطبخ - if food items exist)
 * 3. Bar receipt (البار - if drink items exist)
 */
export function printAllOrderTickets(order: Order, lang: 'en' | 'ar' = 'ar') {
  const drinkItems = filterItemsBySection(order.items, 'drinks');
  const kitchenItems = filterItemsBySection(order.items, 'kitchen');

  let delay = 0;

  // 1. Customer receipt when paid OR charged to account
  if (order.paymentStatus === 'Paid' || order.paymentStatus === 'OnAccount') {
    printCustomerReceipt(order, lang);
    delay += 500;
  }

  // 2. Kitchen ticket for food items (always on place/save)
  if (kitchenItems.length > 0) {
    const run = () => printKitchenReceipt(order, lang);
    if (delay > 0) setTimeout(run, delay);
    else run();
    delay += 500;
  }

  // 3. Bar ticket for drinks (always on place/save)
  if (drinkItems.length > 0) {
    const run = () => printDrinksReceipt(order, lang);
    if (delay > 0) setTimeout(run, delay);
    else run();
  }
}

/**
 * Print a single company account statement: all open OnAccount invoices
 * for the company (total amount due).
 */
export function printCompanyStatement(opts: {
  companyName: string;
  companyPhone?: string;
  orders: Order[];
  taxRate?: number;
  lang?: 'en' | 'ar';
  resolveCustomerLabel?: (o: Order) => string;
}) {
  const {
    companyName,
    companyPhone,
    orders,
    taxRate: taxRateOpt,
    lang = 'ar',
    resolveCustomerLabel,
  } = opts;
  const isRtl = lang === 'ar';
  const store = getStoreConfig();
  const fallbackTax = typeof taxRateOpt === 'number' ? taxRateOpt : getTaxRate();

  const open = orders
    .filter(o => o.paymentStatus === 'OnAccount' && o.status !== 'Cancelled')
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  const total = open.reduce((s, o) => s + getOrderGrandTotal(o, fallbackTax), 0);

  const title = isRtl ? 'كشف حساب شركة' : 'Company Account Statement';
  const dateLabel = isRtl ? 'التاريخ' : 'Date';
  const invLabel = isRtl ? 'فاتورة' : 'Invoice';
  const byLabel = isRtl ? 'بواسطة' : 'By';
  const totalLabel = isRtl ? 'إجمالي المبالغ المستحقة' : 'Total amounts due';
  const storeName = store.storeName || 'BrewMaster';

  const rows = open
    .map(o => {
      const who =
        resolveCustomerLabel?.(o) ||
        o.customerName ||
        o.customerPhone ||
        '—';
      const amt = getOrderGrandTotal(o, fallbackTax);
      const no = formatOrderNumber(o);
      return `
        <tr>
          <td style="padding:6px 4px;border-bottom:1px dashed #ccc;">#${no}</td>
          <td style="padding:6px 4px;border-bottom:1px dashed #ccc;">${new Date(o.createdAt).toLocaleString(isRtl ? 'ar-EG' : 'en-US')}</td>
          <td style="padding:6px 4px;border-bottom:1px dashed #ccc;">${who}</td>
          <td style="padding:6px 4px;border-bottom:1px dashed #ccc;text-align:${isRtl ? 'left' : 'right'};font-weight:bold;">${amt.toFixed(2)}</td>
        </tr>`;
    })
    .join('');

  const html = `
    <!DOCTYPE html>
    <html dir="${isRtl ? 'rtl' : 'ltr'}">
    <head>
      <title>${title} - ${companyName}</title>
      <meta charset="utf-8">
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: Arial, sans-serif; padding: 16px; max-width: 480px; margin: 0 auto; color: #000; font-size: 13px; }
        .header { text-align: center; border-bottom: 2px dashed #000; padding-bottom: 10px; margin-bottom: 12px; }
        .header h1 { font-size: 18px; margin-bottom: 4px; }
        .header h2 { font-size: 16px; margin: 8px 0 4px; }
        .meta { margin: 10px 0 14px; font-size: 12px; }
        .meta div { margin: 3px 0; display: flex; justify-content: space-between; }
        table { width: 100%; border-collapse: collapse; margin: 8px 0 14px; }
        th { text-align: ${isRtl ? 'right' : 'left'}; font-size: 11px; border-bottom: 2px solid #000; padding: 6px 4px; }
        .total { border-top: 2px solid #000; padding-top: 10px; margin-top: 8px; display: flex; justify-content: space-between; font-size: 16px; font-weight: bold; }
        .footer { text-align: center; margin-top: 18px; font-size: 11px; color: #444; border-top: 1px dashed #000; padding-top: 8px; }
        @media print { @page { margin: 8mm; } body { max-width: 100%; } }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>${storeName}</h1>
        <p>${title}</p>
        <h2>${companyName}</h2>
        ${companyPhone ? `<p>${companyPhone}</p>` : ''}
      </div>
      <div class="meta">
        <div><span>${dateLabel}</span><span>${new Date().toLocaleString(isRtl ? 'ar-EG' : 'en-US')}</span></div>
        <div><span>${isRtl ? 'عدد الفواتير' : 'Invoices'}</span><span>${open.length}</span></div>
      </div>
      <table>
        <thead>
          <tr>
            <th>${invLabel}</th>
            <th>${dateLabel}</th>
            <th>${byLabel}</th>
            <th>${isRtl ? 'المبلغ' : 'Amount'}</th>
          </tr>
        </thead>
        <tbody>
          ${rows || `<tr><td colspan="4" style="padding:12px;text-align:center;">${isRtl ? 'لا توجد فواتير مفتوحة' : 'No open invoices'}</td></tr>`}
        </tbody>
      </table>
      <div class="total">
        <span>${totalLabel}</span>
        <span>${total.toFixed(2)} ${isRtl ? 'ج.م' : 'EGP'}</span>
      </div>
      <div class="footer">
        <p>${storeName} POS</p>
      </div>
    </body>
    </html>`;

  printHtml(html);
}

/**
 * Print a single customer account statement: all open OnAccount invoices
 * for the customer (total amount due).
 */
export function printCustomerStatement(opts: {
  customerName: string;
  customerPhone?: string;
  orders: Order[];
  taxRate?: number;
  lang?: 'en' | 'ar';
}) {
  const { customerName, customerPhone, orders, taxRate: taxRateOpt, lang = 'ar' } = opts;
  const isRtl = lang === 'ar';
  const store = getStoreConfig();
  const fallbackTax = typeof taxRateOpt === 'number' ? taxRateOpt : getTaxRate();

  const open = orders
    .filter(o => o.paymentStatus === 'OnAccount' && o.status !== 'Cancelled')
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(a.createdAt).getTime());

  const total = open.reduce((s, o) => s + getOrderGrandTotal(o, fallbackTax), 0);

  const title = isRtl ? 'كشف حساب عميل' : 'Customer Account Statement';
  const dateLabel = isRtl ? 'التاريخ' : 'Date';
  const invLabel = isRtl ? 'فاتورة' : 'Invoice';
  const totalLabel = isRtl ? 'إجمالي الرصيد المستحق' : 'Total balance due';
  const storeName = store.storeName || 'BrewMaster';

  const rows = open
    .map(o => {
      const amt = getOrderGrandTotal(o, fallbackTax);
      const no = formatOrderNumber(o);
      return `
        <tr>
          <td style="padding:6px 4px;border-bottom:1px dashed #ccc;">#${no}</td>
          <td style="padding:6px 4px;border-bottom:1px dashed #ccc;">${new Date(o.createdAt).toLocaleString(isRtl ? 'ar-EG' : 'en-US')}</td>
          <td style="padding:6px 4px;border-bottom:1px dashed #ccc;">${o.tableId || 'Takeaway'}</td>
          <td style="padding:6px 4px;border-bottom:1px dashed #ccc;text-align:${isRtl ? 'left' : 'right'};font-weight:bold;">${amt.toFixed(2)}</td>
        </tr>`;
    })
    .join('');

  const html = `
    <!DOCTYPE html>
    <html dir="${isRtl ? 'rtl' : 'ltr'}">
    <head>
      <title>${title} - ${customerName}</title>
      <meta charset="utf-8">
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: Arial, sans-serif; padding: 16px; max-width: 480px; margin: 0 auto; color: #000; font-size: 13px; }
        .header { text-align: center; border-bottom: 2px dashed #000; padding-bottom: 10px; margin-bottom: 12px; }
        .header h1 { font-size: 18px; margin-bottom: 4px; }
        .header h2 { font-size: 16px; margin: 8px 0 4px; }
        .meta { margin: 10px 0 14px; font-size: 12px; }
        .meta div { margin: 3px 0; display: flex; justify-content: space-between; }
        table { width: 100%; border-collapse: collapse; margin: 8px 0 14px; }
        th { text-align: ${isRtl ? 'right' : 'left'}; font-size: 11px; border-bottom: 2px solid #000; padding: 6px 4px; }
        .total { border-top: 2px solid #000; padding-top: 10px; margin-top: 8px; display: flex; justify-content: space-between; font-size: 16px; font-weight: bold; }
        .footer { text-align: center; margin-top: 18px; font-size: 11px; color: #444; border-top: 1px dashed #000; padding-top: 8px; }
        @media print { @page { margin: 8mm; } body { max-width: 100%; } }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>${storeName}</h1>
        <p>${title}</p>
        <h2>${customerName}</h2>
        ${customerPhone ? `<p>${customerPhone}</p>` : ''}
      </div>
      <div class="meta">
        <div><span>${dateLabel}</span><span>${new Date().toLocaleString(isRtl ? 'ar-EG' : 'en-US')}</span></div>
        <div><span>${isRtl ? 'عدد الفواتير المفتوحة' : 'Open Invoices'}</span><span>${open.length}</span></div>
      </div>
      <table>
        <thead>
          <tr>
            <th>${invLabel}</th>
            <th>${dateLabel}</th>
            <th>${isRtl ? 'نوع الطلب' : 'Mode'}</th>
            <th>${isRtl ? 'المبلغ' : 'Amount'}</th>
          </tr>
        </thead>
        <tbody>
          ${rows || `<tr><td colspan="4" style="padding:12px;text-align:center;">${isRtl ? 'لا توجد فواتير مفتوحة' : 'No open invoices'}</td></tr>`}
        </tbody>
      </table>
      <div class="total">
        <span>${totalLabel}</span>
        <span>${total.toFixed(2)} ${isRtl ? 'ج.م' : 'EGP'}</span>
      </div>
      <div class="footer">
        <p>${storeName} POS</p>
      </div>
    </body>
    </html>`;

  printHtml(html);
}
