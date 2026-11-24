import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getDefaultBusinessForUser } from "@/lib/tenant";
import { formatMoney } from "@/lib/utils";
import { getOverdueReport, toIsoDay } from "@/server/services/report.service";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function OverdueReportPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const report = await getOverdueReport(session.user.id);
  const biz = await getDefaultBusinessForUser(session.user.id);
  const currency = biz?.currency ?? "AED";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Overdue invoices</h1>
          <p className="text-sm text-muted-foreground">
            {report.count} invoice{report.count === 1 ? "" : "s"} past due ·{" "}
            {formatMoney(report.totalBalance.toString(), currency)} outstanding
            · worst first.
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
                    <td className="py-2">{toIsoDay(r.dueDate)}</td>
                    <td className="py-2 text-right">{r.daysOverdue}</td>
                    <td className="py-2 text-right">
                      {formatMoney(r.balance.toString(), currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
