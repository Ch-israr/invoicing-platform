import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getDefaultBusinessForUser } from "@/lib/tenant";
import { formatMoney } from "@/lib/utils";
import { getAgingReport, toIsoDay } from "@/server/services/report.service";
import { PrintButton } from "@/components/invoices/print-button";

export default async function AgingPrintPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const report = await getAgingReport(session.user.id);
  const biz = await getDefaultBusinessForUser(session.user.id);
  const currency = biz?.currency ?? "AED";

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-6 print:max-w-none print:p-0">
      <div className="flex items-center justify-between print:hidden">
        <p className="text-sm text-muted-foreground">A/R aging</p>
        <PrintButton />
      </div>
      <h1 className="text-2xl font-bold">A/R aging — {biz?.name ?? ""}</h1>
      <p className="text-sm text-muted-foreground">
        {report.count} open invoice{report.count === 1 ? "" : "s"} ·{" "}
        {formatMoney(report.totalOutstanding.toString(), currency)} outstanding ·{" "}
        {formatMoney(report.overdueTotal.toString(), currency)} overdue
      </p>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="py-2 font-medium">Bucket</th>
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
                {report.buckets.find((b) => b.key === r.bucket)?.label ?? r.bucket}
              </td>
              <td className="py-2 font-medium">{r.number}</td>
              <td className="py-2">{r.customerName}</td>
              <td className="py-2">{toIsoDay(r.dueDate)}</td>
              <td className="py-2 text-right">{r.daysOverdue === 0 ? "—" : r.daysOverdue}</td>
              <td className="py-2 text-right">{formatMoney(r.balance.toString(), currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
