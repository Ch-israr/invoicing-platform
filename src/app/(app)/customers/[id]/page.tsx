import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import {
  Banknote,
  Hourglass,
  Mail,
  Phone,
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  CustomerTransactions,
  type CustomerTransactionRow,
} from "@/components/customers/customer-transactions";
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

  const { business, customer, stats, invoices, payments, creditNotes } = detail;
  const currency = business.currency;
  const now = new Date();
  const overdueBalance = dec(stats.overdueBalance);
  const outstanding = dec(stats.outstanding);
  const isActive = customer.status === "ACTIVE";

  // One unified transaction list: invoices, payments and credit notes,
  // newest first. Serialized to plain JSON for the client filter/table.
  const transactions: CustomerTransactionRow[] = [
    ...invoices.map((inv) => {
      const isOverdue =
        (OPEN_STATUSES as readonly string[]).includes(inv.status) &&
        new Date(inv.dueDate) < now &&
        dec(inv.balance) > 0;
      return {
        id: `invoice-${inv.id}`,
        kind: "invoice" as const,
        date: new Date(inv.issueDate).toISOString(),
        typeLabel: "Invoice",
        detail: `Due ${new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(inv.dueDate))}`,
        number: isDraftNumber(inv.number) ? "Draft" : inv.number,
        href: `/invoices/${inv.id}`,
        amount: dec(inv.grandTotal),
        statusKey: inv.status,
        isOverdue,
        dueLabel: isOverdue
          ? `${formatMoney(dec(inv.balance), currency)} due`
          : null,
      };
    }),
    ...payments.map((p) => ({
      id: `payment-${p.id}`,
      kind: "payment" as const,
      date: new Date(p.date).toISOString(),
      typeLabel: "Payment",
      detail: `${METHOD_LABELS[p.method] ?? p.method} · Invoice ${isDraftNumber(p.invoice.number) ? "Draft" : p.invoice.number}`,
      number: p.reference ?? "—",
      href: `/payments/${p.id}/receipt`,
      amount: dec(p.amount),
      statusKey: "RECEIVED",
      isOverdue: false,
      dueLabel: null,
    })),
    ...creditNotes.map((cn) => ({
      id: `credit-note-${cn.id}`,
      kind: "credit-note" as const,
      date: new Date(cn.createdAt).toISOString(),
      typeLabel: "Credit note",
      detail: `Invoice ${isDraftNumber(cn.invoice.number) ? "Draft" : cn.invoice.number}`,
      number: cn.number,
      href: `/credit-notes/${cn.id}`,
      amount: -dec(cn.grandTotal),
      statusKey: cn.status,
      isOverdue: false,
      dueLabel: null,
    })),
  ].sort((a, b) => +new Date(b.date) - +new Date(a.date));

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
      hint: "Issued invoices",
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
          {customer.email || customer.phone ? (
            <div className="mt-2 flex gap-1.5">
              {customer.email ? (
                <Button asChild variant="outline" size="icon" className="h-8 w-8" aria-label={`Email ${customer.email}`}>
                  <a href={`mailto:${customer.email}`}>
                    <Mail className="h-4 w-4" aria-hidden />
                  </a>
                </Button>
              ) : null}
              {customer.phone ? (
                <Button asChild variant="outline" size="icon" className="h-8 w-8" aria-label={`Call ${customer.phone}`}>
                  <a href={`tel:${customer.phone}`}>
                    <Phone className="h-4 w-4" aria-hidden />
                  </a>
                </Button>
              ) : null}
            </div>
          ) : null}
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

      {/* Financial summary: a distinct blue-tinted card of its own, in the
          reference's shape — titled, with the outstanding balance as the
          large figure and the overdue payment as a dot-labelled row. The
          outstanding balance IS the open balance, so it is not repeated. */}
      <Card className="border-primary/20 bg-primary/[0.04] dark:bg-primary/[0.08]">
        <CardContent className="space-y-4 p-6">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <span className="rounded-md bg-primary/10 p-1.5 text-primary">
              <Wallet className="h-4 w-4" aria-hidden />
            </span>
            Financial summary
          </p>
          <div className="flex flex-wrap items-center justify-between gap-6">
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
              <p className="flex items-center gap-2 text-sm text-muted-foreground sm:justify-end">
                <span className="h-2 w-2 rounded-full bg-red-600" aria-hidden />
                Overdue payment
              </p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-red-700 dark:text-red-400">
                {formatMoney(overdueBalance, currency)}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {overdueBalance > 0
                  ? "Chase these first — they are past their due date."
                  : "Nothing overdue."}
              </p>
            </div>
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
          <p>
            <span className="text-muted-foreground">Billing address: </span>
            {customer.billingAddress ?? (
              <Link href={`/customers/${customer.id}/edit`} className="font-medium text-primary hover:underline">
                Add billing address
              </Link>
            )}
          </p>
          <p>
            <span className="text-muted-foreground">Shipping address: </span>
            {customer.shippingAddress ?? (
              <Link href={`/customers/${customer.id}/edit`} className="font-medium text-primary hover:underline">
                Add shipping address
              </Link>
            )}
          </p>
          {customer.notes ? (
            <p className="sm:col-span-2"><span className="text-muted-foreground">Notes: </span>{customer.notes}</p>
          ) : null}
        </CardContent>
      </Card>

      <CustomerTransactions rows={transactions} currency={currency} />
    </div>
  );
}
