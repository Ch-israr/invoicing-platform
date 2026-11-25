import { randomUUID } from "node:crypto";
import { Prisma, type InvoiceStatus, type TaxCategory, type TaxRate } from "@prisma/client";
import Decimal from "decimal.js";
import { prisma } from "@/lib/prisma";
import {
  canManageBusiness,
  canWrite,
  getDefaultBusinessForUser,
  requireCanWrite,
  requireMembership,
  scopeWhere,
  TenantError,
} from "@/lib/tenant";
import { logActivity } from "@/lib/activity";
import { PAGE_SIZE, pageCount as calcPageCount } from "@/lib/pagination";
import {
  applyInvoiceLevelDiscount,
  calculateInvoice,
  calculateLine,
  type InvoiceDiscountInput,
  type LineInput,
  type LineResult,
} from "@/lib/money";
import { draftNumber, formatInvoiceNumber, isDraftNumber } from "@/lib/numbering";
import {
  firstValidationError,
  invoiceSchema,
  stripEmptyLineItems,
  taxCategoryForRateCode,
  type InvoiceInput,
  type InvoiceItemInput,
} from "@/lib/validation/invoice";

export type ServiceResult<T = void> =
  | ({ ok: true } & (T extends void ? object : { data: T }))
  // lineIndex: index of the offending line item (into the items array
  // as submitted), when the failure is about one line — the form uses
  // it to highlight that line.
  | { ok: false; error: string; lineIndex?: number };

/** Statuses that can become overdue (derived, never stored). */
const UNPAID_STATUSES: InvoiceStatus[] = ["ISSUED", "SENT", "PARTIALLY_PAID"];

export function isInvoiceOverdue(
  status: InvoiceStatus,
  dueDate: Date,
  balance: Decimal.Value,
): boolean {
  if (!UNPAID_STATUSES.includes(status)) return false;
  if (new Decimal(balance).lessThanOrEqualTo(0)) return false;
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  return dueDate.getTime() < today.getTime();
}

export function daysOverdue(dueDate: Date, now = new Date()): number {
  const today = new Date(now);
  today.setUTCHours(0, 0, 0, 0);
  return Math.max(0, Math.floor((today.getTime() - dueDate.getTime()) / 86_400_000));
}

// ---------------------------------------------------------------------------
// Payment state — shared by the payment, refund and credit-note services.
//   amountPaid = Σ payments − Σ refunds
//   balance    = grandTotal − amountPaid − Σ issued credit notes, clamped ≥ 0
// Status follows the money:
//   balance 0 + money received  → PAID
//   balance 0 + only credited   → status UNCHANGED (a fully-credited
//                                  invoice is resolved, not "paid")
//   balance > 0 + anything paid/credited → PARTIALLY_PAID
//   balance > 0 + nothing paid/credited  → ISSUED (SENT kept when it
//                                          was SENT; a reversal —
//                                          payment deleted, refund in
//                                          full, credit cancelled —
//                                          returns the invoice there)
// CANCELLED and DRAFT are terminal/untouched and never recomputed.
// ---------------------------------------------------------------------------

export function deriveInvoiceStatus(
  current: InvoiceStatus,
  balance: Decimal.Value,
  effectivePaid: Decimal.Value,
  credited: Decimal.Value,
): InvoiceStatus {
  if (current === "CANCELLED" || current === "DRAFT") return current;
  const bal = new Decimal(balance);
  const paid = new Decimal(effectivePaid);
  const cred = new Decimal(credited);
  if (bal.lessThanOrEqualTo(0)) {
    return paid.greaterThan(0) ? "PAID" : current;
  }
  if (paid.greaterThan(0) || cred.greaterThan(0)) return "PARTIALLY_PAID";
  // Nothing paid or credited any more (payment deleted, refund in
  // full, credit note cancelled): back to the unpaid state. SENT is
  // kept when it was the state; anything else (PARTIALLY_PAID, PAID)
  // falls back to ISSUED — there is no stored "was sent" marker to
  // restore, and ISSUED is the base unpaid state.
  return current === "ISSUED" || current === "SENT" ? current : "ISSUED";
}

export type InvoicePaymentState = {
  effectivePaid: Decimal;
  credited: Decimal;
  balance: Decimal;
  status: InvoiceStatus;
};

