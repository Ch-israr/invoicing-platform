"use client";

import { useActionState } from "react";
import { Input } from "@/components/ui/input";
import { Field, FormError, SubmitButton } from "@/components/shared/form-fields";
import type { FormState } from "@/components/invoices/invoice-builder";

export function CategoryForm({
  action,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
}) {
  const [state, formAction] = useActionState(action, null);
  return (
    <form action={formAction} className="space-y-3">
      <div className="flex gap-2">
        <div className="flex-1">
          <Field label="Name" htmlFor="name">
            <Input id="name" name="name" required placeholder="e.g. Subscriptions" />
          </Field>
        </div>
        <div className="self-end">
          <SubmitButton>Add category</SubmitButton>
        </div>
      </div>
      <FormError error={state?.error} />
    </form>
  );
}
