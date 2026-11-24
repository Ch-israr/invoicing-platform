import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getDefaultBusinessForUser } from "@/lib/tenant";
import { formatMoney } from "@/lib/utils";
import {
  getVatReport,
  parseDateRange,
  toIsoDay,
} from "@/server/services/report.service";
import { PrintButton } from "@/components/invoices/print-button";

export default async function VatPrintPage({
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

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-6 print:max-w-none print:p-0">
      <div className="flex items-center justify-between print:hidden">
        <p className="text-sm text-muted-foreground">
          VAT report · {toIsoDay(range.from)} → {toIsoDay(range.to)}
        </p>
        <PrintButton />
      </div>
      <h1 className="text-2xl font-bold">VAT report — {biz?.name ?? ""}</h1>
      <p className="text-sm text-muted-foreground">
        {toIsoDay(range.from)} → {toIsoDay(range.to)} · Output VAT{" "}
        {formatMoney(report.outputVat.toString(), currency)} · Input VAT{" "}
        {formatMoney(report.inputVat.toString(), currency)} · Net payable{" "}
        {formatMoney(report.netVat.toString(), currency)}
      </p>
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
              <td className="py-2 text-right">{formatMoney(m.outputVat.toString(), currency)}</td>
              <td className="py-2 text-right">{formatMoney(m.inputVat.toString(), currency)}</td>
              <td className="py-2 text-right">
                {formatMoney(m.outputVat.sub(m.inputVat).toString(), currency)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