/** Read the ledger state of an invoice: net money received and credits issued. */
export async function readInvoicePaymentState(
  db: Prisma.TransactionClient | typeof prisma,
  invoiceId: string,
): Promise<{ effectivePaid: Decimal; credited: Decimal } | null> {
  const invoice = await db.invoice.findUnique({
    where: { id: invoiceId },
    select: { id: true },
  });
  if (!invoice) return null;
  const [payments, creditNotes] = await Promise.all([
    db.payment.findMany({
      where: { invoiceId },
      select: {
        amount: true,
        earlyDiscountAmount: true,
        refunds: { select: { amount: true } },
      },
    }),
    db.creditNote.findMany({
      where: { invoiceId, status: "ISSUED" },
      select: { grandTotal: true },
    }),
  ]);
  // Effective paid counts an early-payment discount granted on a
  // payment, so paying (balance − discount) with the discount applied
  // settles the invoice; deleting such a payment reverts it.
  const effectivePaid = payments.reduce(
    (acc, p) =>
      acc
        .add(new Decimal(p.amount.toString()))
        .add(new Decimal(p.earlyDiscountAmount.toString()))
        .sub(
          p.refunds.reduce(
            (r, x) => r.add(new Decimal(x.amount.toString())),
            new Decimal(0),
          ),
        ),
    new Decimal(0),
  );
  const credited = creditNotes.reduce(
    (acc, c) => acc.add(new Decimal(c.grandTotal.toString())),
    new Decimal(0),
  );
  return { effectivePaid, credited };
}

/**
 * Recompute amountPaid / balance / status from the payment, refund and
 * credit-note rows. Call inside the same transaction that changed any
 * of them so the invoice can never disagree with its ledger.
 */
export async function recomputeInvoiceState(
  tx: Prisma.TransactionClient,
  invoiceId: string,
): Promise<InvoicePaymentState> {
  const invoice = await tx.invoice.findUnique({
    where: { id: invoiceId },
    select: { grandTotal: true, status: true },
  });
  if (!invoice) throw new TenantError(404, "Invoice not found");
  const state = await readInvoicePaymentState(tx, invoiceId);
  if (!state) throw new TenantError(404, "Invoice not found");
  const grand = new Decimal(invoice.grandTotal.toString());
  const balance = Decimal.max(
    0,
    grand.sub(state.effectivePaid).sub(state.credited),
  );
  const status = deriveInvoiceStatus(
    invoice.status,
    balance,
    state.effectivePaid,
    state.credited,
  );
  await tx.invoice.update({
    where: { id: invoiceId },
    data: {
      amountPaid: state.effectivePaid,
      balance,
      status,
    },
  });
  return { ...state, balance, status };
}

// ---------------------------------------------------------------------------
// Snapshot payload — the frozen invoice. The PDF (Phase 4) renders from
// this, never from live customer/product rows. Money is stored as
// strings so no precision is lost through JSON.
// ---------------------------------------------------------------------------

export type InvoiceSnapshotPayload = {
  version: 1;
  invoice: {
    id: string;
    number: string;
    status: string;
    currency: string;
    issueDate: string;
    dueDate: string;
    supplyDate: string | null;
    template: string;
    locale: string;
    subtotal: string;
    discountTotal: string;
    /** Invoice-level discount actually applied (0 when none). */
    invoiceDiscountType: string;
    invoiceDiscountValue: string;
    invoiceDiscountTotal: string;
    /** Early-payment discount terms as issued (granted at payment time). */
    earlyDiscountType: string;
    earlyDiscountValue: string;
    earlyDiscountDays: number;
    taxableAmount: string;
    vatAmount: string;
    grandTotal: string;
    amountPaid: string;
    balance: string;
    notes: string | null;
    terms: string | null;
  };
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
    shippingAddress: string | null;
    country: string;
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
};

// ---------------------------------------------------------------------------
// Tax resolution
// ---------------------------------------------------------------------------

type ResolvedLine = {
  item: InvoiceItemInput;
  taxRateId: string | null;
  rate: Decimal;
  taxCategory: TaxCategory;
  result: LineResult;
};

/**
 * Resolve the VAT rate for one line. An explicit taxRateId wins (and
 * must belong to this business); otherwise the rate is derived from the
 * line's tax category using the business's rates (STANDARD uses the
 * business default rate). The category is always derived from the
 * resolved rate so rate and category can never disagree.
 */
