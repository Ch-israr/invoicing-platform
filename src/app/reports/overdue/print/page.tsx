import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getDefaultBusinessForUser } from "@/lib/tenant";
import { formatMoney } from "@/lib/utils";
import { getOverdueReport, toIsoDay } from "@/server/services/report.service";
import { PrintButton } from "@/components/invoices/print-button";

export default async function OverduePrintPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const report = await getOverdueReport(session.user.id);
  const biz = await getDefaultBusinessForUser(session.user.id);
  const currency = biz?.currency ?? "AED";

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-6 print:max-w-none print:p-0">
      <div className="flex items-center justify-between print:hidden">
        <p className="text-sm text-muted-foreground">Overdue invoices</p>
        <PrintButton />
      </div>
      <h1 className="text-2xl font-bold">Overdue invoices — {biz?.name ?? ""}</h1>
      <p className="text-sm text-muted-foreground">
        {report.count} invoice{report.count === 1 ? "" : "s"} ·{" "}
        {formatMoney(report.totalBalance.toString(), currency)} outstanding
      </p>
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
              <td className="py-2 font-medium">{r.number}</td>
              <td className="py-2">{r.customerName}</td>
              <td className="py-2">{toIsoDay(r.dueDate)}</td>
              <td className="py-2 text-right">{r.daysOverdue}</td>
              <td className="py-2 text-right">{formatMoney(r.balance.toString(), currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
