import { redirect, notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { TenantError } from "@/lib/tenant";
import { formatQuotationNumber } from "@/lib/numbering";
import {
  getQuotationDetail,
  getQuotationFormData,
} from "@/server/services/quotation.service";
import {
  InvoiceBuilder,
  type LineState,
} from "@/components/invoices/invoice-builder";
import { updateQuotationAction } from "../../actions";

function toDateInput(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export default async function EditQuotationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const { id } = await params;

  let detail;
  try {
    detail = await getQuotationDetail(session.user.id, id);
  } catch (err) {
    if (err instanceof TenantError) notFound();
    throw err;
  }
  if (detail.quotation.status !== "DRAFT") {
    redirect(`/quotations/${id}`);
  }

  const data = await getQuotationFormData(session.user.id);
  if (!data) redirect("/login");

  const quotation = detail.quotation;
  const template =
    data.settings?.pdfTemplate === "modern" || data.settings?.pdfTemplate === "minimal"
      ? data.settings.pdfTemplate
      : "classic";
  const locale = data.settings?.locale === "ar" ? "ar" : "en";

  const initialLines: LineState[] = quotation.items.map((item) => ({
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
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Edit draft quotation</h1>
        <p className="text-sm text-muted-foreground">
          Only drafts can be edited. Once sent, a quotation is frozen.
        </p>
      </div>
      <InvoiceBuilder
        variant="quotation"
        cancelHref="/quotations"
        invoiceId={quotation.id}
        initial={{
          customerId: quotation.customerId,
          issueDate: toDateInput(quotation.issueDate),
          dueDate: toDateInput(quotation.expiryDate),
          supplyDate: "",
          notes: quotation.notes ?? "",
          terms: quotation.terms ?? "",
          template,
          locale,
          lines: initialLines,
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
        nextNumberPreview={formatQuotationNumber(data.business.nextQuotationNumber)}
        action={updateQuotationAction}
        submitLabel="Save draft"
      />
    </div>
  );
}
