/**
 * Localize the coded errors thrown by DataContext.refundOrder into a message the
 * operator can read. The refund flow throws stable codes (not prose) so both the
 * PaymentModal and the Customers refund dialog render the same wording per locale.
 */
export function localizeRefundError(err: unknown, language: string): string {
  const code = err instanceof Error ? err.message : String(err ?? '');
  const ar = language === 'ar';
  switch (code) {
    case 'refund_requires_manager':
      return ar
        ? 'الاسترجاع يتطلب صلاحية مدير. سجّل الدخول بحساب مدير.'
        : 'Refund requires manager authorization. Please sign in as a manager.';
    case 'Only paid orders can be refunded':
      return ar ? 'يمكن استرجاع الطلبات المدفوعة فقط.' : 'Only paid orders can be refunded.';
    case 'Order not found':
      return ar ? 'لم يتم العثور على الطلب.' : 'Order not found.';
    default:
      return ar ? 'فشل الاسترجاع: ' + code : 'Refund failed: ' + code;
  }
}
