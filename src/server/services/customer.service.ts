import { Prisma, type InvoiceStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  getDefaultBusinessForUser,
  requireCanWrite,
  requireMembership,
  scopeWhere,
  TenantError,
} from "@/lib/tenant";
import { logActivity } from "@/lib/activity";
import { toCsv } from "@/lib/csv";
import { PAGE_SIZE } from "@/lib/pagination";
import { customerSchema, type CustomerInput } from "@/lib/validation/customer";

export type ServiceResult<T = void> =
  | ({ ok: true } & (T extends void ? object : { data: T }))
  | { ok: false; error: string };

const OPEN_INVOICE_STATUSES: InvoiceStatus[] = [
  "ISSUED",
  "SENT",
  "PARTIALLY_PAID",
];
const BILLED_STATUSES: InvoiceStatus[] = [
  "ISSUED",
  "SENT",
  "PARTIALLY_PAID",
  "PAID",
];

/** Resolve a customer id through the user's business — 404, never a leak. */
export async function getCustomerForUser(userId: string, customerId: string) {
  const business = await getDefaultBusinessForUser(userId);
  if (!business) throw new TenantError(404, "Business not found");
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, ...scopeWhere(business.id) },
  });
  if (!customer) throw new TenantError(404, "Customer not found");
  return { business, customer };
}

export type CustomerFilters = {
  q?: string;
  type?: "INDIVIDUAL" | "COMPANY";
  status?: "ACTIVE" | "INACTIVE";
  page?: number;
};

export async function listCustomers(userId: string, filters: CustomerFilters) {
  const business = await getDefaultBusinessForUser(userId);
  if (!business) {
    return { customers: [], total: 0, page: 1, pageCount: 1 };
  }
  const page = Math.max(1, filters.page ?? 1);
  const where: Prisma.CustomerWhereInput = { businessId: business.id };
  if (filters.type) where.type = filters.type;
  if (filters.status) where.status = filters.status;
  if (filters.q) {
    const q = filters.q.trim();
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { companyName: { contains: q, mode: "insensitive" } },
      { email: { contains: q, mode: "insensitive" } },
    ];
  }
  const [customers, total] = await Promise.all([
    prisma.customer.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.customer.count({ where }),
  ]);
  return { customers, total, page, pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}

export async function createCustomer(
  userId: string,
  rawInput: unknown,
): Promise<ServiceResult<{ id: string }>> {
  const parsed = customerSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const business = await getDefaultBusinessForUser(userId);
  if (!business) return { ok: false, error: "No business found" };
  await requireCanWrite(userId, business.id);
  const input: CustomerInput = parsed.data;
  const customer = await prisma.$transaction(async (tx) => {
    const created = await tx.customer.create({
      data: {
        ...scopeWhere(business.id),
        type: input.type,
        name: input.name,
        companyName: input.companyName ?? null,
        email: input.email ?? null,
        phone: input.phone ?? null,
        billingAddress: input.billingAddress ?? null,
        shippingAddress: input.shippingAddress ?? null,
        country: input.country,
        trn: input.trn ?? null,
        notes: input.notes ?? null,
        status: input.status,
      },
    });
    await logActivity(tx, {
      businessId: business.id,
      userId,
      action: "customer.created",
      entityType: "Customer",
      entityId: created.id,
      metadata: { name: created.name },
    });
    return created;
  });
  return { ok: true, data: { id: customer.id } };
}

export async function updateCustomer(
  userId: string,
  customerId: string,
  rawInput: unknown,
): Promise<ServiceResult> {
  const parsed = customerSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { business, customer } = await getCustomerForUser(userId, customerId);
  await requireCanWrite(userId, business.id);
  const input: CustomerInput = parsed.data;
  await prisma.$transaction(async (tx) => {
    await tx.customer.update({
      where: { id: customer.id },
      data: {
        type: input.type,
        name: input.name,
        companyName: input.companyName ?? null,
        email: input.email ?? null,
        phone: input.phone ?? null,
        billingAddress: input.billingAddress ?? null,
        shippingAddress: input.shippingAddress ?? null,
        country: input.country,
        trn: input.trn ?? null,
        notes: input.notes ?? null,
        status: input.status,
      },
    });
    await logActivity(tx, {
      businessId: business.id,
      userId,
      action: "customer.updated",
      entityType: "Customer",
      entityId: customer.id,
      metadata: { name: input.name },
    });
  });
  return { ok: true };
}

