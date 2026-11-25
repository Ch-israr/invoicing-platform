import Decimal from "decimal.js";
import type { Prisma } from "@prisma/client";
import { calculateLine } from "./money";
import type { InvoiceSnapshotPayload } from "@/server/services/invoice.service";

/**
 * The single data shape the invoice preview renders from — and the
 * shape Phase 4's PDF engine will feed to Playwright. The builder
 * (client), the detail page (server) and the frozen snapshot all
 * produce it, so preview === PDF by construction.
 *
 * Money is strings (Decimal.toString()) so JSON snapshots lose no
 * precision. Dates are ISO date strings (YYYY-MM-DD).
 */

export type InvoicePreviewData = {
  number: string | null; // null → draft, not yet numbered
  status: string;
  /** Quotations reuse this shape: title becomes "Quotation" and the
   * due date reads as the expiry date. Defaults to "invoice". */
  documentKind?: "invoice" | "quotation";
  template: string;
  locale: "en" | "ar";
  currency: string;
  issueDate: string;
  dueDate: string;
  supplyDate: string | null;
  business: {
    name: string;
    address: string | null;
    phone: string | null;
    email: string | null;
    website: string | null;
    trn: string | null;
    bankName: string | null;
    accountName: string | null;
    iban: string | null;
    swift: string | null;
    paymentInstructions: string | null;
    logoUrl: string | null;
    signatureUrl: string | null;
    terms: string | null;
    footer: string | null;
  };
  customer: {
    name: string;
    companyName: string | null;
    email: string | null;
    phone: string | null;
    billingAddress: string | null;
    trn: string | null;
  };
  items: Array<{
    description: string;
    sku: string | null;
    quantity: string;
    unit: string;
    unitPrice: string;
    discountType: string;
    discountValue: string;
    taxRate: string;
    taxCategory: string;
    taxInclusive: boolean;
    netAmount: string;
    discountAmount: string;
    taxableAmount: string;
    vatAmount: string;
    lineTotal: string;
  }>;
  totals: {
    subtotal: string;
    discountTotal: string;
    /** Line discounts only (falls back to discountTotal when unset). */
    lineDiscountTotal?: string;
    /** Invoice-level discount actually applied (0 when none). */
    invoiceDiscountTotal?: string;
    taxableAmount: string;
    vatAmount: string;
    grandTotal: string;
    amountPaid: string;
    balance: string;
  };
  notes: string | null;
  terms: string | null;
};

export function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Runtime guard for a frozen snapshot payload (version 1). */
export function isSnapshotPayload(
  value: unknown,
): value is InvoiceSnapshotPayload {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { version?: unknown }).version === 1 &&
    typeof (value as { invoice?: unknown }).invoice === "object"
  );
}

function dec(value: Prisma.Decimal | Decimal | string | number): string {
  return new Decimal(value.toString()).toString();
}

/** Build preview data from a frozen snapshot payload (issued invoices). */
export function previewDataFromSnapshot(
  payload: InvoiceSnapshotPayload,
): InvoicePreviewData {
  const inv = payload.invoice;
  return {
    number: inv.number,
    status: inv.status,
    documentKind: "invoice",
    template: inv.template,
    locale: inv.locale === "ar" ? "ar" : "en",
    currency: inv.currency,
    issueDate: inv.issueDate.slice(0, 10),
    dueDate: inv.dueDate.slice(0, 10),
    supplyDate: inv.supplyDate ? inv.supplyDate.slice(0, 10) : null,
    business: payload.business,
    customer: payload.customer,
    items: payload.items,
    totals: {
      subtotal: inv.subtotal,
      discountTotal: inv.discountTotal,
      // Snapshots taken before the invoice-discount feature lack the
      // field — treat it as 0, so old issued invoices render unchanged.
      lineDiscountTotal: new Decimal(inv.discountTotal)
        .sub(new Decimal(inv.invoiceDiscountTotal ?? "0"))
        .toString(),
      invoiceDiscountTotal: inv.invoiceDiscountTotal ?? "0",
      taxableAmount: inv.taxableAmount,
      vatAmount: inv.vatAmount,
      grandTotal: inv.grandTotal,
      amountPaid: inv.amountPaid,
      balance: inv.balance,
    },
    notes: inv.notes,
    terms: inv.terms,
  };
}

