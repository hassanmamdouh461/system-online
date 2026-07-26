/**
 * Localize the coded errors thrown by DataContext.refundOrder into a message the
 * operator can read. The refund flow throws stable codes (not prose) so both the
 * PaymentModal and the Customers refund dialog render the same wording per locale.
 */
export function localizeRefundError(err: unknown, language: string): string {
  const code = err instanceof Error ? err.message : String(err ?? '');
  const ar = language === 'ar';
  switch (code) {
    case 'refund_pin_required':
      return ar
        ? 'أدخل رمز التصعيد (PIN) لتأكيد الاسترجاع.'
        : 'Enter the escalation PIN to confirm the refund.';
    case 'refund_offline':
      return ar
        ? 'الاسترجاع بصلاحية كاشير يحتاج اتصالاً بالإنترنت. حاول مرة أخرى عند الاتصال.'
        : 'Cashier refunds need an internet connection. Try again once you are online.';
    case 'refund_escalation_failed':
      return ar
        ? 'رمز التصعيد غير صحيح أو غير مصرّح به. تأكد من الرمز أو سجّل الدخول كمدير.'
        : 'The escalation PIN is wrong or not authorized. Check the PIN or sign in as a manager.';
    case 'Only paid orders can be refunded':
      return ar ? 'يمكن استرجاع الطلبات المدفوعة فقط.' : 'Only paid orders can be refunded.';
    case 'Order not found':
      return ar ? 'لم يتم العثور على الطلب.' : 'Order not found.';
    default:
      return ar ? 'فشل الاسترجاع: ' + code : 'Refund failed: ' + code;
  }
}
