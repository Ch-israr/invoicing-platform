"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Field, FormError, SubmitButton } from "@/components/shared/form-fields";
import { InvoicePreview } from "./invoice-preview";
import type { InvoicePreviewData } from "@/lib/invoice-preview";
import { calculateInvoice } from "@/lib/money";
import { taxCategoryForRateCode } from "@/lib/validation/invoice";
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
} from "./line-items-editor";

// Re-exported for the invoice/quotation edit pages.
export type { BuilderProduct, BuilderTaxRate, LineState } from "./line-items-editor";

// lineIndex: index of the offending line item (into the items array
// as submitted), when the failure is about one line — the builder
// highlights that line.
export type FormState = { error?: string; ok?: boolean; lineIndex?: number } | null;

export type BuilderCustomer = {
  id: string;
  name: string;
  companyName: string | null;
  type: "INDIVIDUAL" | "COMPANY";
  email: string | null;
  phone: string | null;
  billingAddress: string | null;
  trn: string | null;
};

export type BuilderBusiness = {
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  trn: string | null;
  bankName: string | null;
  accountName: string | null;
  iban: string | null;
  swift: string | null;
  paymentInstructions: string | null;
  logoUrl: string | null;
  signatureUrl: string | null;
  defaultTerms: string | null;
  defaultFooter: string | null;
  currency: string;
  invoicePrefix: string;
  nextInvoiceNumber: number;
};

