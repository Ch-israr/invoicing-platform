"use client";

import { useActionState, useMemo, useState } from "react";
import Decimal from "decimal.js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FormError, SubmitButton } from "@/components/shared/form-fields";
import { createCreditNoteAction } from "@/app/(app)/invoices/actions";
import { calculateLine } from "@/lib/money";
import { formatMoney } from "@/lib/utils";

export type CreditLine = {
  id: string;
  description: string;
  sku: string | null;
  quantity: string;
  unit: string;
  unitPrice: string;
  taxRate: string;
  taxCategory: string;
  taxInclusive: boolean;
  creditedQty: string;
  remainingQty: string;
};

type LineState = {
  id: string;
  quantity: string;
  unitPrice: string;
};

/**
 * Credit part of an invoice, line by line. Quantity is capped at the
 * line's remaining uncredited quantity and the price at the invoiced
 * price (both re-checked server-side). Totals shown here are
 * display-only — the server recomputes everything.
 */
export function CreditNoteForm({
  invoiceId,
  invoiceNumber,
  currency,
  balance,
  lines,
}: {
  invoiceId: string;
  invoiceNumber: string;
  currency: string;
  balance: string;
  lines: CreditLine[];
}) {
  const [state, formAction] = useActionState(createCreditNoteAction, null);
  const [reason, setReason] = useState("");
  const [lineState, setLineState] = useState<Record<string, LineState>>(
    () =>
      Object.fromEntries(
        lines.map((l) => [
          l.id,
          { id: l.id, quantity: "", unitPrice: l.unitPrice },
        ]),
      ),
  );

  const updateLine = (id: string, patch: Partial<LineState>) =>
    setLineState((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  const active = useMemo(
    () =>
      lines
        .map((l) => ({ line: l, state: lineState[l.id] }))
        .filter(({ state }) => state && Number(state.quantity) > 0),
    [lines, lineState],
  );

  const totals = useMemo(() => {
    const results = active.map(({ line, state }) =>
      calculateLine({
        quantity: state.quantity,
        unitPrice: state.unitPrice || "0",
        discountType: "NONE",
        discountValue: "0",
        taxRatePercent: line.taxRate,
        taxInclusive: line.taxInclusive,
      }),
    );
    const sum = (pick: (r: (typeof results)[number]) => Decimal) =>
      results.reduce((acc, r) => acc.add(pick(r)), new Decimal(0));
    return {
      subtotal: sum((r) => r.netAmount),
      vatAmount: sum((r) => r.vatAmount),
      grandTotal: sum((r) => r.lineTotal),
    };
  }, [active]);

  const itemsJson = JSON.stringify(
    active.map(({ state }) => ({
      invoiceItemId: state.id,
      quantity: state.quantity,
      unitPrice: state.unitPrice,
    })),
  );

  const overBalance = totals.grandTotal.greaterThan(new Decimal(balance));

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="id" value={invoiceId} />
      <input type="hidden" name="items" value={itemsJson} />
      <FormError error={state?.error} />
      <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
        Crediting invoice {invoiceNumber}. Outstanding balance{" "}
        {formatMoney(balance, currency)} — the credit can never exceed it.
        The invoice itself is never changed; the credit reduces its
        balance.
      </p>

      <Field label="Reason" htmlFor="reason">
        <Textarea
          id="reason"
          name="reason"
          rows={2}
          required
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Returned goods, damaged item, goodwill"
        />
      </Field>

      <Card>
        <CardHeader>
          <CardTitle>Lines to credit</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
        {lines.map((l) => {
          const st = lineState[l.id];
          const remaining = new Decimal(l.remainingQty);
          const fullyCredited = remaining.lessThanOrEqualTo(0);
          return (
            <div key={l.id} className="space-y-3 rounded-lg border bg-card p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-medium">{l.description}</p>
                <p className="text-sm text-muted-foreground">
                  {l.quantity} {l.unit} × {formatMoney(l.unitPrice, currency)}
                  {l.creditedQty !== "0"
                    ? ` — ${l.creditedQty} already credited, ${l.remainingQty} left`
                    : ""}
                  {l.taxInclusive ? " (incl. VAT)" : ""}
                </p>
              </div>
              {fullyCredited ? (
                <p className="text-sm text-muted-foreground">
                  Fully credited already.
                </p>
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <Field label="Quantity to credit" htmlFor={`qty-${l.id}`}>
                    <Input
                      id={`qty-${l.id}`}
                      inputMode="decimal"
                      placeholder="0"
                      value={st?.quantity ?? ""}
                      onChange={(e) => updateLine(l.id, { quantity: e.target.value })}
                    />
                  </Field>
                  <Field label="Unit price" htmlFor={`price-${l.id}`}>
                    <Input
                      id={`price-${l.id}`}
                      inputMode="decimal"
                      value={st?.unitPrice ?? ""}
                      onChange={(e) => updateLine(l.id, { unitPrice: e.target.value })}
                    />
                  </Field>
                  <p className="self-end text-sm text-muted-foreground">
                    Max {l.remainingQty} {l.unit}
                  </p>
                </div>
              )}
            </div>
          );
        })}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <dl className="w-full max-w-xs space-y-1.5 rounded-lg border bg-card p-4 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Credit subtotal</dt>
            <dd>{formatMoney(totals.subtotal.toString(), currency)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">VAT</dt>
            <dd>{formatMoney(totals.vatAmount.toString(), currency)}</dd>
          </div>
          <div className="flex justify-between border-t pt-2 text-base font-bold">
            <dt>Total credit</dt>
            <dd>{formatMoney(totals.grandTotal.toString(), currency)}</dd>
          </div>
          {overBalance ? (
            <p className="text-xs text-destructive">
              This credit exceeds the outstanding balance.
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">
            Preview totals — the server recalculates everything when saving.
          </p>
        </dl>
      </div>

      <div className="sticky bottom-4 z-10 flex gap-2 rounded-lg border bg-card p-3 shadow-lg">
        <SubmitButton>Issue credit note</SubmitButton>
        <Button variant="outline" asChild>
          <a href={`/invoices/${invoiceId}`}>Cancel</a>
        </Button>
      </div>
    </form>
  );
}
