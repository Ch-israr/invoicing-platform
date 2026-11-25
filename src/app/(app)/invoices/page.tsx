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

const STATUS_LABELS: Record<(typeof STATUSES)[number], string> = {
  DRAFT: "Draft",
  ISSUED: "Issued",
  SENT: "Sent",
  PARTIALLY_PAID: "Partially paid",
  PAID: "Paid",
  CANCELLED: "Cancelled",
};

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
    <div className="-m-4 min-h-[calc(100dvh-4rem)] space-y-6 bg-muted/60 p-4 md:-m-6 md:p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Invoices</h1>
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

      <form className="flex flex-wrap items-center gap-2" method="get">
        <Input
          name="q"
          defaultValue={q}
          placeholder="Search number or customer…"
          className="min-w-48 flex-1 sm:max-w-xs"
        />
        <Select name="status" defaultValue={status ?? ""} className="w-44">
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
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
            <div className="p-6">
              <p className="text-sm text-muted-foreground">
                No invoices yet — create your first invoice to start billing.
              </p>
              <Button asChild size="sm" className="mt-3">
                <Link href="/invoices/new">Create your first invoice</Link>
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="px-4 py-3 font-medium">Number</th>
                    <th className="px-4 py-3 font-medium">Customer</th>
                    <th className="px-4 py-3 font-medium whitespace-nowrap">Issue date</th>
                    <th className="px-4 py-3 font-medium whitespace-nowrap">Due date</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 text-right font-medium">Total</th>
                    <th className="px-4 py-3 text-right font-medium">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv) => (
                    <tr
                      key={inv.id}
                      className={
                        inv.isOverdue
                          ? "border-b bg-red-50/70 last:border-0 hover:bg-red-100/70 dark:bg-red-950/20 dark:hover:bg-red-950/30"
                          : "border-b last:border-0 hover:bg-muted/50"
                      }
                    >
                      <td className="px-4 py-3 whitespace-nowrap">
                        <Link href={`/invoices/${inv.id}`} className="font-medium underline-offset-2 hover:underline">
                          {isDraftNumber(inv.number) ? "Draft" : inv.number}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        {inv.customer.companyName ?? inv.customer.name}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {inv.issueDate.toISOString().slice(0, 10)}
                      </td>
                      <td
                        className={
                          inv.isOverdue
                            ? "px-4 py-3 font-medium whitespace-nowrap text-red-700 dark:text-red-400"
                            : "px-4 py-3 whitespace-nowrap"
                        }
                      >
                        {inv.dueDate.toISOString().slice(0, 10)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <InvoiceStatusBadge status={inv.status} isOverdue={inv.isOverdue} />
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {formatMoney(inv.grandTotal.toString(), inv.currency)}
                      </td>
                      <td
                        className={
                          Number(inv.balance) > 0
                            ? "px-4 py-3 text-right font-semibold tabular-nums"
                            : "px-4 py-3 text-right tabular-nums"
                        }
                      >
                        {formatMoney(inv.balance.toString(), inv.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Pagination page={page} pageCount={pageCount} total={total} makeHref={makeHref} />
    </div>
  );
}
