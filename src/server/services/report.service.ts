import Decimal from "decimal.js";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  getDefaultBusinessForUser,
  requireMembership,
  TenantError,
} from "@/lib/tenant";
import { daysOverdue } from "@/server/services/invoice.service";

/**
 * Reports — every figure is computed from the ledger tables
 * (Invoice / InvoiceItem / Payment / CreditNote / Expense), never
 * from cached totals, so each report ties exactly to the underlying
 * invoices and payments. All money is Decimal; totals are rounded
 * half-up to 2dp only at display time (the stored values already are).
 *
 * Statuses:
 * - BILLED = ISSUED, SENT, PARTIALLY_PAID, PAID (issued, never voided)
 * - OPEN   = ISSUED, SENT, PARTIALLY_PAID (still has a balance)
 */

const BILLED_STATUSES = ["ISSUED", "SENT", "PARTIALLY_PAID", "PAID"] as const;
const OPEN_STATUSES = ["ISSUED", "SENT", "PARTIALLY_PAID"] as const;

export type DateRange = { from: Date; to: Date };

/** Inclusive day range from `YYYY-MM-DD` query params. Defaults to the current month. */
export function parseDateRange(query: {
  from?: string;
  to?: string;
}): DateRange {
  const today = new Date();
  const firstOfMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const parse = (s: string | undefined, fallback: Date): Date => {
    if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return fallback;
    const d = new Date(`${s}T00:00:00.000Z`);
    return Number.isNaN(d.getTime()) ? fallback : d;
  };
  let from = parse(query.from, firstOfMonth);
  let to = parse(query.to, today);
  if (from > to) [from, to] = [to, from];
  return { from, to };
}

/** Exclusive upper bound for a `to` day (start of the next day). */
export function rangeEndExclusive(to: Date): Date {
  return new Date(to.getTime() + 86_400_000);
}

export function toIsoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function dec(value: unknown): Decimal {
  if (value === null || value === undefined) return new Decimal(0);
  return new Decimal(value.toString());
}

function decOrZero(value: Decimal | null): Decimal {
  return value === null ? new Decimal(0) : value;
}

async function businessIdFor(userId: string): Promise<string> {
  const business = await getDefaultBusinessForUser(userId);
  if (!business) throw new TenantError(404, "Business not found");
  await requireMembership(userId, business.id);
  return business.id;
}

// ---------------------------------------------------------------------------
// Monthly series (raw SQL date_trunc — aggregation stays in Postgres)
// ---------------------------------------------------------------------------

type MonthRow = { month: Date; total: unknown };

async function monthlySums(
  businessId: string,
  table: "Invoice" | "Payment" | "Expense" | "CreditNote",
  dateColumn: "issueDate" | "date" | "createdAt",
  sumColumn: "grandTotal" | "amount" | "vatAmount",
  range: DateRange,
  extraWhere: Prisma.Sql = Prisma.empty,
): Promise<Array<{ month: string; total: Decimal }>> {
  const end = rangeEndExclusive(range.to);
  const rows = await prisma.$queryRaw<MonthRow[]>(Prisma.sql`
    SELECT date_trunc('month', ${Prisma.raw(`"${dateColumn}"`)}) AS month,
           SUM(${Prisma.raw(`"${sumColumn}"`)}) AS total
    FROM ${Prisma.raw(`"${table}"`)}
    WHERE "businessId" = ${businessId}
      AND ${Prisma.raw(`"${dateColumn}"`)} >= ${range.from}
      AND ${Prisma.raw(`"${dateColumn}"`)} < ${end}
      ${extraWhere}
    GROUP BY 1 ORDER BY 1
  `);
  return rows.map((r) => ({ month: monthKey(new Date(r.month)), total: dec(r.total) }));
}

