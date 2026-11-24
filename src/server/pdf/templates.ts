import { readFileSync } from "node:fs";
import path from "node:path";
import { formatMoney } from "@/lib/utils";
import type { InvoicePreviewData } from "@/lib/invoice-preview";

/**
 * Standalone HTML invoice templates for the PDF engine.
 *
 * The on-screen React preview (`InvoicePreview`) and these templates
 * render the SAME data shape (InvoicePreviewData) with the SAME
 * sections in the SAME order — header, bill-to, lines, totals, notes /
 * terms / bank, footer — so preview and PDF match on content and
 * structure. The PDF templates are plain HTML + inline CSS (no
 * Tailwind) because Playwright renders them from a string with
 * `page.setContent`; bundling the app's Tailwind output into a PDF
 * render would be fragile and is unnecessary.
 *
 * Three templates, all A4:
 *  - classic: clean table, dark header row (the Phase 3 default)
 *  - modern:  indigo accent band + accent totals
 *  - minimal: compact, thin rules, no colour (low-ink)
 *
 * Arabic (locale "ar") renders RTL with real Arabic text. The Noto
 * Sans Arabic font is embedded as base64 @font-face (copied into
 * public/fonts/, OFL licensed) so the PDF renders Arabic on any host,
 * even one without Arabic system fonts.
 */

const LABELS = {
  en: {
    taxInvoice: "Tax Invoice",
    draft: "DRAFT — number assigned on issue",
    billTo: "Bill To",
    description: "Description",
    qty: "Qty",
    unitPrice: "Unit Price",
    discount: "Discount",
    vat: "VAT",
    total: "Total",
    subtotal: "Subtotal",
    discountTotal: "Discount",
    taxable: "Taxable Amount",
    vatAmount: "VAT",
    grandTotal: "Grand Total",
    amountPaid: "Amount Paid",
    balance: "Balance Due",
    issueDate: "Issue Date",
    dueDate: "Due Date",
    supplyDate: "Supply Date",
    notes: "Notes",
    terms: "Terms",
    bankDetails: "Bank Details",
    inclVat: "incl. VAT",
    trn: "TRN",
    draftWatermark: "DRAFT",
  },
  ar: {
    taxInvoice: "فاتورة ضريبية",
    draft: "مسودة — يُمنح الرقم عند الإصدار",
    billTo: "فاتورة إلى",
    description: "الوصف",
    qty: "الكمية",
    unitPrice: "سعر الوحدة",
    discount: "الخصم",
    vat: "ضريبة القيمة المضافة",
    total: "المجموع",
    subtotal: "المجموع الفرعي",
    discountTotal: "الخصم",
    taxable: "المبلغ الخاضع للضريبة",
    vatAmount: "ضريبة القيمة المضافة",
    grandTotal: "المجموع الإجمالي",
    amountPaid: "المبلغ المدفوع",
    balance: "الرصيد المستحق",
    issueDate: "تاريخ الإصدار",
    dueDate: "تاريخ الاستحقاق",
    supplyDate: "تاريخ التوريد",
    notes: "ملاحظات",
    terms: "الشروط",
    bankDetails: "تفاصيل البنك",
    inclVat: "شامل الضريبة",
    trn: "الرقم الضريبي",
    draftWatermark: "مسودة",
  },
} as const;

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDate(value: string, locale: "en" | "ar"): string {
  const d = new Date(`${value}T00:00:00Z`);
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-AE" : "en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(d);
}

/** Base64 @font-face for the bundled Noto fonts (cached after first read). */
let cachedFontCss: string | null = null;

