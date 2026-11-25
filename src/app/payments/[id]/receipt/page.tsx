import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { TenantError } from "@/lib/tenant";
import { formatMoney } from "@/lib/utils";
import { getReceiptData } from "@/server/services/payment.service";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InvoiceStatusBadge } from "@/components/invoices/status-badge";
import { PrintButton } from "@/components/invoices/print-button";

const METHOD_LABELS: Record<string, string> = {
  CASH: "Cash",
  BANK_TRANSFER: "Bank transfer",
  CARD: "Card",
  OTHER: "Other",
};

const OPEN_STATUSES = ["ISSUED", "SENT", "PARTIALLY_PAID"] as const;

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(value);
}

/**
 * Payment receipt — a bare print page (same pattern as the invoice
 * print view). A receipt records a payment; it is not a new money
 * movement. Totals are the ledger state as of now: net paid to date
 * and the remaining balance.
 *
 * On screen the receipt is shown as document + action rail (the
 * round-1 invoice-detail pattern); the rail is hidden when printing
 * so only the document prints.
 */
export default async function PaymentReceiptPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const { id } = await params;

  let data;
  try {
    data = await getReceiptData(session.user.id, id);
  } catch (err) {
    if (err instanceof TenantError) notFound();
    throw err;
  }

  const { business, payment, invoice, customer, refundedTotal, totalPaid, credited, balance } =
    data;
  const currency = invoice.currency;
  const netThisPayment = payment.amount.toString();
  const isOverdue =
    (OPEN_STATUSES as readonly string[]).includes(invoice.status) &&
    new Date(invoice.dueDate) < new Date() &&
    Number(balance.toString()) > 0;

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6 print:max-w-none print:p-0">
      <div className="flex items-center justify-between print:hidden">
        <p className="text-sm text-muted-foreground">
          Payment receipt —{" "}
          <Link href={`/invoices/${invoice.id}`} className="underline">
            Invoice {invoice.number}
          </Link>
        </p>
        <PrintButton />
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_280px] print:block">
        <div className="overflow-hidden rounded-lg border bg-white p-6 text-slate-900 shadow-sm md:p-8 dark:bg-slate-950 dark:text-slate-100">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xl font-bold">{business.name}</p>
              {business.trn ? (
                <p className="text-sm text-slate-500">TRN: {business.trn}</p>
              ) : null}
              {business.address ? (
                <p className="whitespace-pre-line text-sm text-slate-500">{business.address}</p>
              ) : null}
              {business.phone || business.email ? (
                <p className="text-sm text-slate-500">
                  {[business.phone, business.email].filter(Boolean).join(" · ")}
                </p>
              ) : null}
            </div>
            <div className="text-end">
              <p className="text-2xl font-bold">Payment Receipt</p>
              <p className="mt-1 text-sm text-slate-500">{formatDate(payment.date)}</p>
            </div>
          </div>

          <div className="mt-6 space-y-1 text-sm">
            <p>
              <span className="text-slate-500">Received from: </span>
              {customer.companyName ?? customer.name}
            </p>
            <p>
              <span className="text-slate-500">For invoice: </span>
              {invoice.number} ({formatMoney(invoice.grandTotal.toString(), currency)})
            </p>
            <p>
              <span className="text-slate-500">Method: </span>
              {METHOD_LABELS[payment.method] ?? payment.method}
            </p>
            {payment.reference ? (
              <p>
                <span className="text-slate-500">Reference: </span>
                {payment.reference}
              </p>
            ) : null}
            {payment.notes ? (
              <p className="whitespace-pre-line">
                <span className="text-slate-500">Notes: </span>
                {payment.notes}
              </p>
            ) : null}
          </div>

          <dl className="mt-6 space-y-1.5 border-t pt-4 text-sm">
            <div className="flex justify-between text-base font-bold">
              <dt>Amount received</dt>
              <dd>{formatMoney(netThisPayment, currency)}</dd>
            </div>
            {refundedTotal.toString() !== "0" ? (
              <div className="flex justify-between">
                <dt className="text-slate-500">Refunded from this payment</dt>
                <dd>−{formatMoney(refundedTotal.toString(), currency)}</dd>
              </div>
            ) : null}
            <div className="flex justify-between">
              <dt className="text-slate-500">Total paid on this invoice (net)</dt>
              <dd>{formatMoney(totalPaid.toString(), currency)}</dd>
            </div>
            {credited.toString() !== "0" ? (
              <div className="flex justify-between">
                <dt className="text-slate-500">Credited</dt>
                <dd>−{formatMoney(credited.toString(), currency)}</dd>
              </div>
            ) : null}
            <div className="flex justify-between font-semibold">
              <dt>Remaining balance</dt>
              <dd>{formatMoney(balance.toString(), currency)}</dd>
            </div>
          </dl>
        </div>

        <div className="space-y-4 print:hidden">
          <Card>
            <CardHeader>
              <CardTitle>Status</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <InvoiceStatusBadge status={invoice.status} isOverdue={isOverdue} />
              <div>
                <p className="text-xs text-muted-foreground">Amount received</p>
                <p className="text-2xl font-bold tracking-tight tabular-nums">
                  {formatMoney(netThisPayment, currency)}
                </p>
              </div>
              <div className="rounded-lg bg-muted/60 px-3 py-2">
                <p className="text-xs text-muted-foreground">Remaining balance</p>
                <p className="text-xl font-bold tabular-nums">
                  {formatMoney(balance.toString(), currency)}
                </p>
              </div>
              <p className="text-xs text-muted-foreground">
                Total paid on this invoice (net):{" "}
                {formatMoney(totalPaid.toString(), currency)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button asChild variant="outline" className="w-full">
                <Link href={`/invoices/${invoice.id}`}>View invoice</Link>
              </Button>
              <Button asChild variant="outline" className="w-full">
                <Link href="/payments">All payments</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
