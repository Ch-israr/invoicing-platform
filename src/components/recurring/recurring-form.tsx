"use client";

import { useActionState, useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FormError, SubmitButton } from "@/components/shared/form-fields";
import {
  blankLine,
  computeLinePreview,
  defaultTaxRateId,
  isEmptyLine,
  LineItemsEditor,
  LineTotalsBox,
  type BuilderProduct,
  type BuilderTaxRate,
  type LineState,
} from "@/components/invoices/line-items-editor";
import { taxCategoryForRateCode } from "@/lib/validation/invoice";
import type { FormState } from "@/components/invoices/invoice-builder";

export type RecurringCustomer = {
  id: string;
  name: string;
  companyName: string | null;
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Create a recurring schedule. The line editor is the same one the
 * invoice builder uses, and the frozen lines are stored as the
 * schedule's template — every run recomputes totals from them.
 */
export function RecurringForm({
  customers,
  products,
  taxRates,
  business,
  settingsTemplate,
  settingsLocale,
  settingsTerms,
  action,
}: {
  customers: RecurringCustomer[];
  products: BuilderProduct[];
  taxRates: BuilderTaxRate[];
  business: { currency: string };
  settingsTemplate: "classic" | "modern" | "minimal";
  settingsLocale: "en" | "ar";
  settingsTerms?: string | null;
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
}) {
  const [state, formAction] = useActionState(action, null);
  const defaultRateId = useMemo(() => defaultTaxRateId(taxRates), [taxRates]);
  const rateById = useMemo(
    () => new Map(taxRates.map((t) => [t.id, t])),
    [taxRates],
  );

  const [customerId, setCustomerId] = useState("");
  const [frequency, setFrequency] = useState("MONTHLY");
  const [intervalDays, setIntervalDays] = useState("14");
  const [startDate, setStartDate] = useState(todayIso());
  const [endDate, setEndDate] = useState("");
  const [autoSend, setAutoSend] = useState(false);
  const [notes, setNotes] = useState("");
  const [terms, setTerms] = useState(settingsTerms ?? "");
  const [template, setTemplate] = useState<"classic" | "modern" | "minimal">(settingsTemplate);
  const [locale, setLocale] = useState<"en" | "ar">(settingsLocale);
  const [lines, setLines] = useState<LineState[]>([blankLine(defaultRateId)]);

  const preview = useMemo(
    () => computeLinePreview(lines, taxRates),
    [lines, taxRates],
  );

  // Fully-empty lines are dropped, like in the invoice builder, so a
  // blank starting line can never block a save (the server strips
  // them again defensively, with the same rule).
  const itemsJson = JSON.stringify(
    lines.filter((l) => !isEmptyLine(l)).map((l) => ({
      productId: l.productId || undefined,
      description: l.description,
      sku: l.sku || undefined,
      quantity: l.quantity,
      unit: l.unit,
      unitPrice: l.unitPrice,
      discountType: l.discountType,
      discountValue: l.discountValue || "0",
      taxRateId: l.taxRateId || undefined,
      taxCategory: l.taxRateId
        ? taxCategoryForRateCode(rateById.get(l.taxRateId)?.code ?? "STD_5")
        : "OUT_OF_SCOPE",
      taxInclusive: l.taxInclusive,
    })),
  );

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="items" value={itemsJson} />
      <FormError error={state?.error} />
      <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
        The first invoice is created on the start date, then on each
        repeat. Every run creates exactly one invoice per period — even
        if the run is triggered twice.
      </p>

      <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
        <Card>
          <CardHeader>
            <CardTitle>Schedule</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
          <Field label="Customer" htmlFor="customerId">
            <Select
              id="customerId"
              name="customerId"
              required
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
            >
              <option value="">Select a customer…</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.companyName ?? c.name}
                  {c.companyName ? ` (${c.name})` : ""}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Frequency" htmlFor="frequency">
            <Select
              id="frequency"
              name="frequency"
              required
              value={frequency}
              onChange={(e) => setFrequency(e.target.value)}
            >
              <option value="WEEKLY">Weekly</option>
              <option value="MONTHLY">Monthly</option>
              <option value="QUARTERLY">Every 3 months</option>
              <option value="YEARLY">Yearly</option>
              <option value="CUSTOM">Custom interval</option>
            </Select>
          </Field>
          {frequency === "CUSTOM" ? (
            <Field label="Every N days" htmlFor="intervalDays">
              <Input
                id="intervalDays"
                name="intervalDays"
                inputMode="numeric"
                required
                value={intervalDays}
                onChange={(e) => setIntervalDays(e.target.value)}
              />
            </Field>
          ) : null}
          <Field label="Start date" htmlFor="startDate" hint="First invoice is created on this date.">
            <Input
              id="startDate"
              name="startDate"
              type="date"
              required
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </Field>
          <Field label="End date (optional)" htmlFor="endDate" hint="Leave empty for no end.">
            <Input
              id="endDate"
              name="endDate"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="autoSend"
              checked={autoSend}
              onChange={(e) => setAutoSend(e.target.checked)}
              className="h-4 w-4 accent-primary"
            />
            Issue and email each invoice automatically
          </label>
          <p className="text-xs text-muted-foreground">
            When off, each run creates a draft for you to review and issue
            by hand. When on, the invoice is issued, its PDF generated,
            and the email sent to the customer.
          </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Document</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
          <Field label="Template" htmlFor="template">
            <Select
              id="template"
              name="template"
              value={template}
              onChange={(e) =>
                setTemplate(e.target.value as "classic" | "modern" | "minimal")
              }
            >
              <option value="classic">Classic</option>
              <option value="modern">Modern</option>
              <option value="minimal">Minimal</option>
            </Select>
          </Field>
          <Field label="Language" htmlFor="locale">
            <Select
              id="locale"
              name="locale"
              value={locale}
              onChange={(e) => setLocale(e.target.value as "en" | "ar")}
            >
              <option value="en">English</option>
              <option value="ar">Arabic (RTL)</option>
            </Select>
          </Field>
          <Field label="Notes" htmlFor="notes" hint="Shown on each invoice.">
            <Textarea
              id="notes"
              name="notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </Field>
          <Field label="Terms" htmlFor="terms" hint="Shown on each invoice.">
            <Textarea
              id="terms"
              name="terms"
              rows={2}
              value={terms}
              onChange={(e) => setTerms(e.target.value)}
            />
          </Field>
          </CardContent>
        </Card>
      </div>

      <LineItemsEditor
        lines={lines}
        onLinesChange={setLines}
        products={products}
        taxRates={taxRates}
        currency={business.currency}
        lineTotalsByKey={preview.lineTotalsByKey}
      />
      <LineTotalsBox totals={preview.totals} currency={business.currency} />

      <div className="sticky bottom-4 z-10 flex gap-2 rounded-lg border bg-card p-3 shadow-lg">
        <SubmitButton>Create schedule</SubmitButton>
        <Button variant="outline" asChild>
          <Link href="/recurring">Cancel</Link>
        </Button>
      </div>
    </form>
  );
}
