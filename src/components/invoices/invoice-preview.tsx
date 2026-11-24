import { formatMoney } from "@/lib/utils";
import type { InvoicePreviewData } from "@/lib/invoice-preview";

/**
 * Pure presentational invoice — renders from InvoicePreviewData only.
 * No server imports, no data fetching: the builder (client), the
 * detail page (server) and Phase 4's PDF worker all feed it the same
 * shape, so the live preview is what the PDF will look like.
 *
 * Three templates, matching the PDF engine's templates.ts:
 * classic (clean table), modern (indigo accent band + accent totals),
 * minimal (compact, thin rules, low-ink).
 */

const LABELS = {
  en: {
    taxInvoice: "Tax Invoice",
    quotation: "Quotation",
    draft: "DRAFT — number assigned on issue",
    draftQuotation: "DRAFT — number assigned on send",
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
    expiryDate: "Expiry Date",
    supplyDate: "Supply Date",
    notes: "Notes",
    terms: "Terms",
    bankDetails: "Bank Details",
    inclVat: "incl. VAT",
    trn: "TRN",
  },
  ar: {
    taxInvoice: "فاتورة ضريبية",
    quotation: "عرض سعر",
    draft: "مسودة — يُمنح الرقم عند الإصدار",
    draftQuotation: "مسودة — يُمنح الرقم عند الإرسال",
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
    expiryDate: "تاريخ الانتهاء",
    supplyDate: "تاريخ التوريد",
    notes: "ملاحظات",
    terms: "الشروط",
    bankDetails: "تفاصيل البنك",
    inclVat: "شامل الضريبة",
    trn: "الرقم الضريبي",
  },
} as const;

function formatDate(value: string, locale: "en" | "ar"): string {
  const d = new Date(`${value}T00:00:00Z`);
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-AE" : "en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(d);
}

