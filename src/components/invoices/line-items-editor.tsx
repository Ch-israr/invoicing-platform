"use client";

import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Field } from "@/components/shared/form-fields";
import { calculateInvoice } from "@/lib/money";
import { cn, formatMoney } from "@/lib/utils";
import { isEmptyLineState } from "@/lib/validation/invoice";

/**
 * Shared line-item editor for the invoice builder, the quotation
 * builder and the recurring-invoice form. One editor, one behaviour:
 * product prefill, per-line discount (% or fixed), per-line VAT rate,
 * tax-inclusive prices. Totals are display-only — the server
 * recalculates everything on save.
 */

export type LineState = {
  key: string;
  productId: string;
  description: string;
  sku: string;
  unit: string;
  quantity: string;
  unitPrice: string;
  discountType: "NONE" | "PERCENT" | "FIXED";
  discountValue: string;
  taxRateId: string;
  taxInclusive: boolean;
};

export type BuilderProduct = {
  id: string;
  name: string;
  sku: string | null;
  description: string | null;
  unit: string;
  price: string;
  taxRateId: string | null;
  taxCategory: "STANDARD" | "ZERO_RATED" | "EXEMPT" | "OUT_OF_SCOPE";
};

export type BuilderTaxRate = {
  id: string;
  code: string;
  name: string;
  rate: string;
};

let keyCounter = 0;
function nextKey(): string {
  keyCounter += 1;
  return `line-${Date.now()}-${keyCounter}`;
}

export function blankLine(defaultRateId: string): LineState {
  return {
    key: nextKey(),
    productId: "",
    description: "",
    sku: "",
    unit: "pcs",
    quantity: "1",
    unitPrice: "",
    discountType: "NONE",
    discountValue: "0",
    taxRateId: defaultRateId,
    taxInclusive: false,
  };
}

/** The tax rate a fresh line defaults to (STD 5% when present). */
export function defaultTaxRateId(taxRates: BuilderTaxRate[]): string {
  return taxRates.find((t) => t.code === "STD_5")?.id ?? taxRates[0]?.id ?? "";
}

/**
 * A line that carries nothing — no product, no description, no SKU,
 * no price and no discount. The blank line's defaults (quantity "1",
 * unit "pcs", the default VAT rate) are not content, so they don't
 * count. Delegates to `isEmptyLineState` in lib/validation/invoice.ts
 * so the client and the server judge emptiness by the same rule.
 */
export function isEmptyLine(line: LineState): boolean {
  return isEmptyLineState(line);
}

/**
 * Display-only preview totals for a set of lines. Blank/incomplete
 * lines are skipped, and totals are keyed by line so a blank line
 * cannot shift the totals of the lines after it.
 */
export function computeLinePreview(
  lines: LineState[],
  taxRates: BuilderTaxRate[],
): {
  totals: ReturnType<typeof calculateInvoice>["totals"];
  lineTotalsByKey: Map<string, string>;
} {
  const rateById = new Map(taxRates.map((t) => [t.id, t]));
  const valid = lines.filter(
    (l) => l.description.trim() !== "" && Number(l.quantity) > 0 && l.unitPrice.trim() !== "",
  );
  const { lines: results, totals } = calculateInvoice(
    valid.map((l) => ({
      quantity: l.quantity || "0",
      unitPrice: l.unitPrice || "0",
      discountType: l.discountType,
      discountValue: l.discountValue || "0",
      taxRatePercent: l.taxRateId ? (rateById.get(l.taxRateId)?.rate ?? "0") : "0",
      taxInclusive: l.taxInclusive,
    })),
  );
  const lineTotalsByKey = new Map<string, string>();
  valid.forEach((l, i) => {
    const total = results[i]?.lineTotal.toString();
    if (total !== undefined) lineTotalsByKey.set(l.key, total);
  });
  return { totals, lineTotalsByKey };
}

