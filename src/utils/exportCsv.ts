/**
 * CSV export.
 *
 * WHY THIS EXISTS
 * The "Export" buttons on the manager dashboard and the reports page were wired to
 * `window.print()` while wearing a Download icon and the label "تصدير". Clicking
 * one produced no file, no message, and no feedback of any kind — a manager who
 * wanted numbers in Excel got a print dialog at best. The icon and the label both
 * promised something the handler never did.
 *
 * NOTES
 *   • A UTF-8 BOM is prepended. Without it Excel on Windows reads the file as
 *     ANSI and every Arabic column header turns into mojibake — which would make
 *     the export useless for exactly the people asking for it.
 *   • CRLF line endings, for the same Excel-compatibility reason.
 *   • No money arithmetic happens here. Values are formatted for display only,
 *     never recomputed (see scripts/check-money-safety.mjs).
 */

export type CsvCell = string | number | boolean | null | undefined;
export type CsvRow = CsvCell[];

/**
 * Escape one cell per RFC 4180.
 *
 * Also neutralises spreadsheet formula injection: a value starting with = + - @
 * is executed as a formula by Excel and Google Sheets when the file is opened, so
 * a customer name like "=1+1" (or something far worse pointing at a URL) would run
 * on the manager's machine. Prefixing a tab keeps the text readable while making
 * it inert.
 */
export function escapeCsvCell(value: CsvCell): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `\t${text}`;
  if (/["\n\r,;]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

/** Serialise rows to a CSV document (no BOM — see toCsvBlob). */
export function toCsv(rows: CsvRow[]): string {
  return rows.map((row) => row.map(escapeCsvCell).join(',')).join('\r\n');
}

/** CSV as a Blob, BOM included so Excel detects UTF-8. */
export function toCsvBlob(rows: CsvRow[]): Blob {
  return new Blob(['﻿', toCsv(rows)], { type: 'text/csv;charset=utf-8;' });
}

/** `prefix-2026-08-04.csv` — a stable, sortable, filesystem-safe name. */
export function csvFilename(prefix: string, date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const safe = prefix.replace(/[^\w؀-ۿ-]+/g, '-').replace(/^-+|-+$/g, '');
  return `${safe || 'export'}-${stamp}.csv`;
}

/**
 * Trigger a browser download. Returns false when the environment cannot download
 * (SSR, or a locked-down webview), so callers can tell the operator instead of
 * appearing to do nothing — which is the exact failure this replaces.
 */
export function downloadCsv(filename: string, rows: CsvRow[]): boolean {
  if (typeof document === 'undefined' || typeof URL?.createObjectURL !== 'function') {
    return false;
  }
  try {
    const url = URL.createObjectURL(toCsvBlob(rows));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    // Revoked on the next tick: revoking synchronously can cancel the download
    // in some browsers before it starts.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  } catch (err) {
    console.warn('[export] CSV download failed:', err);
    return false;
  }
}