function fontFaceCss(): string {
  if (cachedFontCss !== null) return cachedFontCss;
  const candidates = [
    path.join(process.cwd(), "public", "fonts"),
    "/usr/share/fonts/truetype/noto",
  ];
  const read = (name: string): string | null => {
    for (const dir of candidates) {
      try {
        return readFileSync(path.join(dir, name)).toString("base64");
      } catch {
        // try next candidate
      }
    }
    return null;
  };
  const faces: Array<{ family: string; weight: number; file: string }> = [
    { family: "Noto Sans", weight: 400, file: "NotoSans-Regular.ttf" },
    { family: "Noto Sans", weight: 700, file: "NotoSans-Bold.ttf" },
    { family: "Noto Sans Arabic", weight: 400, file: "NotoSansArabic-Regular.ttf" },
    { family: "Noto Sans Arabic", weight: 700, file: "NotoSansArabic-Bold.ttf" },
  ];
  const rules: string[] = [];
  for (const face of faces) {
    const b64 = read(face.file);
    if (!b64) continue;
    rules.push(
      `@font-face{font-family:'${face.family}';font-style:normal;font-weight:${face.weight};font-display:swap;src:url(data:font/ttf;base64,${b64}) format('truetype');}`,
    );
  }
  cachedFontCss = rules.join("\n");
  return cachedFontCss;
}