/** The totals box shown under the line editor (display only). */
export function LineTotalsBox({
  totals,
  currency,
}: {
  totals: ReturnType<typeof calculateInvoice>["totals"];
  currency: string;
}) {
  return (
    <div className="flex justify-end">
      <dl className="w-full max-w-xs space-y-1.5 rounded-lg border bg-card p-4 text-sm shadow-sm">
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Subtotal</dt>
          <dd className="tabular-nums">{formatMoney(totals.subtotal.toString(), currency)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Discount</dt>
          <dd className="tabular-nums">−{formatMoney(totals.discountTotal.toString(), currency)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Taxable amount</dt>
          <dd className="tabular-nums">{formatMoney(totals.taxableAmount.toString(), currency)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted-foreground">VAT</dt>
          <dd className="tabular-nums">{formatMoney(totals.vatAmount.toString(), currency)}</dd>
        </div>
        <div className="mt-1 flex justify-between rounded-md bg-muted px-2 py-1.5 text-base font-bold">
          <dt>Grand total</dt>
          <dd className="tabular-nums">{formatMoney(totals.grandTotal.toString(), currency)}</dd>
        </div>
        <p className="text-xs text-muted-foreground">
          Preview totals — the server recalculates everything when saving.
        </p>
      </dl>
    </div>
  );
}

export function LineItemsEditor({
  lines,
  onLinesChange,
  products,
  taxRates,
  currency,
  lineTotalsByKey,
  highlightKey,
}: {
  lines: LineState[];
  onLinesChange: (lines: LineState[]) => void;
  products: BuilderProduct[];
  taxRates: BuilderTaxRate[];
  currency: string;
  lineTotalsByKey: Map<string, string>;
  /** Key of the line the last failed save pointed at — it gets a red
   * ring and a "Check this line" label. */
  highlightKey?: string | null;
}) {
  const defaultRateId = useMemo(() => defaultTaxRateId(taxRates), [taxRates]);

  const updateLine = (key: string, patch: Partial<LineState>) => {
    onLinesChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  };

  const applyProduct = (key: string, productId: string) => {
    if (!productId) {
      updateLine(key, { productId: "", description: "", sku: "", unit: "pcs", unitPrice: "" });
      return;
    }
    const p = products.find((x) => x.id === productId);
    if (!p) return;
    updateLine(key, {
      productId: p.id,
      description: p.name,
      sku: p.sku ?? "",
      unit: p.unit,
      unitPrice: p.price,
      taxRateId: p.taxRateId ?? defaultRateId,
    });
  };

  const removeLine = (key: string) => {
    if (lines.length > 1) onLinesChange(lines.filter((l) => l.key !== key));
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Line items</h2>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onLinesChange([...lines, blankLine(defaultRateId)])}
        >
          Add line
        </Button>
      </div>
      {lines.map((line, idx) => {
        const lineTotal = lineTotalsByKey.get(line.key);
        const highlighted = highlightKey != null && line.key === highlightKey;
        return (
          <div
            key={line.key}
            className={cn(
              "space-y-3 rounded-lg border bg-card p-4 shadow-sm",
              highlighted && "border-destructive ring-2 ring-destructive/40",
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold">Line {idx + 1}</span>
              {highlighted ? (
                <span className="text-sm font-medium text-destructive">
                  Check this line
                </span>
              ) : null}
              <div className="flex items-center gap-3">
                {lineTotal !== undefined ? (
                  <span className="text-sm font-semibold tabular-nums">
                    {formatMoney(lineTotal, currency)}
                  </span>
                ) : null}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={lines.length === 1}
                  onClick={() => removeLine(line.key)}
                >
                  Remove
                </Button>
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Item" htmlFor={`product-${line.key}`}>
                <Select
                  id={`product-${line.key}`}
                  value={line.productId}
                  onChange={(e) => applyProduct(line.key, e.target.value)}
                >
                  <option value="">Custom line — type a description</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.sku ? ` (${p.sku})` : ""} — {formatMoney(p.price, currency)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Description" htmlFor={`desc-${line.key}`}>
                <Input
                  id={`desc-${line.key}`}
                  value={line.description}
                  onChange={(e) => updateLine(line.key, { description: e.target.value })}
                  placeholder="e.g. Consulting — January"
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
              <Field label="SKU" htmlFor={`sku-${line.key}`}>
                <Input
                  id={`sku-${line.key}`}
                  value={line.sku}
                  onChange={(e) => updateLine(line.key, { sku: e.target.value })}
                />
              </Field>
              <Field label="Quantity" htmlFor={`qty-${line.key}`}>
                <Input
                  id={`qty-${line.key}`}
                  inputMode="decimal"
                  value={line.quantity}
                  onChange={(e) => updateLine(line.key, { quantity: e.target.value })}
                />
              </Field>
              <Field label="Unit" htmlFor={`unit-${line.key}`}>
                <Input
                  id={`unit-${line.key}`}
                  value={line.unit}
                  onChange={(e) => updateLine(line.key, { unit: e.target.value })}
                />
              </Field>
              <Field label="Unit price" htmlFor={`price-${line.key}`}>
                <Input
                  id={`price-${line.key}`}
                  inputMode="decimal"
                  value={line.unitPrice}
                  onChange={(e) => updateLine(line.key, { unitPrice: e.target.value })}
                  placeholder="0.00"
                />
              </Field>
              <Field label="Discount" htmlFor={`disc-type-${line.key}`}>
                <div className="flex gap-2">
                  <Select
                    id={`disc-type-${line.key}`}
                    value={line.discountType}
                    onChange={(e) =>
                      updateLine(line.key, {
                        discountType: e.target.value as LineState["discountType"],
                        discountValue: "0",
                      })
                    }
                  >
                    <option value="NONE">None</option>
                    <option value="PERCENT">%</option>
                    <option value="FIXED">Fixed</option>
                  </Select>
                  {line.discountType !== "NONE" ? (
                    <Input
                      aria-label="Discount value"
                      inputMode="decimal"
                      value={line.discountValue}
                      onChange={(e) => updateLine(line.key, { discountValue: e.target.value })}
                      placeholder={line.discountType === "PERCENT" ? "10" : "25.00"}
                    />
                  ) : null}
                </div>
              </Field>
              <Field label="VAT rate" htmlFor={`tax-${line.key}`}>
                <Select
                  id={`tax-${line.key}`}
                  value={line.taxRateId}
                  onChange={(e) => updateLine(line.key, { taxRateId: e.target.value })}
                >
                  {taxRates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.code} — {t.rate}%
                    </option>
                  ))}
                  <option value="">Out of scope (0%)</option>
                </Select>
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={line.taxInclusive}
                onChange={(e) => updateLine(line.key, { taxInclusive: e.target.checked })}
                className="h-4 w-4 accent-primary"
              />
              Unit price already includes VAT
            </label>
          </div>
        );
      })}
    </div>
  );
}
