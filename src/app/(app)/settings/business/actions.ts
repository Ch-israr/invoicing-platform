"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { getDefaultBusinessForUser, TenantError } from "@/lib/tenant";
import { saveUpload, validateImageFile } from "@/lib/storage";
import { updateBusinessProfile } from "@/server/services/business.service";

export type FormState = { error?: string; ok?: boolean } | null;

export async function updateBusinessAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const userId = session.user.id;

  // Text fields only — file inputs are handled separately below.
  const input: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") input[key] = value;
  }

  // Optional uploads: only stored when a file was actually chosen.
  const files: { logoUrl?: string; signatureUrl?: string } = {};
  for (const [field, kind] of [
    ["logo", "logo"],
    ["signature", "signature"],
  ] as const) {
    const file = formData.get(field);
    if (file instanceof File && file.size > 0) {
      const problem = validateImageFile(file);
      if (problem) return { error: `${field === "logo" ? "Logo" : "Signature"}: ${problem}` };
      const business = await getDefaultBusinessForUser(userId);
      if (!business) return { error: "No business found" };
      const saved = await saveUpload(business.id, kind, file);
      if (kind === "logo") files.logoUrl = saved.url;
      else files.signatureUrl = saved.url;
    }
  }

  try {
    const result = await updateBusinessProfile(userId, input, files);
    if (!result.ok) return { error: result.error };
  } catch (err) {
    if (err instanceof TenantError) return { error: err.message };
    throw err;
  }
  revalidatePath("/settings/business");
  revalidatePath("/dashboard");
  return { ok: true };
}
