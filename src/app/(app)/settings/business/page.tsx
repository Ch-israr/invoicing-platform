import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { canManageBusiness } from "@/lib/tenant";
import { getBusinessProfile } from "@/server/services/business.service";
import { BusinessForm } from "@/components/settings/business-form";
import { updateBusinessAction } from "./actions";

export default async function BusinessSettingsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const profile = await getBusinessProfile(session.user.id);
  if (!profile) {
    return (
      <div className="-m-4 min-h-[calc(100dvh-4rem)] space-y-6 bg-muted/60 p-4 md:-m-6 md:p-6">
        <h1 className="text-2xl font-bold tracking-tight">Business Profile</h1>
        <p className="text-sm text-muted-foreground">
          Your account has no business workspace yet.
        </p>
      </div>
    );
  }

  const { business, settings, taxRates } = profile;
  const readOnly = !canManageBusiness(profile.business.membership.role);

  return (
    <div className="-m-4 min-h-[calc(100dvh-4rem)] space-y-6 bg-muted/60 p-4 md:-m-6 md:p-6">
      <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Business Profile</h1>
        <p className="text-sm text-muted-foreground">
          Company details, tax and numbering, bank details and preferences.
          These appear on your invoices and quotations.
        </p>
      </div>
      <BusinessForm
        business={{
          name: business.name,
          country: business.country,
          currency: business.currency,
          address: business.address,
          phone: business.phone,
          email: business.email,
          website: business.website,
          trn: business.trn,
          bankName: business.bankName,
          accountName: business.accountName,
          iban: business.iban,
          swift: business.swift,
          paymentInstructions: business.paymentInstructions,
          invoicePrefix: business.invoicePrefix,
          nextInvoiceNumber: business.nextInvoiceNumber,
          nextQuotationNumber: business.nextQuotationNumber,
          nextCreditNoteNumber: business.nextCreditNoteNumber,
          defaultVatRateId: business.defaultVatRateId,
          defaultTerms: business.defaultTerms,
          defaultFooter: business.defaultFooter,
          logoUrl: business.logoUrl,
          signatureUrl: business.signatureUrl,
        }}
        settings={{
          locale: settings?.locale ?? "en",
          timezone: settings?.timezone ?? "Asia/Dubai",
          dateFormat: settings?.dateFormat ?? "DD/MM/YYYY",
          pdfTemplate: settings?.pdfTemplate ?? "classic",
          primaryColor: settings?.primaryColor ?? "#0f172a",
          emailFromName: settings?.emailFromName,
          emailFromAddress: settings?.emailFromAddress,
          emailProvider: settings?.emailProvider ?? "log",
        }}
        taxRates={taxRates.map((t) => ({
          id: t.id,
          code: t.code,
          name: t.name,
          rate: t.rate.toString(),
        }))}
        action={updateBusinessAction}
        readOnly={readOnly}
      />
      </div>
    </div>
  );
}
