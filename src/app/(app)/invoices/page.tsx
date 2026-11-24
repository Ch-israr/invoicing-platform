import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { parsePage } from "@/lib/pagination";
import { listInvoices } from "@/server/services/invoice.service";
import { isDraftNumber } from "@/lib/numbering";
import { formatMoney } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Pagination } from "@/components/shared/pagination";
import { InvoiceStatusBadge } from "@/components/invoices/status-badge";

const STATUSES = ["DRAFT", "ISSUED", "SENT", "PARTIALLY_PAID", "PAID", "CANCELLED"] as const;

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const params = await searchParams;

  const q = typeof params.q === "string" ? params.q : "";
  const status =
    typeof params.status === "string" &&
    (STATUSES as readonly string[]).includes(params.status)
      ? (params.status as (typeof STATUSES)[number])
      : undefined;
  const page = parsePage(params.page);
  const deleteError = typeof params.deleteError === "string" ? params.deleteError : undefined;

  const { invoices, total, pageCount } = await listInvoices(session.user.id, {
    q: q || undefined,
    status,
    page,
  });

  const makeHref = (p: number) => {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    if (status) sp.set("status", status);
    sp.set("page", String(p));
    return `/invoices?${sp.toString()}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Invoices</h1>
          <p className="text-sm text-muted-foreground">
            Drafts, issued invoices and their balances.
          </p>
        </div>
        <Button asChild>
          <Link href="/invoices/new">New Invoice</Link>
        </Button>
      </div>

      {deleteError ? (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {deleteError}
        </p>
      ) : null}

      <form className="flex flex-wrap gap-2" method="get">
        <Input
          name="q"
          defaultValue={q}
          placeholder="Search number or customer…"
          className="w-64"
        />
        <Select name="status" defaultValue={status ?? ""}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
        <Button type="submit" variant="outline">
          Filter
        </Button>
        {q || status ? (
          <Button variant="ghost" asChild>
            <Link href="/invoices">Clear</Link>
          </Button>
        ) : null}
      </form>

      <Card>
        <CardContent className="p-0">
          {invoices.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">
              No invoices yet. Create your first invoice to start billing.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Number</th>
                  <th className="px-4 py-3 font-medium">Customer</th>
                  <th className="px-4 py-3 font-medium">Issue date</th>
                  <th className="px-4 py-3 font-medium">Due date</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 text-right font-medium">Total</th>
                  <th className="px-4 py-3 text-right font-medium">Balance</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id} className="border-b last:border-0 hover:bg-muted/50">
                    <td className="px-4 py-3">
                      <Link href={`/invoices/${inv.id}`} className="font-medium underline-offset-2 hover:underline">
                        {isDraftNumber(inv.number) ? "Draft" : inv.number}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      {inv.customer.companyName ?? inv.customer.name}
                    </td>
                    <td className="px-4 py-3">
                      {inv.issueDate.toISOString().slice(0, 10)}
                    </td>
                    <td className="px-4 py-3">
                      {inv.dueDate.toISOString().slice(0, 10)}
                    </td>
                    <td className="px-4 py-3">
                      <InvoiceStatusBadge status={inv.status} isOverdue={inv.isOverdue} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      {formatMoney(inv.grandTotal.toString(), inv.currency)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {formatMoney(inv.balance.toString(), inv.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Pagination page={page} pageCount={pageCount} total={total} makeHref={makeHref} />
    </div>
  );
}
