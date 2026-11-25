import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { formatMoney } from "@/lib/utils";
import {
  isSnapshotPayload,
  previewDataFromLive,
  previewDataFromSnapshot,
  type InvoicePreviewData,
} from "@/lib/invoice-preview";
import {
  getPortalInvoice,
  verifyPortalToken,
} from "@/server/services/portal.service";
import { InvoicePreview } from "@/components/invoices/invoice-preview";
import { InvoiceStatusBadge } from "@/components/invoices/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

async function clientIp(): Promise<string> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return h.get("x-real-ip") ?? "unknown";
}

export default async function PortalInvoiceSubPage({
  params,
}: {
  params: Promise<{ token: string; invoiceId: string }>;
}) {
  const { token, invoiceId } = await params;
  const ip = await clientIp();
  const verified = await verifyPortalToken(token, ip);
  if (!verified.ok) notFound();
  const context = verified.context;
  // Single-document tokens open their own document at /portal/[token];
  // this sub-page is for customer tokens (or the matching invoice token).
  if (context.kind === "invoice" && context.invoiceId !== invoiceId) notFound();
  if (context.kind === "quotation") notFound();

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
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
      <header className="border-b pb-4">
        <p className="text-sm font-semibold">{business.name}</p>
        <p className="text-xs text-muted-foreground">Customer portal</p>
      </header>
      <p>
        <Link href={`/portal/${token}`} className="text-sm underline">
          ← Back to your documents
        </Link>
      </p>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Invoice {invoice.number}</h1>
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
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        {[
          { label: "Grand total", value: formatMoney(invoice.grandTotal.toString(), currency) },
          { label: "Amount paid", value: formatMoney(invoice.amountPaid.toString(), currency) },
          { label: "Balance due", value: formatMoney(invoice.balance.toString(), currency) },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className="mt-1 text-lg font-semibold">{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <InvoicePreview data={previewData} />
    </div>
  );
}