function resolveLineTax(
  rates: TaxRate[],
  defaultVatRateId: string | null,
  item: InvoiceItemInput,
): { taxRateId: string | null; rate: Decimal; taxCategory: TaxCategory } | string {
  const byId = new Map(rates.map((r) => [r.id, r]));
  const byCode = new Map(rates.map((r) => [r.code.toUpperCase(), r]));

  if (item.taxRateId) {
    const rate = byId.get(item.taxRateId);
    if (!rate) return "Selected tax rate does not belong to this business";
    return {
      taxRateId: rate.id,
      rate: rate.rate,
      taxCategory: taxCategoryForRateCode(rate.code),
    };
  }
  switch (item.taxCategory) {
    case "STANDARD": {
      const def = (defaultVatRateId && byId.get(defaultVatRateId)) ?? byCode.get("STD_5");
      if (!def) return "No standard VAT rate configured for this business";
      return { taxRateId: def.id, rate: def.rate, taxCategory: "STANDARD" };
    }
    case "ZERO_RATED": {
      const zero = byCode.get("ZERO");
      if (!zero) return "No zero-rated VAT rate configured for this business";
      return { taxRateId: zero.id, rate: zero.rate, taxCategory: "ZERO_RATED" };
    }
    case "EXEMPT": {
      const exempt = byCode.get("EXEMPT");
      if (!exempt) return "No exempt VAT rate configured for this business";
      return { taxRateId: exempt.id, rate: exempt.rate, taxCategory: "EXEMPT" };
    }
    case "OUT_OF_SCOPE":
      return { taxRateId: null, rate: new Decimal(0), taxCategory: "OUT_OF_SCOPE" };
  }
}

type ComputedInvoice = {
  lines: ResolvedLine[];
  totals: ReturnType<typeof calculateInvoice>["totals"];
};

/**
 * Sum already-computed (rounded) line results into invoice totals,
 * applying the invoice-level discount across the VAT rates (see
 * lib/money.ts). discountTotal is the TOTAL discount — line
 * discounts plus the invoice-level discount — so
 * grandTotal = subtotal − discountTotal + vatAmount still holds.
 */
function sumLineResults(
  lines: ResolvedLine[],
  discount: InvoiceDiscountInput = { type: "NONE", value: "0" },
) {
  const sum = (pick: (r: LineResult) => Decimal): Decimal =>
    lines.reduce((acc, l) => acc.add(pick(l.result)), new Decimal(0));
  const subtotal = sum((r) => r.netAmount);
  const lineDiscountTotal = sum((r) => r.discountAmount);
  const applied = applyInvoiceLevelDiscount(
    lines.map((l) => ({ taxRatePercent: l.rate, result: l.result })),
    discount,
  );
  return {
    subtotal,
    discountTotal: lineDiscountTotal.add(applied.invoiceDiscountTotal),
    lineDiscountTotal,
    invoiceDiscountTotal: applied.invoiceDiscountTotal,
    taxableAmount: applied.taxableAmount,
    vatAmount: applied.vatAmount,
    grandTotal: applied.grandTotal,
  };
}

/** Recompute every money figure from the validated input. Client totals are never used.
 * Only the line items are needed, so quotations (which have no due
 * date / template / locale) can use the same function. Quotations
 * never carry an invoice discount — the parameter is optional and
 * defaults to none. */
export function computeInvoice(
  input: { items: InvoiceItemInput[]; invoiceDiscount?: InvoiceDiscountInput },
  rates: TaxRate[],
  defaultVatRateId: string | null,
): ComputedInvoice | string {
  const resolved: ResolvedLine[] = [];
  for (const item of input.items) {
    const tax = resolveLineTax(rates, defaultVatRateId, item);
    if (typeof tax === "string") return tax;
    const lineInput: LineInput = {
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      discountType: item.discountType,
      discountValue: item.discountValue,
      taxRatePercent: tax.rate,
      taxInclusive: item.taxInclusive,
    };
    resolved.push({ item, ...tax, result: calculateLine(lineInput) });
  }
  return { lines: resolved, totals: sumLineResults(resolved, input.invoiceDiscount) };
}

