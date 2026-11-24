import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { TenantError } from "@/lib/tenant";
import { formatMoney } from "@/lib/utils";
import { getCreditNoteDetail } from "@/server/services/credit-note.service";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
    <div className="max-w-5xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Credit Note {note.number}</h1>
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
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href={`/credit-notes/${note.id}/print`} target="_blank">
              Print
            </Link>
          </Button>
          {isIssued && canManage ? (
            <form action={cancelCreditNoteAction}>
              <input type="hidden" name="id" value={note.id} />
              <Button type="submit" variant="outline">
                Cancel credit note
              </Button>
            </form>
          ) : null}
        </div>
      </div>

      {actionError ? (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {actionError}
        </p>
      ) : null}

      <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
        {isIssued
          ? "This credit note reduced the invoice balance by its total. The invoice itself was not changed."
          : "This credit note was cancelled — its balance effect was reversed."}
        {note.reason ? ` Reason: ${note.reason}` : ""}
      </p>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        {[
          { label: "Credit subtotal", value: formatMoney(note.subtotal.toString(), currency) },
          { label: "VAT", value: formatMoney(note.vatAmount.toString(), currency) },
          { label: "Total credit", value: formatMoney(note.grandTotal.toString(), currency) },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className="mt-1 text-lg font-semibold">{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          <ul className="divide-y">
            {note.items.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 px-6 py-4">
                <div>
                  <p className="font-medium">{item.description}</p>
                  <p className="text-sm text-muted-foreground">
                    {item.quantity.toString()} × {formatMoney(item.unitPrice.toString(), currency)}
                    {Number(item.taxRate) > 0 ? ` · VAT ${item.taxRate}%` : " · No VAT"}
                  </p>
                </div>
                <p className="font-semibold">
                  −{formatMoney(item.lineTotal.toString(), currency)}
                </p>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
