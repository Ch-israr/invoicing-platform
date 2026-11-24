import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { TenantError } from "@/lib/tenant";
import { formatMoney } from "@/lib/utils";
import { isDraftNumber } from "@/lib/numbering";
import { previewDataFromQuotation } from "@/lib/invoice-preview";
import { getQuotationDetail } from "@/server/services/quotation.service";
import { listPortalTokens } from "@/server/services/portal.service";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PortalTokenManager } from "@/components/portal/portal-token-manager";
import { DeleteButton } from "@/components/shared/delete-button";
import { InvoicePreview } from "@/components/invoices/invoice-preview";
import { InvoiceStatusBadge } from "@/components/invoices/status-badge";
import {
  acceptQuotationAction,
  convertQuotationAction,
  deleteQuotationAction,
  expireQuotationAction,
  rejectQuotationAction,
  sendQuotationAction,
} from "../actions";

export default async function QuotationDetailPage({
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

  let detail;
  let portalTokens: Awaited<ReturnType<typeof listPortalTokens>> = [];
  try {
    detail = await getQuotationDetail(session.user.id, id);
    if (detail.quotation.status !== "DRAFT") {
      portalTokens = await listPortalTokens(session.user.id, { quotationId: id });
    }
  } catch (err) {
    if (err instanceof TenantError) notFound();
    throw err;
  }

  const { business, quotation, canManage, isExpired } = detail;
  const currency = business.currency;
  const isDraft = quotation.status === "DRAFT";
  const isSent = quotation.status === "SENT";
  const canConvert =
    (isSent || quotation.status === "ACCEPTED") && !quotation.convertedInvoiceId;

  // Quotations have no template/locale of their own — render with the
  // business settings defaults, like the new-quotation page does.
  const settings = await prisma.businessSettings.findUnique({
    where: { businessId: business.id },
  });
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
    isDraft,
  );

  const stats = [
    { label: "Subtotal", value: formatMoney(quotation.subtotal.toString(), currency) },
    { label: "VAT", value: formatMoney(quotation.vatAmount.toString(), currency) },
    { label: "Grand total", value: formatMoney(quotation.grandTotal.toString(), currency) },
  ];

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">
            {isDraftNumber(quotation.number) ? "Draft quotation" : `Quotation ${quotation.number}`}
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <InvoiceStatusBadge status={quotation.status} />
            {isExpired ? <span>This quotation is past its expiry date</span> : null}
            <span>{quotation.customer.companyName ?? quotation.customer.name}</span>
            {quotation.convertedInvoice ? (
              <span>
                Converted to{" "}
                <Link
                  href={`/invoices/${quotation.convertedInvoice.id}`}
                  className="underline"
                >
                  {quotation.convertedInvoice.number}
                </Link>
              </span>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {isDraft ? (
            <Button asChild>
              <Link href={`/quotations/${quotation.id}/edit`}>Edit draft</Link>
            </Button>
          ) : null}
          {isDraft && canManage ? (
            <form action={sendQuotationAction}>
              <input type="hidden" name="id" value={quotation.id} />
              <Button type="submit" variant="default">
                Send quotation
              </Button>
            </form>
          ) : null}
          {isSent ? (
            <>
              <form action={acceptQuotationAction}>
                <input type="hidden" name="id" value={quotation.id} />
                <Button type="submit" variant="default">
                  Accept
                </Button>
              </form>
              <form action={rejectQuotationAction}>
                <input type="hidden" name="id" value={quotation.id} />
                <Button type="submit" variant="outline">
                  Reject
                </Button>
              </form>
              <form action={expireQuotationAction}>
                <input type="hidden" name="id" value={quotation.id} />
                <Button type="submit" variant="outline">
                  Mark expired
                </Button>
              </form>
            </>
          ) : null}
          {canConvert && canManage ? (
            <form action={convertQuotationAction}>
              <input type="hidden" name="id" value={quotation.id} />
              <Button type="submit" variant="default">
                Convert to invoice
              </Button>
            </form>
          ) : null}
          {isDraft ? (
            <form action={deleteQuotationAction}>
              <input type="hidden" name="id" value={quotation.id} />
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

      {isDraft ? (
        <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
          Draft — the quotation number is assigned when you send it.
          Converting an accepted quotation creates a draft invoice from
          these lines.
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className="mt-1 text-lg font-semibold">{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {!isDraft ? (
        <Card>
          <CardHeader>
            <CardTitle>Customer portal</CardTitle>
          </CardHeader>
          <CardContent>
            <PortalTokenManager
              kind="quotation"
              documentId={quotation.id}
              tokens={portalTokens}
              canManage={canManage}
              backPath={`/quotations/${quotation.id}`}
            />
          </CardContent>
        </Card>
      ) : null}

      <InvoicePreview data={previewData} />
    </div>
  );
}