export type InvoiceBuilderValues = {
  customerId: string;
  issueDate: string;
  dueDate: string;
  supplyDate: string;
  notes: string;
  terms: string;
  template: "classic" | "modern" | "minimal";
  locale: "en" | "ar";
  lines: LineState[];
  /** Invoice-level discount (invoice variant only). */
  invoiceDiscountType?: "NONE" | "PERCENT" | "FIXED";
  invoiceDiscountValue?: string;
  /** Early-payment discount (invoice variant only). */
  earlyDiscountType?: "NONE" | "PERCENT" | "FIXED";
  earlyDiscountValue?: string;
  earlyDiscountDays?: string;
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function plusDaysIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function InvoiceBuilder({
  invoiceId,
  initial,
  customers,
  products,
  taxRates,
  business,
  settingsTemplate,
  settingsLocale,
  settingsTerms,
  nextNumberPreview,
  action,
  submitLabel,
  variant = "invoice",
  cancelHref = "/invoices",
}: {
  invoiceId?: string;
  initial?: InvoiceBuilderValues;
  customers: BuilderCustomer[];
  products: BuilderProduct[];
  taxRates: BuilderTaxRate[];
  business: BuilderBusiness;
  settingsTemplate: "classic" | "modern" | "minimal";
  settingsLocale: "en" | "ar";
  settingsTerms?: string | null;
  nextNumberPreview: string;
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  submitLabel: string;
  /**
   * "quotation" reuses the whole builder for quotations: the due date
   * field becomes the expiry date (the quotation action maps
   * dueDate → expiryDate), the supply date is hidden, and the preview
   * renders as a quotation. Items, totals and validation are identical.
   */
  variant?: "invoice" | "quotation";
  cancelHref?: string;
}) {
  const isQuotation = variant === "quotation";
  const [state, formAction] = useActionState(action, null);

  const defaultRateId = useMemo(() => defaultTaxRateId(taxRates), [taxRates]);
  const rateById = useMemo(
    () => new Map(taxRates.map((t) => [t.id, t])),
    [taxRates],
  );

  const [customerId, setCustomerId] = useState(initial?.customerId ?? "");
  const [issueDate, setIssueDate] = useState(initial?.issueDate ?? todayIso());
  const [dueDate, setDueDate] = useState(initial?.dueDate ?? plusDaysIso(30));
  const [supplyDate, setSupplyDate] = useState(initial?.supplyDate ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [terms, setTerms] = useState(initial?.terms ?? settingsTerms ?? "");
  const [template, setTemplate] = useState<"classic" | "modern" | "minimal">(
    initial?.template ?? settingsTemplate,
  );
  const [locale, setLocale] = useState<"en" | "ar">(initial?.locale ?? settingsLocale);
  const [lines, setLines] = useState<LineState[]>(
    initial?.lines && initial.lines.length > 0 ? initial.lines : [blankLine(defaultRateId)],
  );

  // Invoice-level + early-payment discounts (invoice variant only;
  // quotations never carry them). Draft-time fields, locked on issue.
  const [invoiceDiscountType, setInvoiceDiscountType] = useState<
    "NONE" | "PERCENT" | "FIXED"
  >(initial?.invoiceDiscountType ?? "NONE");
  const [invoiceDiscountValue, setInvoiceDiscountValue] = useState(
    initial?.invoiceDiscountValue ?? "0",
  );
  const [earlyDiscountType, setEarlyDiscountType] = useState<
    "NONE" | "PERCENT" | "FIXED"
  >(initial?.earlyDiscountType ?? "NONE");
  const [earlyDiscountValue, setEarlyDiscountValue] = useState(
    initial?.earlyDiscountValue ?? "0",
  );
  const [earlyDiscountDays, setEarlyDiscountDays] = useState(
    initial?.earlyDiscountDays ?? "10",
  );

  // Live preview totals — display only; the server recalculates on save.
  const preview = useMemo(
    () =>
      computeLinePreview(lines, taxRates, {
        type: invoiceDiscountType,
        value: invoiceDiscountValue || "0",
      }),
    [lines, taxRates, invoiceDiscountType, invoiceDiscountValue],
  );

  const previewData: InvoicePreviewData = useMemo(() => {
    const customer = customers.find((c) => c.id === customerId);
    const validLines = lines.filter(
      (l) => l.description.trim() !== "" && Number(l.quantity) > 0 && l.unitPrice.trim() !== "",
    );
    const { lines: results } = calculateInvoice(
      validLines.map((l) => ({
        quantity: l.quantity || "0",
        unitPrice: l.unitPrice || "0",
        discountType: l.discountType,
        discountValue: l.discountValue || "0",
        taxRatePercent: l.taxRateId ? (rateById.get(l.taxRateId)?.rate ?? "0") : "0",
        taxInclusive: l.taxInclusive,
      })),
    );
    return {
      number: null,
      status: "DRAFT",
      documentKind: isQuotation ? "quotation" : "invoice",
      template,
      locale,
      currency: business.currency,
      issueDate,
      dueDate,
      supplyDate: supplyDate || null,
      business: {
        name: business.name,
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
        logoUrl: business.logoUrl,
        signatureUrl: business.signatureUrl,
        terms: business.defaultTerms,
        footer: business.defaultFooter,
      },
      customer: {
        name: customer?.name ?? "—",
        companyName: customer?.companyName ?? null,
        email: customer?.email ?? null,
        phone: customer?.phone ?? null,
        billingAddress: customer?.billingAddress ?? null,
        trn: customer?.trn ?? null,
      },
      items: validLines.map((l, i) => ({
        description: l.description,
        sku: l.sku || null,
        quantity: l.quantity,
        unit: l.unit,
        unitPrice: l.unitPrice,
        discountType: l.discountType,
        discountValue: l.discountValue || "0",
        taxRate: l.taxRateId ? (rateById.get(l.taxRateId)?.rate ?? "0") : "0",
        taxCategory: l.taxRateId
          ? taxCategoryForRateCode(rateById.get(l.taxRateId)?.code ?? "STD_5")
          : "OUT_OF_SCOPE",
        taxInclusive: l.taxInclusive,
        netAmount: results[i]?.netAmount.toString() ?? "0",
        discountAmount: results[i]?.discountAmount.toString() ?? "0",
        taxableAmount: results[i]?.taxableAmount.toString() ?? "0",
        vatAmount: results[i]?.vatAmount.toString() ?? "0",
        lineTotal: results[i]?.lineTotal.toString() ?? "0",
      })),
      totals: {
        subtotal: preview.totals.subtotal.toString(),
        discountTotal: preview.totals.discountTotal.toString(),
        lineDiscountTotal: preview.totals.lineDiscountTotal.toString(),
        invoiceDiscountTotal: preview.totals.invoiceDiscountTotal.toString(),
        taxableAmount: preview.totals.taxableAmount.toString(),
        vatAmount: preview.totals.vatAmount.toString(),
        grandTotal: preview.totals.grandTotal.toString(),
        amountPaid: "0",
        balance: preview.totals.grandTotal.toString(),
      },
      notes: notes || null,
      terms: terms || null,
    };
  }, [lines, customerId, customers, template, locale, business, issueDate, dueDate, supplyDate, notes, terms, rateById, preview, isQuotation]);

  // Lines as submitted: fully-empty lines (the blank starting line,
  // or an "Add line" never filled) are dropped, so they can never
  // block a save. The server strips them again defensively, with the
  // same rule, so the submitted index the server reports for a bad
  // line maps back to this list.
  const submittedLines = useMemo(() => lines.filter((l) => !isEmptyLine(l)), [lines]);

  // Key of the line the last failed save pointed at, snapshotted when
  // the error arrives so later edits don't move the highlight.
  const [errorLineKey, setErrorLineKey] = useState<string | null>(null);
  useEffect(() => {
    if (state?.lineIndex !== undefined) {
      setErrorLineKey(submittedLines[state.lineIndex]?.key ?? null);
    } else {
      setErrorLineKey(null);
    }
    // Only the error state may move the highlight — not later edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const itemsJson = JSON.stringify(
    submittedLines.map((l) => ({
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
    <div className="space-y-6">
      <form action={formAction} className="space-y-6">
        {invoiceId ? <input type="hidden" name="id" value={invoiceId} /> : null}
        <input type="hidden" name="items" value={itemsJson} />
        <FormError error={state?.error} />

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Invoice details</CardTitle>
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
            {customers.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No active customers yet.{" "}
                <Link href="/customers/new" className="underline">
                  Add a customer
                </Link>{" "}
                first.
              </p>
            ) : null}
            <div className="grid grid-cols-3 gap-4">
              <Field label="Issue date" htmlFor="issueDate">
                <Input
                  id="issueDate"
                  name="issueDate"
                  type="date"
                  required
                  value={issueDate}
                  onChange={(e) => setIssueDate(e.target.value)}
                />
              </Field>
              <Field label={isQuotation ? "Expiry date" : "Due date"} htmlFor="dueDate">
                <Input
                  id="dueDate"
                  name="dueDate"
                  type="date"
                  required
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </Field>
              {isQuotation ? null : (
                <Field label="Supply date" htmlFor="supplyDate" hint="Optional">
                  <Input
                    id="supplyDate"
                    name="supplyDate"
                    type="date"
                    value={supplyDate}
                    onChange={(e) => setSupplyDate(e.target.value)}
                  />
                </Field>
              )}
            </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Template &amp; notes</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Template" htmlFor="template">
                <Select
                  id="template"
                  name="template"
                  value={template}
                  onChange={(e) => setTemplate(e.target.value as "classic" | "modern" | "minimal")}
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
                  <option value="ar">العربية (Arabic, RTL)</option>
                </Select>
              </Field>
            </div>
            <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
              Saved as a draft.{" "}
              {isQuotation
                ? `The quotation number (${nextNumberPreview}) is assigned when you send it — numbers are never reused.`
                : `The invoice number (${nextNumberPreview}) is assigned when you issue it — numbers are never reused.`}
            </p>
            <Field label="Notes" htmlFor="notes" hint="Shown on the invoice.">
              <Textarea
                id="notes"
                name="notes"
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </Field>
            <Field label="Terms" htmlFor="terms" hint="Shown on the invoice.">
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
          highlightKey={errorLineKey}
        />

        {isQuotation ? null : (
          <Card>
            <CardHeader>
              <CardTitle>Discounts</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Field label="Invoice discount" htmlFor="invoiceDiscountType" hint="Applied to the whole invoice before tax, after line discounts.">
                <div className="flex gap-2">
                  <Select
                    id="invoiceDiscountType"
                    name="invoiceDiscountType"
                    value={invoiceDiscountType}
                    onChange={(e) => {
                      setInvoiceDiscountType(
                        e.target.value as "NONE" | "PERCENT" | "FIXED",
                      );
                      setInvoiceDiscountValue("0");
                    }}
                  >
                    <option value="NONE">None</option>
                    <option value="PERCENT">%</option>
                    <option value="FIXED">Fixed</option>
                  </Select>
                  {invoiceDiscountType !== "NONE" ? (
                    <Input
                      id="invoiceDiscountValue"
                      name="invoiceDiscountValue"
                      aria-label="Invoice discount value"
                      inputMode="decimal"
                      value={invoiceDiscountValue}
                      onChange={(e) => setInvoiceDiscountValue(e.target.value)}
                      placeholder={invoiceDiscountType === "PERCENT" ? "10" : "25.00"}
                    />
                  ) : null}
                </div>
              </Field>
              <Field
                label="Early-payment discount"
                htmlFor="earlyDiscountType"
                hint="Offered when recording a payment, only within the window from the issue date. It never reduces the invoice total."
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Select
                    id="earlyDiscountType"
                    name="earlyDiscountType"
                    value={earlyDiscountType}
                    onChange={(e) => {
                      setEarlyDiscountType(
                        e.target.value as "NONE" | "PERCENT" | "FIXED",
                      );
                      setEarlyDiscountValue("0");
                    }}
                  >
                    <option value="NONE">None</option>
                    <option value="PERCENT">%</option>
                    <option value="FIXED">Fixed</option>
                  </Select>
                  {earlyDiscountType !== "NONE" ? (
                    <>
                      <Input
                        id="earlyDiscountValue"
                        name="earlyDiscountValue"
                        aria-label="Early-payment discount value"
                        inputMode="decimal"
                        value={earlyDiscountValue}
                        onChange={(e) => setEarlyDiscountValue(e.target.value)}
                        placeholder={earlyDiscountType === "PERCENT" ? "2" : "25.00"}
                        className="max-w-32"
                      />
                      <span className="text-sm text-muted-foreground">if paid within</span>
                      <Input
                        id="earlyDiscountDays"
                        name="earlyDiscountDays"
                        aria-label="Early-payment discount days"
                        type="number"
                        min={0}
                        step={1}
                        value={earlyDiscountDays}
                        onChange={(e) => setEarlyDiscountDays(e.target.value)}
                        className="max-w-24"
                      />
                      <span className="text-sm text-muted-foreground">days</span>
                    </>
                  ) : null}
                </div>
              </Field>
            </CardContent>
          </Card>
        )}

        <LineTotalsBox totals={preview.totals} currency={business.currency} />

        <div className="sticky bottom-4 z-10 space-y-2 rounded-lg border bg-card p-3 shadow-lg">
          {state?.error ? (
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              Couldn&apos;t save — {state.error}
              {errorLineKey ? ". Check the highlighted line." : ""}
            </p>
          ) : null}
          <div className="flex gap-2">
            <SubmitButton>{submitLabel}</SubmitButton>
            <Button variant="outline" asChild>
              <Link href={cancelHref}>Cancel</Link>
            </Button>
          </div>
        </div>
      </form>

      {/* Live preview */}
      <div className="space-y-2">
        <h2 className="text-lg font-semibold">Live preview</h2>
        <p className="text-sm text-muted-foreground">
          {isQuotation
            ? "This is the same layout the quotation will be shown in."
            : "This is the same layout the PDF will use."}
        </p>
        <InvoicePreview data={previewData} />
      </div>
    </div>
  );
}
