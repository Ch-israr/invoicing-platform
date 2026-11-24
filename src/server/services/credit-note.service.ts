import { Prisma } from "@prisma/client";
import Decimal from "decimal.js";
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
import { calculateLine, round2 } from "@/lib/money";
import {
  getInvoiceForUser,
  recomputeInvoiceState,
  type ServiceResult,
} from "./invoice.service";
import { formatCreditNoteNumber } from "@/lib/numbering";
import {
  creditNoteSchema,
  type CreditNoteInput,
} from "@/lib/validation/credit-note";

/**
 * Credit notes — the only way to correct an issued invoice.
 *
 * A credit note reverses part of an invoice, line by line: each line
 * references an invoice item and credits up to its remaining
 * uncredited quantity (already-credited quantities from ISSUED notes
 * are subtracted; cancelled notes don't count). The description, VAT
 * rate and tax-inclusive flag come from the invoice item itself, so a
 * credit can never invent a different rate; unitPrice defaults to
 * the item's price and may only be lowered. Per-line amounts and VAT
 * come from the shared money engine (calculateLine), applying the
 * invoice line's own discount (prorated for FIXED) unless the price
 * was lowered by hand.
 *
 * The note's grandTotal reduces the invoice balance (amountPaid is
 * untouched) and can never exceed the outstanding balance — a fully
 * paid invoice cannot be credited; refund the payment instead. The
 * invoice itself is never edited or deleted. Cancelling a note
 * reverses its balance effect in the same transaction.
 * Numbering: CN-0001 from Business.nextCreditNoteNumber, assigned on
 * creation (credit notes are ISSUED immediately — there is no draft
 * state). A fully-credited invoice keeps its ISSUED/SENT status with
 * balance 0; see recomputeInvoiceState / deriveInvoiceStatus.
 */

