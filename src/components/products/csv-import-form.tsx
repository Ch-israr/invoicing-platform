"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Field, FormError, SubmitButton } from "@/components/shared/form-fields";

export type ImportState =
  | { error?: string; created?: number; importErrors?: { row: number; message: string }[] }
  | null;

export function CsvImportForm({
  action,
}: {
  action: (prev: ImportState, formData: FormData) => Promise<ImportState>;
}) {
  const [state, formAction] = useActionState(action, null);

  return (
    <div className="space-y-4">
      <form action={formAction} className="space-y-4">
        <FormError error={state?.error} />
        <Field
          label="CSV file"
          htmlFor="file"
          hint="Columns: Name* and Price* are required. Optional: SKU, Description, Category, Unit, Tax Category, Tax Rate Code, Active. Unknown categories are created automatically."
        >
          <Input id="file" name="file" type="file" accept=".csv,text/csv" required />
        </Field>
        <div className="flex gap-2">
          <SubmitButton>Import products</SubmitButton>
          <Button type="button" variant="outline" asChild>
            <Link href="/products">Cancel</Link>
          </Button>
        </div>
      </form>

      {state?.created !== undefined ? (
        <div className="space-y-2 rounded-md border p-4">
          <p role="status" className="text-sm font-medium">
            Imported {state.created} item{state.created === 1 ? "" : "s"}.
          </p>
          {state.importErrors && state.importErrors.length > 0 ? (
            <>
              <p className="text-sm text-muted-foreground">
                {state.importErrors.length} row{state.importErrors.length === 1 ? "" : "s"} could not be imported:
              </p>
              <ul className="list-disc space-y-1 pl-5 text-sm">
                {state.importErrors.map((e, i) => (
                  <li key={i}>
                    Row {e.row}: {e.message}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No errors — every row was imported.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
