"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Field, FormError, SubmitButton } from "@/components/shared/form-fields";
import { recordPaymentAction } from "@/app/(app)/invoices/actions";
import { formatMoney } from "@/lib/utils";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Record a payment against an issued invoice. Amount is capped at the outstanding balance. */
export function PaymentForm({
  invoiceId,
  currency,
  balance,
}: {
  invoiceId: string;
  currency: string;
  balance: string;
}) {
  const [state, formAction] = useActionState(recordPaymentAction, null);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("BANK_TRANSFER");
  const [date, setDate] = useState(todayIso());

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
      <div className="flex flex-wrap gap-2">
        <SubmitButton>Record payment</SubmitButton>
        <Button
          type="button"
          variant="outline"
          onClick={() => setAmount(balance)}
        >
          Pay in full ({formatMoney(balance, currency)})
        </Button>
      </div>
    </form>
  );
}
