/**
 * Every invoice must name the person who took it — but only where naming one
 * is actually possible.
 *
 * A till could close a full payment with no staff selected at all: the name was
 * attached opportunistically (`staff ? { cashierName: staff } : undefined`) and
 * `selectedStaff` is restored from localStorage without ever being checked
 * against the current list. The result was invoices with no attribution: no
 * accountability, no per-staff report.
 *
 * The obvious "just make it required" breaks a real case: a branch that has not
 * added any staff yet would be unable to sell at all. So the requirement is
 * conditional on the list being non-empty. A remembered name that is no longer
 * on the list (deleted on another device) also counts as "not selected" —
 * otherwise a stale localStorage value keeps signing invoices for someone who
 * is gone.
 */

/** Does this till have to ask for a staff member before closing an order? */
export function needsStaffSelection(staffList: string[], selectedStaff: string): boolean {
  if (!staffList || staffList.length === 0) return false; // nobody to pick yet — never block the sale
  return !staffList.includes((selectedStaff || '').trim());
}
