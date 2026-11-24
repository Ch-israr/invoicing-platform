import { redirect, notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { TenantError } from "@/lib/tenant";
import {
  isSnapshotPayload,
  previewDataFromLive,
  previewDataFromSnapshot,
  type InvoicePreviewData,
} from "@/lib/invoice-preview";
import { getInvoiceDetail } from "@/server/services/invoice.service";
import { InvoicePreview } from "@/components/invoices/invoice-preview";
import { PrintButton } from "@/components/invoices/print-button";

/**
 * Print view for an invoice — a bare page (no app shell) rendering
 * the same InvoicePreview component as the detail page, so what you
 * print is what you see on screen. The browser's print dialog opens
 * automatically; the toolbar is hidden in the printed output.
 */
export default async function InvoicePrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const { id } = await params;

  let detail;
  try {
    detail = await getInvoiceDetail(session.user.id, id);
  } catch (err) {
    if (err instanceof TenantError) notFound();
    throw err;
  }

  const { business, invoice } = detail;
  const isDraft = invoice.status === "DRAFT";
  let previewData: InvoicePreviewData;
  if (invoice.snapshot && isSnapshotPayload(invoice.snapshot.payload)) {
    previewData = previewDataFromSnapshot(invoice.snapshot.payload);
  } else {
    previewData = previewDataFromLive(invoice, business, invoice.customer, isDraft);
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-6 print:max-w-none print:p-0">
      <div className="flex items-center justify-between print:hidden">
        <p className="text-sm text-muted-foreground">
          {isDraft ? "Draft invoice" : `Invoice ${invoice.number}`} — print view
        </p>
        <PrintButton />
      </div>
      <InvoicePreview data={previewData} />
    </div>
  );
}