export type LiveInvoice = {
  number: string;
  status: string;
  currency: string;
  issueDate: Date;
  dueDate: Date;
  supplyDate: Date | null;
  template: string;
  locale: string;
  subtotal: Prisma.Decimal;
  discountTotal: Prisma.Decimal;
  invoiceDiscountTotal: Prisma.Decimal;
  taxableAmount: Prisma.Decimal;
  vatAmount: Prisma.Decimal;
  grandTotal: Prisma.Decimal;
  amountPaid: Prisma.Decimal;
  balance: Prisma.Decimal;
  notes: string | null;
  terms: string | null;
  items: Array<{
    description: string;
    sku: string | null;
    quantity: Prisma.Decimal;
    unit: string;
    unitPrice: Prisma.Decimal;
    discountType: "NONE" | "PERCENT" | "FIXED";
    discountValue: Prisma.Decimal;
    taxRate: Prisma.Decimal;
    taxCategory: string;
    taxInclusive: boolean;
  }>;
};

export type LiveBusiness = {
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  trn: string | null;
  bankName: string | null;
  accountName: string | null;
  iban: string | null;
  swift: string | null;
  paymentInstructions: string | null;
  logoUrl: string | null;
  signatureUrl: string | null;
  defaultTerms: string | null;
  defaultFooter: string | null;
};

export type LiveCustomer = {
  name: string;
  companyName: string | null;
  email: string | null;
  phone: string | null;
  billingAddress: string | null;
  trn: string | null;
};

/**
 * Build preview data for a quotation (draft or sent). Quotations have
 * no template/locale of their own — the business settings defaults
 * are used. The expiry date is shown where an invoice shows its due
 * date (InvoicePreview switches the label by documentKind).
 */
export function previewDataFromQuotation(
  quotation: {
    number: string;
    status: string;
    currency: string;
    issueDate: Date;
    expiryDate: Date;
    subtotal: Prisma.Decimal;
    discountTotal: Prisma.Decimal;
    taxableAmount: Prisma.Decimal;
    vatAmount: Prisma.Decimal;
    grandTotal: Prisma.Decimal;
    notes: string | null;
    terms: string | null;
    items: Array<{
      description: string;
      sku: string | null;
      quantity: Prisma.Decimal;
      unit: string;
      unitPrice: Prisma.Decimal;
      discountType: "NONE" | "PERCENT" | "FIXED";
      discountValue: Prisma.Decimal;
      taxRate: Prisma.Decimal;
      taxCategory: string;
      taxInclusive: boolean;
    }>;
  },
  business: LiveBusiness,
  customer: LiveCustomer,
  template: string,
  locale: "en" | "ar",
  isDraft: boolean,
): InvoicePreviewData {
  return {
    number: isDraft ? null : quotation.number,
    status: quotation.status,
    documentKind: "quotation",
    template,
    locale,
    currency: quotation.currency,
    issueDate: toDateString(quotation.issueDate),
    dueDate: toDateString(quotation.expiryDate),
    supplyDate: null,
    business: {
      name: business.name,
      address: business.address,
      phone: business.phone,
      email: business.email,
      website: business.website,
      trn: business.trn,
      bankName: business.bankName,
      accountName: business.accountName,
      iban: business.iban,
      swift: business.swift,
      paymentInstructions: business.paymentInstructions,
      logoUrl: business.logoUrl,
      signatureUrl: business.signatureUrl,
      terms: business.defaultTerms,
      footer: business.defaultFooter,
    },
    customer: {
      name: customer.name,
      companyName: customer.companyName,
      email: customer.email,
      phone: customer.phone,
      billingAddress: customer.billingAddress,
      trn: customer.trn,
    },
    items: quotation.items.map((item) => {
      const result = calculateLine({
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        discountType: item.discountType,
        discountValue: item.discountValue,
        taxRatePercent: item.taxRate,
        taxInclusive: item.taxInclusive,
      });
      return {
        description: item.description,
        sku: item.sku,
        quantity: dec(item.quantity),
        unit: item.unit,
        unitPrice: dec(item.unitPrice),
        discountType: item.discountType,
        discountValue: dec(item.discountValue),
        taxRate: dec(item.taxRate),
        taxCategory: item.taxCategory,
        taxInclusive: item.taxInclusive,
        netAmount: result.netAmount.toString(),
        discountAmount: result.discountAmount.toString(),
        taxableAmount: result.taxableAmount.toString(),
        vatAmount: result.vatAmount.toString(),
        lineTotal: result.lineTotal.toString(),
      };
    }),
    totals: {
      subtotal: dec(quotation.subtotal),
      discountTotal: dec(quotation.discountTotal),
      // Quotations have no invoice-level discount.
      lineDiscountTotal: dec(quotation.discountTotal),
      invoiceDiscountTotal: "0",
      taxableAmount: dec(quotation.taxableAmount),
      vatAmount: dec(quotation.vatAmount),
      grandTotal: dec(quotation.grandTotal),
      amountPaid: "0",
      balance: dec(quotation.grandTotal),
    },
    notes: quotation.notes,
    terms: quotation.terms,
  };
}
/**
 * Build preview data from live rows (drafts, or issued invoices whose
 * snapshot is missing). Per-line breakdowns are recomputed with the
 * money engine from the stored line fields — never from client input.
 */
