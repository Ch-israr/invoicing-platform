"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Field, FormError, SubmitButton } from "@/components/shared/form-fields";
import { COUNTRIES } from "@/lib/validation/business";

export type FormState = { error?: string; ok?: boolean } | null;

export type CustomerFormValues = {
  id?: string;
  type: "INDIVIDUAL" | "COMPANY";
  name: string;
  companyName?: string | null;
  email?: string | null;
  phone?: string | null;
  billingAddress?: string | null;
  shippingAddress?: string | null;
  country: string;
  trn?: string | null;
  notes?: string | null;
  status: "ACTIVE" | "INACTIVE";
};

export function CustomerForm({
  customer,
  action,
  submitLabel,
}: {
  customer?: CustomerFormValues;
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  submitLabel: string;
}) {
  const [state, formAction] = useActionState(action, null);
  const v = customer;

  return (
    <form action={formAction} className="space-y-5">
      {v?.id ? <input type="hidden" name="id" value={v.id} /> : null}
      <FormError error={state?.error} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Customer type" htmlFor="type">
          <Select id="type" name="type" defaultValue={v?.type ?? "COMPANY"}>
            <option value="COMPANY">Company</option>
            <option value="INDIVIDUAL">Individual</option>
          </Select>
        </Field>
        <Field label="Status" htmlFor="status">
          <Select id="status" name="status" defaultValue={v?.status ?? "ACTIVE"}>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </Select>
        </Field>
        <Field label="Customer name" htmlFor="name">
          <Input id="name" name="name" required defaultValue={v?.name ?? ""} placeholder="e.g. Ahmed Khan" />
        </Field>
        <Field label="Company name" htmlFor="companyName" hint="For company customers — leave blank for individuals.">
          <Input id="companyName" name="companyName" defaultValue={v?.companyName ?? ""} />
        </Field>
        <Field label="Email" htmlFor="email">
          <Input id="email" name="email" type="email" defaultValue={v?.email ?? ""} />
        </Field>
        <Field label="Phone" htmlFor="phone">
          <Input id="phone" name="phone" type="tel" defaultValue={v?.phone ?? ""} />
        </Field>
        <Field label="Country" htmlFor="country">
          <Select id="country" name="country" defaultValue={v?.country ?? "AE"}>
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="TRN (Tax Registration Number)" htmlFor="trn">
          <Input id="trn" name="trn" defaultValue={v?.trn ?? ""} />
        </Field>
        <Field label="Billing address" htmlFor="billingAddress">
          <Textarea id="billingAddress" name="billingAddress" defaultValue={v?.billingAddress ?? ""} />
        </Field>
        <Field label="Shipping address" htmlFor="shippingAddress">
          <Textarea id="shippingAddress" name="shippingAddress" defaultValue={v?.shippingAddress ?? ""} />
        </Field>
      </div>
      <Field label="Notes" htmlFor="notes">
        <Textarea id="notes" name="notes" defaultValue={v?.notes ?? ""} />
      </Field>
      <div className="flex gap-2">
        <SubmitButton>{submitLabel}</SubmitButton>
        <Button type="button" variant="outline" asChild>
          <Link href="/customers">Cancel</Link>
        </Button>
      </div>
    </form>
  );
}
