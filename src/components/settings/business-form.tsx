"use client";

import { useActionState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FormError, FormSaved, SubmitButton } from "@/components/shared/form-fields";
import { COUNTRIES, CURRENCIES } from "@/lib/validation/business";

export type FormState = { error?: string; ok?: boolean } | null;

export type BusinessFormValues = {
  name: string;
  country: string;
  currency: string;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  trn?: string | null;
  bankName?: string | null;
  accountName?: string | null;
  iban?: string | null;
  swift?: string | null;
  paymentInstructions?: string | null;
  invoicePrefix: string;
  nextInvoiceNumber: number;
  nextQuotationNumber: number;
  nextCreditNoteNumber: number;
  defaultVatRateId?: string | null;
  defaultTerms?: string | null;
  defaultFooter?: string | null;
  logoUrl?: string | null;
  signatureUrl?: string | null;
};

export type SettingsFormValues = {
  locale: string;
  timezone: string;
  dateFormat: string;
  pdfTemplate: string;
  primaryColor: string;
  emailFromName?: string | null;
  emailFromAddress?: string | null;
  emailProvider: string;
};

export type TaxRateOption = { id: string; code: string; name: string; rate: string };

export function BusinessForm({
  business,
  settings,
  taxRates,
  action,
  readOnly = false,
}: {
  business: BusinessFormValues;
  settings: SettingsFormValues;
  taxRates: TaxRateOption[];
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  /** Viewers/members can see the profile but cannot save changes. */
  readOnly?: boolean;
}) {
  const [state, formAction] = useActionState(action, null);
  const b = business;
  const s = settings;

  return (
    <form action={formAction} className="space-y-6">
      <FormError error={state?.error} />
      <FormSaved saved={state?.ok} />
      {readOnly ? (
        <p role="note" className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
          You can view this profile, but only owners and admins can change it.
        </p>
      ) : null}
      <fieldset disabled={readOnly} className="space-y-6 disabled:opacity-90">

      <Card>
        <CardHeader>
          <CardTitle>Company</CardTitle>
          <CardDescription>Shown on invoices, quotations and credit notes.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Company name" htmlFor="name">
            <Input id="name" name="name" required defaultValue={b.name} />
          </Field>
          <Field label="Country" htmlFor="country">
            <Select id="country" name="country" defaultValue={b.country}>
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Default currency" htmlFor="currency">
            <Select id="currency" name="currency" defaultValue={b.currency}>
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="TRN (Tax Registration Number)" htmlFor="trn">
            <Input id="trn" name="trn" defaultValue={b.trn ?? ""} />
          </Field>
          <Field label="Address" htmlFor="address">
            <Textarea id="address" name="address" defaultValue={b.address ?? ""} />
          </Field>
          <div className="grid gap-4">
            <Field label="Phone" htmlFor="phone">
              <Input id="phone" name="phone" type="tel" defaultValue={b.phone ?? ""} />
            </Field>
            <Field label="Email" htmlFor="email">
              <Input id="email" name="email" type="email" defaultValue={b.email ?? ""} />
            </Field>
            <Field label="Website" htmlFor="website">
              <Input id="website" name="website" defaultValue={b.website ?? ""} />
            </Field>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Branding</CardTitle>
          <CardDescription>
            PNG, JPEG or WebP, up to 5 MB. The logo appears on invoices; the
            signature appears next to the authorised-signatory line.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Company logo" htmlFor="logo">
            <div className="space-y-2">
              {b.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={b.logoUrl} alt="Current company logo" className="h-16 w-auto rounded border bg-white p-1" />
              ) : (
                <p className="text-sm text-muted-foreground">No logo uploaded yet.</p>
              )}
              <Input id="logo" name="logo" type="file" accept="image/png,image/jpeg,image/webp" />
            </div>
          </Field>
          <Field label="Authorised signature" htmlFor="signature">
            <div className="space-y-2">
              {b.signatureUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={b.signatureUrl} alt="Current signature" className="h-16 w-auto rounded border bg-white p-1" />
              ) : (
                <p className="text-sm text-muted-foreground">No signature uploaded yet.</p>
              )}
              <Input id="signature" name="signature" type="file" accept="image/png,image/jpeg,image/webp" />
            </div>
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tax &amp; numbering</CardTitle>
          <CardDescription>
            The default VAT rate applies to new items unless they carry their
            own rate. Numbering never reuses a number once issued.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Default VAT rate" htmlFor="defaultVatRateId">
            <Select id="defaultVatRateId" name="defaultVatRateId" defaultValue={b.defaultVatRateId ?? ""}>
              <option value="">None</option>
              {taxRates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.code} — {t.name} ({t.rate}%)
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Invoice prefix" htmlFor="invoicePrefix" hint="Letters, numbers and dashes only.">
            <Input id="invoicePrefix" name="invoicePrefix" required defaultValue={b.invoicePrefix} />
          </Field>
          <Field label="Next invoice number" htmlFor="nextInvoiceNumber">
            <Input id="nextInvoiceNumber" name="nextInvoiceNumber" type="number" min={1} required defaultValue={b.nextInvoiceNumber} />
          </Field>
          <Field label="Next quotation number" htmlFor="nextQuotationNumber">
            <Input id="nextQuotationNumber" name="nextQuotationNumber" type="number" min={1} required defaultValue={b.nextQuotationNumber} />
          </Field>
          <Field label="Next credit note number" htmlFor="nextCreditNoteNumber">
            <Input id="nextCreditNoteNumber" name="nextCreditNoteNumber" type="number" min={1} required defaultValue={b.nextCreditNoteNumber} />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Bank &amp; payment</CardTitle>
          <CardDescription>Printed on invoices so customers know how to pay.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Bank name" htmlFor="bankName">
            <Input id="bankName" name="bankName" defaultValue={b.bankName ?? ""} />
          </Field>
          <Field label="Account name" htmlFor="accountName">
            <Input id="accountName" name="accountName" defaultValue={b.accountName ?? ""} />
          </Field>
          <Field label="IBAN" htmlFor="iban">
            <Input id="iban" name="iban" defaultValue={b.iban ?? ""} />
          </Field>
          <Field label="SWIFT / BIC" htmlFor="swift">
            <Input id="swift" name="swift" defaultValue={b.swift ?? ""} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Payment instructions" htmlFor="paymentInstructions">
              <Textarea id="paymentInstructions" name="paymentInstructions" defaultValue={b.paymentInstructions ?? ""} />
            </Field>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Document defaults</CardTitle>
          <CardDescription>Used as the starting text on new invoices.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <Field label="Default invoice terms" htmlFor="defaultTerms">
            <Textarea id="defaultTerms" name="defaultTerms" defaultValue={b.defaultTerms ?? ""} />
          </Field>
          <Field label="Default footer" htmlFor="defaultFooter">
            <Textarea id="defaultFooter" name="defaultFooter" defaultValue={b.defaultFooter ?? ""} />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Preferences</CardTitle>
          <CardDescription>Language, timezone and document appearance.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Language" htmlFor="locale">
            <Select id="locale" name="locale" defaultValue={s.locale}>
              <option value="en">English</option>
              <option value="ar">Arabic (RTL — Phase 4 templates)</option>
            </Select>
          </Field>
          <Field label="Timezone" htmlFor="timezone">
            <Input id="timezone" name="timezone" required defaultValue={s.timezone} />
          </Field>
          <Field label="Date format" htmlFor="dateFormat">
            <Select id="dateFormat" name="dateFormat" defaultValue={s.dateFormat}>
              <option value="DD/MM/YYYY">DD/MM/YYYY</option>
              <option value="MM/DD/YYYY">MM/DD/YYYY</option>
              <option value="YYYY-MM-DD">YYYY-MM-DD</option>
            </Select>
          </Field>
          <Field label="Invoice template" htmlFor="pdfTemplate">
            <Select id="pdfTemplate" name="pdfTemplate" defaultValue={s.pdfTemplate}>
              <option value="classic">Classic</option>
              <option value="modern">Modern (Phase 4)</option>
              <option value="minimal">Minimal (Phase 4)</option>
            </Select>
          </Field>
          <Field label="Primary colour" htmlFor="primaryColor">
            <Input id="primaryColor" name="primaryColor" type="color" defaultValue={s.primaryColor} />
          </Field>
          <Field label="Email provider" htmlFor="emailProvider">
            <Select id="emailProvider" name="emailProvider" defaultValue={s.emailProvider}>
              <option value="log">Log only (development)</option>
              <option value="resend">Resend</option>
              <option value="smtp">SMTP</option>
            </Select>
          </Field>
          <Field label="Email from name" htmlFor="emailFromName">
            <Input id="emailFromName" name="emailFromName" defaultValue={s.emailFromName ?? ""} />
          </Field>
          <Field label="Email from address" htmlFor="emailFromAddress">
            <Input id="emailFromAddress" name="emailFromAddress" type="email" defaultValue={s.emailFromAddress ?? ""} />
          </Field>
        </CardContent>
      </Card>

      <div className="sticky bottom-4 z-10 flex items-center gap-3 rounded-lg border bg-card p-3 shadow-lg">
        <SubmitButton>Save business profile</SubmitButton>
        <p className="text-xs text-muted-foreground">
          Changes are recorded in the activity log. Only owners and admins
          can edit this page.
        </p>
      </div>
      </fieldset>
    </form>
  );
}
