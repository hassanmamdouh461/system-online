/**
 * Localize the coded errors thrown by DataContext.refundOrder into a message the
 * operator can read. The refund flow throws stable codes (not prose) so both the
 * PaymentModal and the Customers refund dialog render the same wording per locale.
 */
export function localizeRefundError(err: unknown, language: string): string {
  const code = err instanceof Error ? err.message : String(err ?? '');
  const ar = language === 'ar';
  switch (code) {
    // Legacy code — refunds are no longer manager-only, but an old queued
    // failure or an older client build can still surface it.
    case 'refund_requires_manager':
    case 'refund_session_missing':
    case 'refund_probe_failed':
      return ar
        ? 'تعذّر التأكد من الجلسة — تأكد من الاتصال بالإنترنت وسجّل الدخول تاني.'
        : 'Could not verify the session — check your connection and sign in again.';
    case 'order_delete_forbidden':
      return ar
        ? 'حذف الفاتورة غير مسموح — استخدم الاسترجاع من شاشة الدفع.'
        : 'Deleting an invoice is not allowed — use Refund on the payment screen.';
    case 'Only paid orders can be refunded':
      return ar ? 'يمكن استرجاع الطلبات المدفوعة فقط.' : 'Only paid orders can be refunded.';
    case 'Order not found':
      return ar ? 'لم يتم العثور على الطلب.' : 'Order not found.';
    default:
      return ar ? 'فشل الاسترجاع: ' + code : 'Refund failed: ' + code;
  }
}
