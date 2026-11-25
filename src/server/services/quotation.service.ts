import { randomUUID } from "node:crypto";
import { Prisma, type QuotationStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  canManageBusiness,
  getDefaultBusinessForUser,
  requireCanWrite,
  requireMembership,
  scopeWhere,
  TenantError,
} from "@/lib/tenant";
import { logActivity } from "@/lib/activity";
import { PAGE_SIZE, pageCount as calcPageCount } from "@/lib/pagination";
import {
  assertCustomerBelongs,
  computeInvoice,
  getInvoiceFormData,
  invoiceCreateData,
  type ServiceResult,
} from "./invoice.service";
import { draftNumber, formatQuotationNumber } from "@/lib/numbering";
import {
  quotationSchema,
  type QuotationInput,
} from "@/lib/validation/quotation";
import {
  firstValidationError,
  invoiceSchema,
  stripEmptyLineItems,
  type InvoiceInput,
} from "@/lib/validation/invoice";

/**
 * Quotations — an invoice that hasn't happened yet.
 *
 * Same customer picker, line editor, money engine and totals as
 * invoices (computeInvoice is shared). Drafts carry a DRAFT-<id>
 * placeholder; the QTN-0001 number is assigned when the quotation is
 * sent, inside the same transaction that increments the counter.
 *
 * Flow: DRAFT → SENT → ACCEPTED / REJECTED / EXPIRED. Converting an
 * accepted (or sent) quotation creates a real DRAFT invoice from the
 * quotation's frozen items — totals recomputed by the money engine,
 * linked both ways (Quotation.convertedInvoiceId / Invoice
 * .convertedFrom). The invoice is a draft on purpose: the user reviews
 * dates and terms before issuing it, and its PDF is generated at
 * issue time by the existing Phase 4 flow. Converting twice is
 * impossible: the link is re-checked inside the conversion
 * transaction (the @unique on convertedInvoiceId is the backstop).
 *
 * Roles: drafts are written by any MEMBER+ (canWrite); sending and
 * converting publish a document to a customer, so they are
 * OWNER/ADMIN only, like issuing an invoice. Recording the
 * customer's response (accept / reject / expire) is canWrite.
 */

function toDate(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

function toDateInput(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export async function getQuotationForUser(userId: string, quotationId: string) {
  const business = await getDefaultBusinessForUser(userId);
  if (!business) throw new TenantError(404, "Business not found");
  const quotation = await prisma.quotation.findFirst({
    where: { id: quotationId, ...scopeWhere(business.id) },
    include: {
      customer: true,
      items: { orderBy: { sortOrder: "asc" } },
      convertedInvoice: { select: { id: true, number: true, status: true } },
    },
  });
  if (!quotation) throw new TenantError(404, "Quotation not found");
  return { business, quotation };
}

/** Same form data as invoices (customers, products, tax rates). */
export async function getQuotationFormData(userId: string) {
  return getInvoiceFormData(userId);
}

export type QuotationFilters = {
  q?: string;
  status?: QuotationStatus;
  customerId?: string;
  page?: number;
};

export async function listQuotations(userId: string, filters: QuotationFilters) {
  const business = await getDefaultBusinessForUser(userId);
  if (!business) {
    return { quotations: [], total: 0, page: 1, pageCount: 1 };
  }
  const page = Math.max(1, filters.page ?? 1);
  const where: Prisma.QuotationWhereInput = { businessId: business.id };
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
  const [quotations, total] = await Promise.all([
    prisma.quotation.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        customer: { select: { id: true, name: true, companyName: true } },
        convertedInvoice: { select: { id: true, number: true } },
      },
    }),
    prisma.quotation.count({ where }),
  ]);
  return { quotations, total, page, pageCount: calcPageCount(total) };
}

export async function getQuotationDetail(userId: string, quotationId: string) {
  const { business, quotation } = await getQuotationForUser(userId, quotationId);
  const membership = await requireMembership(userId, business.id);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  return {
    business,
    quotation,
    canManage: canManageBusiness(membership.role),
    isExpired: quotation.status === "SENT" && quotation.expiryDate.getTime() < today.getTime(),
  };
}

