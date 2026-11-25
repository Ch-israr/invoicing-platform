import { redirect } from "next/navigation";
import Link from "next/link";
import {
  Banknote,
  Hourglass,
  Receipt,
  ReceiptText,
  TrendingDown,
  TrendingUp,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { auth } from "@/lib/auth";
import { getDefaultBusinessForUser } from "@/lib/tenant";
import { prisma } from "@/lib/prisma";
import { cn, formatMoney } from "@/lib/utils";
import { isDraftNumber } from "@/lib/numbering";
import {
  getOutstandingByStatus,
  getRevenueMonthly,
  getTopCustomers,
} from "@/server/services/report.service";
import {
  OutstandingChart,
  RevenueChart,
  TopCustomersChart,
} from "@/components/dashboard/charts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { InvoiceStatusBadge } from "@/components/invoices/status-badge";

const OPEN_STATUSES = ["ISSUED", "SENT", "PARTIALLY_PAID"] as const;
const BILLED_STATUSES = ["ISSUED", "SENT", "PARTIALLY_PAID", "PAID"] as const;

const METHOD_LABELS: Record<string, string> = {
  CASH: "Cash",
  BANK_TRANSFER: "Bank transfer",
  CARD: "Card",
  OTHER: "Other",
};

function dec(value: unknown): number {
  if (value === null || value === undefined) return 0;
  return Number(value);
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

/** "2026-06" → "Jun 26" for the chart axis. */
function shortMonthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  if (!y || !m) return ym;
  const d = new Date(Date.UTC(y, m - 1, 1));
  return `${d.toLocaleString("en-US", { month: "short", timeZone: "UTC" })} ${String(y).slice(2)}`;
}

/** Month-over-month direction from two monthly totals. */
function monthTrend(
  current: number,
  previous: number,
): { label: string; up: boolean } | null {
  if (previous > 0) {
    const pct = Math.round(((current - previous) / previous) * 100);
    if (pct === 0) return { label: "No change vs last month", up: true };
    return { label: `${Math.abs(pct)}% vs last month`, up: pct > 0 };
  }
  if (current > 0) return { label: "New this month", up: true };
  return null;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const params = await searchParams;
  const months =
    params.months === "3" || params.months === "12" ? Number(params.months) : 6;

  const business = await getDefaultBusinessForUser(session.user.id);
  if (!business) {
    return (
      <div className="-m-4 min-h-[calc(100dvh-4rem)] space-y-6 bg-muted/60 p-4 md:-m-6 md:p-6">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <Card>
          <CardHeader>
            <CardTitle>No business yet</CardTitle>
            <CardDescription>
              Your account has no business workspace. Business setup arrives
              in Phase 2 — if you registered before then, please register a
              new account or contact support.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const businessId = business.id;
  const currency = business.currency;
  const now = new Date();

  const [
    billed,
    payments,
    outstanding,
    overdue,
    expenses,
    customerCount,
    productCount,
    recentInvoices,
    recentPayments,
    topCustomers,
    revenueMonthly,
    outstandingByStatus,
  ] = await Promise.all([
    prisma.invoice.aggregate({
      where: { businessId, status: { in: [...BILLED_STATUSES] } },
      _sum: { grandTotal: true },
      _count: true,
    }),
    prisma.payment.aggregate({
      where: { businessId },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.invoice.aggregate({
      where: { businessId, status: { in: [...OPEN_STATUSES] } },
      _sum: { balance: true },
    }),
    prisma.invoice.aggregate({
      where: {
        businessId,
        status: { in: [...OPEN_STATUSES] },
        dueDate: { lt: now },
        balance: { gt: 0 },
      },
      _sum: { balance: true },
      _count: true,
    }),
    prisma.expense.aggregate({
      where: { businessId },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.customer.count({ where: { businessId } }),
    prisma.product.count({ where: { businessId } }),
    prisma.invoice.findMany({
      where: { businessId },
      orderBy: { createdAt: "desc" },
      take: 5,
      include: { customer: { select: { name: true } } },
    }),
    prisma.payment.findMany({
      where: { businessId },
      orderBy: { date: "desc" },
      take: 5,
      include: { invoice: { select: { id: true, number: true } } },
    }),
    getTopCustomers(session.user.id, 5),
    getRevenueMonthly(session.user.id, months),
    getOutstandingByStatus(session.user.id),
  ]);

  const topCustomersList = topCustomers.map((c) => ({
    name: c.name,
    total: Number(c.total.toFixed(2)),
  }));

  const chartData = {
    revenue: revenueMonthly.map((m) => ({
      month: shortMonthLabel(m.month),
      invoiced: Number(m.invoiced.toFixed(2)),
      paid: Number(m.paid.toFixed(2)),
    })),
    outstanding: outstandingByStatus.map((o) => ({
      status: o.status,
      balance: Number(o.balance.toFixed(2)),
      count: o.count,
    })),
    topCustomers: topCustomersList,
  };

  const totalRevenue = dec(billed._sum.grandTotal);
  const totalPayments = dec(payments._sum.amount);
  const totalOutstanding = dec(outstanding._sum.balance);
  const totalOverdue = dec(overdue._sum.balance);
  const totalExpenses = dec(expenses._sum.amount);
  const netCashFlow = totalPayments - totalExpenses;

  const openInvoiceCount = chartData.outstanding.reduce(
    (sum, o) => sum + o.count,
    0,
  );
  const lastMonth = revenueMonthly[revenueMonthly.length - 1];
  const prevMonth = revenueMonthly[revenueMonthly.length - 2];
  const revenueTrend = monthTrend(
    Number(lastMonth?.invoiced ?? 0),
    Number(prevMonth?.invoiced ?? 0),
  );
  const paymentsTrend = monthTrend(
    Number(lastMonth?.paid ?? 0),
    Number(prevMonth?.paid ?? 0),
  );

  type SecondaryStat = {
    label: string;
    value: number;
    hint: string;
    trend?: { label: string; up: boolean } | null;
    icon: LucideIcon;
    chip: string;
  };

  // Secondary figures share one fixed pattern: small grey label, one
  // large bold figure, one small context line. Tints are keyed to
  // meaning: green money in, blue collected, rose money out.
  const secondaryStats: SecondaryStat[] = [
    {
      label: "Total Revenue (billed)",
      value: totalRevenue,
      hint: `${billed._count} ${plural(billed._count, "invoice", "invoices")}`,
      trend: revenueTrend,
      icon: ReceiptText,
      chip: "bg-green-600/10 text-green-700 dark:text-green-400",
    },
    {
      label: "Payments Received",
      value: totalPayments,
      hint: `${payments._count} ${plural(payments._count, "payment", "payments")}`,
      trend: paymentsTrend,
      icon: Banknote,
      chip: "bg-blue-600/10 text-blue-700 dark:text-blue-400",
    },
    {
      label: "Total Expenses",
      value: totalExpenses,
      hint: `${expenses._count} ${plural(expenses._count, "expense", "expenses")}`,
      icon: Receipt,
      chip: "bg-rose-600/10 text-rose-700 dark:text-rose-400",
    },
    {
      label: "Net Cash Flow",
      value: netCashFlow,
      hint: "Payments minus expenses",
      icon: Wallet,
      chip: "bg-primary/10 text-primary",
    },
  ];

  return (
    <div className="-m-4 min-h-[calc(100dvh-4rem)] space-y-6 bg-muted/60 p-4 md:-m-6 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            {business.name} · {currency} · All time — figures come from your
            records, not demo data.
          </p>
        </div>
        <Button asChild>
          <Link href="/invoices/new">New Invoice</Link>
        </Button>
      </div>

      {/* Hero figure: the outstanding balance is the number that matters
          most, so it gets the large figure; everything else is subordinate. */}
      <Card className="border-primary/20">
        <CardContent className="flex flex-wrap items-center justify-between gap-6 p-6">
          <div>
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="rounded-md bg-amber-600/10 p-1.5 text-amber-700 dark:text-amber-400">
                <Hourglass className="h-4 w-4" aria-hidden />
              </span>
              Outstanding balance
            </p>
            <p className="mt-2 text-4xl font-bold tracking-tight tabular-nums">
              {formatMoney(totalOutstanding, currency)}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {openInvoiceCount}{" "}
              {plural(openInvoiceCount, "open invoice", "open invoices")} ·{" "}
              {overdue._count}{" "}
              {plural(overdue._count, "overdue", "overdue")}
            </p>
          </div>
          <div className="text-left sm:text-right">
            <p className="text-sm text-muted-foreground">Overdue</p>
            <p className="text-2xl font-bold tabular-nums text-amber-700 dark:text-amber-400">
              {formatMoney(totalOverdue, currency)}
            </p>
            <p className="text-sm text-muted-foreground">
              {totalOverdue > 0
                ? "Chase these first — they are past their due date."
                : "Nothing overdue."}
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {secondaryStats.map((s) => (
          <Card key={s.label}>
            <CardContent className="p-5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm text-muted-foreground">{s.label}</p>
                <span className={cn("rounded-md p-1.5", s.chip)}>
                  <s.icon className="h-4 w-4" aria-hidden />
                </span>
              </div>
              <p className="mt-2 text-2xl font-bold tracking-tight tabular-nums">
                {formatMoney(s.value, currency)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {s.trend ? (
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 font-medium",
                      s.trend.up
                        ? "text-green-700 dark:text-green-400"
                        : "text-red-700 dark:text-red-400",
                    )}
                  >
                    {s.trend.up ? (
                      <TrendingUp className="h-3.5 w-3.5" aria-hidden />
                    ) : (
                      <TrendingDown className="h-3.5 w-3.5" aria-hidden />
                    )}
                    {s.trend.label}
                  </span>
                ) : (
                  s.hint
                )}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* [&>*]:min-w-0 stops the grid track blowing out on mobile: the
          invoice rows use truncate (nowrap), which raises their
          min-content width; without it the track grew to ~425px on a
          390px viewport. */}
      <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1.5">
                <CardTitle>Recent Invoices</CardTitle>
                <CardDescription>
                  {recentInvoices.length === 0
                    ? "Your latest invoices will show up here."
                    : "Your latest invoices — open one to follow up."}
                </CardDescription>
              </div>
              <Button asChild variant="ghost" size="sm" className="shrink-0">
                <Link href="/invoices">View all</Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {recentInvoices.length === 0 ? (
              <div>
                <p className="text-sm text-muted-foreground">
                  No invoices yet — create your first invoice to start
                  billing.
                </p>
                <Button asChild size="sm" variant="outline" className="mt-3">
                  <Link href="/invoices/new">Create your first invoice</Link>
                </Button>
              </div>
            ) : (
              <ul className="space-y-1">
                {recentInvoices.map((inv) => {
                  const isOverdue =
                    (OPEN_STATUSES as readonly string[]).includes(
                      inv.status,
                    ) &&
                    inv.dueDate < now &&
                    Number(inv.balance) > 0;
                  return (
                    <li key={inv.id}>
                      <Link
                        href={`/invoices/${inv.id}`}
                        className={cn(
                          "flex items-center justify-between gap-3 rounded-lg px-2 py-2 text-sm transition-colors hover:bg-muted/60",
                          isOverdue &&
                            "bg-red-50/70 hover:bg-red-100/70 dark:bg-red-950/20 dark:hover:bg-red-950/30",
                        )}
                      >
                        <span className="min-w-0 truncate">
                          <span className="font-medium">
                            {isDraftNumber(inv.number) ? "Draft" : inv.number}
                          </span>
                          <span className="text-muted-foreground">
                            {" "}
                            · {inv.customer.name}
                          </span>
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          <InvoiceStatusBadge
                            status={inv.status}
                            isOverdue={isOverdue}
                          />
                          <span className="font-medium tabular-nums">
                            {formatMoney(dec(inv.grandTotal), currency)}
                          </span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1.5">
                <CardTitle>Recent Payments</CardTitle>
                <CardDescription>
                  {recentPayments.length === 0
                    ? "Payments you record will show up here."
                    : "Your latest payments."}
                </CardDescription>
              </div>
              <Button asChild variant="ghost" size="sm" className="shrink-0">
                <Link href="/payments">View all</Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {recentPayments.length === 0 ? (
              <div>
                <p className="text-sm text-muted-foreground">
                  No payments recorded yet — record one from an open invoice.
                </p>
                <Button asChild size="sm" variant="outline" className="mt-3">
                  <Link href="/invoices">Go to invoices</Link>
                </Button>
              </div>
            ) : (
              <ul className="space-y-1">
                {recentPayments.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center justify-between gap-3 px-2 py-2 text-sm"
                  >
                    <span className="min-w-0 truncate">
                      {METHOD_LABELS[p.method] ?? p.method} ·{" "}
                      <Link
                        href={`/invoices/${p.invoice.id}`}
                        className="font-medium underline-offset-2 hover:underline"
                      >
                        Invoice{" "}
                        {isDraftNumber(p.invoice.number)
                          ? "Draft"
                          : p.invoice.number}
                      </Link>
                    </span>
                    <span className="shrink-0 font-medium tabular-nums">
                      {formatMoney(dec(p.amount), currency)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1.5">
                <CardTitle>Revenue — last {months} months</CardTitle>
                <CardDescription>
                  Invoiced vs paid, from your ledger.
                </CardDescription>
              </div>
              <div
                className="flex shrink-0 rounded-md border p-0.5"
                role="group"
                aria-label="Period"
              >
                {[3, 6, 12].map((m) => (
                  <Button
                    key={m}
                    asChild
                    variant={m === months ? "default" : "ghost"}
                    size="sm"
                    className="h-7 px-2.5"
                  >
                    <Link href={`/dashboard?months=${m}`}>{m}M</Link>
                  </Button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {chartData.revenue.every(
              (m) => m.invoiced === 0 && m.paid === 0,
            ) ? (
              <div>
                <p className="text-sm text-muted-foreground">
                  Nothing invoiced or paid in the last {months} months — your
                  chart will fill in as you bill.
                </p>
                <Button asChild size="sm" variant="outline" className="mt-3">
                  <Link href="/invoices/new">Create an invoice</Link>
                </Button>
              </div>
            ) : (
              <RevenueChart data={chartData.revenue} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Outstanding by status</CardTitle>
            <CardDescription>
              Open balances split by invoice status.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {chartData.outstanding.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No outstanding balances — everything is paid up.
              </p>
            ) : (
              <OutstandingChart data={chartData.outstanding} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Top Customers</CardTitle>
            <CardDescription>
              {chartData.topCustomers.length === 0
                ? "Your biggest customers will show up here."
                : "By total amount billed."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {chartData.topCustomers.length === 0 ? (
              <div>
                <p className="text-sm text-muted-foreground">
                  No billed customers yet.
                </p>
                <Button asChild size="sm" variant="outline" className="mt-3">
                  <Link href="/invoices/new">Create an invoice</Link>
                </Button>
              </div>
            ) : (
              <TopCustomersChart data={chartData.topCustomers} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Workspace</CardTitle>
            <CardDescription>Counts from your records.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              <Link
                href="/customers"
                className="underline-offset-2 hover:underline"
              >
                Customers:{" "}
                <span className="font-medium">{customerCount}</span>
              </Link>
            </p>
            <p>
              <Link
                href="/products"
                className="underline-offset-2 hover:underline"
              >
                Products &amp; services:{" "}
                <span className="font-medium">{productCount}</span>
              </Link>
            </p>
            <p>
              Business:{" "}
              <span className="font-medium">{business.name}</span> (
              {business.country} · {business.currency})
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