export async function deleteCustomer(
  userId: string,
  customerId: string,
): Promise<ServiceResult> {
  const { business, customer } = await getCustomerForUser(userId, customerId);
  await requireCanWrite(userId, business.id);
  const [invoiceCount, quotationCount, recurringCount] = await Promise.all([
    prisma.invoice.count({ where: { customerId: customer.id } }),
    prisma.quotation.count({ where: { customerId: customer.id } }),
    prisma.recurringInvoice.count({ where: { customerId: customer.id } }),
  ]);
  if (invoiceCount + quotationCount + recurringCount > 0) {
    return {
      ok: false,
      error:
        "This customer has invoices, quotations or recurring billing and cannot be deleted. Set the customer to Inactive instead.",
    };
  }
  await prisma.$transaction(async (tx) => {
    await tx.customer.delete({ where: { id: customer.id } });
    await logActivity(tx, {
      businessId: business.id,
      userId,
      action: "customer.deleted",
      entityType: "Customer",
      entityId: customer.id,
      metadata: { name: customer.name },
    });
  });
  return { ok: true };
}

/**
 * Customer detail: totals computed from real invoice/payment rows.
 * Overdue is derived (open invoice, due date past, balance > 0).
 */
export async function getCustomerDetail(userId: string, customerId: string) {
  const { business, customer } = await getCustomerForUser(userId, customerId);
  await requireMembership(userId, business.id);
  const now = new Date();
  const [totals, overdue, invoices, payments, creditNotes] = await Promise.all([
    prisma.invoice.aggregate({
      where: { businessId: business.id, customerId: customer.id, status: { in: BILLED_STATUSES } },
      _sum: { grandTotal: true, amountPaid: true, balance: true },
      _count: true,
    }),
    prisma.invoice.aggregate({
      where: {
        businessId: business.id,
        customerId: customer.id,
        status: { in: OPEN_INVOICE_STATUSES },
        dueDate: { lt: now },
        balance: { gt: 0 },
      },
      _sum: { balance: true },
      _count: true,
    }),
    prisma.invoice.findMany({
      where: { businessId: business.id, customerId: customer.id },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, number: true, status: true, issueDate: true, dueDate: true, grandTotal: true, balance: true },
    }),
    prisma.payment.findMany({
      where: { businessId: business.id, invoice: { customerId: customer.id } },
      orderBy: { date: "desc" },
      take: 20,
      select: { id: true, date: true, amount: true, method: true, reference: true, invoice: { select: { number: true } } },
    }),
    prisma.creditNote.findMany({
      where: { businessId: business.id, invoice: { customerId: customer.id } },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, number: true, status: true, grandTotal: true, createdAt: true, invoice: { select: { number: true } } },
    }),
  ]);
  return {
    business,
    customer,
    stats: {
      invoiceCount: totals._count,
      totalBilled: totals._sum.grandTotal ?? new Prisma.Decimal(0),
      totalPaid: totals._sum.amountPaid ?? new Prisma.Decimal(0),
      outstanding: totals._sum.balance ?? new Prisma.Decimal(0),
      overdueBalance: overdue._sum.balance ?? new Prisma.Decimal(0),
      overdueCount: overdue._count,
    },
    invoices,
    payments,
    creditNotes,
  };
}

export async function exportCustomersCsv(userId: string): Promise<string> {
  const business = await getDefaultBusinessForUser(userId);
  if (!business) throw new TenantError(404, "Business not found");
  await requireMembership(userId, business.id);
  const customers = await prisma.customer.findMany({
    where: scopeWhere(business.id),
    orderBy: { name: "asc" },
  });
  return toCsv(
    ["Type", "Name", "Company", "Email", "Phone", "Billing Address", "Shipping Address", "Country", "TRN", "Status", "Notes"],
    customers.map((c) => [
      c.type, c.name, c.companyName, c.email, c.phone, c.billingAddress,
      c.shippingAddress, c.country, c.trn, c.status, c.notes,
    ]),
  );
}
