"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { TenantError } from "@/lib/tenant";
import { safeBackPath } from "@/lib/utils";
import {
  createPortalToken,
  revokePortalToken,
} from "@/server/services/portal.service";

export type PortalTokenFormState = {
  error?: string;
  ok?: boolean;
  /** Plaintext token — returned exactly once, shown to the business user. */
  token?: string;
  url?: string;
} | null;

async function requireUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  return session.user.id;
}

export async function createPortalTokenAction(
  _prev: PortalTokenFormState,
  formData: FormData,
): Promise<PortalTokenFormState> {
  const userId = await requireUserId();
  const kind = String(formData.get("kind") ?? "");
  const documentId = String(formData.get("documentId") ?? "");
  const expiresRaw = String(formData.get("expiresInDays") ?? "30");
  const expiresInDays = Number.parseInt(expiresRaw, 10);
  const back = safeBackPath(formData.get("back"), "");
  try {
    const input =
      kind === "invoice"
        ? { invoiceId: documentId, expiresInDays }
        : kind === "quotation"
          ? { quotationId: documentId, expiresInDays }
          : kind === "customer"
            ? { customerId: documentId, expiresInDays }
            : null;
    if (!input) return { error: "Unknown portal link type" };
    const result = await createPortalToken(userId, input);
    if (!result.ok) return { error: result.error };
    if (back) revalidatePath(back);
    return { ok: true, token: result.data.token, url: result.data.url };
  } catch (err) {
    if (err instanceof TenantError) return { error: err.message };
    throw err;
  }
}

export async function revokePortalTokenAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const tokenId = String(formData.get("tokenId") ?? "");
  // The `back` path comes from a hidden form field — never redirect to
  // an external URL supplied by the caller (open redirect).
  const back = safeBackPath(formData.get("back"), "/dashboard");
  try {
    await revokePortalToken(userId, tokenId);
  } catch (err) {
    if (err instanceof TenantError) {
      redirect(`${back}?actionError=${encodeURIComponent(err.message)}`);
    }
    throw err;
  }
  revalidatePath(back);
  redirect(back);
}
