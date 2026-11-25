import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { parsePage } from "@/lib/pagination";
import { listQuotations } from "@/server/services/quotation.service";
import { isDraftNumber } from "@/lib/numbering";
import { formatMoney } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Pagination } from "@/components/shared/pagination";
import { InvoiceStatusBadge } from "@/components/invoices/status-badge";

const STATUSES = ["DRAFT", "SENT", "ACCEPTED", "REJECTED", "EXPIRED"] as const;

const STATUS_LABELS: Record<(typeof STATUSES)[number], string> = {
  DRAFT: "Draft",
  SENT: "Sent",
  ACCEPTED: "Accepted",
  REJECTED: "Rejected",
  EXPIRED: "Expired",
};

const dateFmt = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

export default async function QuotationsPage({
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

  const { quotations, total, pageCount } = await listQuotations(session.user.id, {
    q: q || undefined,
    status,
    page,
  });

  const makeHref = (p: number) => {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    if (status) sp.set("status", status);
    sp.set("page", String(p));
    return `/quotations?${sp.toString()}`;
  };

  return (
    <div className="-m-4 min-h-[calc(100dvh-4rem)] space-y-6 bg-muted/60 p-4 md:-m-6 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Quotations</h1>
          <p className="text-sm text-muted-foreground">
            Drafts, sent quotations and their conversions.
          </p>
        </div>
        <Button asChild>
          <Link href="/quotations/new">New Quotation</Link>
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
          aria-label="Search quotations"
        />
        <Select name="status" defaultValue={status ?? ""} aria-label="Filter by status" className="w-40">
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
            <Link href="/quotations">Clear</Link>
          </Button>
        ) : null}
      </form>

      <Card>
        <CardContent className="p-0">
          {quotations.length === 0 ? (
            <div className="p-6">
              <p className="text-sm text-muted-foreground">
                {total === 0 && !q && !status
                  ? "No quotations yet. Create your first quotation to start quoting."
                  : "No quotations match these filters — try a different search or clear the filters."}
              </p>
              {total === 0 && !q && !status ? (
                <Button asChild size="sm" className="mt-3">
                  <Link href="/quotations/new">Create your first quotation</Link>
                </Button>
              ) : null}
            </div>
          ) : (
            <ul className="divide-y">
              {quotations.map((qt) => (
                <li key={qt.id}>
                  <Link
                    href={`/quotations/${qt.id}`}
                    className="flex flex-wrap items-center justify-between gap-2 px-6 py-4 hover:bg-accent/50"
                  >
                    <div className="min-w-0">
                      <p className="font-medium">
                        {isDraftNumber(qt.number) ? "Draft quotation" : qt.number}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {qt.customer.companyName ?? qt.customer.name}
                        {` · Issued ${dateFmt.format(qt.issueDate)}`}
                        {qt.convertedInvoice
                          ? ` · Converted to ${isDraftNumber(qt.convertedInvoice.number) ? "Draft" : qt.convertedInvoice.number}`
                          : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <InvoiceStatusBadge status={qt.status} />
                      <p className="font-semibold tabular-nums">
                        {formatMoney(qt.grandTotal.toString(), qt.currency)}
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
          {total} quotation{total === 1 ? "" : "s"}
        </p>
      ) : null}
    </div>
  );
}
