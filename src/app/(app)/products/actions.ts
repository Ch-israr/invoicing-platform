"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { TenantError } from "@/lib/tenant";
import {
  createCategory,
  createProduct,
  deleteCategory,
  deleteProduct,
  importProductsCsv,
  renameCategory,
  updateProduct,
} from "@/server/services/product.service";

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

/** Product form posts isActive as "true"/"false" — normalise to boolean. */
function productInput(formData: FormData): Record<string, unknown> {
  const obj = formObject(formData) as Record<string, unknown>;
  obj.isActive = formData.get("isActive") !== "false";
  return obj;
}

export async function createProductAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const userId = await requireUserId();
  try {
    const result = await createProduct(userId, productInput(formData));
    if (!result.ok) return { error: result.error };
  } catch (err) {
    if (err instanceof TenantError) return { error: err.message };
    throw err;
  }
  revalidatePath("/products");
  redirect("/products");
}

export async function updateProductAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const userId = await requireUserId();
  const id = formData.get("id");
  if (typeof id !== "string" || !id) return { error: "Missing product id" };
  try {
    const result = await updateProduct(userId, id, productInput(formData));
    if (!result.ok) return { error: result.error };
  } catch (err) {
    if (err instanceof TenantError) return { error: err.message };
    throw err;
  }
  revalidatePath("/products");
  redirect("/products");
}

export async function deleteProductAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const id = formData.get("id");
  if (typeof id !== "string" || !id) return;
  try {
    const result = await deleteProduct(userId, id);
    if (!result.ok) {
      redirect("/products?deleteError=" + encodeURIComponent(result.error));
    }
  } catch (err) {
    if (err instanceof TenantError) {
      redirect("/products?deleteError=" + encodeURIComponent(err.message));
    }
    throw err;
  }
  revalidatePath("/products");
  redirect("/products");
}

export async function createCategoryAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const userId = await requireUserId();
  try {
    const result = await createCategory(userId, formObject(formData));
    if (!result.ok) return { error: result.error };
  } catch (err) {
    if (err instanceof TenantError) return { error: err.message };
    throw err;
  }
  revalidatePath("/products/categories");
  revalidatePath("/products");
  return { ok: true };
}

export async function renameCategoryAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const userId = await requireUserId();
  const id = formData.get("id");
  if (typeof id !== "string" || !id) return { error: "Missing category id" };
  try {
    const result = await renameCategory(userId, id, formObject(formData));
    if (!result.ok) return { error: result.error };
  } catch (err) {
    if (err instanceof TenantError) return { error: err.message };
    throw err;
  }
  revalidatePath("/products/categories");
  return { ok: true };
}

export async function deleteCategoryAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const id = formData.get("id");
  if (typeof id !== "string" || !id) return;
  try {
    const result = await deleteCategory(userId, id);
    if (!result.ok) {
      redirect("/products/categories?deleteError=" + encodeURIComponent(result.error));
    }
  } catch (err) {
    if (err instanceof TenantError) {
      redirect("/products/categories?deleteError=" + encodeURIComponent(err.message));
    }
    throw err;
  }
  revalidatePath("/products/categories");
  redirect("/products/categories");
}

export type ImportState =
  | { error?: string; created?: number; importErrors?: { row: number; message: string }[] }
  | null;

export async function importProductsAction(
  _prev: ImportState,
  formData: FormData,
): Promise<ImportState> {
  const userId = await requireUserId();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a CSV file to import" };
  }
  if (file.size > 2 * 1024 * 1024) {
    return { error: "CSV file must be 2 MB or smaller" };
  }
  const text = await file.text();
  try {
    const result = await importProductsCsv(userId, text);
    if (!result.ok) return { error: result.error };
    revalidatePath("/products");
    return { created: result.data.created, importErrors: result.data.errors };
  } catch (err) {
    if (err instanceof TenantError) return { error: err.message };
    throw err;
  }
}
