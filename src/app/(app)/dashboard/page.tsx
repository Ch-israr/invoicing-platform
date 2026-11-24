import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getDefaultBusinessForUser } from "@/lib/tenant";
import { prisma } from "@/lib/prisma";
import { formatMoney } from "@/lib/utils";
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

const OPEN_STATUSES = ["ISSUED", "SENT", "PARTIALLY_PAID"] as const;
const BILLED_STATUSES = ["ISSUED", "SENT", "PARTIALLY_PAID", "PAID"] as const;

function dec(value: unknown): number {
  if (value === null || value === undefined) return 0;
  return Number(value);
}

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const business = await getDefaultBusinessForUser(session.user.id);
  if (!business) {
    return (
      <div className="space-y-6">
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
      include: { invoice: { select: { number: true } } },
    }),
    getTopCustomers(session.user.id, 5),
    getRevenueMonthly(session.user.id, 6),
    getOutstandingByStatus(session.user.id),
  ]);

  const topCustomersList = topCustomers.map((c) => ({
    name: c.name,
    total: Number(c.total.toFixed(2)),
  }));

  const chartData = {
    revenue: revenueMonthly.map((m) => ({
      month: m.month,
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

  const stats = [
    { label: "Total Revenue (billed)", value: totalRevenue, hint: `${billed._count} invoices` },
    { label: "Payments Received", value: totalPayments, hint: `${payments._count} payments` },
    { label: "Outstanding", value: totalOutstanding, hint: "Unpaid balances" },
    { label: "Overdue", value: totalOverdue, hint: `${overdue._count} invoices past due` },
    { label: "Total Expenses", value: totalExpenses, hint: `${expenses._count} expenses` },
    { label: "Net Cash Flow", value: netCashFlow, hint: "Payments minus expenses" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          {business.name} · {currency} · All time — figures come from your
          records, not demo data.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardHeader className="pb-2">
              <CardDescription>{s.label}</CardDescription>
              <CardTitle className="text-2xl">
                {formatMoney(s.value, currency)}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">{s.hint}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Recent Invoices</CardTitle>
            <CardDescription>
              {recentInvoices.length === 0
                ? "No invoices yet — create your first invoice in Phase 3."
                : "Your latest invoices."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {recentInvoices.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing here yet.
              </p>
            ) : (
              <ul className="space-y-2">
                {recentInvoices.map((inv) => (
                  <li
                    key={inv.id}
                    className="flex items-center justify-between text-sm"
                  >
                    <span>
                      {inv.number} · {inv.customer.name}
                    </span>
                    <span className="font-medium">
                      {formatMoney(dec(inv.grandTotal), currency)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent Payments</CardTitle>
            <CardDescription>
              {recentPayments.length === 0
                ? "No payments recorded yet."
                : "Your latest payments."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {recentPayments.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing here yet.
              </p>
            ) : (
              <ul className="space-y-2">
                {recentPayments.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center justify-between text-sm"
                  >
                    <span>
                      {p.method.replace("_", " ")} · Invoice {p.invoice.number}
                    </span>
                    <span className="font-medium">
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
            <CardTitle>Revenue — last 6 months</CardTitle>
            <CardDescription>
              Invoiced vs paid, from your ledger.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {chartData.revenue.every(
              (m) => m.invoiced === 0 && m.paid === 0,
            ) ? (
              <p className="text-sm text-muted-foreground">
                Nothing invoiced or paid in the last 6 months.
              </p>
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
                No outstanding balances.
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
                ? "No billed customers yet."
                : "By total amount billed."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {chartData.topCustomers.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing here yet.
              </p>
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
              Customers: <span className="font-medium">{customerCount}</span>
            </p>
            <p>
              Products &amp; services:{" "}
              <span className="font-medium">{productCount}</span>
            </p>
            <p>
              Business: <span className="font-medium">{business.name}</span> (
              {business.country} · {business.currency})
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