function toDate(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

/**
 * The Prisma create payload for an invoice row + its items, from
 * already-computed (server-side) totals. Shared by createInvoice and
 * by quotation conversion so a converted invoice is built exactly
 * like a hand-built one.
 */
export function invoiceCreateData(
  id: string,
  business: { id: string; currency: string; defaultTerms: string | null },
  input: InvoiceInput,
  computed: ComputedInvoice,
  number: string,
): Prisma.InvoiceCreateInput {
  return {
    id,
    business: { connect: { id: business.id } },
    customer: { connect: { id: input.customerId } },
    number,
    status: "DRAFT",
    currency: business.currency,
    issueDate: toDate(input.issueDate),
    dueDate: toDate(input.dueDate),
    supplyDate: input.supplyDate ? toDate(input.supplyDate) : null,
    subtotal: computed.totals.subtotal,
    discountTotal: computed.totals.discountTotal,
    invoiceDiscountType: input.invoiceDiscountType,
    invoiceDiscountValue: new Prisma.Decimal(input.invoiceDiscountValue),
    invoiceDiscountTotal: computed.totals.invoiceDiscountTotal,
    earlyDiscountType: input.earlyDiscountType,
    earlyDiscountValue: new Prisma.Decimal(input.earlyDiscountValue),
    earlyDiscountDays: Number(input.earlyDiscountDays),
    taxableAmount: computed.totals.taxableAmount,
    vatAmount: computed.totals.vatAmount,
    grandTotal: computed.totals.grandTotal,
    amountPaid: new Prisma.Decimal(0),
    balance: computed.totals.grandTotal,
    notes: input.notes ?? null,
    terms: input.terms ?? business.defaultTerms ?? null,
    template: input.template,
    locale: input.locale,
    items: {
      create: computed.lines.map((line, i) => ({
        productId: line.item.productId ?? null,
        description: line.item.description,
        sku: line.item.sku ?? null,
        quantity: new Prisma.Decimal(line.item.quantity),
        unit: line.item.unit,
        unitPrice: new Prisma.Decimal(line.item.unitPrice),
        discountType: line.item.discountType,
        discountValue: new Prisma.Decimal(line.item.discountValue),
        taxInclusive: line.item.taxInclusive,
        taxRateId: line.taxRateId,
        taxRate: line.rate,
        taxCategory: line.taxCategory,
        lineTotal: line.result.lineTotal,
        sortOrder: i,
      })),
    },
  };
}

export async function assertCustomerBelongs(
  businessId: string,
  customerId: string,
): Promise<string | null> {
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, businessId },
    select: { id: true, status: true },
  });
  if (!customer) return "Selected customer does not belong to this business";
  return null;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getInvoiceForUser(userId: string, invoiceId: string) {
  const business = await getDefaultBusinessForUser(userId);
  if (!business) throw new TenantError(404, "Business not found");
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, ...scopeWhere(business.id) },
    include: {
      customer: true,
      items: { orderBy: { sortOrder: "asc" } },
      snapshot: true,
      documents: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  if (!invoice) throw new TenantError(404, "Invoice not found");
  return { business, invoice };
}

export async function getInvoiceFormData(userId: string) {
  const business = await getDefaultBusinessForUser(userId);
  if (!business) return null;
  const [settings, customers, products, taxRates] = await Promise.all([
    prisma.businessSettings.findUnique({ where: { businessId: business.id } }),
    prisma.customer.findMany({
      where: { ...scopeWhere(business.id), status: "ACTIVE" },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        companyName: true,
        type: true,
        email: true,
        phone: true,
        billingAddress: true,
        trn: true,
      },
    }),
    prisma.product.findMany({
      where: { ...scopeWhere(business.id), isActive: true },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        sku: true,
        description: true,
        unit: true,
        price: true,
        taxRateId: true,
        taxCategory: true,
      },
    }),
    prisma.taxRate.findMany({
      where: scopeWhere(business.id),
      orderBy: { code: "asc" },
    }),
  ]);
  return { business, settings, customers, products, taxRates };
}

export type InvoiceFilters = {
  q?: string;
  status?: InvoiceStatus;
  customerId?: string;
  page?: number;
};

