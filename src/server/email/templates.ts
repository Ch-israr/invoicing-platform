import { formatMoney } from "@/lib/utils";

/**
 * Email templates — plain HTML with inline styles plus a plain-text
 * twin (same content, no markup). Rendered from the invoice's stored
 * values; nothing here reads live customer/product rows.
 */

export type InvoiceEmailInput = {
  businessName: string;
  businessEmail: string | null;
  paymentInstructions: string | null;
  bankName: string | null;
  iban: string | null;
  customerName: string;
  invoiceNumber: string;
  grandTotal: string;
  balance: string;
  currency: string;
  /** Formatted for display, e.g. "24 Dec 2026". */
  dueDateLabel: string;
};

export type RenderedEmail = {
  subject: string;
  html: string;
  text: string;
};

function formatDateLong(date: Date): string {
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function renderInvoiceEmail(input: InvoiceEmailInput): RenderedEmail {
  const total = formatMoney(input.grandTotal, input.currency);
  const balance = formatMoney(input.balance, input.currency);
  const subject = `Invoice ${input.invoiceNumber} from ${input.businessName} — ${total} due ${input.dueDateLabel}`;

  const paymentLines: string[] = [];
  if (input.paymentInstructions) paymentLines.push(input.paymentInstructions);
  if (input.bankName || input.iban) {
    paymentLines.push(
      [input.bankName, input.iban ? `IBAN ${input.iban}` : null]
        .filter(Boolean)
        .join(" — "),
    );
  }

  const text = [
    `Hello ${input.customerName},`,
    ``,
    `Please find attached invoice ${input.invoiceNumber} from ${input.businessName}.`,
    ``,
    `  Invoice total: ${total}`,
    `  Balance due:   ${balance}`,
    `  Due date:      ${input.dueDateLabel}`,
    ``,
    ...(paymentLines.length > 0
      ? [`Payment details:`, ...paymentLines.map((l) => `  ${l}`), ``]
      : []),
    `Thank you for your business.`,
    ``,
    `${input.businessName}${input.businessEmail ? ` — ${input.businessEmail}` : ""}`,
  ].join("\n");

  const html = [
    `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111827;max-width:560px">`,
    `<p>Hello ${escapeHtml(input.customerName)},</p>`,
    `<p>Please find attached invoice <strong>${escapeHtml(input.invoiceNumber)}</strong> from ${escapeHtml(input.businessName)}.</p>`,
    `<table style="border-collapse:collapse">`,
    `<tr><td style="padding:4px 16px 4px 0;color:#6b7280">Invoice total</td><td style="padding:4px 0"><strong>${escapeHtml(total)}</strong></td></tr>`,
    `<tr><td style="padding:4px 16px 4px 0;color:#6b7280">Balance due</td><td style="padding:4px 0"><strong>${escapeHtml(balance)}</strong></td></tr>`,
    `<tr><td style="padding:4px 16px 4px 0;color:#6b7280">Due date</td><td style="padding:4px 0">${escapeHtml(input.dueDateLabel)}</td></tr>`,
    `</table>`,
    ...(paymentLines.length > 0
      ? [
          `<p style="color:#6b7280;margin-bottom:4px">Payment details</p>`,
          ...paymentLines.map((l) => `<p style="margin:2px 0">${escapeHtml(l)}</p>`),
        ]
      : []),
    `<p>Thank you for your business.</p>`,
    `<p style="color:#6b7280">${escapeHtml(input.businessName)}${input.businessEmail ? ` — ${escapeHtml(input.businessEmail)}` : ""}</p>`,
    `</div>`,
  ].join("\n");

  return { subject, html, text };
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export { formatDateLong };