function baseCss(template: string): string {
  return `
    ${fontFaceCss()}
    @page { size: A4; margin: 0; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body {
      font-family: 'Noto Sans Arabic', 'Noto Sans', sans-serif;
      font-size: 11pt; line-height: 1.45; color: #0f172a;
      background: #fff;
      /* Chromium maps the Arabic lam-alef ligature glyph to the wrong
         codepoints in the PDF text layer (extracts as "اا" instead of
         "لا"). The lam-alef ligature is a *required* ligature (rlig),
         so both liga and rlig are disabled: the letters then render
         as separate glyphs and pdftotext extracts real Arabic text.
         The letters still join correctly — only the calligraphic
         ligature form is dropped. */
      font-feature-settings: "liga" 0, "rlig" 0;
    }
    .page { padding: 14mm 14mm 12mm; }
    .muted { color: #64748b; }
    .small { font-size: 9pt; }
    .nowrap { white-space: nowrap; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
    .header h1 { margin: 0; font-size: 20pt; line-height: 1.2; }
    .header .number { margin-top: 4px; font-family: monospace; font-size: 13pt; font-weight: 700; }
    .biz-name { font-size: 15pt; font-weight: 700; }
    .dates { margin-top: 8px; font-size: 10pt; }
    .dates .row { display: flex; justify-content: space-between; gap: 16px; }
    .section-label { margin: 18px 0 4px; font-size: 8pt; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: #64748b; }
    table.lines { width: 100%; border-collapse: collapse; font-size: 10pt; margin-top: 6px; }
    table.lines thead { display: table-header-group; }
    table.lines tr { page-break-inside: avoid; }
    table.lines th, table.lines td { padding: 6px 4px; vertical-align: top; }
    table.lines th { text-align: start; font-weight: 700; border-bottom: 2px solid #0f172a; }
    table.lines td.num, table.lines th.num { text-align: end; }
    table.lines tbody td { border-bottom: 1px solid #e2e8f0; }
    .totals-wrap { display: flex; justify-content: flex-end; margin-top: 12px; page-break-inside: avoid; }
    table.totals { width: 62mm; border-collapse: collapse; font-size: 10pt; }
    table.totals td { padding: 3px 0; }
    table.totals td:last-child { text-align: end; }
    table.totals tr.grand td { border-top: 1px solid #94a3b8; padding-top: 6px; font-size: 12pt; font-weight: 700; }
    .block { margin-top: 16px; page-break-inside: avoid; }
    .footer { margin-top: 20px; padding-top: 10px; border-top: 1px solid #e2e8f0; text-align: center; font-size: 9pt; color: #64748b; }
    .watermark {
      position: fixed; inset: 0; display: flex; align-items: center; justify-content: center;
      pointer-events: none; z-index: 9999;
    }
    .watermark span {
      transform: rotate(-30deg); font-size: 90pt; font-weight: 700; letter-spacing: .1em;
      color: rgba(220, 38, 38, 0.07); white-space: nowrap;
    }
    .draft-badge {
      display: inline-block; margin-top: 6px; padding: 2px 8px; border: 1.5px solid #dc2626;
      color: #dc2626; font-size: 9pt; font-weight: 700; letter-spacing: .1em; border-radius: 3px;
    }
    ${template === "modern" ? `
      .accent-band { height: 8px; background: #4f46e5; margin: -14mm -14mm 0; }
      .header h1 { color: #4f46e5; }
      .section-label { color: #4f46e5; }
      table.lines th { border-bottom-color: #4f46e5; color: #3730a3; }
      table.totals tr.grand td { color: #3730a3; }
      .page { padding-top: 10mm; }
    ` : ""}
    ${template === "minimal" ? `
      body { font-size: 10pt; }
      .header h1 { font-size: 16pt; font-weight: 400; }
      .biz-name { font-size: 12pt; font-weight: 400; }
      .section-label { font-weight: 400; letter-spacing: .12em; }
      table.lines th { border-bottom-width: 1px; border-bottom-color: #94a3b8; font-weight: 400; }
      table.lines tbody td { border-bottom-color: #f1f5f9; }
      table.totals tr.grand td { font-weight: 400; }
    ` : ""}
  `;
}

export type RenderInvoiceHtmlOptions = {
  /** Overlay a DRAFT watermark (used for draft downloads). Defaults to true when the invoice has no number. */
  watermarkDraft?: boolean;
};

/**
 * Render the full standalone HTML document for one invoice.
 * All user-controlled strings are escaped — no raw HTML from
 * business/customer/item fields ever reaches the document.
 */
export function renderInvoiceHtml(
  data: InvoicePreviewData,
  opts: RenderInvoiceHtmlOptions = {},
): string {
  const template = ["classic", "modern", "minimal"].includes(data.template)
    ? data.template
    : "classic";
  const t = LABELS[data.locale];
  const isDraft = data.number === null;
  const watermark = opts.watermarkDraft ?? isDraft;
  const money = (v: string) =>
    formatMoney(v, data.currency, data.locale === "ar" ? "ar-AE" : "en-AE");
  const b = data.business;
  const c = data.customer;
  const dir = data.locale === "ar" ? "rtl" : "ltr";

  const bankLine = [b.bankName, b.accountName ? `Account: ${escapeHtml(b.accountName)}` : null, b.iban ? `IBAN: ${escapeHtml(b.iban)}` : null, b.swift ? `SWIFT: ${escapeHtml(b.swift)}` : null]
    .filter(Boolean)
    .join(" · ");

  const itemsHtml = data.items
    .map(
      (item) => `<tr>
        <td><div>${escapeHtml(item.description)}</div>${item.sku ? `<div class="muted small">${escapeHtml(item.sku)}</div>` : ""}</td>
        <td class="num nowrap">${escapeHtml(item.quantity)} ${escapeHtml(item.unit)}</td>
        <td class="num nowrap">${money(item.unitPrice)}${item.taxInclusive ? `<div class="muted small">${t.inclVat}</div>` : ""}</td>
        <td class="num nowrap">${item.discountAmount !== "0" ? `−${money(item.discountAmount)}` : "—"}</td>
        <td class="num nowrap">${money(item.vatAmount)}<div class="muted small">${escapeHtml(item.taxRate)}%</div></td>
        <td class="num nowrap"><strong>${money(item.lineTotal)}</strong></td>
      </tr>`,
    )
    .join("\n");

  return `<!DOCTYPE html>
<html lang="${data.locale}" dir="${dir}">
<head>
<meta charset="utf-8">
<title>${isDraft ? t.draft : `${t.taxInvoice} ${escapeHtml(data.number ?? "")}`}</title>
<style>${baseCss(template)}</style>
</head>
<body>
${watermark ? `<div class="watermark"><span>${t.draftWatermark}</span></div>` : ""}
<div class="page template-${template}">
  ${template === "modern" ? `<div class="accent-band"></div>` : ""}
  <div class="header">
    <div>
      <div class="biz-name">${escapeHtml(b.name)}</div>
      ${b.trn ? `<div class="muted">${t.trn}: ${escapeHtml(b.trn)}</div>` : ""}
      ${b.address ? `<div class="muted" style="white-space:pre-line">${escapeHtml(b.address)}</div>` : ""}
      ${b.phone || b.email ? `<div class="muted">${escapeHtml([b.phone, b.email].filter(Boolean).join(" · "))}</div>` : ""}
      ${b.website ? `<div class="muted">${escapeHtml(b.website)}</div>` : ""}
    </div>
    <div style="text-align:end">
      <h1>${t.taxInvoice}</h1>
      <div class="number">${isDraft ? escapeHtml(t.draft) : escapeHtml(data.number ?? "")}</div>
      ${watermark ? `<div><span class="draft-badge">${t.draftWatermark}</span></div>` : ""}
      <div class="dates">
        <div class="row"><span class="muted">${t.issueDate}</span><span>${formatDate(data.issueDate, data.locale)}</span></div>
        <div class="row"><span class="muted">${t.dueDate}</span><span>${formatDate(data.dueDate, data.locale)}</span></div>
        ${data.supplyDate ? `<div class="row"><span class="muted">${t.supplyDate}</span><span>${formatDate(data.supplyDate, data.locale)}</span></div>` : ""}
      </div>
    </div>
  </div>

  <div class="section-label">${t.billTo}</div>
  <div><strong>${escapeHtml(c.companyName ?? c.name)}</strong></div>
  ${c.companyName ? `<div class="muted">${escapeHtml(c.name)}</div>` : ""}
  ${c.trn ? `<div class="muted">${t.trn}: ${escapeHtml(c.trn)}</div>` : ""}
  ${c.billingAddress ? `<div class="muted" style="white-space:pre-line">${escapeHtml(c.billingAddress)}</div>` : ""}
  ${c.email || c.phone ? `<div class="muted">${escapeHtml([c.email, c.phone].filter(Boolean).join(" · "))}</div>` : ""}

  <table class="lines">
    <thead><tr>
      <th>${t.description}</th>
      <th class="num">${t.qty}</th>
      <th class="num">${t.unitPrice}</th>
      <th class="num">${t.discount}</th>
      <th class="num">${t.vat}</th>
      <th class="num">${t.total}</th>
    </tr></thead>
    <tbody>${itemsHtml}</tbody>
  </table>

  <div class="totals-wrap">
    <table class="totals">
      <tr><td class="muted">${t.subtotal}</td><td>${money(data.totals.subtotal)}</td></tr>
      ${data.totals.discountTotal !== "0" ? `<tr><td class="muted">${t.discountTotal}</td><td>−${money(data.totals.discountTotal)}</td></tr>` : ""}
      <tr><td class="muted">${t.taxable}</td><td>${money(data.totals.taxableAmount)}</td></tr>
      <tr><td class="muted">${t.vatAmount}</td><td>${money(data.totals.vatAmount)}</td></tr>
      <tr class="grand"><td>${t.grandTotal}</td><td>${money(data.totals.grandTotal)}</td></tr>
      ${data.totals.amountPaid !== "0" ? `
      <tr><td class="muted">${t.amountPaid}</td><td>−${money(data.totals.amountPaid)}</td></tr>
      <tr><td><strong>${t.balance}</strong></td><td><strong>${money(data.totals.balance)}</strong></td></tr>` : ""}
    </table>
  </div>

  ${data.notes ? `<div class="block"><div class="section-label">${t.notes}</div><div style="white-space:pre-line">${escapeHtml(data.notes)}</div></div>` : ""}
  ${data.terms ? `<div class="block"><div class="section-label">${t.terms}</div><div class="muted" style="white-space:pre-line">${escapeHtml(data.terms)}</div></div>` : ""}
  ${b.bankName || b.iban ? `<div class="block"><div class="section-label">${t.bankDetails}</div><div class="muted">${bankLine}</div>${b.paymentInstructions ? `<div class="muted" style="white-space:pre-line">${escapeHtml(b.paymentInstructions)}</div>` : ""}</div>` : ""}
  ${b.footer ? `<div class="footer">${escapeHtml(b.footer)}</div>` : ""}
</div>
</body>
</html>`;
}