export async function listInvoices(userId: string, filters: InvoiceFilters) {
  const business = await getDefaultBusinessForUser(userId);
  if (!business) {
    return { invoices: [], total: 0, page: 1, pageCount: 1 };
  }
  const page = Math.max(1, filters.page ?? 1);
  const where: Prisma.InvoiceWhereInput = { businessId: business.id };
  if (filters.status) where.status = filters.status;
  if (filters.customerId) where.customerId = filters.customerId;
  if (filters.q) {
    const q = filters.q.trim();
    where.OR = [
      { number: { contains: q, mode: "insensitive" } },
      { customer: { name: { contains: q, mode: "insensitive" } } },
      { customer: { companyName: { contains: q, mode: "insensitive" } } },
    ];
  }
  const [invoices, total] = await Promise.all([
    prisma.invoice.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { customer: { select: { id: true, name: true, companyName: true } } },
    }),
    prisma.invoice.count({ where }),
  ]);
  return {
    invoices: invoices.map((inv) => ({
      ...inv,
      isOverdue: isInvoiceOverdue(inv.status, inv.dueDate, inv.balance),
    })),
    total,
    page,
    pageCount: calcPageCount(total),
  };
}

export async function getInvoiceDetail(userId: string, invoiceId: string) {
  const { business, invoice } = await getInvoiceForUser(userId, invoiceId);
  const settings = await prisma.businessSettings.findUnique({
    where: { businessId: business.id },
  });
  const membership = await requireMembership(userId, business.id);
  const overdue = isInvoiceOverdue(invoice.status, invoice.dueDate, invoice.balance);
  const [payments, creditNotes, ledger] = await Promise.all([
    prisma.payment.findMany({
      where: { invoiceId: invoice.id },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      include: { refunds: { orderBy: { date: "desc" } } },
    }),
    prisma.creditNote.findMany({
      where: { invoiceId: invoice.id },
      orderBy: { createdAt: "desc" },
      include: { items: true },
    }),
    readInvoicePaymentState(prisma, invoice.id),
  ]);
  const credited = ledger?.credited ?? new Decimal(0);
  const effectivePaid = ledger?.effectivePaid ?? new Decimal(0);
  return {
    business,
    settings,
    invoice,
    /** The page shows Issue/Void buttons only to OWNER/ADMIN; the
     * service enforces the same rule server-side regardless. */
    canManage: canManageBusiness(membership.role),
    canWrite: canWrite(membership.role),
    isOverdue: overdue,
    daysOverdue: overdue ? daysOverdue(invoice.dueDate) : 0,
    payments,
    creditNotes,
    /** Total credited by issued credit notes (cancelled notes excluded). */
    creditTotal: credited,
    effectivePaid,
    /** Balance is 0 with nothing received — resolved by credit, not paid. */
    fullyCredited:
      new Decimal(invoice.balance).lessThanOrEqualTo(0) &&
      effectivePaid.equals(0) &&
      credited.greaterThan(0),
  };
}

// ---------------------------------------------------------------------------
// Drafts
// ---------------------------------------------------------------------------

export async function createInvoice(
  userId: string,
  rawInput: unknown,
): Promise<ServiceResult<{ id: string }>> {
  const parsed = invoiceSchema.safeParse(stripEmptyLineItems(rawInput));
  if (!parsed.success) {
    return { ok: false, ...firstValidationError(parsed.error) };
  }
  const business = await getDefaultBusinessForUser(userId);
  if (!business) return { ok: false, error: "No business found" };
  await requireCanWrite(userId, business.id);
  const input: InvoiceInput = parsed.data;

  const customerError = await assertCustomerBelongs(business.id, input.customerId);
  if (customerError) return { ok: false, error: customerError };
  const taxRates = await prisma.taxRate.findMany({
    where: scopeWhere(business.id),
  });
  const computed = computeInvoice(
    {
      ...input,
      invoiceDiscount: {
        type: input.invoiceDiscountType,
        value: input.invoiceDiscountValue,
      },
    },
    taxRates,
    business.defaultVatRateId,
  );
  if (typeof computed === "string") return { ok: false, error: computed };

  const id = randomUUID();
  const invoice = await prisma.$transaction(async (tx) => {
    const created = await tx.invoice.create({
      data: invoiceCreateData(id, business, input, computed, draftNumber(id)),
    });
    await logActivity(tx, {
      businessId: business.id,
      userId,
      action: "invoice.created",
      entityType: "Invoice",
      entityId: created.id,
      metadata: { number: created.number, grandTotal: computed.totals.grandTotal.toString() },
    });
    return created;
  });
  return { ok: true, data: { id: invoice.id } };
}

