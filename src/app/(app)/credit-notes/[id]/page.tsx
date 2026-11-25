import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { TenantError } from "@/lib/tenant";
import { formatMoney } from "@/lib/utils";
import { getCreditNoteDetail } from "@/server/services/credit-note.service";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InvoiceStatusBadge } from "@/components/invoices/status-badge";
import { cancelCreditNoteAction } from "../actions";

export default async function CreditNoteDetailPage({
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
  try {
    detail = await getCreditNoteDetail(session.user.id, id);
  } catch (err) {
    if (err instanceof TenantError) notFound();
    throw err;
  }

  const { note, invoice, customer, canManage } = detail;
  const currency = invoice.currency;
  const isIssued = note.status === "ISSUED";

  return (
    <div className="-m-4 min-h-[calc(100dvh-4rem)] space-y-6 bg-muted/60 p-4 md:-m-6 md:p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Credit Note {note.number}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <InvoiceStatusBadge status={note.status} />
              <span>
                Against{" "}
                <Link href={`/invoices/${invoice.id}`} className="underline">
                  Invoice {invoice.number}
                </Link>
              </span>
              <span>{customer.companyName ?? customer.name}</span>
            </p>
          </div>
        </div>

        {actionError ? (
          <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {actionError}
          </p>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] [&>*]:min-w-0">
          <div className="min-w-0 space-y-6">
            <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
              {isIssued
                ? "This credit note reduced the invoice balance by its total. The invoice itself was not changed."
                : "This credit note was cancelled — its balance effect was reversed."}
              {note.reason ? ` Reason: ${note.reason}` : ""}
            </p>

            <Card>
              <CardHeader>
                <CardTitle>Credited lines</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <ul className="divide-y">
                  {note.items.map((item) => (
                    <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 px-6 py-4">
                      <div className="min-w-0">
                        <p className="font-medium">{item.description}</p>
                        <p className="text-sm text-muted-foreground">
                          {item.quantity.toString()} × {formatMoney(item.unitPrice.toString(), currency)}
                          {Number(item.taxRate) > 0 ? ` · VAT ${item.taxRate}%` : " · No VAT"}
                        </p>
                      </div>
                      <p className="font-semibold tabular-nums">
                        −{formatMoney(item.lineTotal.toString(), currency)}
                      </p>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Status</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-2">
                  <InvoiceStatusBadge status={note.status} />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Total credit</p>
                  <p className="mt-1 text-2xl font-bold tracking-tight tabular-nums">
                    −{formatMoney(note.grandTotal.toString(), currency)}
                  </p>
                </div>
                <dl className="space-y-2 border-t pt-4 text-sm">
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">Credit subtotal</dt>
                    <dd className="tabular-nums">{formatMoney(note.subtotal.toString(), currency)}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">VAT</dt>
                    <dd className="tabular-nums">{formatMoney(note.vatAmount.toString(), currency)}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">Against invoice</dt>
                    <dd>
                      <Link href={`/invoices/${invoice.id}`} className="font-medium underline">
                        {invoice.number}
                      </Link>
                    </dd>
                  </div>
                  {note.reason ? (
                    <div className="flex justify-between gap-2">
                      <dt className="text-muted-foreground">Reason</dt>
                      <dd className="text-right">{note.reason}</dd>
                    </div>
                  ) : null}
                </dl>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Actions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Button asChild className="w-full">
                  <Link href={`/credit-notes/${note.id}/print`} target="_blank">
                    Print
                  </Link>
                </Button>
                {isIssued && canManage ? (
                  <form action={cancelCreditNoteAction}>
                    <input type="hidden" name="id" value={note.id} />
                    <Button type="submit" variant="outline" className="w-full">
                      Cancel credit note
                    </Button>
                  </form>
                ) : null}
                <Button asChild variant="outline" className="w-full">
                  <Link href="/credit-notes">All credit notes</Link>
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
