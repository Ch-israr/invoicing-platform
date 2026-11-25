import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getDefaultBusinessForUser } from "@/lib/tenant";
import { formatMoney } from "@/lib/utils";
import {
  getProductRevenue,
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

export default async function ProductRevenuePage({
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
  const { rows, totalRevenue, totalQuantity } = await getProductRevenue(
    session.user.id,
    range,
  );
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
          <h1 className="text-2xl font-bold tracking-tight">Product revenue</h1>
          <p className="text-sm text-muted-foreground">
            {formatDate(range.from)} → {formatDate(range.to)} · From line items
            of issued invoices · {formatMoney(totalRevenue.toString(), currency)}{" "}
            across {totalQuantity.toString()} units.
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link href={`/api/reports/products?${qs}`}>Download CSV</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={`/reports/products/print?${qs}`} target="_blank">
              Print
            </Link>
          </Button>
        </div>
      </div>

      <DateRangeFilter from={toIsoDay(range.from)} to={toIsoDay(range.to)} />

      <Card>
        <CardHeader>
          <CardTitle>Revenue by product</CardTitle>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No issued invoice lines in this range.
            </p>
          ) : (
            <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 font-medium">Product</th>
                  <th className="py-2 font-medium">SKU</th>
                  <th className="py-2 text-right font-medium">Qty sold</th>
                  <th className="py-2 text-right font-medium">Invoices</th>
                  <th className="py-2 text-right font-medium">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.productId ?? "custom"} className="border-b last:border-0">
                    <td className="py-2 font-medium">{r.productName}</td>
                    <td className="py-2">{r.sku ?? "—"}</td>
                    <td className="py-2 text-right tabular-nums">{r.quantity.toString()}</td>
                    <td className="py-2 text-right tabular-nums">{r.invoices}</td>
                    <td className="py-2 text-right font-semibold tabular-nums">
                      {formatMoney(r.revenue.toString(), currency)}
                    </td>
                  </tr>
                ))}
                <tr className="font-semibold">
                  <td className="py-2" colSpan={2}>
                    Total
                  </td>
                  <td className="py-2 text-right tabular-nums">{totalQuantity.toString()}</td>
                  <td className="py-2 text-right">—</td>
                  <td className="py-2 text-right tabular-nums">
                    {formatMoney(totalRevenue.toString(), currency)}
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
