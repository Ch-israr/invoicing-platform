import { Prisma, type PaymentMethod } from "@prisma/client";
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
import {
  earlyDiscountSaving,
  isWithinEarlyDiscountWindow,
} from "@/lib/money";
import {
  getInvoiceForUser,
  recomputeInvoiceState,
  type ServiceResult,
} from "./invoice.service";
import {
  paymentSchema,
  refundSchema,
  type PaymentInput,
  type RefundInput,
} from "@/lib/validation/payment";

/**
 * Payments, refunds, receipts.
 *
 * A payment is money received against ONE invoice (the allocation row
 * exists so a split across invoices can be added later without a
 * schema change). Recording, deleting and refunding all run in a
 * transaction that re-reads the invoice balance under a row lock and
 * then recomputes amountPaid / balance / status from the ledger, so
 * the invoice can never disagree with its payments — and two
 * concurrent payments can never overpay it.
 *
 * Overpayment is rejected: a payment may never exceed the outstanding
 * balance (grand total − net paid − issued credits). A refund is
 * money returned: it reduces the net paid amount and moves the
 * invoice status back. Payments and refunds are never edited — a
 * wrong payment is deleted (OWNER/ADMIN) or refunded.
 */

function toDate(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

/** Lock the invoice row for the transaction (serialises balance checks). */
async function lockInvoice(tx: Prisma.TransactionClient, invoiceId: string) {
  await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${invoiceId} FOR UPDATE`;
}

export async function recordPayment(
  userId: string,
  invoiceId: string,
  rawInput: unknown,
): Promise<ServiceResult<{ id: string }>> {
  const parsed = paymentSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { business, invoice } = await getInvoiceForUser(userId, invoiceId);
  await requireCanWrite(userId, business.id);
  if (invoice.status === "DRAFT" || invoice.status === "CANCELLED") {
    return { ok: false, error: "Payments can only be recorded against an issued invoice" };
  }
  const input: PaymentInput = parsed.data;
  const amount = new Decimal(input.amount);

  const outcome = await prisma.$transaction(async (tx) => {
    await lockInvoice(tx, invoice.id);
    const current = await tx.invoice.findUnique({
      where: { id: invoice.id },
      select: { balance: true },
    });
    if (!current) return { ok: false as const, error: "Invoice not found" };
    const balance = new Decimal(current.balance.toString());
    // Early-payment discount: the saving is recomputed here from the
    // invoice row and the balance re-read under the lock — the client
    // never decides the discount amount. The discount does NOT reduce
    // the invoice total; it is granted on this payment, so paying
    // (balance − saving) with the box ticked settles the invoice.
    // Eligibility is judged against TODAY, not the payment date.
    let earlyDiscountAmount = new Decimal(0);
    if (input.applyEarlyDiscount) {
      if (invoice.earlyDiscountType === "NONE") {
        return { ok: false as const, error: "This invoice has no early-payment discount" };
      }
      if (!isWithinEarlyDiscountWindow(invoice.issueDate, invoice.earlyDiscountDays)) {
        return { ok: false as const, error: "The early-payment discount window has expired" };
      }
      const saving = earlyDiscountSaving(
        balance,
        invoice.earlyDiscountType,
        invoice.earlyDiscountValue,
      );
      if (saving.lessThanOrEqualTo(0)) {
        return { ok: false as const, error: "The early-payment discount is zero on the remaining balance" };
      }
      if (saving.greaterThanOrEqualTo(balance)) {
        return { ok: false as const, error: "The early-payment discount would cover the whole balance — record a smaller discount instead" };
      }
      earlyDiscountAmount = saving;
    }
    const payable = balance.sub(earlyDiscountAmount);
    if (amount.greaterThan(payable)) {
      return {
        ok: false as const,
        error: `Payment of ${amount.toFixed(2)} exceeds the outstanding balance of ${payable.toFixed(2)}${earlyDiscountAmount.greaterThan(0) ? " after the early-payment discount" : ""}`,
      };
    }
    // The saving is a % (or fixed amount) of the whole remaining
    // balance, so it can only be granted on a payment that settles
    // the invoice — granting it on a partial payment would let a
    // small payment take the whole discount. The dialog auto-fills
    // the settling amount when the box is ticked.
    if (earlyDiscountAmount.greaterThan(0) && amount.lessThan(payable)) {
      return {
        ok: false as const,
        error: `The early-payment discount of ${earlyDiscountAmount.toFixed(2)} applies when paying the full remaining balance of ${payable.toFixed(2)} — untick the discount to record a partial payment`,
      };
    }
    const created = await tx.payment.create({
      data: {
        ...scopeWhere(business.id),
        invoiceId: invoice.id,
        date: toDate(input.date),
        amount,
        currency: invoice.currency,
        method: input.method,
        reference: input.reference ?? null,
        notes: input.notes ?? null,
        earlyDiscountAmount,
        createdById: userId,
      },
    });
    await tx.paymentAllocation.create({
      data: { paymentId: created.id, invoiceId: invoice.id, amount },
    });
    const state = await recomputeInvoiceState(tx, invoice.id);
    await logActivity(tx, {
      businessId: business.id,
      userId,
      action: "payment.recorded",
      entityType: "Payment",
      entityId: created.id,
      metadata: {
        invoiceId: invoice.id,
        number: invoice.number,
        amount: amount.toString(),
        method: input.method,
        earlyDiscountAmount: earlyDiscountAmount.toString(),
        status: state.status,
      },
    });
    return { ok: true as const, id: created.id };
  });
  return outcome.ok ? { ok: true, data: { id: outcome.id } } : outcome;
}

export async function deletePayment(
  userId: string,
  paymentId: string,
): Promise<ServiceResult> {
  const business = await getDefaultBusinessForUser(userId);
  if (!business) return { ok: false, error: "No business found" };
  const payment = await prisma.payment.findFirst({
    where: { id: paymentId, ...scopeWhere(business.id) },
    include: {
      refunds: { select: { id: true } },
      invoice: { select: { id: true, number: true } },
    },
  });
  if (!payment) throw new TenantError(404, "Payment not found");
  const membership = await requireMembership(userId, business.id);
  if (!canManageBusiness(membership.role)) {
    throw new TenantError(403, "Only owners and admins can delete payments");
  }
  if (payment.refunds.length > 0) {
    return { ok: false, error: "This payment has refunds and cannot be deleted. Refund it instead." };
  }
  await prisma.$transaction(async (tx) => {
    await lockInvoice(tx, payment.invoiceId);
    // Allocations cascade-delete with the payment.
    await tx.payment.delete({ where: { id: payment.id } });
    await recomputeInvoiceState(tx, payment.invoiceId);
    await logActivity(tx, {
      businessId: business.id,
      userId,
      action: "payment.deleted",
      entityType: "Payment",
      entityId: payment.id,
      metadata: {
        invoiceId: payment.invoiceId,
        number: payment.invoice.number,
        amount: payment.amount.toString(),
      },
    });
  });
  return { ok: true };
}

export async function recordRefund(
  userId: string,
  paymentId: string,
  rawInput: unknown,
): Promise<ServiceResult<{ id: string }>> {
  const parsed = refundSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const business = await getDefaultBusinessForUser(userId);
  if (!business) return { ok: false, error: "No business found" };
  const payment = await prisma.payment.findFirst({
    where: { id: paymentId, ...scopeWhere(business.id) },
    include: {
      refunds: { select: { amount: true } },
      invoice: { select: { id: true, number: true } },
    },
  });
  if (!payment) throw new TenantError(404, "Payment not found");
  const membership = await requireMembership(userId, business.id);
  if (!canManageBusiness(membership.role)) {
    throw new TenantError(403, "Only owners and admins can record refunds");
  }
  const input: RefundInput = parsed.data;
  const amount = new Decimal(input.amount);
  const refundedSoFar = payment.refunds.reduce(
    (acc, r) => acc.add(new Decimal(r.amount.toString())),
    new Decimal(0),
  );
  const remaining = new Decimal(payment.amount.toString()).sub(refundedSoFar);
  if (amount.greaterThan(remaining)) {
    return {
      ok: false,
      error: `Refund of ${amount.toFixed(2)} exceeds the unrefunded amount of ${remaining.toFixed(2)} for this payment`,
    };
  }

  const refund = await prisma.$transaction(async (tx) => {
    await lockInvoice(tx, payment.invoiceId);
    const created = await tx.refund.create({
      data: {
        paymentId: payment.id,
        amount,
        reason: input.reason,
        date: toDate(input.date),
      },
    });
    const state = await recomputeInvoiceState(tx, payment.invoiceId);
    await logActivity(tx, {
      businessId: business.id,
      userId,
      action: "payment.refunded",
      entityType: "Refund",
      entityId: created.id,
      metadata: {
        paymentId: payment.id,
        invoiceId: payment.invoiceId,
        number: payment.invoice.number,
        amount: amount.toString(),
        status: state.status,
      },
    });
    return created;
  });
  return { ok: true, data: { id: refund.id } };
}

export type PaymentFilters = {
  q?: string;
  method?: PaymentMethod;
  page?: number;
};

export async function listPayments(userId: string, filters: PaymentFilters) {
  const business = await getDefaultBusinessForUser(userId);
  if (!business) {
    return { payments: [], total: 0, page: 1, pageCount: 1 };
  }
  const page = Math.max(1, filters.page ?? 1);
  const where: Prisma.PaymentWhereInput = { businessId: business.id };
  if (filters.method) where.method = filters.method;
  if (filters.q) {
    const q = filters.q.trim();
    where.OR = [
      { invoice: { number: { contains: q, mode: "insensitive" } } },
      { invoice: { customer: { name: { contains: q, mode: "insensitive" } } } },
      { invoice: { customer: { companyName: { contains: q, mode: "insensitive" } } } },
      { reference: { contains: q, mode: "insensitive" } },
    ];
  }
  const [payments, total] = await Promise.all([
    prisma.payment.findMany({
      where,
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        invoice: {
          select: {
            id: true,
            number: true,
            customer: { select: { id: true, name: true, companyName: true } },
          },
        },
        refunds: { select: { amount: true } },
      },
    }),
    prisma.payment.count({ where }),
  ]);
  return {
    payments: payments.map((p) => ({
      ...p,
      refunded: p.refunds.reduce(
        (acc, r) => acc.add(new Decimal(r.amount.toString())),
        new Decimal(0),
      ),
    })),
    total,
    page,
    pageCount: calcPageCount(total),
  };
}

/** Everything the receipt page needs: the payment, its invoice and the ledger state. */
export async function getReceiptData(userId: string, paymentId: string) {
  const business = await getDefaultBusinessForUser(userId);
  if (!business) throw new TenantError(404, "Business not found");
  const payment = await prisma.payment.findFirst({
    where: { id: paymentId, ...scopeWhere(business.id) },
    include: {
      refunds: { orderBy: { date: "desc" } },
      invoice: {
        include: {
          customer: true,
          payments: { include: { refunds: { select: { amount: true } } } },
          creditNotes: {
            where: { status: "ISSUED" },
            select: { grandTotal: true },
          },
        },
      },
    },
  });
  if (!payment) throw new TenantError(404, "Payment not found");
  const invoice = payment.invoice;
  // Same ledger rule as readInvoicePaymentState: an early-payment
  // discount granted on a payment counts toward the total paid.
  const totalPaid = invoice.payments.reduce(
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
  const credited = invoice.creditNotes.reduce(
    (acc, c) => acc.add(new Decimal(c.grandTotal.toString())),
    new Decimal(0),
  );
  return {
    business,
    payment,
    invoice,
    customer: invoice.customer,
    refundedTotal: payment.refunds.reduce(
      (acc, r) => acc.add(new Decimal(r.amount.toString())),
      new Decimal(0),
    ),
    totalPaid,
    credited,
    balance: new Decimal(invoice.balance.toString()),
  };
}
