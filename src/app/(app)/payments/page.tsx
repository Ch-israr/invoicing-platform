import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { parsePage } from "@/lib/pagination";
import { listPayments } from "@/server/services/payment.service";
import { formatMoney } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Pagination } from "@/components/shared/pagination";

const METHODS = ["CASH", "BANK_TRANSFER", "CARD", "OTHER"] as const;

const METHOD_LABELS: Record<string, string> = {
  CASH: "Cash",
  BANK_TRANSFER: "Bank transfer",
  CARD: "Card",
  OTHER: "Other",
};

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const params = await searchParams;

  const q = typeof params.q === "string" ? params.q : "";
  const method =
    typeof params.method === "string" &&
    (METHODS as readonly string[]).includes(params.method)
      ? (params.method as (typeof METHODS)[number])
      : undefined;
  const page = parsePage(params.page);

  const { payments, total, pageCount } = await listPayments(session.user.id, {
    q: q || undefined,
    method,
    page,
  });

  const makeHref = (p: number) => {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    if (method) sp.set("method", method);
    sp.set("page", String(p));
    return `/payments?${sp.toString()}`;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Payments</h1>
        <p className="text-sm text-muted-foreground">
          Money received against invoices. Payments are recorded from the
          invoice page.
        </p>
      </div>

      <form className="flex flex-wrap gap-2" method="get">
        <Input
          name="q"
          defaultValue={q}
          placeholder="Search invoice, customer or reference…"
          className="w-72"
        />
        <Select name="method" defaultValue={method ?? ""}>
          <option value="">All methods</option>
          {METHODS.map((m) => (
            <option key={m} value={m}>
              {METHOD_LABELS[m]}
            </option>
          ))}
        </Select>
        <Button type="submit" variant="outline">
          Filter
        </Button>
        {q || method ? (
          <Button variant="ghost" asChild>
            <Link href="/payments">Clear</Link>
          </Button>
        ) : null}
      </form>

      <Card>
        <CardContent className="p-0">
          {payments.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">
              No payments yet. Record one from an issued invoice.
            </p>
          ) : (
            <ul className="divide-y">
              {payments.map((p) => (
                <li
                  key={p.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-6 py-4"
                >
                  <Link
                    href={`/invoices/${p.invoice.id}`}
                    className="min-w-0 hover:underline"
                  >
                    <p className="font-medium">
                      {formatMoney(p.amount.toString(), p.currency)}
                      <span className="ml-2 text-sm font-normal text-muted-foreground">
                        {METHOD_LABELS[p.method] ?? p.method} ·{" "}
                        {new Intl.DateTimeFormat("en-GB", {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                          timeZone: "UTC",
                        }).format(p.date)}
                      </span>
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Invoice {p.invoice.number} ·{" "}
                      {p.invoice.customer.companyName ?? p.invoice.customer.name}
                      {p.reference ? ` · Ref: ${p.reference}` : ""}
                      {p.refunded.toString() !== "0"
                        ? ` · Refunded ${formatMoney(p.refunded.toString(), p.currency)}`
                        : ""}
                    </p>
                  </Link>
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/payments/${p.id}/receipt`}>Receipt</Link>
                  </Button>
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
          {total} payment{total === 1 ? "" : "s"}
        </p>
      ) : null}
    </div>
  );
}
