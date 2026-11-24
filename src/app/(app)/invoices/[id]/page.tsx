import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { TenantError } from "@/lib/tenant";
import { formatMoney } from "@/lib/utils";
import { isDraftNumber } from "@/lib/numbering";
import {
  isSnapshotPayload,
  previewDataFromLive,
  previewDataFromSnapshot,
  type InvoicePreviewData,
} from "@/lib/invoice-preview";
import { getInvoiceDetail } from "@/server/services/invoice.service";
import { getInvoiceEmailHistory } from "@/server/email/service";
import { listPortalTokens } from "@/server/services/portal.service";
import { retryEmailAction } from "../../emails/actions";
import { PortalTokenManager } from "@/components/portal/portal-token-manager";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DeleteButton } from "@/components/shared/delete-button";
import { InvoicePreview } from "@/components/invoices/invoice-preview";
import { InvoiceStatusBadge } from "@/components/invoices/status-badge";
import { PaymentForm } from "@/components/invoices/payment-form";
import { PaymentList } from "@/components/invoices/payment-list";
import {
  deleteInvoiceAction,
  issueInvoiceAction,
  regeneratePdfAction,
  sendInvoiceEmailAction,
  voidInvoiceAction,
} from "../actions";

export default async function InvoiceDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const { id } = await params;
  const query = await searchParams;
  const actionError = typeof query.actionError === "string" ? query.actionError : undefined;
  const emailSent = query.emailSent === "1";

  let detail;
  let emailHistory: Awaited<ReturnType<typeof getInvoiceEmailHistory>>["emails"] = [];
  let portalTokens: Awaited<ReturnType<typeof listPortalTokens>> = [];
  try {
    detail = await getInvoiceDetail(session.user.id, id);
    emailHistory = (await getInvoiceEmailHistory(session.user.id, id)).emails;
    if (detail.invoice.status !== "DRAFT") {
      portalTokens = await listPortalTokens(session.user.id, { invoiceId: id });
    }
  } catch (err) {
    if (err instanceof TenantError) notFound();
    throw err;
  }

  const { business, invoice, canManage, canWrite, isOverdue, daysOverdue, payments, creditNotes, creditTotal, fullyCredited } = detail;
  const currency = business.currency;
  const isDraft = invoice.status === "DRAFT";
  const canVoid =
    (invoice.status === "ISSUED" || invoice.status === "SENT") &&
    Number(invoice.amountPaid) === 0;
  const canPay =
    !isDraft &&
    invoice.status !== "CANCELLED" &&
    invoice.status !== "PAID" &&
    Number(invoice.balance) > 0;
  const canSend =
    !isDraft &&
    invoice.status !== "CANCELLED" &&
    canWrite &&
    Boolean(invoice.customer.email);

  // Issued invoices render from the frozen snapshot; drafts (and any
  // invoice without a snapshot) render from the live rows.
  let previewData: InvoicePreviewData;
  if (invoice.snapshot && isSnapshotPayload(invoice.snapshot.payload)) {
    previewData = previewDataFromSnapshot(invoice.snapshot.payload);
  } else {
    previewData = previewDataFromLive(
      invoice,
      business,
      invoice.customer,
      isDraft,
    );
  }

  const stats = [
    { label: "Subtotal", value: formatMoney(invoice.subtotal.toString(), currency) },
    { label: "VAT", value: formatMoney(invoice.vatAmount.toString(), currency) },
    { label: "Grand total", value: formatMoney(invoice.grandTotal.toString(), currency) },
    { label: "Amount paid", value: formatMoney(invoice.amountPaid.toString(), currency) },
    { label: "Balance due", value: formatMoney(invoice.balance.toString(), currency) },
  ];

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">
            {isDraftNumber(invoice.number) ? "Draft invoice" : `Invoice ${invoice.number}`}
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <InvoiceStatusBadge status={invoice.status} isOverdue={isOverdue} />
            {isOverdue ? <span>{daysOverdue} day{daysOverdue === 1 ? "" : "s"} overdue</span> : null}
            <span>
              {invoice.customer.companyName ?? invoice.customer.name}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href={`/api/invoices/${invoice.id}/pdf`}>Download PDF</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={`/invoices/${invoice.id}/print`} target="_blank">
              Print
            </Link>
          </Button>
          {!isDraft && canManage ? (
            <form action={regeneratePdfAction}>
              <input type="hidden" name="id" value={invoice.id} />
              <Button type="submit" variant="outline">
                Regenerate PDF
              </Button>
            </form>
          ) : null}
          {canSend ? (
            <form action={sendInvoiceEmailAction}>
              <input type="hidden" name="id" value={invoice.id} />
              <Button type="submit" variant="default">
                Send by email
              </Button>
            </form>
          ) : null}
          {isDraft ? (
            <Button asChild>
              <Link href={`/invoices/${invoice.id}/edit`}>Edit draft</Link>
            </Button>
          ) : null}
          {isDraft && canManage ? (
            <form action={issueInvoiceAction}>
              <input type="hidden" name="id" value={invoice.id} />
              <Button type="submit" variant="default">
                Issue invoice
              </Button>
            </form>
          ) : null}
          {canVoid && canManage ? (
            <form action={voidInvoiceAction}>
              <input type="hidden" name="id" value={invoice.id} />
              <Button type="submit" variant="outline">
                Void invoice
              </Button>
            </form>
          ) : null}
          {isDraft ? (
            <form action={deleteInvoiceAction}>
              <input type="hidden" name="id" value={invoice.id} />
              <DeleteButton label="Delete draft" />
            </form>
          ) : null}
        </div>
      </div>

      {actionError ? (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {actionError}
        </p>
      ) : null}
      {emailSent ? (
        <p className="rounded-md bg-green-600/10 px-3 py-2 text-sm text-green-700 dark:text-green-400">
          Email sent to {invoice.customer.email}.
        </p>
      ) : null}

      {!isDraft && invoice.snapshot ? (
        <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
          This invoice was issued and is now frozen — the preview below is
          the snapshot taken at issue time. To correct it, void it (if
          unpaid) or issue a credit note.
          {invoice.documents.length > 0
            ? ` PDF stored (${((invoice.documents[0].fileSize ?? 0) / 1024).toFixed(0)} KB).`
            : " PDF is generated on first download."}
        </p>
      ) : null}
      {isDraft ? (
        <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
          Draft — downloading the PDF renders a watermarked preview; the
          stored PDF is created when the invoice is issued.
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className="mt-1 text-lg font-semibold">{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {fullyCredited ? (
        <p className="rounded-md bg-amber-600/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
          Fully credited — the balance was reduced to zero by credit note
          ({formatMoney(creditTotal.toString(), currency)} credited). This
          invoice is resolved, not paid.
        </p>
      ) : null}

      {!isDraft ? (
        <Card>
          <CardHeader>
            <CardTitle>Payments</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {canWrite && canPay ? (
              <PaymentForm
                invoiceId={invoice.id}
                currency={currency}
                balance={invoice.balance.toString()}
              />
            ) : null}
            <PaymentList
              invoiceId={invoice.id}
              payments={payments.map((p) => ({
                ...p,
                amount: p.amount.toString(),
                refunds: p.refunds.map((r) => ({ ...r, amount: r.amount.toString() })),
              }))}
              currency={currency}
              canManage={canManage}
            />
          </CardContent>
        </Card>
      ) : null}

      {!isDraft ? (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-4">
              <CardTitle>Credit notes</CardTitle>
              {canWrite && canPay ? (
                <Button asChild variant="outline" size="sm">
                  <Link href={`/invoices/${invoice.id}/credit-notes/new`}>
                    New credit note
                  </Link>
                </Button>
              ) : null}
            </div>
          </CardHeader>
          <CardContent>
            {creditNotes.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No credit notes for this invoice. A credit note reduces the
                balance without changing the invoice.
              </p>
            ) : (
              <ul className="space-y-2">
                {creditNotes.map((c) => (
                  <li
                    key={c.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
                  >
                    <div>
                      <Link
                        href={`/credit-notes/${c.id}`}
                        className="font-medium underline"
                      >
                        {c.number}
                      </Link>
                      <span className="ml-2 text-sm text-muted-foreground">
                        {c.status === "CANCELLED" ? "Cancelled" : "Issued"}
                        {c.reason ? ` — ${c.reason}` : ""}
                      </span>
                    </div>
                    <p className="font-medium">
                      −{formatMoney(c.grandTotal.toString(), currency)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      ) : null}

      {!isDraft ? (
        <Card>
          <CardHeader>
            <CardTitle>Email history</CardTitle>
          </CardHeader>
          <CardContent>
            {!invoice.customer.email ? (
              <p className="text-sm text-muted-foreground">
                This customer has no email address — add one to send this
                invoice by email.
              </p>
            ) : emailHistory.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Not sent yet. Use “Send by email” above to send this invoice
                to {invoice.customer.email} with the PDF attached.
              </p>
            ) : (
              <ul className="space-y-2">
                {emailHistory.map((e) => (
                  <li
                    key={e.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
                  >
                    <div>
                      <p className="font-medium">{e.subject}</p>
                      <p className="text-sm text-muted-foreground">
                        To {e.to} · {e.status}
                        {e.attempts > 0 ? ` · ${e.attempts} attempt${e.attempts === 1 ? "" : "s"}` : ""}
                        {e.sentAt ? ` · sent ${e.sentAt.toLocaleString()}` : ""}
                      </p>
                      {e.error ? (
                        <p className="text-sm text-destructive">{e.error}</p>
                      ) : null}
                    </div>
                    {e.status === "FAILED" && e.attempts < 3 && canWrite ? (
                      <form action={retryEmailAction}>
                        <input type="hidden" name="id" value={e.id} />
                        <input type="hidden" name="back" value={`/invoices/${invoice.id}`} />
                        <Button type="submit" variant="outline" size="sm">
                          Retry
                        </Button>
                      </form>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      ) : null}

      {!isDraft ? (
        <Card>
          <CardHeader>
            <CardTitle>Customer portal</CardTitle>
          </CardHeader>
          <CardContent>
            <PortalTokenManager
              kind="invoice"
              documentId={invoice.id}
              tokens={portalTokens}
              canManage={canManage}
              backPath={`/invoices/${invoice.id}`}
            />
          </CardContent>
        </Card>
      ) : null}

      <InvoicePreview data={previewData} />
    </div>
  );
}