export async function updateInvoice(
  userId: string,
  invoiceId: string,
  rawInput: unknown,
): Promise<ServiceResult> {
  const parsed = invoiceSchema.safeParse(stripEmptyLineItems(rawInput));
  if (!parsed.success) {
    return { ok: false, ...firstValidationError(parsed.error) };
  }
  const { business, invoice } = await getInvoiceForUser(userId, invoiceId);
  await requireCanWrite(userId, business.id);
  if (invoice.status !== "DRAFT") {
    return { ok: false, error: "Only drafts can be edited. Issue a credit note to correct an issued invoice." };
  }
  const input: InvoiceInput = parsed.data;

  const customerError = await assertCustomerBelongs(business.id, input.customerId);
  if (customerError) return { ok: false, error: customerError };
  const taxRates = await prisma.taxRate.findMany({
    where: scopeWhere(business.id),
  });
  const computed = computeInvoice(
    {
      ...input,
      invoiceDiscount: {
        type: input.invoiceDiscountType,
        value: input.invoiceDiscountValue,
      },
    },
    taxRates,
    business.defaultVatRateId,
  );
  if (typeof computed === "string") return { ok: false, error: computed };

  await prisma.$transaction(async (tx) => {
    await tx.invoiceItem.deleteMany({ where: { invoiceId: invoice.id } });
    await tx.invoice.update({
      where: { id: invoice.id },
      data: {
        customerId: input.customerId,
        issueDate: toDate(input.issueDate),
        dueDate: toDate(input.dueDate),
        supplyDate: input.supplyDate ? toDate(input.supplyDate) : null,
        subtotal: computed.totals.subtotal,
        discountTotal: computed.totals.discountTotal,
        invoiceDiscountType: input.invoiceDiscountType,
        invoiceDiscountValue: new Prisma.Decimal(input.invoiceDiscountValue),
        invoiceDiscountTotal: computed.totals.invoiceDiscountTotal,
        earlyDiscountType: input.earlyDiscountType,
        earlyDiscountValue: new Prisma.Decimal(input.earlyDiscountValue),
        earlyDiscountDays: Number(input.earlyDiscountDays),
        taxableAmount: computed.totals.taxableAmount,
        vatAmount: computed.totals.vatAmount,
        grandTotal: computed.totals.grandTotal,
        balance: computed.totals.grandTotal,
        notes: input.notes ?? null,
        terms: input.terms ?? null,
        template: input.template,
        locale: input.locale,
        items: {
          create: computed.lines.map((line, i) => ({
            productId: line.item.productId ?? null,
            description: line.item.description,
            sku: line.item.sku ?? null,
            quantity: new Prisma.Decimal(line.item.quantity),
            unit: line.item.unit,
            unitPrice: new Prisma.Decimal(line.item.unitPrice),
            discountType: line.item.discountType,
            discountValue: new Prisma.Decimal(line.item.discountValue),
            taxInclusive: line.item.taxInclusive,
            taxRateId: line.taxRateId,
            taxRate: line.rate,
            taxCategory: line.taxCategory,
            lineTotal: line.result.lineTotal,
            sortOrder: i,
          })),
        },
      },
    });
    await logActivity(tx, {
      businessId: business.id,
      userId,
      action: "invoice.updated",
      entityType: "Invoice",
      entityId: invoice.id,
      metadata: { grandTotal: computed.totals.grandTotal.toString() },
    });
  });
  return { ok: true };
}