// ---------------------------------------------------------------------------
// Drafts
// ---------------------------------------------------------------------------

export async function createQuotation(
  userId: string,
  rawInput: unknown,
): Promise<ServiceResult<{ id: string }>> {
  const parsed = quotationSchema.safeParse(stripEmptyLineItems(rawInput));
  if (!parsed.success) {
    return { ok: false, ...firstValidationError(parsed.error) };
  }
  const business = await getDefaultBusinessForUser(userId);
  if (!business) return { ok: false, error: "No business found" };
  await requireCanWrite(userId, business.id);
  const input: QuotationInput = parsed.data;

  const customerError = await assertCustomerBelongs(business.id, input.customerId);
  if (customerError) return { ok: false, error: customerError };
  const taxRates = await prisma.taxRate.findMany({
    where: scopeWhere(business.id),
  });
  const computed = computeInvoice(input, taxRates, business.defaultVatRateId);
  if (typeof computed === "string") return { ok: false, error: computed };

  const id = randomUUID();
  const quotation = await prisma.$transaction(async (tx) => {
    const created = await tx.quotation.create({
      data: {
        id,
        ...scopeWhere(business.id),
        customerId: input.customerId,
        number: draftNumber(id),
        status: "DRAFT",
        currency: business.currency,
        issueDate: toDate(input.issueDate),
        expiryDate: toDate(input.expiryDate),
        subtotal: computed.totals.subtotal,
        discountTotal: computed.totals.discountTotal,
        taxableAmount: computed.totals.taxableAmount,
        vatAmount: computed.totals.vatAmount,
        grandTotal: computed.totals.grandTotal,
        notes: input.notes ?? null,
        terms: input.terms ?? business.defaultTerms ?? null,
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
      action: "quotation.created",
      entityType: "Quotation",
      entityId: created.id,
      metadata: { grandTotal: computed.totals.grandTotal.toString() },
    });
    return created;
  });
  return { ok: true, data: { id: quotation.id } };
}

export async function updateQuotation(
  userId: string,
  quotationId: string,
  rawInput: unknown,
): Promise<ServiceResult> {
  const parsed = quotationSchema.safeParse(stripEmptyLineItems(rawInput));
  if (!parsed.success) {
    return { ok: false, ...firstValidationError(parsed.error) };
  }
  const { business, quotation } = await getQuotationForUser(userId, quotationId);
  await requireCanWrite(userId, business.id);
  if (quotation.status !== "DRAFT") {
    return { ok: false, error: "Only drafts can be edited" };
  }
  const input: QuotationInput = parsed.data;

  const customerError = await assertCustomerBelongs(business.id, input.customerId);
  if (customerError) return { ok: false, error: customerError };
  const taxRates = await prisma.taxRate.findMany({
    where: scopeWhere(business.id),
  });
  const computed = computeInvoice(input, taxRates, business.defaultVatRateId);
  if (typeof computed === "string") return { ok: false, error: computed };

  await prisma.$transaction(async (tx) => {
    await tx.quotationItem.deleteMany({ where: { quotationId: quotation.id } });
    await tx.quotation.update({
      where: { id: quotation.id },
      data: {
        customerId: input.customerId,
        issueDate: toDate(input.issueDate),
        expiryDate: toDate(input.expiryDate),
        subtotal: computed.totals.subtotal,
        discountTotal: computed.totals.discountTotal,
        taxableAmount: computed.totals.taxableAmount,
        vatAmount: computed.totals.vatAmount,
        grandTotal: computed.totals.grandTotal,
        notes: input.notes ?? null,
        terms: input.terms ?? null,
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
      action: "quotation.updated",
      entityType: "Quotation",
      entityId: quotation.id,
      metadata: { grandTotal: computed.totals.grandTotal.toString() },
    });
  });
  return { ok: true };
}

export async function deleteQuotation(
  userId: string,
  quotationId: string,
): Promise<ServiceResult> {
  const { business, quotation } = await getQuotationForUser(userId, quotationId);
  await requireCanWrite(userId, business.id);
  if (quotation.status !== "DRAFT") {
    return { ok: false, error: "Only drafts can be deleted" };
  }
  await prisma.$transaction(async (tx) => {
    await tx.quotation.delete({ where: { id: quotation.id } });
    await logActivity(tx, {
      businessId: business.id,
      userId,
      action: "quotation.deleted",
      entityType: "Quotation",
      entityId: quotation.id,
      metadata: {},
    });
  });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Lifecycle — send / accept / reject / expire / convert
// ---------------------------------------------------------------------------

export async function sendQuotation(
  userId: string,
  quotationId: string,
): Promise<ServiceResult<{ number: string }>> {
  const { business, quotation } = await getQuotationForUser(userId, quotationId);
  const membership = await requireMembership(userId, business.id);
  if (!canManageBusiness(membership.role)) {
    throw new TenantError(403, "Only owners and admins can send quotations");
  }
  if (quotation.status !== "DRAFT") {
    return { ok: false, error: "Only a draft can be sent" };
  }
  if (quotation.items.length === 0) {
    return { ok: false, error: "A quotation needs at least one line item before it can be sent" };
  }
  if (quotation.customer.status !== "ACTIVE") {
    return { ok: false, error: "Cannot send a quotation to an inactive customer" };
  }

  try {
    const number = await prisma.$transaction(async (tx) => {
      // Same atomic-counter pattern as invoice issue: the row update
      // locks the business row, so two concurrent sends can never
      // take the same number.
      const updated = await tx.business.update({
        where: { id: business.id },
        data: { nextQuotationNumber: { increment: 1 } },
        select: { nextQuotationNumber: true },
      });
      const number = formatQuotationNumber(updated.nextQuotationNumber - 1);
      await tx.quotation.update({
        where: { id: quotation.id },
        data: { number, status: "SENT" },
      });
      await logActivity(tx, {
        businessId: business.id,
        userId,
        action: "quotation.sent",
        entityType: "Quotation",
        entityId: quotation.id,
        metadata: { number, grandTotal: quotation.grandTotal.toString() },
      });
      return number;
    });
    return { ok: true, data: { number } };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { ok: false, error: "Quotation number already exists — please try again" };
    }
    throw err;
  }
}

async function setQuotationStatus(
  userId: string,
  quotationId: string,
  from: QuotationStatus[],
  to: QuotationStatus,
  action: string,
): Promise<ServiceResult> {
  const { business, quotation } = await getQuotationForUser(userId, quotationId);
  await requireCanWrite(userId, business.id);
  if (!from.includes(quotation.status)) {
    return { ok: false, error: `A ${quotation.status.toLowerCase()} quotation cannot be ${action}` };
  }
  await prisma.$transaction(async (tx) => {
    await tx.quotation.update({
      where: { id: quotation.id },
      data: { status: to },
    });
    await logActivity(tx, {
      businessId: business.id,
      userId,
      action: `quotation.${action}`,
      entityType: "Quotation",
      entityId: quotation.id,
      metadata: { number: quotation.number },
    });
  });
  return { ok: true };
}

export function acceptQuotation(userId: string, quotationId: string) {
  return setQuotationStatus(userId, quotationId, ["SENT"], "ACCEPTED", "accepted");
}

export function rejectQuotation(userId: string, quotationId: string) {
  return setQuotationStatus(userId, quotationId, ["SENT"], "REJECTED", "rejected");
}

export function expireQuotation(userId: string, quotationId: string) {
  return setQuotationStatus(userId, quotationId, ["SENT"], "EXPIRED", "expired");
}

export async function convertQuotationToInvoice(
  userId: string,
  quotationId: string,
): Promise<ServiceResult<{ invoiceId: string }>> {
  const { business, quotation } = await getQuotationForUser(userId, quotationId);
  const membership = await requireMembership(userId, business.id);
  if (!canManageBusiness(membership.role)) {
    throw new TenantError(403, "Only owners and admins can convert quotations");
  }
  if (quotation.convertedInvoiceId) {
    return { ok: false, error: "This quotation has already been converted to an invoice" };
  }
  if (quotation.status !== "SENT" && quotation.status !== "ACCEPTED") {
    return { ok: false, error: "Only a sent or accepted quotation can be converted" };
  }
  if (quotation.items.length === 0) {
    return { ok: false, error: "A quotation needs at least one line item before it can be converted" };
  }

  // The converted invoice is a draft: issue date today, due date the
  // quotation's expiry when it is still in the future, otherwise 30
  // days out. Terms and notes carry over.
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const issueDate = toDateInput(today);
  const dueDate =
    quotation.expiryDate.getTime() >= today.getTime()
      ? toDateInput(quotation.expiryDate)
      : toDateInput(new Date(today.getTime() + 30 * 86_400_000));

  const settings = await prisma.businessSettings.findUnique({
    where: { businessId: business.id },
  });
  const template =
    settings?.pdfTemplate === "modern" || settings?.pdfTemplate === "minimal"
      ? settings.pdfTemplate
      : "classic";
  const locale = settings?.locale === "ar" ? "ar" : "en";

  const input: InvoiceInput = {
    customerId: quotation.customerId,
    issueDate,
    dueDate,
    supplyDate: undefined,
    notes: quotation.notes ?? undefined,
    terms: quotation.terms ?? undefined,
    template,
    locale,
    items: quotation.items.map((item) => ({
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
    })),
  };
  // Validate the mapped input through the invoice schema — a converted
  // invoice must pass exactly the same checks as a hand-built one.
  const validated = invoiceSchema.safeParse(input);
  if (!validated.success) {
    return { ok: false, error: validated.error.issues[0]?.message ?? "Invalid quotation lines" };
  }
  const taxRates = await prisma.taxRate.findMany({
    where: scopeWhere(business.id),
  });
  const computed = computeInvoice(validated.data, taxRates, business.defaultVatRateId);
  if (typeof computed === "string") return { ok: false, error: computed };

  const invoiceId = randomUUID();
  try {
    await prisma.$transaction(async (tx) => {
      // Re-check inside the transaction: two concurrent conversions
      // must not create two invoices for one quotation.
      const fresh = await tx.quotation.findUnique({
        where: { id: quotation.id },
        select: { convertedInvoiceId: true },
      });
      if (!fresh || fresh.convertedInvoiceId) {
        throw new Error("ALREADY_CONVERTED");
      }
      await tx.invoice.create({
        data: invoiceCreateData(
          invoiceId,
          business,
          validated.data,
          computed,
          draftNumber(invoiceId),
        ),
      });
      await tx.quotation.update({
        where: { id: quotation.id },
        data: { status: "ACCEPTED", convertedInvoiceId: invoiceId },
      });
      await logActivity(tx, {
        businessId: business.id,
        userId,
        action: "quotation.converted",
        entityType: "Quotation",
        entityId: quotation.id,
        metadata: {
          number: quotation.number,
          invoiceId,
          grandTotal: computed.totals.grandTotal.toString(),
        },
      });
      await logActivity(tx, {
        businessId: business.id,
        userId,
        action: "invoice.created",
        entityType: "Invoice",
        entityId: invoiceId,
        metadata: {
          number: draftNumber(invoiceId),
          grandTotal: computed.totals.grandTotal.toString(),
          fromQuotation: quotation.number,
        },
      });
    });
  } catch (err) {
    if (err instanceof Error && err.message === "ALREADY_CONVERTED") {
      return { ok: false, error: "This quotation has already been converted to an invoice" };
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { ok: false, error: "This quotation has already been converted to an invoice" };
    }
    throw err;
  }
  return { ok: true, data: { invoiceId } };
}
