"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { TenantError } from "@/lib/tenant";
import {
  acceptQuotation,
  convertQuotationToInvoice,
  createQuotation,
  deleteQuotation,
  expireQuotation,
  rejectQuotation,
  sendQuotation,
  updateQuotation,
} from "@/server/services/quotation.service";

// lineIndex: index of the offending line item (into the items array
// as submitted), when the failure is about one line — the builder
// highlights that line.
export type FormState = { error?: string; ok?: boolean; lineIndex?: number } | null;

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

/** Line items arrive as a JSON string in a hidden field (same as invoices). */
function parseItems(formData: FormData): unknown {
  const raw = formData.get("items");
  if (typeof raw !== "string") return [];
  try {
    return JSON.parse(raw);
  } catch {
    return "__invalid__";
  }
}

function quotationInput(formData: FormData): Record<string, unknown> {
  const raw = formObject(formData);
  // The shared builder posts the second date as `dueDate`; for a
  // quotation that field is the expiry date.
  return { ...raw, expiryDate: raw.dueDate, items: parseItems(formData) };
}

export async function createQuotationAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const userId = await requireUserId();
  const input = quotationInput(formData);
  if (input.items === "__invalid__") return { error: "Line items could not be read" };
  try {
    const result = await createQuotation(userId, input);
    if (!result.ok) return { error: result.error, lineIndex: result.lineIndex };
    revalidatePath("/quotations");
    redirect(`/quotations/${result.data.id}`);
  } catch (err) {
    if (err instanceof TenantError) return { error: err.message };
    throw err;
  }
}

export async function updateQuotationAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const userId = await requireUserId();
  const id = formData.get("id");
  if (typeof id !== "string" || !id) return { error: "Missing quotation id" };
  const input = quotationInput(formData);
  if (input.items === "__invalid__") return { error: "Line items could not be read" };
  try {
    const result = await updateQuotation(userId, id, input);
    if (!result.ok) return { error: result.error, lineIndex: result.lineIndex };
  } catch (err) {
    if (err instanceof TenantError) return { error: err.message };
    throw err;
  }
  revalidatePath("/quotations");
  redirect(`/quotations/${id}`);
}

function lifecycleAction(
  fn: (userId: string, id: string) => Promise<{ ok: boolean; error?: string }>,
) {
  return async (formData: FormData): Promise<void> => {
    const userId = await requireUserId();
    const id = formData.get("id");
    if (typeof id !== "string" || !id) return;
    try {
      const result = await fn(userId, id);
      if (!result.ok) {
        redirect(`/quotations/${id}?actionError=` + encodeURIComponent(result.error ?? "Failed"));
      }
    } catch (err) {
      if (err instanceof TenantError) {
        redirect(`/quotations/${id}?actionError=` + encodeURIComponent(err.message));
      }
      throw err;
    }
    revalidatePath("/quotations");
    redirect(`/quotations/${id}`);
  };
}

export const sendQuotationAction = lifecycleAction(sendQuotation);
export const acceptQuotationAction = lifecycleAction(acceptQuotation);
export const rejectQuotationAction = lifecycleAction(rejectQuotation);
export const expireQuotationAction = lifecycleAction(expireQuotation);

export async function convertQuotationAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const id = formData.get("id");
  if (typeof id !== "string" || !id) return;
  try {
    const result = await convertQuotationToInvoice(userId, id);
    if (!result.ok) {
      redirect(`/quotations/${id}?actionError=` + encodeURIComponent(result.error));
    }
    revalidatePath("/quotations");
    revalidatePath("/invoices");
    redirect(`/invoices/${result.data.invoiceId}`);
  } catch (err) {
    if (err instanceof TenantError) {
      redirect(`/quotations/${id}?actionError=` + encodeURIComponent(err.message));
    }
    throw err;
  }
}

export async function deleteQuotationAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const id = formData.get("id");
  if (typeof id !== "string" || !id) return;
  try {
    const result = await deleteQuotation(userId, id);
    if (!result.ok) {
      redirect("/quotations?deleteError=" + encodeURIComponent(result.error));
    }
  } catch (err) {
    if (err instanceof TenantError) {
      redirect("/quotations?deleteError=" + encodeURIComponent(err.message));
    }
    throw err;
  }
  revalidatePath("/quotations");
  redirect("/quotations");
}
