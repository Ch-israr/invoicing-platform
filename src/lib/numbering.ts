/**
 * Document numbering.
 *
 * Format is `<PREFIX>-<zero-padded 4-digit sequence>`, e.g. `INV-0001`.
 * Invoices use the business's own `invoicePrefix` (editable in
 * Settings → Tax & numbering). Quotations and credit notes have fixed
 * prefixes (`QTN`, `CN`) — the business has no prefix field for them —
 * but their own counters (`nextQuotationNumber`,
 * `nextCreditNoteNumber`), also editable in Settings. The number is
 * only assigned when the document leaves draft: invoices on issue,
 * quotations on send, credit notes on creation (they are issued
 * immediately). Drafts carry a `DRAFT-<id>` placeholder that is never
 * shown to customers. Numbers are never reused: the counter is
 * incremented inside the same transaction that assigns the number, and
 * `@@unique([businessId, number])` is the backstop.
 */

export const QUOTATION_PREFIX = "QTN";
export const CREDIT_NOTE_PREFIX = "CN";

/** Generic `<PREFIX>-<zero-padded 4-digit sequence>` formatter. */
export function formatDocumentNumber(prefix: string, n: number): string {
  return `${prefix}-${String(n).padStart(4, "0")}`;
}

export function formatInvoiceNumber(prefix: string, n: number): string {
  return formatDocumentNumber(prefix, n);
}

export function formatQuotationNumber(n: number): string {
  return formatDocumentNumber(QUOTATION_PREFIX, n);
}

export function formatCreditNoteNumber(n: number): string {
  return formatDocumentNumber(CREDIT_NOTE_PREFIX, n);
}

/** Placeholder number for a draft, replaced with the real number on issue. */
export function draftNumber(id: string): string {
  return `DRAFT-${id}`;
}

/** True for a draft placeholder number (never a real issued number). */
export function isDraftNumber(number: string): boolean {
  return number.startsWith("DRAFT-");
}
