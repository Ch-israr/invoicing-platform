import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { previewDataFromQuotation } from "@/lib/invoice-preview";
import {
  getPortalQuotation,
  verifyPortalToken,
} from "@/server/services/portal.service";
import { InvoicePreview } from "@/components/invoices/invoice-preview";
import { InvoiceStatusBadge } from "@/components/invoices/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  acceptQuotationPortalAction,
  rejectQuotationPortalAction,
} from "../../actions";

async function clientIp(): Promise<string> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return h.get("x-real-ip") ?? "unknown";
}

export default async function PortalQuotationSubPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string; quotationId: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { token, quotationId } = await params;
  const query = await searchParams;
  const ip = await clientIp();
  const verified = await verifyPortalToken(token, ip);
  if (!verified.ok) notFound();
  const context = verified.context;
  if (context.kind === "invoice") notFound();
  if (context.kind === "quotation" && context.quotationId !== quotationId) notFound();

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
  const decided = typeof query.decided === "string" ? query.decided : undefined;
  const portalError = typeof query.portalError === "string" ? query.portalError : undefined;

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
      <div>
        <h1 className="text-2xl font-bold">Quotation {quotation.number}</h1>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <InvoiceStatusBadge status={quotation.status} />
          <span>{quotation.customer.companyName ?? quotation.customer.name}</span>
        </p>
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
    </div>
  );
}