export function previewDataFromLive(
  invoice: LiveInvoice,
  business: LiveBusiness,
  customer: LiveCustomer,
  isDraft: boolean,
): InvoicePreviewData {
  return {
    number: isDraft ? null : invoice.number,
    status: invoice.status,
    documentKind: "invoice",
    template: invoice.template,
    locale: invoice.locale === "ar" ? "ar" : "en",
    currency: invoice.currency,
    issueDate: toDateString(invoice.issueDate),
    dueDate: toDateString(invoice.dueDate),
    supplyDate: invoice.supplyDate ? toDateString(invoice.supplyDate) : null,
    business: {
      name: business.name,
      address: business.address,
      phone: business.phone,
      email: business.email,
      website: business.website,
      trn: business.trn,
      bankName: business.bankName,
      accountName: business.accountName,
      iban: business.iban,
      swift: business.swift,
      paymentInstructions: business.paymentInstructions,
      logoUrl: business.logoUrl,
      signatureUrl: business.signatureUrl,
      terms: business.defaultTerms,
      footer: business.defaultFooter,
    },
    customer: {
      name: customer.name,
      companyName: customer.companyName,
      email: customer.email,
      phone: customer.phone,
      billingAddress: customer.billingAddress,
      trn: customer.trn,
    },
    items: invoice.items.map((item) => {
      const result = calculateLine({
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        discountType: item.discountType,
        discountValue: item.discountValue,
        taxRatePercent: item.taxRate,
        taxInclusive: item.taxInclusive,
      });
      return {
        description: item.description,
        sku: item.sku,
        quantity: dec(item.quantity),
        unit: item.unit,
        unitPrice: dec(item.unitPrice),
        discountType: item.discountType,
        discountValue: dec(item.discountValue),
        taxRate: dec(item.taxRate),
        taxCategory: item.taxCategory,
        taxInclusive: item.taxInclusive,
        netAmount: result.netAmount.toString(),
        discountAmount: result.discountAmount.toString(),
        taxableAmount: result.taxableAmount.toString(),
        vatAmount: result.vatAmount.toString(),
        lineTotal: result.lineTotal.toString(),
      };
    }),
    totals: {
      subtotal: dec(invoice.subtotal),
      discountTotal: dec(invoice.discountTotal),
      lineDiscountTotal: new Decimal(invoice.discountTotal.toString())
        .sub(new Decimal(invoice.invoiceDiscountTotal.toString()))
        .toString(),
      invoiceDiscountTotal: dec(invoice.invoiceDiscountTotal),
      taxableAmount: dec(invoice.taxableAmount),
      vatAmount: dec(invoice.vatAmount),
      grandTotal: dec(invoice.grandTotal),
      amountPaid: dec(invoice.amountPaid),
      balance: dec(invoice.balance),
    },
    notes: invoice.notes,
    terms: invoice.terms,
  };
}