export function InvoicePreview({ data }: { data: InvoicePreviewData }) {
  const t = LABELS[data.locale];
  const money = (v: string) => formatMoney(v, data.currency, data.locale === "ar" ? "ar-AE" : "en-AE");
  const b = data.business;
  const c = data.customer;
  const template = ["classic", "modern", "minimal"].includes(data.template)
    ? data.template
    : "classic";
  const isModern = template === "modern";
  const isMinimal = template === "minimal";
  const isQuotation = data.documentKind === "quotation";

  return (
    <div
      dir={data.locale === "ar" ? "rtl" : "ltr"}
      className={
        isMinimal
          ? "overflow-hidden bg-white text-sm text-slate-900 dark:bg-slate-950 dark:text-slate-100"
          : "overflow-hidden rounded-lg border bg-white text-slate-900 shadow-sm dark:bg-slate-950 dark:text-slate-100"
      }
    >
      {isModern ? <div className="h-2 bg-indigo-600" /> : null}
      <div className="space-y-6 p-6 md:p-8">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            {b.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={b.logoUrl} alt={b.name} className="mb-3 max-h-12 max-w-48 object-contain" />
            ) : null}
            <p className="text-xl font-bold">{b.name}</p>
            {b.trn ? (
              <p className="text-sm text-slate-500">
                {t.trn}: {b.trn}
              </p>
            ) : null}
            {b.address ? <p className="whitespace-pre-line text-sm text-slate-500">{b.address}</p> : null}
            {b.phone || b.email ? (
              <p className="text-sm text-slate-500">
                {[b.phone, b.email].filter(Boolean).join(" · ")}
              </p>
            ) : null}
            {b.website ? <p className="text-sm text-slate-500">{b.website}</p> : null}
          </div>
          <div className="text-end">
            <p className={`text-2xl font-bold ${isModern ? "text-indigo-700 dark:text-indigo-400" : ""}`}>
              {isQuotation ? t.quotation : t.taxInvoice}
            </p>
            <p className="mt-1 font-mono text-lg font-semibold">
              {data.number ?? (isQuotation ? t.draftQuotation : t.draft)}
            </p>
            <dl className="mt-2 space-y-0.5 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">{t.issueDate}</dt>
                <dd>{formatDate(data.issueDate, data.locale)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">{isQuotation ? t.expiryDate : t.dueDate}</dt>
                <dd>{formatDate(data.dueDate, data.locale)}</dd>
              </div>
              {data.supplyDate ? (
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500">{t.supplyDate}</dt>
                  <dd>{formatDate(data.supplyDate, data.locale)}</dd>
                </div>
              ) : null}
            </dl>
          </div>
        </div>

        {/* Bill to */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t.billTo}</p>
          <p className="mt-1 font-semibold">{c.companyName ?? c.name}</p>
          {c.companyName ? <p className="text-sm text-slate-500">{c.name}</p> : null}
          {c.trn ? (
            <p className="text-sm text-slate-500">
              {t.trn}: {c.trn}
            </p>
          ) : null}
          {c.billingAddress ? (
            <p className="whitespace-pre-line text-sm text-slate-500">{c.billingAddress}</p>
          ) : null}
          {c.email || c.phone ? (
            <p className="text-sm text-slate-500">{[c.email, c.phone].filter(Boolean).join(" · ")}</p>
          ) : null}
        </div>

        {/* Lines */}
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b-2 border-slate-900 text-start dark:border-slate-100">
              <th className="py-2 text-start font-semibold">{t.description}</th>
              <th className="py-2 text-end font-semibold">{t.qty}</th>
              <th className="py-2 text-end font-semibold">{t.unitPrice}</th>
              <th className="py-2 text-end font-semibold">{t.discount}</th>
              <th className="py-2 text-end font-semibold">{t.vat}</th>
              <th className="py-2 text-end font-semibold">{t.total}</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((item, i) => (
              <tr key={i} className="border-b border-slate-200 align-top dark:border-slate-800">
                <td className="py-2 pe-2">
                  <p>{item.description}</p>
                  {item.sku ? <p className="text-xs text-slate-500">{item.sku}</p> : null}
                </td>
                <td className="py-2 text-end whitespace-nowrap">
                  {item.quantity} {item.unit}
                </td>
                <td className="py-2 text-end whitespace-nowrap">
                  {money(item.unitPrice)}
                  {item.taxInclusive ? (
                    <span className="block text-xs text-slate-500">{t.inclVat}</span>
                  ) : null}
                </td>
                <td className="py-2 text-end whitespace-nowrap">
                  {item.discountAmount !== "0" ? `−${money(item.discountAmount)}` : "—"}
                </td>
                <td className="py-2 text-end whitespace-nowrap">
                  {money(item.vatAmount)}
                  <span className="block text-xs text-slate-500">{item.taxRate}%</span>
                </td>
                <td className="py-2 text-end font-medium whitespace-nowrap">{money(item.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Totals */}
        <div className="flex justify-end">
          <dl className="w-full max-w-xs space-y-1.5 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-500">{t.subtotal}</dt>
              <dd>{money(data.totals.subtotal)}</dd>
            </div>
            {data.totals.discountTotal !== "0" ? (
              <div className="flex justify-between">
                <dt className="text-slate-500">{t.discountTotal}</dt>
                <dd>−{money(data.totals.discountTotal)}</dd>
              </div>
            ) : null}
            <div className="flex justify-between">
              <dt className="text-slate-500">{t.taxable}</dt>
              <dd>{money(data.totals.taxableAmount)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">{t.vatAmount}</dt>
              <dd>{money(data.totals.vatAmount)}</dd>
            </div>
            <div
              className={`flex justify-between border-t pt-2 text-base font-bold ${
                isModern
                  ? "border-indigo-200 text-indigo-800 dark:border-indigo-900 dark:text-indigo-300"
                  : "border-slate-300 dark:border-slate-700"
              }`}
            >
              <dt>{t.grandTotal}</dt>
              <dd>{money(data.totals.grandTotal)}</dd>
            </div>
            {data.totals.amountPaid !== "0" ? (
              <>
                <div className="flex justify-between">
                  <dt className="text-slate-500">{t.amountPaid}</dt>
                  <dd>−{money(data.totals.amountPaid)}</dd>
                </div>
                <div className="flex justify-between font-semibold">
                  <dt>{t.balance}</dt>
                  <dd>{money(data.totals.balance)}</dd>
                </div>
              </>
            ) : null}
          </dl>
        </div>

        {/* Notes / terms / bank */}
        {data.notes ? (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t.notes}</p>
            <p className="mt-1 whitespace-pre-line text-sm">{data.notes}</p>
          </div>
        ) : null}
        {data.terms ? (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t.terms}</p>
            <p className="mt-1 whitespace-pre-line text-sm text-slate-500">{data.terms}</p>
          </div>
        ) : null}
        {b.bankName || b.iban ? (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t.bankDetails}</p>
            <p className="mt-1 text-sm text-slate-500">
              {[b.bankName, b.accountName ? `Account: ${b.accountName}` : null, b.iban ? `IBAN: ${b.iban}` : null, b.swift ? `SWIFT: ${b.swift}` : null]
                .filter(Boolean)
                .join(" · ")}
            </p>
            {b.paymentInstructions ? (
              <p className="mt-1 whitespace-pre-line text-sm text-slate-500">{b.paymentInstructions}</p>
            ) : null}
          </div>
        ) : null}
        {b.footer ? (
          <p className="border-t border-slate-200 pt-4 text-center text-xs text-slate-500 dark:border-slate-800">
            {b.footer}
          </p>
        ) : null}
      </div>
    </div>
  );
}