/** Align invoiced/paid monthly series into one row per month (pure). */
export function mergeMonthlySeries(
  invoiced: Array<{ month: string; total: Decimal }>,
  paid: Array<{ month: string; total: Decimal }>,
): Array<{ month: string; invoiced: Decimal; paid: Decimal }> {
  const months = new Set([...invoiced.map((r) => r.month), ...paid.map((r) => r.month)]);
  const byMonth = new Map<string, { invoiced: Decimal; paid: Decimal }>();
  for (const m of months) byMonth.set(m, { invoiced: new Decimal(0), paid: new Decimal(0) });
  for (const r of invoiced) byMonth.get(r.month)!.invoiced = r.total;
  for (const r of paid) byMonth.get(r.month)!.paid = r.total;
  return [...byMonth.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([month, v]) => ({ month, ...v }));
}

// ---------------------------------------------------------------------------
// Revenue
// ---------------------------------------------------------------------------

export type RevenueReport = {
  range: DateRange;
  invoiced: Decimal;
  invoicedCount: number;
  paid: Decimal;
  paidCount: number;
  credited: Decimal;
  outstanding: Decimal;
  monthly: Array<{ month: string; invoiced: Decimal; paid: Decimal }>;
};

export async function getRevenueReport(
  userId: string,
  range: DateRange,
): Promise<RevenueReport> {
  const businessId = await businessIdFor(userId);
  const end = rangeEndExclusive(range.to);
  const [invoicedAgg, paidAgg, creditedAgg, outstandingAgg, invoicedMonthly, paidMonthly] =
    await Promise.all([
      prisma.invoice.aggregate({
        where: {
          businessId,
          status: { in: [...BILLED_STATUSES] },
          issueDate: { gte: range.from, lt: end },
        },
        _sum: { grandTotal: true },
        _count: true,
      }),
      prisma.payment.aggregate({
        where: { businessId, date: { gte: range.from, lt: end } },
        _sum: { amount: true },
        _count: true,
      }),
      prisma.creditNote.aggregate({
        where: {
          businessId,
          status: "ISSUED",
          createdAt: { gte: range.from, lt: end },
        },
        _sum: { grandTotal: true },
      }),
      prisma.invoice.aggregate({
        where: {
          businessId,
          status: { in: [...OPEN_STATUSES] },
          issueDate: { gte: range.from, lt: end },
          balance: { gt: 0 },
        },
        _sum: { balance: true },
      }),
      monthlySums(businessId, "Invoice", "issueDate", "grandTotal", range, Prisma.sql`AND "status" IN ('ISSUED','SENT','PARTIALLY_PAID','PAID')`),
      monthlySums(businessId, "Payment", "date", "amount", range),
    ]);
  return {
    range,
    invoiced: decOrZero(invoicedAgg._sum.grandTotal),
    invoicedCount: invoicedAgg._count,
    paid: decOrZero(paidAgg._sum.amount),
    paidCount: paidAgg._count,
    credited: decOrZero(creditedAgg._sum.grandTotal),
    outstanding: decOrZero(outstandingAgg._sum.balance),
    monthly: mergeMonthlySeries(invoicedMonthly, paidMonthly),
  };
}

// ---------------------------------------------------------------------------
// VAT
// ---------------------------------------------------------------------------

export type VatReport = {
  range: DateRange;
  outputVat: Decimal;
  inputVat: Decimal;
  netVat: Decimal;
  monthly: Array<{ month: string; outputVat: Decimal; inputVat: Decimal }>;
};

/** Net VAT payable = output VAT on issued invoices − input VAT on expenses (pure). */
export function computeVatNet(outputVat: Decimal, inputVat: Decimal): Decimal {
  return new Decimal(outputVat).sub(new Decimal(inputVat));
}

