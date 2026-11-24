import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { parsePage } from "@/lib/pagination";
import { listCreditNotes } from "@/server/services/credit-note.service";
import { formatMoney } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Pagination } from "@/components/shared/pagination";
import { InvoiceStatusBadge } from "@/components/invoices/status-badge";

export default async function CreditNotesPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const params = await searchParams;

  const q = typeof params.q === "string" ? params.q : "";
  const status =
    typeof params.status === "string" && (params.status === "ISSUED" || params.status === "CANCELLED")
      ? (params.status as "ISSUED" | "CANCELLED")
      : undefined;
  const page = parsePage(params.page);

  const { creditNotes, total, pageCount } = await listCreditNotes(session.user.id, {
    q: q || undefined,
    status,
    page,
  });

  const makeHref = (p: number) => {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    if (status) sp.set("status", status);
    sp.set("page", String(p));
    return `/credit-notes?${sp.toString()}`;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Credit Notes</h1>
        <p className="text-sm text-muted-foreground">
          Corrections to issued invoices. A credit note reduces the
          invoice balance without changing the invoice.
        </p>
      </div>

      <form className="flex flex-wrap gap-2" method="get">
        <Input
          name="q"
          defaultValue={q}
          placeholder="Search number, invoice or customer…"
          className="w-72"
        />
        <Select name="status" defaultValue={status ?? ""}>
          <option value="">All statuses</option>
          <option value="ISSUED">Issued</option>
          <option value="CANCELLED">Cancelled</option>
        </Select>
        <Button type="submit" variant="outline">
          Filter
        </Button>
        {q || status ? (
          <Button variant="ghost" asChild>
            <Link href="/credit-notes">Clear</Link>
          </Button>
        ) : null}
      </form>

      <Card>
        <CardContent className="p-0">
          {creditNotes.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">
              No credit notes yet. Issue one from an issued invoice.
            </p>
          ) : (
            <ul className="divide-y">
              {creditNotes.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/credit-notes/${c.id}`}
                    className="flex flex-wrap items-center justify-between gap-2 px-6 py-4 hover:bg-accent/50"
                  >
                    <div>
                      <p className="font-medium">{c.number}</p>
                      <p className="text-sm text-muted-foreground">
                        Invoice {c.invoice.number} ·{" "}
                        {c.invoice.customer.companyName ?? c.invoice.customer.name}
                        {c.reason ? ` · ${c.reason}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <InvoiceStatusBadge status={c.status} />
                      <p className="font-semibold">
                        −{formatMoney(c.grandTotal.toString(), c.invoice.currency)}
                      </p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {pageCount > 1 ? (
        <Pagination page={page} pageCount={pageCount} total={total} makeHref={makeHref} />
      ) : null}
      {total > 0 ? (
        <p className="text-sm text-muted-foreground">
          {total} credit note{total === 1 ? "" : "s"}
        </p>
      ) : null}
    </div>
  );
}
