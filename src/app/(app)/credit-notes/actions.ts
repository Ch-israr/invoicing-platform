"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { TenantError } from "@/lib/tenant";
import { cancelCreditNote } from "@/server/services/credit-note.service";

async function requireUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  return session.user.id;
}

/** Cancel an issued credit note (OWNER/ADMIN) — restores the invoice balance. */
export async function cancelCreditNoteAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const id = formData.get("id");
  if (typeof id !== "string" || !id) return;
  try {
    const result = await cancelCreditNote(userId, id);
    if (!result.ok) {
      redirect(`/credit-notes/${id}?actionError=` + encodeURIComponent(result.error));
    }
  } catch (err) {
    if (err instanceof TenantError) {
      redirect(`/credit-notes/${id}?actionError=` + encodeURIComponent(err.message));
    }
    throw err;
  }
  revalidatePath("/credit-notes");
  redirect(`/credit-notes/${id}`);
}
