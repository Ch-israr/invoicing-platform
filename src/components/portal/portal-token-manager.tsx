"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FormError } from "@/components/shared/form-fields";
import {
  createPortalTokenAction,
  revokePortalTokenAction,
  type PortalTokenFormState,
} from "@/app/(app)/portal-tokens/actions";
import type { PortalTokenView } from "@/server/services/portal.service";

/**
 * Customer portal links for one invoice / quotation / customer.
 * The plaintext link is shown exactly once, right after creation —
 * only its hash is stored, so a lost link can never be recovered,
 * only revoked and re-created.
 */
export function PortalTokenManager({
  kind,
  documentId,
  tokens,
  canManage,
  backPath,
}: {
  kind: "invoice" | "quotation" | "customer";
  documentId: string;
  tokens: PortalTokenView[];
  canManage: boolean;
  backPath: string;
}) {
  const [state, formAction] = useActionState<PortalTokenFormState, FormData>(
    createPortalTokenAction,
    null,
  );
  const [copied, setCopied] = useState(false);
  const [expiryDays, setExpiryDays] = useState("30");

  const copyLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${url}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable — the link text itself is selectable.
    }
  };

  const now = Date.now();
  return (
    <div className="space-y-4">
      {state?.token && state.url ? (
        <div className="rounded-md bg-green-600/10 p-3">
          <p className="text-sm font-medium text-green-700 dark:text-green-400">
            Portal link created — copy it now. It will not be shown again.
          </p>
          <p className="mt-1 break-all text-sm">
            {`${typeof window !== "undefined" ? window.location.origin : ""}${state.url}`}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={() => copyLink(state.url!)}
          >
            {copied ? "Copied" : "Copy link"}
          </Button>
        </div>
      ) : null}
      <FormError error={state?.error} />

      {canManage ? (
        <form action={formAction} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="kind" value={kind} />
          <input type="hidden" name="documentId" value={documentId} />
          <input type="hidden" name="back" value={backPath} />
          <Field label="Link expires in (days)" htmlFor="portal-expiry-days">
            <Input
              id="portal-expiry-days"
              name="expiresInDays"
              inputMode="numeric"
              value={expiryDays}
              onChange={(e) => setExpiryDays(e.target.value)}
              className="w-24"
            />
          </Field>
          <Button type="submit" variant="outline">
            Create portal link
          </Button>
        </form>
      ) : null}

      {tokens.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No portal links yet. A link lets the customer open this document
          without signing in.
        </p>
      ) : (
        <ul className="space-y-2">
          {tokens.map((t) => {
            const expired = t.expiresAt.getTime() < now;
            const status = t.revokedAt ? "Revoked" : expired ? "Expired" : "Active";
            return (
              <li
                key={t.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
              >
                <div>
                  <p className="font-medium">{t.scope}</p>
                  <p className="text-sm text-muted-foreground">
                    {status} · created {t.createdAt.toLocaleDateString()} · expires{" "}
                    {t.expiresAt.toLocaleDateString()}
                  </p>
                </div>
                {!t.revokedAt && canManage ? (
                  <form action={revokePortalTokenAction}>
                    <input type="hidden" name="tokenId" value={t.id} />
                    <input type="hidden" name="back" value={backPath} />
                    <Button type="submit" variant="outline" size="sm">
                      Revoke
                    </Button>
                  </form>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
