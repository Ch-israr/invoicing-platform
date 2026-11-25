"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import Decimal from "decimal.js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FormError, SubmitButton } from "@/components/shared/form-fields";
import { DeleteButton } from "@/components/shared/delete-button";
import {
  deletePaymentAction,
  recordRefundAction,
} from "@/app/(app)/invoices/actions";
import { formatMoney } from "@/lib/utils";

export type PaymentRow = {
  id: string;
  date: Date;
  amount: string;
  method: string;
  reference: string | null;
  notes: string | null;
  refunds: Array<{ id: string; amount: string; reason: string | null; date: Date }>;
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}

const METHOD_LABELS: Record<string, string> = {
  CASH: "Cash",
  BANK_TRANSFER: "Bank transfer",
  CARD: "Card",
  OTHER: "Other",
};

/** Inline refund form for one payment (OWNER/ADMIN only). */
function RefundForm({
  invoiceId,
  paymentId,
  maxAmount,
  currency,
}: {
  invoiceId: string;
  paymentId: string;
  maxAmount: string;
  currency: string;
}) {
  const [state, formAction] = useActionState(recordRefundAction, null);
  return (
    <form action={formAction} className="mt-3 space-y-3 rounded-md border p-3">
      <input type="hidden" name="id" value={invoiceId} />
      <input type="hidden" name="paymentId" value={paymentId} />
      <FormError error={state?.error} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Refund date" htmlFor={`refund-date-${paymentId}`}>
          <Input
            id={`refund-date-${paymentId}`}
            name="date"
            type="date"
            required
            defaultValue={todayIso()}
          />
        </Field>
        <Field
          label="Amount"
          htmlFor={`refund-amount-${paymentId}`}
          hint={`Up to ${formatMoney(maxAmount, currency)} unrefunded`}
        >
          <Input
            id={`refund-amount-${paymentId}`}
            name="amount"
            inputMode="decimal"
            required
            placeholder="0.00"
          />
        </Field>
        <Field label="Reason" htmlFor={`refund-reason-${paymentId}`}>
          <Input
            id={`refund-reason-${paymentId}`}
            name="reason"
            required
            placeholder="Why is this being refunded?"
          />
        </Field>
      </div>
      <SubmitButton variant="outline">Record refund</SubmitButton>
    </form>
  );
}

/** Payments on an invoice: amount, method, refunds and net paid. */
export function PaymentList({
  invoiceId,
  payments,
  currency,
  canManage,
}: {
  invoiceId: string;
  payments: PaymentRow[];
  currency: string;
  canManage: boolean;
}) {
  const [refundFor, setRefundFor] = useState<string | null>(null);
  if (payments.length === 0) {
    return <p className="text-sm text-muted-foreground">No payments recorded yet.</p>;
  }
  return (
    <ul className="relative space-y-5 before:absolute before:bottom-2 before:left-[5px] before:top-2 before:w-px before:bg-border">
      {payments.map((p) => {
        const refunded = p.refunds.reduce(
          (acc, r) => acc.add(new Decimal(r.amount)),
          new Decimal(0),
        );
        const net = new Decimal(p.amount).sub(refunded);
        const unrefunded = net.toString();
        return (
          <li key={p.id} className="relative pl-6">
            <span
              className="absolute left-0 top-1.5 h-[11px] w-[11px] rounded-full border-2 border-background bg-green-600"
              aria-hidden
            />
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-medium tabular-nums">
                  {formatMoney(p.amount, currency)}
                  <span className="ml-2 text-sm font-normal text-muted-foreground">
                    {METHOD_LABELS[p.method] ?? p.method} · {formatDate(p.date)}
                  </span>
                </p>
                {p.reference ? (
                  <p className="text-sm text-muted-foreground">Ref: {p.reference}</p>
                ) : null}
                {p.notes ? (
                  <p className="whitespace-pre-line text-sm text-muted-foreground">{p.notes}</p>
                ) : null}
                {refunded.greaterThan(0) ? (
                  <p className="text-sm text-amber-700 dark:text-amber-400">
                    Refunded {formatMoney(refunded.toString(), currency)} — net{" "}
                    {formatMoney(net.toString(), currency)}
                  </p>
                ) : null}
                {p.refunds.map((r) => (
                  <p key={r.id} className="text-xs text-muted-foreground">
                    Refund {formatMoney(r.amount, currency)} on {formatDate(r.date)}
                    {r.reason ? ` — ${r.reason}` : ""}
                  </p>
                ))}
              </div>
              <div className="flex gap-2">
                <Button asChild variant="outline" size="sm">
                  <Link href={`/payments/${p.id}/receipt`}>Receipt</Link>
                </Button>
                {canManage && refunded.lessThan(new Decimal(p.amount)) ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setRefundFor(refundFor === p.id ? null : p.id)}
                  >
                    {refundFor === p.id ? "Close refund" : "Refund"}
                  </Button>
                ) : null}
                {canManage && p.refunds.length === 0 ? (
                  <form action={deletePaymentAction}>
                    <input type="hidden" name="id" value={invoiceId} />
                    <input type="hidden" name="paymentId" value={p.id} />
                    <DeleteButton label="Delete" />
                  </form>
                ) : null}
              </div>
            </div>
            {canManage && refundFor === p.id ? (
              <RefundForm
                invoiceId={invoiceId}
                paymentId={p.id}
                maxAmount={unrefunded}
                currency={currency}
              />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
