"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { TenantError } from "@/lib/tenant";
import { safeBackPath } from "@/lib/utils";
import {
  processEmailQueue,
  retryEmailLog,
  retryFailedEmails,
} from "@/server/email/service";

async function requireUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  return session.user.id;
}

/** Manual retry of one failed email (bypasses the backoff wait). */
export async function retryEmailAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const id = formData.get("id");
  if (typeof id !== "string" || !id) return;
  const back = formData.get("back");
  // safeBackPath rejects protocol-relative targets (//evil.com) that a
  // bare startsWith("/") check would let through.
  const backTo = safeBackPath(back, "/emails");
  try {
    const result = await retryEmailLog(userId, id);
    if (!result.ok) {
      redirect(backTo + `?actionError=` + encodeURIComponent(result.error));
    }
  } catch (err) {
    if (err instanceof TenantError) {
      redirect(backTo + `?actionError=` + encodeURIComponent(err.message));
    }
    throw err;
  }
  revalidatePath("/emails");
  redirect(backTo);
}

/** Retry every failed email that still has attempts left (respects backoff). */
export async function retryAllFailedEmailsAction(): Promise<void> {
  const userId = await requireUserId();
  try {
    const result = await retryFailedEmails(userId);
    revalidatePath("/emails");
    redirect(`/emails?retried=${result.retried}&skipped=${result.skipped}`);
  } catch (err) {
    if (err instanceof TenantError) {
      redirect("/emails?actionError=" + encodeURIComponent(err.message));
    }
    throw err;
  }
}

/** Drain the queue now (manual trigger; no worker daemon in this phase). */
export async function processEmailQueueAction(): Promise<void> {
  const userId = await requireUserId();
  try {
    const result = await processEmailQueue({ userId });
    revalidatePath("/emails");
    redirect(`/emails?sent=${result.sent}&failed=${result.failed}`);
  } catch (err) {
    if (err instanceof TenantError) {
      redirect("/emails?actionError=" + encodeURIComponent(err.message));
    }
    throw err;
  }
}