export async function getVatReport(userId: string, range: DateRange): Promise<VatReport> {
  const businessId = await businessIdFor(userId);
  const end = rangeEndExclusive(range.to);
  const [outputAgg, inputAgg, outputMonthly, inputMonthly] = await Promise.all([
    prisma.invoice.aggregate({
      where: {
        businessId,
        status: { in: [...BILLED_STATUSES] },
        issueDate: { gte: range.from, lt: end },
      },
      _sum: { vatAmount: true },
    }),
    prisma.expense.aggregate({
      where: { businessId, date: { gte: range.from, lt: end } },
      _sum: { vatAmount: true },
    }),
    monthlySums(businessId, "Invoice", "issueDate", "vatAmount", range, Prisma.sql`AND "status" IN ('ISSUED','SENT','PARTIALLY_PAID','PAID')`),
    monthlySums(businessId, "Expense", "date", "vatAmount", range),
  ]);
  const outputVat = decOrZero(outputAgg._sum.vatAmount);
  const inputVat = decOrZero(inputAgg._sum.vatAmount);
  const months = new Set([...outputMonthly.map((r) => r.month), ...inputMonthly.map((r) => r.month)]);
  const monthly = [...months].sort().map((month) => ({
    month,
    outputVat: outputMonthly.find((r) => r.month === month)?.total ?? new Decimal(0),
    inputVat: inputMonthly.find((r) => r.month === month)?.total ?? new Decimal(0),
  }));
  return { range, outputVat, inputVat, netVat: computeVatNet(outputVat, inputVat), monthly };
}

// ---------------------------------------------------------------------------
// Overdue
// ---------------------------------------------------------------------------

export type OverdueRow = {
  invoiceId: string;
  number: string;
  customerName: string;
  dueDate: Date;
  daysOverdue: number;
  balance: Decimal;
};

/** A date truncated to UTC midnight. Due-date comparisons use day
 * granularity everywhere, so an invoice due today is never overdue. */
