"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { decideQuotationViaPortal } from "@/server/services/portal.service";

async function clientIp(): Promise<string> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return h.get("x-real-ip") ?? "unknown";
}

/** Accept a quotation from the portal (no login — token-verified). */
export async function acceptQuotationPortalAction(formData: FormData): Promise<void> {
  const token = String(formData.get("token") ?? "");
  const quotationId = String(formData.get("quotationId") ?? "");
  const ip = await clientIp();
  const result = await decideQuotationViaPortal(token, ip, quotationId, "ACCEPTED");
  if (!result.ok) {
    redirect(
      `/portal/${encodeURIComponent(token)}?portalError=${encodeURIComponent(result.error ?? "Could not decide the quotation")}`,
    );
  }
  redirect(`/portal/${encodeURIComponent(token)}?decided=accepted`);
}

/** Reject a quotation from the portal (no login — token-verified). */
export async function rejectQuotationPortalAction(formData: FormData): Promise<void> {
  const token = String(formData.get("token") ?? "");
  const quotationId = String(formData.get("quotationId") ?? "");
  const ip = await clientIp();
  const result = await decideQuotationViaPortal(token, ip, quotationId, "REJECTED");
  if (!result.ok) {
    redirect(
      `/portal/${encodeURIComponent(token)}?portalError=${encodeURIComponent(result.error ?? "Could not decide the quotation")}`,
    );
  }
  redirect(`/portal/${encodeURIComponent(token)}?decided=rejected`);
}
