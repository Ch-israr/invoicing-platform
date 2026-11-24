import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { TenantError } from "@/lib/tenant";
import { formatMoney } from "@/lib/utils";
import { getCreditNoteDetail } from "@/server/services/credit-note.service";
import { PrintButton } from "@/components/invoices/print-button";

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(value);
}

/**
 * Printable credit note — a simple document view (not the Playwright
 * invoice templates: a credit note is a short correction record, and
 * a second template system was deliberately not built for it).
 */
export default async function CreditNotePrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const { id } = await params;

  let detail;
  try {
    detail = await getCreditNoteDetail(session.user.id, id);
  } catch (err) {
    if (err instanceof TenantError) notFound();
    throw err;
  }

  const { business, note, invoice, customer } = detail;
  const currency = invoice.currency;

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6 print:max-w-none print:p-0">
      <div className="flex items-center justify-between print:hidden">
        <p className="text-sm text-muted-foreground">
          Credit note {note.number} —{" "}
          <Link href={`/credit-notes/${note.id}`} className="underline">
            back to detail
          </Link>
        </p>
        <PrintButton />
      </div>

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
            <p className="text-2xl font-bold">Credit Note</p>
            <p className="mt-1 font-mono text-lg font-semibold">{note.number}</p>
            <p className="text-sm text-slate-500">{formatDate(note.createdAt)}</p>
            <p className="text-sm text-slate-500">
              Status: {note.status === "ISSUED" ? "Issued" : "Cancelled"}
            </p>
          </div>
        </div>

        <div className="mt-6 space-y-1 text-sm">
          <p>
            <span className="text-slate-500">Credited to: </span>
            {customer.companyName ?? customer.name}
          </p>
          <p>
            <span className="text-slate-500">Against invoice: </span>
            {invoice.number} ({formatMoney(invoice.grandTotal.toString(), currency)})
          </p>
          {note.reason ? (
            <p>
              <span className="text-slate-500">Reason: </span>
              {note.reason}
            </p>
          ) : null}
        </div>

        <table className="mt-6 w-full text-sm">
          <thead>
            <tr className="border-b text-start text-slate-500">
              <th className="py-2 text-start font-semibold">Description</th>
              <th className="py-2 text-end font-semibold">Qty</th>
              <th className="py-2 text-end font-semibold">Unit Price</th>
              <th className="py-2 text-end font-semibold">Total</th>
            </tr>
          </thead>
          <tbody>
            {note.items.map((item) => (
              <tr key={item.id} className="border-b">
                <td className="py-2">{item.description}</td>
                <td className="py-2 text-end">{item.quantity.toString()}</td>
                <td className="py-2 text-end">{formatMoney(item.unitPrice.toString(), currency)}</td>
                <td className="py-2 text-end">
                  −{formatMoney(item.lineTotal.toString(), currency)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <dl className="mt-4 space-y-1.5 text-sm">
          <div className="flex justify-between">
            <dt className="text-slate-500">Credit subtotal</dt>
            <dd>{formatMoney(note.subtotal.toString(), currency)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-500">VAT</dt>
            <dd>{formatMoney(note.vatAmount.toString(), currency)}</dd>
          </div>
          <div className="flex justify-between border-t pt-2 text-base font-bold">
            <dt>Total credit</dt>
            <dd>−{formatMoney(note.grandTotal.toString(), currency)}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
