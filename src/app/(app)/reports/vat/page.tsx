import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getDefaultBusinessForUser } from "@/lib/tenant";
import { formatMoney } from "@/lib/utils";
import {
  getVatReport,
  parseDateRange,
  toIsoDay,
} from "@/server/services/report.service";
import { DateRangeFilter } from "@/components/reports/date-filter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function VatReportPage({
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
  const report = await getVatReport(session.user.id, range);
  const biz = await getDefaultBusinessForUser(session.user.id);
  const currency = biz?.currency ?? "AED";
  const qs = new URLSearchParams({
    from: toIsoDay(range.from),
    to: toIsoDay(range.to),
  }).toString();

  const totals = [
    { label: "Output VAT", value: report.outputVat, hint: "VAT on issued invoices" },
    { label: "Input VAT", value: report.inputVat, hint: "VAT on expenses" },
    { label: "Net VAT payable", value: report.netVat, hint: "Output − input" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">VAT report</h1>
          <p className="text-sm text-muted-foreground">
            {toIsoDay(range.from)} → {toIsoDay(range.to)} · Computed from
            the actual tax amounts on invoices and expenses — no hardcoded
            rate.
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link href={`/api/reports/vat?${qs}`}>Download CSV</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={`/reports/vat/print?${qs}`} target="_blank">
              Print
            </Link>
          </Button>
        </div>
      </div>

      <DateRangeFilter from={toIsoDay(range.from)} to={toIsoDay(range.to)} />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
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
              No VAT in this range.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 font-medium">Month</th>
                  <th className="py-2 text-right font-medium">Output VAT</th>
                  <th className="py-2 text-right font-medium">Input VAT</th>
                  <th className="py-2 text-right font-medium">Net</th>
                </tr>
              </thead>
              <tbody>
                {report.monthly.map((m) => (
                  <tr key={m.month} className="border-b last:border-0">
                    <td className="py-2">{m.month}</td>
                    <td className="py-2 text-right">
                      {formatMoney(m.outputVat.toString(), currency)}
                    </td>
                    <td className="py-2 text-right">
                      {formatMoney(m.inputVat.toString(), currency)}
                    </td>
                    <td className="py-2 text-right">
                      {formatMoney(m.outputVat.sub(m.inputVat).toString(), currency)}
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
