"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { TenantError } from "@/lib/tenant";
import {
  cancelRecurring,
  createRecurring,
  pauseRecurring,
  resumeRecurring,
  runDueSchedules,
  runRecurring,
} from "@/server/services/recurring.service";
import type { FormState } from "@/components/invoices/invoice-builder";

async function requireUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  return session.user.id;
}

function formObject(formData: FormData): Record<string, string> {
  const obj: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") obj[key] = value;
  }
  return obj;
}

/** Line items arrive as a JSON string in a hidden field (the form
 * keeps them in client state). Parsed here, then validated by Zod in
 * the service — the server never trusts client totals. */
function parseItems(formData: FormData): unknown {
  const raw = formData.get("items");
  if (typeof raw !== "string") return [];
  try {
    return JSON.parse(raw);
  } catch {
    return "__invalid__";
  }
}

export async function createRecurringAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const userId = await requireUserId();
  const items = parseItems(formData);
  if (items === "__invalid__") return { error: "Line items could not be read" };
  try {
    const result = await createRecurring(userId, { ...formObject(formData), items });
    if (!result.ok) return { error: result.error, lineIndex: result.lineIndex };
    revalidatePath("/recurring");
    redirect(`/recurring/${result.data.id}`);
  } catch (err) {
    if (err instanceof TenantError) return { error: err.message };
    throw err;
  }
}

function scheduleId(formData: FormData): string | null {
  const id = formData.get("id");
  return typeof id === "string" && id ? id : null;
}

export async function pauseRecurringAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const id = scheduleId(formData);
  if (!id) return;
  try {
    const result = await pauseRecurring(userId, id);
    if (!result.ok) redirect(`/recurring/${id}?actionError=` + encodeURIComponent(result.error));
  } catch (err) {
    if (err instanceof TenantError) {
      redirect(`/recurring/${id}?actionError=` + encodeURIComponent(err.message));
    }
    throw err;
  }
  revalidatePath("/recurring");
  redirect(`/recurring/${id}`);
}

export async function resumeRecurringAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const id = scheduleId(formData);
  if (!id) return;
  try {
    const result = await resumeRecurring(userId, id);
    if (!result.ok) redirect(`/recurring/${id}?actionError=` + encodeURIComponent(result.error));
  } catch (err) {
    if (err instanceof TenantError) {
      redirect(`/recurring/${id}?actionError=` + encodeURIComponent(err.message));
    }
    throw err;
  }
  revalidatePath("/recurring");
  redirect(`/recurring/${id}`);
}

export async function cancelRecurringAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const id = scheduleId(formData);
  if (!id) return;
  try {
    const result = await cancelRecurring(userId, id);
    if (!result.ok) redirect(`/recurring/${id}?actionError=` + encodeURIComponent(result.error));
  } catch (err) {
    if (err instanceof TenantError) {
      redirect(`/recurring/${id}?actionError=` + encodeURIComponent(err.message));
    }
    throw err;
  }
  revalidatePath("/recurring");
  redirect(`/recurring/${id}`);
}

/** Run one schedule now (its next period, even if not yet due). */
export async function runRecurringNowAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const id = scheduleId(formData);
  if (!id) return;
  try {
    const result = await runRecurring({ userId, scheduleId: id });
    revalidatePath("/recurring");
    if (result.created.length > 0) {
      redirect(`/recurring/${id}?ran=${result.created.length}`);
    }
    redirect(
      `/recurring/${id}?actionError=` +
        encodeURIComponent(
          result.skipped[0]?.reason ?? "Nothing was due for this schedule",
        ),
    );
  } catch (err) {
    if (err instanceof TenantError) {
      redirect(`/recurring/${id}?actionError=` + encodeURIComponent(err.message));
    }
    throw err;
  }
}

/** Run every due schedule for the business (manual trigger; no cron daemon in this phase). */
export async function runDueSchedulesAction(): Promise<void> {
  const userId = await requireUserId();
  try {
    const result = await runDueSchedules({ userId });
    revalidatePath("/recurring");
    redirect(
      `/recurring?ran=${result.created.length}&issued=${result.issued.length}&emailed=${result.emailed.length}`,
    );
  } catch (err) {
    if (err instanceof TenantError) {
      redirect("/recurring?actionError=" + encodeURIComponent(err.message));
    }
    throw err;
  }
}