export async function createCreditNote(
  userId: string,
  invoiceId: string,
  rawInput: unknown,
): Promise<ServiceResult<{ id: string; number: string }>> {
  const parsed = creditNoteSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { business, invoice } = await getInvoiceForUser(userId, invoiceId);
  await requireCanWrite(userId, business.id);
  if (
    invoice.status !== "ISSUED" &&
    invoice.status !== "SENT" &&
    invoice.status !== "PARTIALLY_PAID"
  ) {
    return { ok: false, error: "Credit notes can only be issued against an outstanding invoice" };
  }
  const input: CreditNoteInput = parsed.data;

  // Resolve every line against the invoice's own items before touching
  // the database: unknown item ids and over-credited quantities fail
  // fast with a clear message.
  const byId = new Map(invoice.items.map((i) => [i.id, i]));
  for (const line of input.items) {
    if (!byId.has(line.invoiceItemId)) {
      return { ok: false, error: "One of the credited lines does not belong to this invoice" };
    }
  }
  // Remaining quantity per invoice item (original − already credited
  // by ISSUED notes). Computed once here for the error message; the
  // transaction re-checks it under the invoice row lock.
  const remainingQty = await creditedQuantities(invoice.id);
  for (const line of input.items) {
    const item = byId.get(line.invoiceItemId)!;
    const remaining = new Decimal(item.quantity.toString()).sub(
      remainingQty.get(line.invoiceItemId) ?? new Decimal(0),
    );
    if (new Decimal(line.quantity).greaterThan(remaining)) {
      return {
        ok: false,
        error: `Cannot credit ${line.quantity} × "${item.description}" — only ${remaining.toString()} remains uncredited`,
      };
    }
    if (line.unitPrice !== undefined) {
      const price = new Decimal(line.unitPrice);
      if (price.greaterThan(new Decimal(item.unitPrice.toString()))) {
        return {
          ok: false,
          error: `Credit price for "${item.description}" cannot exceed the invoiced price`,
        };
      }
    }
  }

  // A credit reverses what the customer actually paid for the line:
  // the invoice item's own discount applies to the credited quantity
  // (a FIXED line discount is prorated by quantity). When the credit
  // price is lowered by hand (goodwill credit), the original discount
  // does not apply on top — the lowered price is the credit.
  const lines = input.items.map((line) => {
    const item = byId.get(line.invoiceItemId)!;
    const priceOverridden =
      line.unitPrice !== undefined &&
      !new Decimal(line.unitPrice).equals(new Decimal(item.unitPrice.toString()));
    const discountValue =
      !priceOverridden && item.discountType === "FIXED"
        ? round2(
            new Decimal(item.discountValue.toString())
              .mul(new Decimal(line.quantity))
              .div(new Decimal(item.quantity.toString())),
          ).toString()
        : item.discountValue.toString();
    const result = calculateLine({
      quantity: line.quantity,
      unitPrice: line.unitPrice ?? item.unitPrice.toString(),
      discountType: priceOverridden ? "NONE" : item.discountType,
      discountValue: priceOverridden ? "0" : discountValue,
      taxRatePercent: item.taxRate,
      taxInclusive: item.taxInclusive,
    });
    return { item, line, result };
  });
  const sum = (pick: (r: (typeof lines)[number]["result"]) => Decimal) =>
    lines.reduce((acc, l) => acc.add(pick(l.result)), new Decimal(0));
  const subtotal = sum((r) => r.netAmount);
  const vatAmount = sum((r) => r.vatAmount);
  const grandTotal = sum((r) => r.lineTotal);

  try {
    const created = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${invoice.id} FOR UPDATE`;
      const current = await tx.invoice.findUnique({
        where: { id: invoice.id },
        select: { balance: true, status: true },
      });
      if (!current) throw new TenantError(404, "Invoice not found");
      if (
        current.status !== "ISSUED" &&
        current.status !== "SENT" &&
        current.status !== "PARTIALLY_PAID"
      ) {
        throw new Error("INVOICE_NOT_CREDITABLE");
      }
      if (grandTotal.greaterThan(new Decimal(current.balance.toString()))) {
        throw new Error("EXCEEDS_BALANCE");
      }
      // Re-check per-line remaining quantities under the lock: a
      // concurrent credit note could have consumed them.
      const freshRemaining = await creditedQuantitiesTx(tx, invoice.id);
      for (const { item, line } of lines) {
        const remaining = new Decimal(item.quantity.toString()).sub(
          freshRemaining.get(line.invoiceItemId) ?? new Decimal(0),
        );
        if (new Decimal(line.quantity).greaterThan(remaining)) {
          throw new Error("QUANTITY_EXCEEDED");
        }
      }
      const updated = await tx.business.update({
        where: { id: business.id },
        data: { nextCreditNoteNumber: { increment: 1 } },
        select: { nextCreditNoteNumber: true },
      });
      const number = formatCreditNoteNumber(updated.nextCreditNoteNumber - 1);
      const note = await tx.creditNote.create({
        data: {
          ...scopeWhere(business.id),
          invoiceId: invoice.id,
          number,
          reason: input.reason,
          subtotal,
          vatAmount,
          grandTotal,
          status: "ISSUED",
          items: {
            create: lines.map(({ item, line, result }) => ({
              invoiceItemId: item.id,
              description: item.description,
              quantity: new Decimal(line.quantity),
              unitPrice: new Decimal(line.unitPrice ?? item.unitPrice.toString()),
              taxRateId: item.taxRateId,
              taxRate: item.taxRate,
              taxCategory: item.taxCategory,
              lineTotal: result.lineTotal,
            })),
          },
        },
      });
      const state = await recomputeInvoiceState(tx, invoice.id);
      await logActivity(tx, {
        businessId: business.id,
        userId,
        action: "credit_note.created",
        entityType: "CreditNote",
        entityId: note.id,
        metadata: {
          invoiceId: invoice.id,
          invoiceNumber: invoice.number,
          number,
          grandTotal: grandTotal.toString(),
          status: state.status,
        },
      });
      return note;
    });
    return { ok: true, data: { id: created.id, number: created.number } };
  } catch (err) {
    if (err instanceof Error) {
      if (err.message === "EXCEEDS_BALANCE") {
        return {
          ok: false,
          error: `Credit of ${grandTotal.toFixed(2)} exceeds the outstanding balance`,
        };
      }
      if (err.message === "QUANTITY_EXCEEDED") {
        return { ok: false, error: "One of the credited lines exceeds its remaining quantity" };
      }
      if (err.message === "INVOICE_NOT_CREDITABLE") {
        return { ok: false, error: "Credit notes can only be issued against an outstanding invoice" };
      }
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { ok: false, error: "Credit note number already exists — please try again" };
    }
    throw err;
  }
}

/** Quantity already credited per invoice item, from ISSUED notes only. */
async function creditedQuantities(
  invoiceId: string,
): Promise<Map<string, Decimal>> {
  const rows = await prisma.creditNoteItem.findMany({
    where: { creditNote: { invoiceId, status: "ISSUED" }, invoiceItemId: { not: null } },
    select: { invoiceItemId: true, quantity: true },
  });
  const map = new Map<string, Decimal>();
  for (const row of rows) {
    if (!row.invoiceItemId) continue;
    const prev = map.get(row.invoiceItemId) ?? new Decimal(0);
    map.set(row.invoiceItemId, prev.add(new Decimal(row.quantity.toString())));
  }
  return map;
}

async function creditedQuantitiesTx(
  tx: Prisma.TransactionClient,
  invoiceId: string,
): Promise<Map<string, Decimal>> {
  const rows = await tx.creditNoteItem.findMany({
    where: { creditNote: { invoiceId, status: "ISSUED" }, invoiceItemId: { not: null } },
    select: { invoiceItemId: true, quantity: true },
  });
  const map = new Map<string, Decimal>();
  for (const row of rows) {
    if (!row.invoiceItemId) continue;
    const prev = map.get(row.invoiceItemId) ?? new Decimal(0);
    map.set(row.invoiceItemId, prev.add(new Decimal(row.quantity.toString())));
  }
  return map;
}

export async function cancelCreditNote(
  userId: string,
  creditNoteId: string,
): Promise<ServiceResult> {
  const business = await getDefaultBusinessForUser(userId);
  if (!business) return { ok: false, error: "No business found" };
  const note = await prisma.creditNote.findFirst({
    where: { id: creditNoteId, ...scopeWhere(business.id) },
    include: { invoice: { select: { id: true, number: true } } },
  });
  if (!note) throw new TenantError(404, "Credit note not found");
  const membership = await requireMembership(userId, business.id);
  if (!canManageBusiness(membership.role)) {
    throw new TenantError(403, "Only owners and admins can cancel credit notes");
  }
  if (note.status !== "ISSUED") {
    return { ok: false, error: "Only an issued credit note can be cancelled" };
  }
  await prisma.$transaction(async (tx) => {
    await tx.creditNote.update({
      where: { id: note.id },
      data: { status: "CANCELLED" },
    });
    await recomputeInvoiceState(tx, note.invoiceId);
    await logActivity(tx, {
      businessId: business.id,
      userId,
      action: "credit_note.cancelled",
      entityType: "CreditNote",
      entityId: note.id,
      metadata: {
        invoiceId: note.invoiceId,
        invoiceNumber: note.invoice.number,
        number: note.number,
        grandTotal: note.grandTotal.toString(),
      },
    });
  });
  return { ok: true };
}

export type CreditNoteFilters = {
  q?: string;
  status?: "ISSUED" | "CANCELLED";
  page?: number;
};

export async function listCreditNotes(userId: string, filters: CreditNoteFilters) {
  const business = await getDefaultBusinessForUser(userId);
  if (!business) {
    return { creditNotes: [], total: 0, page: 1, pageCount: 1 };
  }
  const page = Math.max(1, filters.page ?? 1);
  const where: Prisma.CreditNoteWhereInput = { businessId: business.id };
  if (filters.status) where.status = filters.status;
  if (filters.q) {
    const q = filters.q.trim();
    where.OR = [
      { number: { contains: q, mode: "insensitive" } },
      { invoice: { number: { contains: q, mode: "insensitive" } } },
      { invoice: { customer: { name: { contains: q, mode: "insensitive" } } } },
      { invoice: { customer: { companyName: { contains: q, mode: "insensitive" } } } },
    ];
  }
  const [creditNotes, total] = await Promise.all([
    prisma.creditNote.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        invoice: {
          select: {
            id: true,
            number: true,
            currency: true,
            customer: { select: { id: true, name: true, companyName: true } },
          },
        },
      },
    }),
    prisma.creditNote.count({ where }),
  ]);
  return { creditNotes, total, page, pageCount: calcPageCount(total) };
}

export async function getCreditNoteDetail(userId: string, creditNoteId: string) {
  const business = await getDefaultBusinessForUser(userId);
  if (!business) throw new TenantError(404, "Business not found");
  const note = await prisma.creditNote.findFirst({
    where: { id: creditNoteId, ...scopeWhere(business.id) },
    include: {
      items: true,
      invoice: { include: { customer: true } },
    },
  });
  if (!note) throw new TenantError(404, "Credit note not found");
  const membership = await requireMembership(userId, business.id);
  return {
    business,
    note,
    invoice: note.invoice,
    customer: note.invoice.customer,
    canManage: canManageBusiness(membership.role),
  };
}

/**
 * Form data for crediting an invoice: each line with how much of it
 * is still uncredited (ISSUED notes only). Lines fully credited
 * already are omitted.
 */
export async function getCreditNoteFormData(userId: string, invoiceId: string) {
  const { business, invoice } = await getInvoiceForUser(userId, invoiceId);
  const credited = await creditedQuantities(invoice.id);
  const lines = invoice.items.map((item) => {
    const creditedQty = credited.get(item.id) ?? new Decimal(0);
    const remaining = new Decimal(item.quantity.toString()).sub(creditedQty);
    return {
      id: item.id,
      description: item.description,
      sku: item.sku,
      quantity: item.quantity.toString(),
      unit: item.unit,
      unitPrice: item.unitPrice.toString(),
      taxRate: item.taxRate.toString(),
      taxCategory: item.taxCategory,
      taxInclusive: item.taxInclusive,
      creditedQty: creditedQty.toString(),
      remainingQty: remaining.toString(),
    };
  });
  return { business, invoice, lines };
}
