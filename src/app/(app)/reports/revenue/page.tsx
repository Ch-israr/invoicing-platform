import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getDefaultBusinessForUser } from "@/lib/tenant";
import { formatMoney } from "@/lib/utils";
import {
  getRevenueReport,
  parseDateRange,
  toIsoDay,
} from "@/server/services/report.service";
import { DateRangeFilter } from "@/components/reports/date-filter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function RevenueReportPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const params = await searchParams;
  const range = parseDateRange({
    from: typeof params.from === "string" ? params.from : undefined,
    to: typeof params.to === "string" ? params.to : undefined,
  });
  const report = await getRevenueReport(session.user.id, range);
  const biz = await getDefaultBusinessForUser(session.user.id);
  const currency = biz?.currency ?? "AED";
  const qs = new URLSearchParams({
    from: toIsoDay(range.from),
    to: toIsoDay(range.to),
  }).toString();

  const totals = [
    { label: "Invoiced", value: report.invoiced, hint: `${report.invoicedCount} invoices` },
    { label: "Paid", value: report.paid, hint: `${report.paidCount} payments` },
    { label: "Credited", value: report.credited, hint: "Issued credit notes" },
    { label: "Outstanding", value: report.outstanding, hint: "Open invoices in range" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Revenue report</h1>
          <p className="text-sm text-muted-foreground">
            {toIsoDay(range.from)} → {toIsoDay(range.to)} · Invoiced is the
            sum of issued invoices; paid is the sum of payments received.
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link href={`/api/reports/revenue?${qs}`}>Download CSV</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={`/reports/revenue/print?${qs}`} target="_blank">
              Print
            </Link>
          </Button>
        </div>
      </div>

      <DateRangeFilter from={toIsoDay(range.from)} to={toIsoDay(range.to)} />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {totals.map((t) => (
          <Card key={t.label}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{t.label}</p>
              <p className="mt-1 text-lg font-semibold">
                {formatMoney(t.value.toString(), currency)}
              </p>
              <p className="text-xs text-muted-foreground">{t.hint}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Monthly breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          {report.monthly.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing invoiced or paid in this range.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 font-medium">Month</th>
                  <th className="py-2 text-right font-medium">Invoiced</th>
                  <th className="py-2 text-right font-medium">Paid</th>
                </tr>
              </thead>
              <tbody>
                {report.monthly.map((m) => (
                  <tr key={m.month} className="border-b last:border-0">
                    <td className="py-2">{m.month}</td>
                    <td className="py-2 text-right">
                      {formatMoney(m.invoiced.toString(), currency)}
                    </td>
                    <td className="py-2 text-right">
                      {formatMoney(m.paid.toString(), currency)}
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
