"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Field, FormError, SubmitButton } from "@/components/shared/form-fields";
import type { FormState } from "@/components/invoices/invoice-builder";

export type ExpenseCategoryOption = { id: string; name: string };

export type ExpenseFormValues = {
  title: string;
  date: string;
  amount: string;
  vatAmount: string;
  categoryId: string;
  vendor: string;
  method: "CASH" | "BANK_TRANSFER" | "CARD" | "OTHER";
  description: string;
  receiptUrl: string | null;
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function ExpenseForm({
  expenseId,
  initial,
  categories,
  currency,
  action,
  submitLabel,
}: {
  expenseId?: string;
  initial?: ExpenseFormValues;
  categories: ExpenseCategoryOption[];
  currency: string;
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  submitLabel: string;
}) {
  const [state, formAction] = useActionState(action, null);
  const [method, setMethod] = useState(initial?.method ?? "BANK_TRANSFER");
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? "");

  return (
    <form action={formAction} className="max-w-2xl space-y-6">
      {expenseId ? <input type="hidden" name="id" value={expenseId} /> : null}
      <FormError error={state?.error} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Title" htmlFor="title">
          <Input
            id="title"
            name="title"
            required
            defaultValue={initial?.title ?? ""}
            placeholder="e.g. Office rent — December"
          />
        </Field>
        <Field label="Date" htmlFor="date">
          <Input
            id="date"
            name="date"
            type="date"
            required
            defaultValue={initial?.date ?? todayIso()}
          />
        </Field>
        <Field label={`Amount (${currency})`} htmlFor="amount">
          <Input
            id="amount"
            name="amount"
            inputMode="decimal"
            required
            defaultValue={initial?.amount ?? ""}
            placeholder="0.00"
          />
        </Field>
        <Field label={`VAT included (${currency})`} htmlFor="vatAmount" hint="VAT part of the amount, if any.">
          <Input
            id="vatAmount"
            name="vatAmount"
            inputMode="decimal"
            defaultValue={initial?.vatAmount ?? "0"}
            placeholder="0.00"
          />
        </Field>
        <Field label="Category" htmlFor="categoryId">
          <Select
            id="categoryId"
            name="categoryId"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
          >
            <option value="">Uncategorised</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Vendor" htmlFor="vendor">
          <Input
            id="vendor"
            name="vendor"
            defaultValue={initial?.vendor ?? ""}
            placeholder="e.g. Etisalat"
          />
        </Field>
        <Field label="Paid by" htmlFor="method">
          <Select
            id="method"
            name="method"
            value={method}
            onChange={(e) =>
              setMethod(e.target.value as ExpenseFormValues["method"])
            }
          >
            <option value="BANK_TRANSFER">Bank transfer</option>
            <option value="CASH">Cash</option>
            <option value="CARD">Card</option>
            <option value="OTHER">Other</option>
          </Select>
        </Field>
        <Field label="Receipt" htmlFor="receipt" hint="PNG, JPEG, WebP or PDF, up to 5 MB.">
          <div className="space-y-2">
            {initial?.receiptUrl ? (
              <p className="text-sm">
                <a
                  href={initial.receiptUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  View current receipt
                </a>{" "}
                — uploading a new file replaces it.
              </p>
            ) : null}
            <Input
              id="receipt"
              name="receipt"
              type="file"
              accept="image/png,image/jpeg,image/webp,application/pdf"
            />
          </div>
        </Field>
      </div>

      <Field label="Description" htmlFor="description">
        <Textarea
          id="description"
          name="description"
          rows={3}
          defaultValue={initial?.description ?? ""}
        />
      </Field>

      <div className="flex gap-2">
        <SubmitButton>{submitLabel}</SubmitButton>
        <Button variant="outline" asChild>
          <Link href="/expenses">Cancel</Link>
        </Button>
      </div>
    </form>
  );
}
