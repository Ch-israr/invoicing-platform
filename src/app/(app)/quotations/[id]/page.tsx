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

  const dateFmt = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  // Exactly one primary action per state; everything else is outline.
  const hasActions =
    isDraft || isSent || canConvert;

  return (
    <div className="-m-4 min-h-[calc(100dvh-4rem)] space-y-6 bg-muted/60 p-4 md:-m-6 md:p-6">
      <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {isDraftNumber(quotation.number) ? "Draft quotation" : `Quotation ${quotation.number}`}
        </h1>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <InvoiceStatusBadge status={quotation.status} />
          {isExpired ? (
            <span className="font-medium text-red-700 dark:text-red-400">
              This quotation is past its expiry date
            </span>
          ) : null}
          <span>{quotation.customer.companyName ?? quotation.customer.name}</span>
          <span>
            Issued {dateFmt.format(quotation.issueDate)} · Expires{" "}
            {dateFmt.format(quotation.expiryDate)}
          </span>
        </p>
      </div>

      {actionError ? (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {actionError}
        </p>
      ) : null}

      {/* Document + action rail: the quotation document stays readable on
          the left; status and actions live in the side column. */}
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-6">
          {isDraft ? (
            <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
              Draft — the quotation number is assigned when you send it.
              Converting an accepted quotation creates a draft invoice from
              these lines.
            </p>
          ) : null}

          <InvoicePreview data={previewData} />

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
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Status</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <InvoiceStatusBadge status={quotation.status} />
                {isExpired ? (
                  <p className="mt-2 text-sm font-medium text-red-700 dark:text-red-400">
                    This quotation is past its expiry date
                  </p>
                ) : null}
              </div>
              <dl className="space-y-1.5 text-sm">
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Customer</dt>
                  <dd className="text-right font-medium">
                    {quotation.customer.companyName ?? quotation.customer.name}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Issued</dt>
                  <dd className="tabular-nums">{dateFmt.format(quotation.issueDate)}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Expires</dt>
                  <dd className="tabular-nums">{dateFmt.format(quotation.expiryDate)}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Subtotal</dt>
                  <dd className="tabular-nums">{formatMoney(quotation.subtotal.toString(), currency)}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">VAT</dt>
                  <dd className="tabular-nums">{formatMoney(quotation.vatAmount.toString(), currency)}</dd>
                </div>
                {quotation.convertedInvoice ? (
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">Converted to</dt>
                    <dd>
                      <Link
                        href={`/invoices/${quotation.convertedInvoice.id}`}
                        className="font-medium underline"
                      >
                        {isDraftNumber(quotation.convertedInvoice.number)
                          ? "Draft"
                          : quotation.convertedInvoice.number}
                      </Link>
                    </dd>
                  </div>
                ) : null}
              </dl>
              <div className="rounded-lg bg-muted/60 px-3 py-2.5">
                <p className="text-xs text-muted-foreground">Grand total</p>
                <p className="text-2xl font-bold tracking-tight tabular-nums">
                  {formatMoney(quotation.grandTotal.toString(), currency)}
                </p>
              </div>
            </CardContent>
          </Card>

          {hasActions ? (
            <Card>
              <CardHeader>
                <CardTitle>Actions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {isDraft && canManage ? (
                  <form action={sendQuotationAction}>
                    <input type="hidden" name="id" value={quotation.id} />
                    <Button type="submit" variant="default" className="w-full">
                      Send quotation
                    </Button>
                  </form>
                ) : null}
                {canConvert && canManage ? (
                  <form action={convertQuotationAction}>
                    <input type="hidden" name="id" value={quotation.id} />
                    <Button
                      type="submit"
                      variant={isDraft ? "outline" : "default"}
                      className="w-full"
                    >
                      Convert to invoice
                    </Button>
                  </form>
                ) : null}
                {isDraft ? (
                  <Button asChild variant="outline" className="w-full">
                    <Link href={`/quotations/${quotation.id}/edit`}>Edit draft</Link>
                  </Button>
                ) : null}
                {isSent ? (
                  <>
                    <form action={acceptQuotationAction}>
                      <input type="hidden" name="id" value={quotation.id} />
                      <Button type="submit" variant="outline" className="w-full">
                        Accept
                      </Button>
                    </form>
                    <form action={rejectQuotationAction}>
                      <input type="hidden" name="id" value={quotation.id} />
                      <Button type="submit" variant="outline" className="w-full">
                        Reject
                      </Button>
                    </form>
                    <form action={expireQuotationAction}>
                      <input type="hidden" name="id" value={quotation.id} />
                      <Button type="submit" variant="outline" className="w-full">
                        Mark expired
                      </Button>
                    </form>
                  </>
                ) : null}
                {isDraft ? (
                  <form action={deleteQuotationAction}>
                    <input type="hidden" name="id" value={quotation.id} />
                    <DeleteButton label="Delete draft" className="w-full" />
                  </form>
                ) : null}
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
      </div>
    </div>
  );
}
