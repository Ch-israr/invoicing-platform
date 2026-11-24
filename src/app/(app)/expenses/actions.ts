"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { getDefaultBusinessForUser, TenantError } from "@/lib/tenant";
import { deleteFile, saveFile, validateReceiptFile } from "@/lib/storage";
import {
  createExpense,
  createExpenseCategory,
  deleteExpense,
  deleteExpenseCategory,
  getExpenseDetail,
  updateExpense,
} from "@/server/services/expense.service";
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

/** Save an uploaded receipt (if any) and return its URL. */
async function saveReceipt(
  userId: string,
  formData: FormData,
): Promise<{ url?: string; error?: string }> {
  const file = formData.get("receipt");
  if (!(file instanceof File) || file.size === 0) return {};
  const problem = validateReceiptFile(file);
  if (problem) return { error: problem };
  const business = await getDefaultBusinessForUser(userId);
  if (!business) return { error: "No business found" };
  const saved = await saveFile(
    business.id,
    "receipt",
    file.name,
    Buffer.from(await file.arrayBuffer()),
  );
  return { url: saved.url };
}

function keyFromUrl(url: string | null): string | null {
  if (!url) return null;
  const prefix = "/api/uploads/";
  if (!url.startsWith(prefix)) return null;
  return url.slice(prefix.length);
}

export async function createExpenseAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const userId = await requireUserId();
  const receipt = await saveReceipt(userId, formData);
  if (receipt.error) return { error: receipt.error };
  try {
    const result = await createExpense(userId, formObject(formData), receipt.url ?? null);
    if (!result.ok) return { error: result.error };
    revalidatePath("/expenses");
    redirect(`/expenses/${result.data.id}`);
  } catch (err) {
    if (err instanceof TenantError) return { error: err.message };
    throw err;
  }
}

export async function updateExpenseAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const userId = await requireUserId();
  const id = formData.get("id");
  if (typeof id !== "string" || !id) return { error: "Missing expense id" };
  const receipt = await saveReceipt(userId, formData);
  if (receipt.error) return { error: receipt.error };
  try {
    const before = await getExpenseDetail(userId, id);
    const result = await updateExpense(userId, id, formObject(formData), receipt.url);
    if (!result.ok) return { error: result.error };
    // A new receipt replaces the old file — delete the old one.
    if (receipt.url) {
      const oldKey = keyFromUrl(before.expense.receiptUrl);
      if (oldKey) await deleteFile(oldKey);
    }
    revalidatePath("/expenses");
    redirect(`/expenses/${id}`);
  } catch (err) {
    if (err instanceof TenantError) return { error: err.message };
    throw err;
  }
}

export async function deleteExpenseAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const id = formData.get("id");
  if (typeof id !== "string" || !id) return;
  try {
    const result = await deleteExpense(userId, id);
    if (!result.ok) {
      redirect("/expenses?deleteError=" + encodeURIComponent(result.error));
    }
  } catch (err) {
    if (err instanceof TenantError) {
      redirect("/expenses?deleteError=" + encodeURIComponent(err.message));
    }
    throw err;
  }
  revalidatePath("/expenses");
  redirect("/expenses");
}

export async function createExpenseCategoryAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const userId = await requireUserId();
  try {
    const result = await createExpenseCategory(userId, formObject(formData));
    if (!result.ok) return { error: result.error };
  } catch (err) {
    if (err instanceof TenantError) return { error: err.message };
    throw err;
  }
  revalidatePath("/expenses/categories");
  redirect("/expenses/categories");
}

export async function deleteExpenseCategoryAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const id = formData.get("id");
  if (typeof id !== "string" || !id) return;
  try {
    const result = await deleteExpenseCategory(userId, id);
    if (!result.ok) {
      redirect("/expenses/categories?deleteError=" + encodeURIComponent(result.error));
    }
  } catch (err) {
    if (err instanceof TenantError) {
      redirect("/expenses/categories?deleteError=" + encodeURIComponent(err.message));
    }
    throw err;
  }
  revalidatePath("/expenses/categories");
  redirect("/expenses/categories");
}
