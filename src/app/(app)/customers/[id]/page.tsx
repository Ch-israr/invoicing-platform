import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import {
  Banknote,
  Hourglass,
  ReceiptText,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { auth } from "@/lib/auth";
import { TenantError } from "@/lib/tenant";
import { cn, formatMoney } from "@/lib/utils";
import { isDraftNumber } from "@/lib/numbering";
import { getCustomerDetail } from "@/server/services/customer.service";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { InvoiceStatusBadge } from "@/components/invoices/status-badge";
import { DeleteButton } from "@/components/shared/delete-button";
import { deleteCustomerAction } from "../actions";

const OPEN_STATUSES = ["ISSUED", "SENT", "PARTIALLY_PAID"] as const;

const METHOD_LABELS: Record<string, string> = {
  CASH: "Cash",
  BANK_TRANSFER: "Bank transfer",
  CARD: "Card",
  OTHER: "Other",
};

function dec(value: unknown): number {
  return value === null || value === undefined ? 0 : Number(value);
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

function shortDate(value: Date | string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const { id } = await params;

  let detail;
  try {
    detail = await getCustomerDetail(session.user.id, id);
  } catch (err) {
    if (err instanceof TenantError) notFound();
    throw err;
  }

  const { business, customer, stats, invoices, payments } = detail;
  const currency = business.currency;
  const now = new Date();
  const overdueBalance = dec(stats.overdueBalance);
  const outstanding = dec(stats.outstanding);
  const isActive = customer.status === "ACTIVE";

  // Secondary figures share the dashboard's fixed pattern: small grey
  // label, one large bold figure, one small context line, with an
  // icon chip whose tint is keyed to meaning.
  const secondaryStats: {
    label: string;
    value: string;
    hint: string;
    icon: LucideIcon;
    chip: string;
  }[] = [
    {
      label: "Invoices",
      value: String(stats.invoiceCount),
      hint: "Total invoices",
      icon: ReceiptText,
      chip: "bg-slate-500/10 text-slate-600 dark:text-slate-400",
    },
    {
      label: "Total Billed",
      value: formatMoney(dec(stats.totalBilled), currency),
      hint: "Issued and paid invoices",
      icon: Banknote,
      chip: "bg-green-600/10 text-green-700 dark:text-green-400",
    },
    {
      label: "Total Paid",
      value: formatMoney(dec(stats.totalPaid), currency),
      hint: "Payments received",
      icon: Wallet,
      chip: "bg-blue-600/10 text-blue-700 dark:text-blue-400",
    },
  ];

  return (
    <div className="-m-4 min-h-[calc(100dvh-4rem)] space-y-6 bg-muted/60 p-4 md:-m-6 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{customer.name}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>
              {customer.type === "COMPANY" ? "Company" : "Individual"}
              {customer.companyName ? ` · ${customer.companyName}` : ""}
            </span>
            <span
              className={cn(
                "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                isActive
                  ? "bg-green-600/10 text-green-700 dark:text-green-400"
                  : "bg-slate-500/10 text-slate-600 dark:text-slate-400",
              )}
            >
              {isActive ? "Active" : "Inactive"}
            </span>
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild>
            <Link href="/invoices/new">New Invoice</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href={`/customers/${customer.id}/edit`}>Edit</Link>
          </Button>
          <form action={deleteCustomerAction}>
            <input type="hidden" name="id" value={customer.id} />
            <DeleteButton label="Delete" />
          </form>
        </div>
      </div>

      {/* Hero figure: the outstanding balance is the number that matters
          most, so it gets the large figure; the overdue block sits beside
          it, mirroring the dashboard hero. */}
      <Card className="border-primary/20">
        <CardContent className="flex flex-wrap items-center justify-between gap-6 p-6">
          <div>
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="rounded-md bg-amber-600/10 p-1.5 text-amber-700 dark:text-amber-400">
                <Hourglass className="h-4 w-4" aria-hidden />
              </span>
              Outstanding balance
            </p>
            <p className="mt-2 text-4xl font-bold tracking-tight tabular-nums">
              {formatMoney(outstanding, currency)}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {stats.invoiceCount}{" "}
              {plural(stats.invoiceCount, "invoice", "invoices")} ·{" "}
              {stats.overdueCount}{" "}
              {plural(stats.overdueCount, "overdue", "overdue")}
            </p>
          </div>
          <div className="text-left sm:text-right">
            <p className="text-sm text-muted-foreground">Overdue</p>
            <p className="text-2xl font-bold tabular-nums text-amber-700 dark:text-amber-400">
              {formatMoney(overdueBalance, currency)}
            </p>
            <p className="text-sm text-muted-foreground">
              {overdueBalance > 0
                ? "Chase these first — they are past their due date."
                : "Nothing overdue."}
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 [&>*]:min-w-0">
        {secondaryStats.map((s) => (
          <Card key={s.label}>
            <CardContent className="p-5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm text-muted-foreground">{s.label}</p>
                <span className={cn("rounded-md p-1.5", s.chip)}>
                  <s.icon className="h-4 w-4" aria-hidden />
                </span>
              </div>
              <p className="mt-2 text-2xl font-bold tracking-tight tabular-nums">
                {s.value}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">{s.hint}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
          <p><span className="text-muted-foreground">Email: </span>{customer.email ?? "—"}</p>
          <p><span className="text-muted-foreground">Phone: </span>{customer.phone ?? "—"}</p>
          <p><span className="text-muted-foreground">Country: </span>{customer.country}</p>
          <p><span className="text-muted-foreground">TRN: </span>{customer.trn ?? "—"}</p>
          <p><span className="text-muted-foreground">Billing address: </span>{customer.billingAddress ?? "—"}</p>
          <p><span className="text-muted-foreground">Shipping address: </span>{customer.shippingAddress ?? "—"}</p>
          {customer.notes ? (
            <p className="sm:col-span-2"><span className="text-muted-foreground">Notes: </span>{customer.notes}</p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1.5">
              <CardTitle>Invoice History</CardTitle>
              <CardDescription>
                {invoices.length === 0
                  ? "No invoices yet — create the first one to start billing this customer."
                  : "Latest invoices for this customer — open one to follow up."}
              </CardDescription>
            </div>
            {invoices.length > 0 ? (
              <Button asChild variant="ghost" size="sm" className="shrink-0">
                <Link href="/invoices">View all</Link>
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent>
          {invoices.length === 0 ? (
            <div>
              <p className="text-sm text-muted-foreground">
                Nothing here yet.
              </p>
              <Button asChild size="sm" className="mt-3">
                <Link href="/invoices/new">Create invoice</Link>
              </Button>
            </div>
          ) : (
            <ul className="space-y-1">
              {invoices.map((inv) => {
                const isOverdue =
                  (OPEN_STATUSES as readonly string[]).includes(inv.status) &&
                  new Date(inv.dueDate) < now &&
                  dec(inv.balance) > 0;
                return (
                  <li key={inv.id}>
                    <Link
                      href={`/invoices/${inv.id}`}
                      className={cn(
                        "flex items-center justify-between gap-3 rounded-lg px-2 py-2 text-sm transition-colors hover:bg-muted/60",
                        isOverdue &&
                          "bg-red-50/70 hover:bg-red-100/70 dark:bg-red-950/20 dark:hover:bg-red-950/30",
                      )}
                    >
                      <span className="min-w-0 truncate">
                        <span className="font-medium">
                          {isDraftNumber(inv.number) ? "Draft" : inv.number}
                        </span>
                        <span className="text-muted-foreground">
                          {" "}· due {shortDate(inv.dueDate)}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <InvoiceStatusBadge status={inv.status} isOverdue={isOverdue} />
                        <span className="font-medium tabular-nums">
                          {formatMoney(dec(inv.grandTotal), currency)}
                          {dec(inv.balance) > 0 ? (
                            <span className="hidden text-muted-foreground sm:inline">
                              {" "}({formatMoney(dec(inv.balance), currency)} due)
                            </span>
                          ) : null}
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1.5">
              <CardTitle>Payment History</CardTitle>
              <CardDescription>
                {payments.length === 0
                  ? "No payments recorded yet."
                  : "Latest payments from this customer."}
              </CardDescription>
            </div>
            {payments.length > 0 ? (
              <Button asChild variant="ghost" size="sm" className="shrink-0">
                <Link href="/payments">View all</Link>
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent>
          {payments.length === 0 ? (
            <div>
              <p className="text-sm text-muted-foreground">
                No payments recorded yet. Record one from an issued invoice.
              </p>
              <Button asChild size="sm" variant="outline" className="mt-3">
                <Link href="/invoices">View invoices</Link>
              </Button>
            </div>
          ) : (
            <ul className="space-y-1">
              {payments.map((p) => (
                <li key={p.id}>
                  <Link
                    href={`/payments/${p.id}/receipt`}
                    className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 text-sm transition-colors hover:bg-muted/60"
                  >
                    <span className="min-w-0 truncate">
                      <span className="font-medium">{shortDate(p.date)}</span>
                      <span className="text-muted-foreground">
                        {" "}· {METHOD_LABELS[p.method] ?? p.method} · Invoice {p.invoice.number}
                        {p.reference ? ` · ${p.reference}` : ""}
                      </span>
                    </span>
                    <span className="shrink-0 font-medium tabular-nums">
                      {formatMoney(dec(p.amount), currency)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