export async function deleteInvoice(
  userId: string,
  invoiceId: string,
): Promise<ServiceResult> {
  const { business, invoice } = await getInvoiceForUser(userId, invoiceId);
  await requireCanWrite(userId, business.id);
  if (invoice.status !== "DRAFT") {
    return { ok: false, error: "Only drafts can be deleted. Void an issued invoice instead." };
  }
  await prisma.$transaction(async (tx) => {
    await tx.invoice.delete({ where: { id: invoice.id } });
    await logActivity(tx, {
      businessId: business.id,
      userId,
      action: "invoice.deleted",
      entityType: "Invoice",
      entityId: invoice.id,
      metadata: {},
    });
  });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Issue / void — OWNER / ADMIN only
// ---------------------------------------------------------------------------

function buildSnapshotPayload(
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
    defaultTerms: string | null;
    defaultFooter: string | null;
  },
  customer: {
    name: string;
    companyName: string | null;
    email: string | null;
    phone: string | null;
    billingAddress: string | null;
    shippingAddress: string | null;
    country: string;
    trn: string | null;
  },
  invoice: {
    id: string;
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
    invoiceDiscountType: string;
    invoiceDiscountValue: Prisma.Decimal;
    invoiceDiscountTotal: Prisma.Decimal;
    earlyDiscountType: string;
    earlyDiscountValue: Prisma.Decimal;
    earlyDiscountDays: number;
    taxableAmount: Prisma.Decimal;
    vatAmount: Prisma.Decimal;
    grandTotal: Prisma.Decimal;
    amountPaid: Prisma.Decimal;
    balance: Prisma.Decimal;
    notes: string | null;
    terms: string | null;
  },
  lines: ResolvedLine[],
): InvoiceSnapshotPayload {
  return {
    version: 1,
    invoice: {
      id: invoice.id,
      number: invoice.number,
      status: invoice.status,
      currency: invoice.currency,
      issueDate: invoice.issueDate.toISOString(),
      dueDate: invoice.dueDate.toISOString(),
      supplyDate: invoice.supplyDate ? invoice.supplyDate.toISOString() : null,
      template: invoice.template,
      locale: invoice.locale,
      subtotal: invoice.subtotal.toString(),
      discountTotal: invoice.discountTotal.toString(),
      invoiceDiscountType: invoice.invoiceDiscountType,
      invoiceDiscountValue: invoice.invoiceDiscountValue.toString(),
      invoiceDiscountTotal: invoice.invoiceDiscountTotal.toString(),
      earlyDiscountType: invoice.earlyDiscountType,
      earlyDiscountValue: invoice.earlyDiscountValue.toString(),
      earlyDiscountDays: invoice.earlyDiscountDays,
      taxableAmount: invoice.taxableAmount.toString(),
      vatAmount: invoice.vatAmount.toString(),
      grandTotal: invoice.grandTotal.toString(),
      amountPaid: invoice.amountPaid.toString(),
      balance: invoice.balance.toString(),
      notes: invoice.notes,
      terms: invoice.terms,
    },
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
      shippingAddress: customer.shippingAddress,
      country: customer.country,
      trn: customer.trn,
    },
    items: lines.map((line) => ({
      description: line.item.description,
      sku: line.item.sku ?? null,
      quantity: new Prisma.Decimal(line.item.quantity).toString(),
      unit: line.item.unit,
      unitPrice: new Prisma.Decimal(line.item.unitPrice).toString(),
      discountType: line.item.discountType,
      discountValue: new Prisma.Decimal(line.item.discountValue).toString(),
      taxRate: line.rate.toString(),
      taxCategory: line.taxCategory,
      taxInclusive: line.item.taxInclusive,
      netAmount: line.result.netAmount.toString(),
      discountAmount: line.result.discountAmount.toString(),
      taxableAmount: line.result.taxableAmount.toString(),
      vatAmount: line.result.vatAmount.toString(),
      lineTotal: line.result.lineTotal.toString(),
    })),
  };
}

