"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { TenantError } from "@/lib/tenant";
import {
  createCustomer,
  deleteCustomer,
  updateCustomer,
} from "@/server/services/customer.service";

export type FormState = { error?: string; ok?: boolean } | null;

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

export async function createCustomerAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const userId = await requireUserId();
  try {
    const result = await createCustomer(userId, formObject(formData));
    if (!result.ok) return { error: result.error };
  } catch (err) {
    if (err instanceof TenantError) return { error: err.message };
    throw err;
  }
  revalidatePath("/customers");
  redirect("/customers");
}

export async function updateCustomerAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const userId = await requireUserId();
  const id = formData.get("id");
  if (typeof id !== "string" || !id) return { error: "Missing customer id" };
  try {
    const result = await updateCustomer(userId, id, formObject(formData));
    if (!result.ok) return { error: result.error };
  } catch (err) {
    if (err instanceof TenantError) return { error: err.message };
    throw err;
  }
  revalidatePath("/customers");
  redirect(`/customers/${id}`);
}

export async function deleteCustomerAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const id = formData.get("id");
  if (typeof id !== "string" || !id) return;
  try {
    const result = await deleteCustomer(userId, id);
    if (!result.ok) {
      // No error channel on a plain delete form — the list page shows
      // a generic notice via the query string instead.
      redirect("/customers?deleteError=" + encodeURIComponent(result.error));
    }
  } catch (err) {
    if (err instanceof TenantError) {
      redirect("/customers?deleteError=" + encodeURIComponent(err.message));
    }
    throw err;
  }
  revalidatePath("/customers");
  redirect("/customers");
}
