import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getDefaultBusinessForUser } from "@/lib/tenant";
import { formatMoney } from "@/lib/utils";
import {
  getCustomerBalances,
  parseDateRange,
  toIsoDay,
} from "@/server/services/report.service";
import { DateRangeFilter } from "@/components/reports/date-filter";
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

export default async function CustomerBalancesPage({
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
  const { rows, totals } = await getCustomerBalances(session.user.id, range);
  const biz = await getDefaultBusinessForUser(session.user.id);
  const currency = biz?.currency ?? "AED";
  const qs = new URLSearchParams({
    from: toIsoDay(range.from),
    to: toIsoDay(range.to),
  }).toString();

  return (
    <div className="-m-4 min-h-[calc(100dvh-4rem)] space-y-6 bg-muted/60 p-4 md:-m-6 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Customer balances</h1>
          <p className="text-sm text-muted-foreground">
            {formatDate(range.from)} → {formatDate(range.to)} · Invoiced, paid
            and credited in the range; outstanding is the live balance of
            open invoices.
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link href={`/api/reports/customers?${qs}`}>Download CSV</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={`/reports/customers/print?${qs}`} target="_blank">
              Print
            </Link>
          </Button>
        </div>
      </div>

      <DateRangeFilter from={toIsoDay(range.from)} to={toIsoDay(range.to)} />

      <Card>
        <CardHeader>
          <CardTitle>Balances</CardTitle>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No customer activity in this range.
            </p>
          ) : (
            <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 font-medium">Customer</th>
                  <th className="py-2 text-right font-medium">Invoiced</th>
                  <th className="py-2 text-right font-medium">Paid</th>
                  <th className="py-2 text-right font-medium">Credited</th>
                  <th className="py-2 text-right font-medium">Outstanding</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.customerId} className="border-b last:border-0">
                    <td className="py-2 font-medium">{r.customerName}</td>
                    <td className="py-2 text-right tabular-nums">
                      {formatMoney(r.invoiced.toString(), currency)}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {formatMoney(r.paid.toString(), currency)}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {formatMoney(r.credited.toString(), currency)}
                    </td>
                    <td className="py-2 text-right font-semibold tabular-nums">
                      {formatMoney(r.outstanding.toString(), currency)}
                    </td>
                  </tr>
                ))}
                <tr className="font-semibold">
                  <td className="py-2">Total</td>
                  <td className="py-2 text-right tabular-nums">
                    {formatMoney(totals.invoiced.toString(), currency)}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {formatMoney(totals.paid.toString(), currency)}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {formatMoney(totals.credited.toString(), currency)}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {formatMoney(totals.outstanding.toString(), currency)}
                  </td>
                </tr>
              </tbody>
            </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
