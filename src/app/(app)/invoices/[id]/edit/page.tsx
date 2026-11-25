import { redirect, notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { TenantError } from "@/lib/tenant";
import { formatInvoiceNumber } from "@/lib/numbering";
import {
  getInvoiceDetail,
  getInvoiceFormData,
} from "@/server/services/invoice.service";
import {
  InvoiceBuilder,
  type LineState,
} from "@/components/invoices/invoice-builder";
import { updateInvoiceAction } from "../../actions";

function toDateInput(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export default async function EditInvoicePage({
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
  if (detail.invoice.status !== "DRAFT") {
    redirect(`/invoices/${id}`);
  }

  const data = await getInvoiceFormData(session.user.id);
  if (!data) redirect("/login");

  const invoice = detail.invoice;
  const template =
    invoice.template === "modern" || invoice.template === "minimal"
      ? invoice.template
      : "classic";
  const locale = invoice.locale === "ar" ? "ar" : "en";

  const initialLines: LineState[] = invoice.items.map((item) => ({
    key: `existing-${item.id}`,
    productId: item.productId ?? "",
    description: item.description,
    sku: item.sku ?? "",
    unit: item.unit,
    quantity: item.quantity.toString(),
    unitPrice: item.unitPrice.toString(),
    discountType: item.discountType,
    discountValue: item.discountValue.toString(),
    taxRateId: item.taxRateId ?? "",
    taxInclusive: item.taxInclusive,
  }));

  return (
    <div className="-m-4 min-h-[calc(100dvh-4rem)] space-y-6 bg-muted/60 p-4 md:-m-6 md:p-6">
      <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Edit draft invoice</h1>
        <p className="text-sm text-muted-foreground">
          Only drafts can be edited. Once issued, an invoice is frozen.
        </p>
      </div>
      <InvoiceBuilder
        invoiceId={invoice.id}
        initial={{
          customerId: invoice.customerId,
          issueDate: toDateInput(invoice.issueDate),
          dueDate: toDateInput(invoice.dueDate),
          supplyDate: invoice.supplyDate ? toDateInput(invoice.supplyDate) : "",
          notes: invoice.notes ?? "",
          terms: invoice.terms ?? "",
          template,
          locale,
          lines: initialLines,
          invoiceDiscountType: invoice.invoiceDiscountType,
          invoiceDiscountValue: invoice.invoiceDiscountValue.toString(),
          earlyDiscountType: invoice.earlyDiscountType,
          earlyDiscountValue: invoice.earlyDiscountValue.toString(),
          earlyDiscountDays: invoice.earlyDiscountDays.toString(),
        }}
        customers={data.customers}
        products={data.products.map((p) => ({
          ...p,
          price: p.price.toString(),
        }))}
        taxRates={data.taxRates.map((t) => ({
          id: t.id,
          code: t.code,
          name: t.name,
          rate: t.rate.toString(),
        }))}
        business={data.business}
        settingsTemplate={template}
        settingsLocale={locale}
        settingsTerms={data.business.defaultTerms}
        nextNumberPreview={formatInvoiceNumber(
          data.business.invoicePrefix,
          data.business.nextInvoiceNumber,
        )}
        action={updateInvoiceAction}
        submitLabel="Save draft"
      />
      </div>
    </div>
  );
}
