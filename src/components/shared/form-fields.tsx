"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

export function Field({
  label,
  htmlFor,
  children,
  hint,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function FormError({ error }: { error?: string }) {
  if (!error) return null;
  return (
    <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {error}
    </p>
  );
}

export function FormSaved({ saved }: { saved?: boolean }) {
  if (!saved) return null;
  return (
    <p role="status" className="rounded-md bg-green-600/10 px-3 py-2 text-sm text-green-700 dark:text-green-400">
      Saved.
    </p>
  );
}

export function SubmitButton({
  children,
  variant,
}: {
  children: React.ReactNode;
  variant?: "default" | "destructive" | "outline" | "secondary" | "ghost";
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} disabled={pending}>
      {pending ? "Saving…" : children}
    </Button>
  );
}
