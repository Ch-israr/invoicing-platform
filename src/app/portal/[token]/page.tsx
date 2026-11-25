import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { formatMoney } from "@/lib/utils";
import {
  isSnapshotPayload,
  previewDataFromLive,
  previewDataFromQuotation,
  previewDataFromSnapshot,
  type InvoicePreviewData,
} from "@/lib/invoice-preview";
import {
  getPortalCustomerDocuments,
  getPortalInvoice,
  getPortalQuotation,
  verifyPortalToken,
  type PortalContext,
} from "@/server/services/portal.service";
import { InvoicePreview } from "@/components/invoices/invoice-preview";
import { InvoiceStatusBadge } from "@/components/invoices/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  acceptQuotationPortalAction,
  rejectQuotationPortalAction,
} from "./actions";

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

async function clientIp(): Promise<string> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return h.get("x-real-ip") ?? "unknown";
}

function PortalShell({
  businessName,
  children,
}: {
  businessName: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-muted/60">
      <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
        <header className="border-b pb-4">
          <p className="text-sm font-semibold">{businessName}</p>
          <p className="text-xs text-muted-foreground">Customer portal</p>
        </header>
        {children}
      </div>
    </div>
  );
}

function InvalidLink() {
  return (
    <div className="min-h-dvh bg-muted/60">
      <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
        <Card>
          <CardHeader>
            <CardTitle>This link is no longer valid</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              The link may have expired or been revoked. Please ask the
              business to send you a fresh link.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

async function InvoiceView({
  token,
  context,
  invoiceId,
  showBack,
}: {
  token: string;
  context: PortalContext;
  invoiceId: string;
  showBack: boolean;
}) {
  const data = await getPortalInvoice(context, invoiceId);
  if (!data) notFound();
  const { business, invoice } = data;
  const currency = business.currency;
  let previewData: InvoicePreviewData;
  if (invoice.snapshot && isSnapshotPayload(invoice.snapshot.payload)) {
    previewData = previewDataFromSnapshot(invoice.snapshot.payload);
  } else {
    previewData = previewDataFromLive(invoice, business, invoice.customer, false);
  }
  return (
    <PortalShell businessName={business.name}>
      {showBack ? (
        <p>
          <Link href={`/portal/${token}`} className="text-sm underline">
            ← Back to your documents
          </Link>
        </p>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Invoice {invoice.number}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <InvoiceStatusBadge status={invoice.status} />
            <span>{invoice.customer.companyName ?? invoice.customer.name}</span>
          </p>
        </div>
        <Button asChild>
          <a href={`/api/portal/${token}/pdf?invoiceId=${invoice.id}`}>
            Download PDF
          </a>
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 [&>*]:min-w-0">
        {[
          { label: "Grand total", value: formatMoney(invoice.grandTotal.toString(), currency) },
          { label: "Amount paid", value: formatMoney(invoice.amountPaid.toString(), currency) },
          { label: "Balance due", value: formatMoney(invoice.balance.toString(), currency) },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className="mt-1 text-2xl font-bold tracking-tight tabular-nums">{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <InvoicePreview data={previewData} />
    </PortalShell>
  );
}

async function QuotationView({
  token,
  context,
  quotationId,
  showBack,
  decided,
  portalError,
}: {
  token: string;
  context: PortalContext;
  quotationId: string;
  showBack: boolean;
  decided?: string;
  portalError?: string;
}) {
  const data = await getPortalQuotation(context, quotationId);
  if (!data) notFound();
  const { business, settings, quotation } = data;
  const template =
    settings?.pdfTemplate === "modern" || settings?.pdfTemplate === "minimal"
      ? settings.pdfTemplate
      : "classic";
  const locale = settings?.locale === "ar" ? "ar" : "en";
  const previewData = previewDataFromQuotation(
    quotation,
    business,
    quotation.customer,
    template,
    locale,
    false,
  );
  const isSent = quotation.status === "SENT";
  return (
    <PortalShell businessName={business.name}>
      {showBack ? (
        <p>
          <Link href={`/portal/${token}`} className="text-sm underline">
            ← Back to your documents
          </Link>
        </p>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Quotation {quotation.number}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <InvoiceStatusBadge status={quotation.status} />
            <span>{quotation.customer.companyName ?? quotation.customer.name}</span>
          </p>
        </div>
      </div>
      {decided === "accepted" ? (
        <p className="rounded-md bg-green-600/10 px-3 py-2 text-sm text-green-700 dark:text-green-400">
          Thank you — this quotation is accepted.
        </p>
      ) : null}
      {decided === "rejected" ? (
        <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
          This quotation has been rejected.
        </p>
      ) : null}
      {portalError ? (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {portalError}
        </p>
      ) : null}
      {isSent ? (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-3 p-4">
            <p className="text-sm">
              Please review the quotation below and accept or reject it.
            </p>
            <span className="flex-1" />
            <form action={acceptQuotationPortalAction}>
              <input type="hidden" name="token" value={token} />
              <input type="hidden" name="quotationId" value={quotation.id} />
              <Button type="submit">Accept quotation</Button>
            </form>
            <form action={rejectQuotationPortalAction}>
              <input type="hidden" name="token" value={token} />
              <input type="hidden" name="quotationId" value={quotation.id} />
              <Button type="submit" variant="outline">
                Reject
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}
      <InvoicePreview data={previewData} />
    </PortalShell>
  );
}

async function CustomerDashboard({
  token,
  context,
}: {
  token: string;
  context: PortalContext;
}) {
  const { customer, invoices, quotations } = await getPortalCustomerDocuments(context);
  if (!customer) notFound();
  const business = await prisma.business.findUnique({
    where: { id: context.businessId },
  });
  if (!business) notFound();
  return (
    <PortalShell businessName={business.name}>
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {customer.companyName ?? customer.name}
        </h1>
        <p className="text-sm text-muted-foreground">
          Your invoices and quotations from {business.name}.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Invoices</CardTitle>
        </CardHeader>
        <CardContent>
          {invoices.length === 0 ? (
            <p className="text-sm text-muted-foreground">No invoices yet.</p>
          ) : (
            <ul className="divide-y">
              {invoices.map((inv) => (
                <li key={inv.id} className="flex flex-wrap items-center justify-between gap-2 py-3 first:pt-0 last:pb-0">
                  <Link
                    href={`/portal/${token}/invoice/${inv.id}`}
                    className="min-w-0 hover:underline"
                  >
                    <p className="flex flex-wrap items-center gap-2 font-medium">
                      {inv.number}
                      <InvoiceStatusBadge status={inv.status} />
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Due {formatDate(inv.dueDate)}
                    </p>
                  </Link>
                  <p className="font-semibold tabular-nums">
                    {formatMoney(inv.balance.toString(), business.currency)}{" "}
                    <span className="text-sm font-normal text-muted-foreground">
                      due of {formatMoney(inv.grandTotal.toString(), business.currency)}
                    </span>
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Quotations</CardTitle>
        </CardHeader>
        <CardContent>
          {quotations.length === 0 ? (
            <p className="text-sm text-muted-foreground">No quotations yet.</p>
          ) : (
            <ul className="divide-y">
              {quotations.map((q) => (
                <li key={q.id} className="flex flex-wrap items-center justify-between gap-2 py-3 first:pt-0 last:pb-0">
                  <Link
                    href={`/portal/${token}/quotation/${q.id}`}
                    className="min-w-0 hover:underline"
                  >
                    <p className="flex flex-wrap items-center gap-2 font-medium">
                      {q.number}
                      <InvoiceStatusBadge status={q.status} />
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Expires {formatDate(q.expiryDate)}
                    </p>
                  </Link>
                  <p className="font-semibold tabular-nums">
                    {formatMoney(q.grandTotal.toString(), business.currency)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </PortalShell>
  );
}

export default async function PortalPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { token } = await params;
  const query = await searchParams;
  const ip = await clientIp();
  const verified = await verifyPortalToken(token, ip);
  if (!verified.ok) return <InvalidLink />;
  const context = verified.context;
  const decided = typeof query.decided === "string" ? query.decided : undefined;
  const portalError = typeof query.portalError === "string" ? query.portalError : undefined;

  if (context.kind === "invoice") {
    return (
      <InvoiceView token={token} context={context} invoiceId={context.invoiceId} showBack={false} />
    );
  }
  if (context.kind === "quotation") {
    return (
      <QuotationView
        token={token}
        context={context}
        quotationId={context.quotationId}
        showBack={false}
        decided={decided}
        portalError={portalError}
      />
    );
  }
  return <CustomerDashboard token={token} context={context} />;
}
