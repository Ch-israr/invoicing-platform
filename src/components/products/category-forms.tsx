"use client";

import { useActionState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FormError, SubmitButton } from "@/components/shared/form-fields";
import { DeleteButton } from "@/components/shared/delete-button";

export type FormState = { error?: string; ok?: boolean } | null;

export function CategoryForms({
  categories,
  createAction,
  renameAction,
  deleteAction,
}: {
  categories: { id: string; name: string; productCount: number }[];
  createAction: (prev: FormState, formData: FormData) => Promise<FormState>;
  renameAction: (prev: FormState, formData: FormData) => Promise<FormState>;
  deleteAction: (formData: FormData) => Promise<void>;
}) {
  const [createState, createFormAction] = useActionState(createAction, null);
  const [renameState, renameFormAction] = useActionState(renameAction, null);

  return (
    <div className="space-y-6">
      <form action={createFormAction} className="flex items-end gap-2">
        <div className="flex-1">
          <label htmlFor="new-category" className="mb-1.5 block text-sm font-medium">
            Category name
          </label>
          <Input id="new-category" name="name" required placeholder="e.g. Services" />
        </div>
        <SubmitButton>Add category</SubmitButton>
      </form>
      <FormError error={createState?.error} />

      {categories.length === 0 ? (
        <p className="text-sm text-muted-foreground">No categories yet.</p>
      ) : (
        <ul className="space-y-3">
          {categories.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-2 rounded-md border p-3">
              <form action={renameFormAction} className="flex flex-1 items-center gap-2">
                <input type="hidden" name="id" value={c.id} />
                <Input name="name" defaultValue={c.name} aria-label={`Rename category ${c.name}`} className="min-w-40 flex-1" />
                <Button type="submit" variant="outline" size="sm">
                  Rename
                </Button>
              </form>
              <span className="text-xs text-muted-foreground">
                {c.productCount} item{c.productCount === 1 ? "" : "s"}
              </span>
              <form action={deleteAction}>
                <input type="hidden" name="id" value={c.id} />
                <DeleteButton label="Delete" />
              </form>
            </li>
          ))}
        </ul>
      )}
      <FormError error={renameState?.error} />
      {renameState?.ok ? (
        <p role="status" className="text-sm text-green-700 dark:text-green-400">
          Category renamed.
        </p>
      ) : null}
    </div>
  );
}
