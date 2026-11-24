import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getDefaultBusinessForUser } from "@/lib/tenant";
import { formatMoney } from "@/lib/utils";
import {
  getCustomerBalances,
  parseDateRange,
  toIsoDay,
} from "@/server/services/report.service";
import { PrintButton } from "@/components/invoices/print-button";

export default async function CustomersPrintPage({
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

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-6 print:max-w-none print:p-0">
      <div className="flex items-center justify-between print:hidden">
        <p className="text-sm text-muted-foreground">
          Customer balances · {toIsoDay(range.from)} → {toIsoDay(range.to)}
        </p>
        <PrintButton />
      </div>
      <h1 className="text-2xl font-bold">Customer balances — {biz?.name ?? ""}</h1>
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
              <td className="py-2 text-right">{formatMoney(r.invoiced.toString(), currency)}</td>
              <td className="py-2 text-right">{formatMoney(r.paid.toString(), currency)}</td>
              <td className="py-2 text-right">{formatMoney(r.credited.toString(), currency)}</td>
              <td className="py-2 text-right">{formatMoney(r.outstanding.toString(), currency)}</td>
            </tr>
          ))}
          <tr className="font-semibold">
            <td className="py-2">Total</td>
            <td className="py-2 text-right">{formatMoney(totals.invoiced.toString(), currency)}</td>
            <td className="py-2 text-right">{formatMoney(totals.paid.toString(), currency)}</td>
            <td className="py-2 text-right">{formatMoney(totals.credited.toString(), currency)}</td>
            <td className="py-2 text-right">{formatMoney(totals.outstanding.toString(), currency)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