export function startOfTodayUTC(now = new Date()): Date {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export async function getOverdueReport(
  userId: string,
  now = new Date(),
): Promise<{ rows: OverdueRow[]; totalBalance: Decimal; count: number }> {
  const businessId = await businessIdFor(userId);
  const invoices = await prisma.invoice.findMany({
    where: {
      businessId,
      status: { in: [...OPEN_STATUSES] },
      // Day granularity, matching isInvoiceOverdue: an invoice due
      // today is not overdue, even if "now" is later in the day.
      dueDate: { lt: startOfTodayUTC(now) },
      balance: { gt: 0 },
    },
    orderBy: { dueDate: "asc" },
    include: { customer: { select: { name: true, companyName: true } } },
  });
  const rows: OverdueRow[] = invoices.map((inv) => ({
    invoiceId: inv.id,
    number: inv.number,
    customerName: inv.customer.companyName ?? inv.customer.name,
    dueDate: inv.dueDate,
    daysOverdue: daysOverdue(inv.dueDate, now),
    balance: new Decimal(inv.balance.toString()),
  }));
  const totalBalance = rows.reduce((acc, r) => acc.add(r.balance), new Decimal(0));
  return { rows, totalBalance, count: rows.length };
}

// ---------------------------------------------------------------------------
// A/R aging — open invoices bucketed by days overdue
// ---------------------------------------------------------------------------

/** A/R aging buckets, by whole days overdue (0 = not yet due). */
export type AgingBucketKey = "current" | "1-30" | "31-60" | "61-90" | "90+";

export const AGING_BUCKETS: Array<{ key: AgingBucketKey; label: string }> = [
  { key: "current", label: "Current (not yet due)" },
  { key: "1-30", label: "1–30 days" },
  { key: "31-60", label: "31–60 days" },
  { key: "61-90", label: "61–90 days" },
  { key: "90+", label: "90+ days" },
];

/** Pure: which bucket a days-overdue count falls in. */
export function bucketForDaysOverdue(days: number): AgingBucketKey {
  if (days <= 0) return "current";
  if (days <= 30) return "1-30";
  if (days <= 60) return "31-60";
  if (days <= 90) return "61-90";
  return "90+";
}

export type AgingRow = {
  invoiceId: string;
  number: string;
  customerName: string;
  dueDate: Date;
  daysOverdue: number;
  balance: Decimal;
  bucket: AgingBucketKey;
};

export type AgingBucketSummary = {
  key: AgingBucketKey;
  label: string;
  count: number;
  total: Decimal;
};

export type AgingReport = {
  buckets: AgingBucketSummary[];
  rows: AgingRow[];
  /** Total outstanding across all buckets. */
  totalOutstanding: Decimal;
  /** Total in the overdue buckets (1–30 and older) — this must agree
   * with getOverdueReport's totalBalance on the same data. */
  overdueTotal: Decimal;
  count: number;
};

/**
 * Open invoices with a balance, bucketed by due date vs today.
 * The overdue buckets use the same definition of outstanding balance
 * as getOverdueReport, so the two reports agree.
 */
export async function getAgingReport(
  userId: string,
  now = new Date(),
): Promise<AgingReport> {
  const businessId = await businessIdFor(userId);
  const invoices = await prisma.invoice.findMany({
    where: {
      businessId,
      status: { in: [...OPEN_STATUSES] },
      balance: { gt: 0 },
    },
    orderBy: { dueDate: "asc" },
    include: { customer: { select: { name: true, companyName: true } } },
  });
  const rows: AgingRow[] = invoices.map((inv) => {
    const days = daysOverdue(inv.dueDate, now);
    return {
      invoiceId: inv.id,
      number: inv.number,
      customerName: inv.customer.companyName ?? inv.customer.name,
      dueDate: inv.dueDate,
      daysOverdue: days,
      balance: new Decimal(inv.balance.toString()),
      bucket: bucketForDaysOverdue(days),
    };
  });
  const buckets: AgingBucketSummary[] = AGING_BUCKETS.map(({ key, label }) => {
    const inBucket = rows.filter((r) => r.bucket === key);
    return {
      key,
      label,
      count: inBucket.length,
      total: inBucket.reduce((acc, r) => acc.add(r.balance), new Decimal(0)),
    };
  });
  const totalOutstanding = rows.reduce((acc, r) => acc.add(r.balance), new Decimal(0));
  const overdueTotal = rows
    .filter((r) => r.bucket !== "current")
    .reduce((acc, r) => acc.add(r.balance), new Decimal(0));
  return { buckets, rows, totalOutstanding, overdueTotal, count: rows.length };
}

// ---------------------------------------------------------------------------
// Customer balances (pure row builder, unit-tested)
// ---------------------------------------------------------------------------

export type CustomerBalanceRow = {
  customerId: string;
  customerName: string;
  invoiced: Decimal;
  paid: Decimal;
  credited: Decimal;
  outstanding: Decimal;
};

export function buildCustomerBalanceRows(input: {
  customers: Array<{ id: string; name: string }>;
  invoicedByCustomer: Map<string, Decimal>;
  paidByCustomer: Map<string, Decimal>;
  creditedByCustomer: Map<string, Decimal>;
  outstandingByCustomer: Map<string, Decimal>;
}): CustomerBalanceRow[] {
  const rows = input.customers.map((c) => ({
    customerId: c.id,
    customerName: c.name,
    invoiced: input.invoicedByCustomer.get(c.id) ?? new Decimal(0),
    paid: input.paidByCustomer.get(c.id) ?? new Decimal(0),
    credited: input.creditedByCustomer.get(c.id) ?? new Decimal(0),
    outstanding: input.outstandingByCustomer.get(c.id) ?? new Decimal(0),
  }));
  rows.sort((a, b) => b.outstanding.comparedTo(a.outstanding));
  return rows;
}

export async function getCustomerBalances(
  userId: string,
  range: DateRange,
): Promise<{ rows: CustomerBalanceRow[]; totals: CustomerBalanceRow }> {
  const businessId = await businessIdFor(userId);
  const end = rangeEndExclusive(range.to);
  const [invoicedGroups, paidGroups, creditedGroups, outstandingGroups] = await Promise.all([
    prisma.invoice.groupBy({
      by: ["customerId"],
      where: {
        businessId,
        status: { in: [...BILLED_STATUSES] },
        issueDate: { gte: range.from, lt: end },
      },
      _sum: { grandTotal: true },
    }),
    prisma.payment.groupBy({
      by: ["invoiceId"],
      where: { businessId, date: { gte: range.from, lt: end } },
      _sum: { amount: true },
    }),
    prisma.creditNote.groupBy({
      by: ["invoiceId"],
      where: { businessId, status: "ISSUED", createdAt: { gte: range.from, lt: end } },
      _sum: { grandTotal: true },
    }),
    prisma.invoice.groupBy({
      by: ["customerId"],
      where: { businessId, status: { in: [...OPEN_STATUSES] }, balance: { gt: 0 } },
      _sum: { balance: true },
    }),
  ]);
  // Payments and credit notes are grouped by invoice — resolve invoice → customer once.
  const invoiceIds = [...new Set([...paidGroups.map((g) => g.invoiceId), ...creditedGroups.map((g) => g.invoiceId)])];
  const invoices = invoiceIds.length
    ? await prisma.invoice.findMany({
        where: { id: { in: invoiceIds } },
        select: { id: true, customerId: true },
      })
    : [];
  const customerByInvoice = new Map(invoices.map((i) => [i.id, i.customerId]));
  const sumInto = (map: Map<string, Decimal>, key: string | undefined, value: Decimal | null) => {
    if (!key || value === null) return;
    map.set(key, (map.get(key) ?? new Decimal(0)).add(value));
  };
  const invoicedByCustomer = new Map<string, Decimal>();
  for (const g of invoicedGroups) sumInto(invoicedByCustomer, g.customerId, g._sum.grandTotal);
  const paidByCustomer = new Map<string, Decimal>();
  for (const g of paidGroups) sumInto(paidByCustomer, customerByInvoice.get(g.invoiceId), g._sum.amount);
  const creditedByCustomer = new Map<string, Decimal>();
  for (const g of creditedGroups) sumInto(creditedByCustomer, customerByInvoice.get(g.invoiceId), g._sum.grandTotal);
  const outstandingByCustomer = new Map<string, Decimal>();
  for (const g of outstandingGroups) sumInto(outstandingByCustomer, g.customerId, g._sum.balance);

  const customerIds = [
    ...new Set([
      ...invoicedByCustomer.keys(),
      ...paidByCustomer.keys(),
      ...creditedByCustomer.keys(),
      ...outstandingByCustomer.keys(),
    ]),
  ];
  const customers = customerIds.length
    ? await prisma.customer.findMany({
        where: { id: { in: customerIds } },
        select: { id: true, name: true, companyName: true },
      })
    : [];
  const rows = buildCustomerBalanceRows({
    customers: customers.map((c) => ({ id: c.id, name: c.companyName ?? c.name })),
    invoicedByCustomer,
    paidByCustomer,
    creditedByCustomer,
    outstandingByCustomer,
  });
  const sumRows = (pick: (r: CustomerBalanceRow) => Decimal) =>
    rows.reduce((acc, r) => acc.add(pick(r)), new Decimal(0));
  const totals: CustomerBalanceRow = {
    customerId: "",
    customerName: "Total",
    invoiced: sumRows((r) => r.invoiced),
    paid: sumRows((r) => r.paid),
    credited: sumRows((r) => r.credited),
    outstanding: sumRows((r) => r.outstanding),
  };
  return { rows, totals };
}

// ---------------------------------------------------------------------------
// Product revenue (pure row builder, unit-tested)
// ---------------------------------------------------------------------------

export type ProductRevenueRow = {
  productId: string | null;
  productName: string;
  sku: string | null;
  quantity: Decimal;
  revenue: Decimal;
  invoices: number;
};

export function buildProductRevenueRows(input: {
  groups: Array<{ productId: string | null; quantity: Decimal; revenue: Decimal; invoices: number }>;
  names: Map<string, { name: string; sku: string | null }>;
}): ProductRevenueRow[] {
  const rows = input.groups.map((g) => ({
    productId: g.productId,
    productName: g.productId
      ? (input.names.get(g.productId)?.name ?? "Deleted product")
      : "Custom lines (no product)",
    sku: g.productId ? (input.names.get(g.productId)?.sku ?? null) : null,
    quantity: g.quantity,
    revenue: g.revenue,
    invoices: g.invoices,
  }));
  rows.sort((a, b) => b.revenue.comparedTo(a.revenue));
  return rows;
}

export async function getProductRevenue(
  userId: string,
  range: DateRange,
): Promise<{ rows: ProductRevenueRow[]; totalRevenue: Decimal; totalQuantity: Decimal }> {
  const businessId = await businessIdFor(userId);
  const end = rangeEndExclusive(range.to);
  const groups = await prisma.invoiceItem.groupBy({
    by: ["productId"],
    where: {
      invoice: {
        businessId,
        status: { in: [...BILLED_STATUSES] },
        issueDate: { gte: range.from, lt: end },
      },
    },
    _sum: { quantity: true, lineTotal: true },
    _count: { invoiceId: true },
  });
  const productIds = groups.map((g) => g.productId).filter((id): id is string => id !== null);
  const products = productIds.length
    ? await prisma.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, name: true, sku: true },
      })
    : [];
  const names = new Map(products.map((p) => [p.id, { name: p.name, sku: p.sku }]));
  const rows = buildProductRevenueRows({
    groups: groups.map((g) => ({
      productId: g.productId,
      quantity: decOrZero(g._sum.quantity),
      revenue: decOrZero(g._sum.lineTotal),
      invoices: g._count.invoiceId,
    })),
    names,
  });
  return {
    rows,
    totalRevenue: rows.reduce((acc, r) => acc.add(r.revenue), new Decimal(0)),
    totalQuantity: rows.reduce((acc, r) => acc.add(r.quantity), new Decimal(0)),
  };
}

