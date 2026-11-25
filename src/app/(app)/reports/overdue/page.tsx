import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getDefaultBusinessForUser } from "@/lib/tenant";
import { formatMoney } from "@/lib/utils";
import { getOverdueReport } from "@/server/services/report.service";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export default async function OverdueReportPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const report = await getOverdueReport(session.user.id);
  const biz = await getDefaultBusinessForUser(session.user.id);
  const currency = biz?.currency ?? "AED";

  return (
    <div className="-m-4 min-h-[calc(100dvh-4rem)] space-y-6 bg-muted/60 p-4 md:-m-6 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Overdue invoices</h1>
          <p className="text-sm text-muted-foreground">
            Invoices past their due date with balances, worst first.
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link href="/api/reports/overdue">Download CSV</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/reports/overdue/print" target="_blank">
              Print
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 [&>*]:min-w-0">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Overdue invoices</p>
            <p className="mt-1 text-2xl font-bold tracking-tight tabular-nums">{report.count}</p>
            <p className="text-xs text-muted-foreground">Past their due date</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Total outstanding</p>
            <p className="mt-1 text-2xl font-bold tracking-tight tabular-nums">
              {formatMoney(report.totalBalance.toString(), currency)}
            </p>
            <p className="text-xs text-muted-foreground">Across overdue invoices</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Overdue</CardTitle>
        </CardHeader>
        <CardContent>
          {report.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing overdue — all open invoices are within their due dates.
            </p>
          ) : (
            <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 font-medium">Invoice</th>
                  <th className="py-2 font-medium">Customer</th>
                  <th className="py-2 font-medium">Due date</th>
                  <th className="py-2 text-right font-medium">Days overdue</th>
                  <th className="py-2 text-right font-medium">Balance</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((r) => (
                  <tr key={r.invoiceId} className="border-b last:border-0">
                    <td className="py-2">
                      <Link href={`/invoices/${r.invoiceId}`} className="font-medium underline">
                        {r.number}
                      </Link>
                    </td>
                    <td className="py-2">{r.customerName}</td>
                    <td className="py-2">{formatDate(r.dueDate)}</td>
                    <td className="py-2 text-right tabular-nums">{r.daysOverdue}</td>
                    <td className="py-2 text-right font-semibold tabular-nums">
                      {formatMoney(r.balance.toString(), currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
