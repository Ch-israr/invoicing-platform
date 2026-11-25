"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FormError, SubmitButton } from "@/components/shared/form-fields";

export type FormState = { error?: string; ok?: boolean } | null;

export type ProductFormValues = {
  id?: string;
  name: string;
  sku?: string | null;
  description?: string | null;
  categoryId?: string | null;
  unit: string;
  price: string;
  taxRateId?: string | null;
  taxCategory: "STANDARD" | "ZERO_RATED" | "EXEMPT" | "OUT_OF_SCOPE";
  isActive: boolean;
};

export type TaxRateOption = { id: string; code: string; name: string; rate: string };
export type CategoryOption = { id: string; name: string };

export function ProductForm({
  product,
  categories,
  taxRates,
  currency,
  action,
  submitLabel,
}: {
  product?: ProductFormValues;
  categories: CategoryOption[];
  taxRates: TaxRateOption[];
  currency: string;
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  submitLabel: string;
}) {
  const [state, formAction] = useActionState(action, null);
  const v = product;

  return (
    <form action={formAction} className="space-y-6">
      {v?.id ? <input type="hidden" name="id" value={v.id} /> : null}
      <FormError error={state?.error} />
      <Card>
        <CardHeader>
          <CardTitle>Item details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Item name" htmlFor="name">
              <Input id="name" name="name" required defaultValue={v?.name ?? ""} placeholder="e.g. Consulting — per hour" />
            </Field>
            <Field label="SKU" htmlFor="sku" hint="Unique within your business. Leave blank if none.">
              <Input id="sku" name="sku" defaultValue={v?.sku ?? ""} />
            </Field>
            <Field label="Category" htmlFor="categoryId">
              <Select id="categoryId" name="categoryId" defaultValue={v?.categoryId ?? ""}>
                <option value="">No category</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Unit" htmlFor="unit">
              <Input id="unit" name="unit" defaultValue={v?.unit ?? "pcs"} />
            </Field>
          </div>
          <Field label="Description" htmlFor="description">
            <Textarea id="description" name="description" defaultValue={v?.description ?? ""} />
          </Field>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Pricing &amp; tax</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={`Unit price (${currency})`} htmlFor="price">
              <Input id="price" name="price" required inputMode="decimal" defaultValue={v?.price ?? ""} placeholder="0.00" />
            </Field>
            <Field label="Default tax rate" htmlFor="taxRateId">
              <Select id="taxRateId" name="taxRateId" defaultValue={v?.taxRateId ?? ""}>
                <option value="">Business default</option>
                {taxRates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.code} — {t.name} ({t.rate}%)
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Tax category" htmlFor="taxCategory">
              <Select id="taxCategory" name="taxCategory" defaultValue={v?.taxCategory ?? "STANDARD"}>
                <option value="STANDARD">Standard rated</option>
                <option value="ZERO_RATED">Zero-rated</option>
                <option value="EXEMPT">Exempt</option>
                <option value="OUT_OF_SCOPE">Out of scope</option>
              </Select>
            </Field>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Status</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Status" htmlFor="isActive">
              <Select id="isActive" name="isActive" defaultValue={v?.isActive === false ? "false" : "true"}>
                <option value="true">Active</option>
                <option value="false">Inactive</option>
              </Select>
            </Field>
          </div>
          <p className="text-xs text-muted-foreground">
            Changing the price here only changes the catalogue price. Invoices
            already issued keep the price they were issued at.
          </p>
        </CardContent>
      </Card>
      <div className="sticky bottom-4 z-10 flex gap-2 rounded-lg border bg-card p-3 shadow-lg">
        <SubmitButton>{submitLabel}</SubmitButton>
        <Button type="button" variant="outline" asChild>
          <Link href="/products">Cancel</Link>
        </Button>
      </div>
    </form>
  );
}
