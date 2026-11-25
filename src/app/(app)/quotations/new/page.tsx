import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getQuotationFormData } from "@/server/services/quotation.service";
import { formatQuotationNumber } from "@/lib/numbering";
import { InvoiceBuilder } from "@/components/invoices/invoice-builder";
import { createQuotationAction } from "../actions";

export default async function NewQuotationPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const data = await getQuotationFormData(session.user.id);
  if (!data) redirect("/login");

  const template =
    data.settings?.pdfTemplate === "modern" ||
    data.settings?.pdfTemplate === "minimal"
      ? data.settings.pdfTemplate
      : "classic";
  const locale = data.settings?.locale === "ar" ? "ar" : "en";

  return (
    <div className="-m-4 min-h-[calc(100dvh-4rem)] space-y-6 bg-muted/60 p-4 md:-m-6 md:p-6">
      <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">New Quotation</h1>
        <p className="text-sm text-muted-foreground">
          Build a draft, check the live preview, then send it from the
          quotation page. Converting an accepted quotation creates a real
          invoice from the same lines.
        </p>
      </div>
      <InvoiceBuilder
        variant="quotation"
        cancelHref="/quotations"
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
        action={createQuotationAction}
        submitLabel="Save draft"
      />
    </div>
    </div>
  );
}
