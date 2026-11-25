"use client";

import { useActionState, useState } from "react";
import Decimal from "decimal.js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Field, FormError, SubmitButton } from "@/components/shared/form-fields";
import { recordPaymentAction } from "@/app/(app)/invoices/actions";
import { formatMoney } from "@/lib/utils";
import {
  earlyDiscountDeadline,
  earlyDiscountSaving,
  isWithinEarlyDiscountWindow,
} from "@/lib/money";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatDay(date: Date): string {
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * Record a payment against an issued invoice. Amount is capped at the
 * outstanding balance. When the invoice offers an early-payment
 * discount and today is within the window, a checkbox offers it: the
 * saving is computed from the current remaining balance, and ticking
 * it fills the amount that settles the invoice (balance − saving).
 */
export function PaymentForm({
  invoiceId,
  currency,
  balance,
  issueDate,
  earlyDiscount,
}: {
  invoiceId: string;
  currency: string;
  balance: string;
  issueDate: string;
  earlyDiscount?: {
    type: "NONE" | "PERCENT" | "FIXED";
    value: string;
    days: number;
  };
}) {
  const [state, formAction] = useActionState(recordPaymentAction, null);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("BANK_TRANSFER");
  const [date, setDate] = useState(todayIso());
  const [applyEarlyDiscount, setApplyEarlyDiscount] = useState(false);

  // The offer: only when a discount is configured, today is within
  // the window, and the saving is a real amount smaller than the
  // balance (a 100% discount would leave a $0 payment).
  const saving =
    earlyDiscount && earlyDiscount.type !== "NONE"
      ? earlyDiscountSaving(balance, earlyDiscount.type, earlyDiscount.value)
      : new Decimal(0);
  const inWindow =
    earlyDiscount && earlyDiscount.type !== "NONE"
      ? isWithinEarlyDiscountWindow(new Date(`${issueDate}T00:00:00Z`), earlyDiscount.days)
      : false;
  const balanceDec = new Decimal(balance);
  const earlyDiscountOffered =
    inWindow && saving.greaterThan(0) && saving.lessThan(balanceDec);
  const payableWithDiscount = balanceDec.sub(saving);
  const payInFullAmount = applyEarlyDiscount ? payableWithDiscount : balanceDec;

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="id" value={invoiceId} />
      <FormError error={state?.error} />
      <div className="space-y-4">
        <Field label="Date" htmlFor="payment-date">
          <Input
            id="payment-date"
            name="date"
            type="date"
            required
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>
        <Field
          label="Amount"
          htmlFor="payment-amount"
          hint={`Outstanding: ${formatMoney(balance, currency)}`}
        >
          <Input
            id="payment-amount"
            name="amount"
            inputMode="decimal"
            required
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </Field>
        <Field label="Method" htmlFor="payment-method">
          <Select
            id="payment-method"
            name="method"
            value={method}
            onChange={(e) => setMethod(e.target.value)}
          >
            <option value="BANK_TRANSFER">Bank transfer</option>
            <option value="CASH">Cash</option>
            <option value="CARD">Card</option>
            <option value="OTHER">Other</option>
          </Select>
        </Field>
        <Field label="Reference" htmlFor="payment-reference" hint="Optional">
          <Input
            id="payment-reference"
            name="reference"
            placeholder="e.g. transfer ref"
          />
        </Field>
      </div>
      <Field label="Notes" htmlFor="payment-notes" hint="Optional">
        <Textarea id="payment-notes" name="notes" rows={2} />
      </Field>
      {earlyDiscountOffered && earlyDiscount ? (
        <label
          htmlFor="apply-early-discount"
          className="flex cursor-pointer items-start gap-2 rounded-md border bg-muted/60 px-3 py-2 text-sm"
        >
          <input
            id="apply-early-discount"
            name="applyEarlyDiscount"
            type="checkbox"
            value="true"
            checked={applyEarlyDiscount}
            onChange={(e) => {
              const checked = e.target.checked;
              setApplyEarlyDiscount(checked);
              setAmount(
                checked
                  ? payableWithDiscount.toFixed(2)
                  : balanceDec.toFixed(2),
              );
            }}
            className="mt-0.5"
          />
          <span>
            Apply early-payment discount (save {formatMoney(saving.toString(), currency)} if
            paid by{" "}
            {formatDay(earlyDiscountDeadline(new Date(`${issueDate}T00:00:00Z`), earlyDiscount.days))})
          </span>
        </label>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <SubmitButton>Record payment</SubmitButton>
        <Button
          type="button"
          variant="outline"
          onClick={() => setAmount(payInFullAmount.toFixed(2))}
        >
          Pay in full ({formatMoney(payInFullAmount.toString(), currency)})
        </Button>
      </div>
    </form>
  );
}
