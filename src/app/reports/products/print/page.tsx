import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getDefaultBusinessForUser } from "@/lib/tenant";
import { formatMoney } from "@/lib/utils";
import {
  getProductRevenue,
  parseDateRange,
  toIsoDay,
} from "@/server/services/report.service";
import { PrintButton } from "@/components/invoices/print-button";

export default async function ProductsPrintPage({
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

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-6 print:max-w-none print:p-0">
      <div className="flex items-center justify-between print:hidden">
        <p className="text-sm text-muted-foreground">
          Product revenue · {toIsoDay(range.from)} → {toIsoDay(range.to)}
        </p>
        <PrintButton />
      </div>
      <h1 className="text-2xl font-bold">Product revenue — {biz?.name ?? ""}</h1>
      <p className="text-sm text-muted-foreground">
        {formatMoney(totalRevenue.toString(), currency)} across{" "}
        {totalQuantity.toString()} units
      </p>
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
              <td className="py-2 text-right">{r.quantity.toString()}</td>
              <td className="py-2 text-right">{r.invoices}</td>
              <td className="py-2 text-right">{formatMoney(r.revenue.toString(), currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