// ---------------------------------------------------------------------------
// Dashboard analytics (same ledger sources as the reports)
// ---------------------------------------------------------------------------

export async function getRevenueMonthly(
  userId: string,
  months: number,
): Promise<Array<{ month: string; invoiced: Decimal; paid: Decimal }>> {
  const businessId = await businessIdFor(userId);
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1));
  const range: DateRange = { from, to: now };
  const [invoiced, paid] = await Promise.all([
    monthlySums(businessId, "Invoice", "issueDate", "grandTotal", range, Prisma.sql`AND "status" IN ('ISSUED','SENT','PARTIALLY_PAID','PAID')`),
    monthlySums(businessId, "Payment", "date", "amount", range),
  ]);
  // Fill months with no activity so the chart has a continuous axis.
  const filled: Array<{ month: string; invoiced: Decimal; paid: Decimal }> = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const key = monthKey(d);
    filled.push({
      month: key,
      invoiced: invoiced.find((r) => r.month === key)?.total ?? new Decimal(0),
      paid: paid.find((r) => r.month === key)?.total ?? new Decimal(0),
    });
  }
  return filled;
}

export async function getOutstandingByStatus(
  userId: string,
): Promise<Array<{ status: string; balance: Decimal; count: number }>> {
  const businessId = await businessIdFor(userId);
  const groups = await prisma.invoice.groupBy({
    by: ["status"],
    where: { businessId, status: { in: [...OPEN_STATUSES] }, balance: { gt: 0 } },
    _sum: { balance: true },
    _count: true,
  });
  return groups.map((g) => ({
    status: g.status,
    balance: decOrZero(g._sum.balance),
    count: g._count,
  }));
}

export async function getTopCustomers(
  userId: string,
  limit = 5,
): Promise<Array<{ name: string; total: Decimal }>> {
  const businessId = await businessIdFor(userId);
  const groups = await prisma.invoice.groupBy({
    by: ["customerId"],
    where: { businessId, status: { in: [...BILLED_STATUSES] } },
    _sum: { grandTotal: true },
    orderBy: { _sum: { grandTotal: "desc" } },
    take: limit,
  });
  if (groups.length === 0) return [];
  const customers = await prisma.customer.findMany({
    where: { id: { in: groups.map((g) => g.customerId) } },
    select: { id: true, name: true, companyName: true },
  });
  const nameById = new Map(customers.map((c) => [c.id, c.companyName ?? c.name]));
  return groups.map((g) => ({
    name: nameById.get(g.customerId) ?? "Unknown customer",
    total: decOrZero(g._sum.grandTotal),
  }));
}