export async function issueInvoice(
  userId: string,
  invoiceId: string,
): Promise<ServiceResult<{ number: string }>> {
  const { business, invoice } = await getInvoiceForUser(userId, invoiceId);
  const membership = await requireMembership(userId, business.id);
  if (!canManageBusiness(membership.role)) {
    throw new TenantError(403, "Only owners and admins can issue invoices");
  }
  if (invoice.status !== "DRAFT") {
    return { ok: false, error: "Only a draft can be issued" };
  }
  if (invoice.items.length === 0) {
    return { ok: false, error: "An invoice needs at least one line item before it can be issued" };
  }
  if (invoice.customer.status !== "ACTIVE") {
    return { ok: false, error: "Cannot issue an invoice to an inactive customer" };
  }

  // Recompute from the stored draft lines (their snapshotted rates) so
  // the issued totals never depend on what the client sent at save time.
  const lines: ResolvedLine[] = invoice.items.map((item) => {
    const result = calculateLine({
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      discountType: item.discountType,
      discountValue: item.discountValue,
      taxRatePercent: item.taxRate,
      taxInclusive: item.taxInclusive,
    });
    return {
      item: {
        productId: item.productId ?? undefined,
        description: item.description,
        sku: item.sku ?? undefined,
        quantity: item.quantity.toString(),
        unit: item.unit,
        unitPrice: item.unitPrice.toString(),
        discountType: item.discountType,
        discountValue: item.discountValue.toString(),
        taxRateId: item.taxRateId ?? undefined,
        taxCategory: item.taxCategory,
        taxInclusive: item.taxInclusive,
      },
      taxRateId: item.taxRateId,
      rate: item.taxRate,
      taxCategory: item.taxCategory,
      result,
    };
  });
  // Recompute with the discount fields stored on the draft, so the
  // issued totals and snapshot carry the discount the draft had.
  const totals = sumLineResults(lines, {
    type: invoice.invoiceDiscountType,
    value: invoice.invoiceDiscountValue,
  });

  try {
    const number = await prisma.$transaction(async (tx) => {
      // Atomically take the next number: the row update locks the
      // business row, so two concurrent issues can never take the
      // same number. `increment` returns the NEW value, so the
      // number used is newValue - 1.
      const updated = await tx.business.update({
        where: { id: business.id },
        data: { nextInvoiceNumber: { increment: 1 } },
        select: { invoicePrefix: true, nextInvoiceNumber: true },
      });
      const number = formatInvoiceNumber(
        updated.invoicePrefix,
        updated.nextInvoiceNumber - 1,
      );

      const issued = await tx.invoice.update({
        where: { id: invoice.id },
        data: {
          number,
          status: "ISSUED",
          subtotal: totals.subtotal,
          discountTotal: totals.discountTotal,
          invoiceDiscountTotal: totals.invoiceDiscountTotal,
          taxableAmount: totals.taxableAmount,
          vatAmount: totals.vatAmount,
          grandTotal: totals.grandTotal,
          amountPaid: new Prisma.Decimal(0),
          balance: totals.grandTotal,
        },
      });
      const payload = buildSnapshotPayload(
        business,
        invoice.customer,
        { ...issued, number },
        lines,
      );
      await tx.invoiceSnapshot.create({
        data: {
          invoiceId: invoice.id,
          payload: payload as unknown as Prisma.InputJsonValue,
          templateVersion: "1",
        },
      });
      await logActivity(tx, {
        businessId: business.id,
        userId,
        action: "invoice.issued",
        entityType: "Invoice",
        entityId: invoice.id,
        metadata: { number, grandTotal: totals.grandTotal.toString() },
      });
      return number;
    });
    return { ok: true, data: { number } };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { ok: false, error: "Invoice number already exists — please try again" };
    }
    throw err;
  }
}

export async function voidInvoice(
  userId: string,
  invoiceId: string,
): Promise<ServiceResult> {
  const { business, invoice } = await getInvoiceForUser(userId, invoiceId);
  const membership = await requireMembership(userId, business.id);
  if (!canManageBusiness(membership.role)) {
    throw new TenantError(403, "Only owners and admins can void invoices");
  }
  if (invoice.status !== "ISSUED" && invoice.status !== "SENT") {
    return { ok: false, error: "Only an issued invoice can be voided" };
  }
  if (!new Decimal(invoice.amountPaid).equals(0)) {
    return { ok: false, error: "Cannot void an invoice that has payments. Issue a credit note instead." };
  }
  const creditCount = await prisma.creditNote.count({
    where: { invoiceId: invoice.id },
  });
  if (creditCount > 0) {
    return { ok: false, error: "Cannot void an invoice that has credit notes." };
  }
  await prisma.$transaction(async (tx) => {
    await tx.invoice.update({
      where: { id: invoice.id },
      data: { status: "CANCELLED" },
    });
    await logActivity(tx, {
      businessId: business.id,
      userId,
      action: "invoice.voided",
      entityType: "Invoice",
      entityId: invoice.id,
      metadata: { number: invoice.number },
    });
  });
  return { ok: true };
}

/** True when the stored number is a real issued number, not a draft placeholder. */
export function hasIssuedNumber(number: string): boolean {
  return !isDraftNumber(number);
}
