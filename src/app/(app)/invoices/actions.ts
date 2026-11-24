"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { TenantError } from "@/lib/tenant";
import {
  createInvoice,
  deleteInvoice,
  issueInvoice,
  updateInvoice,
  voidInvoice,
} from "@/server/services/invoice.service";
import {
  deletePayment,
  recordPayment,
  recordRefund,
} from "@/server/services/payment.service";
import { createCreditNote } from "@/server/services/credit-note.service";
import {
  generateInvoicePdf,
  regenerateInvoicePdf,
} from "@/server/pdf/service";
import { queueInvoiceEmail } from "@/server/email/service";

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

/** Line items arrive as a JSON string in a hidden field (the builder
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

export async function createInvoiceAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const userId = await requireUserId();
  const raw = formObject(formData);
  const items = parseItems(formData);
  if (items === "__invalid__") return { error: "Line items could not be read" };
  try {
    const result = await createInvoice(userId, { ...raw, items });
    if (!result.ok) return { error: result.error };
    revalidatePath("/invoices");
    redirect(`/invoices/${result.data.id}`);
  } catch (err) {
    if (err instanceof TenantError) return { error: err.message };
    throw err;
  }
}

export async function updateInvoiceAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const userId = await requireUserId();
  const id = formData.get("id");
  if (typeof id !== "string" || !id) return { error: "Missing invoice id" };
  const raw = formObject(formData);
  const items = parseItems(formData);
  if (items === "__invalid__") return { error: "Line items could not be read" };
  try {
    const result = await updateInvoice(userId, id, { ...raw, items });
    if (!result.ok) return { error: result.error };
  } catch (err) {
    if (err instanceof TenantError) return { error: err.message };
    throw err;
  }
  revalidatePath("/invoices");
  redirect(`/invoices/${id}`);
}

export async function issueInvoiceAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const id = formData.get("id");
  if (typeof id !== "string" || !id) return;
  try {
    const result = await issueInvoice(userId, id);
    if (!result.ok) {
      redirect(`/invoices/${id}?actionError=` + encodeURIComponent(result.error));
    }
  } catch (err) {
    if (err instanceof TenantError) {
      redirect(`/invoices/${id}?actionError=` + encodeURIComponent(err.message));
    }
    throw err;
  }
  // The issue itself already succeeded: generate the stored PDF
  // best-effort. A PDF failure must not un-issue the invoice — the
  // download route generates on demand if no stored PDF exists yet.
  try {
    const pdf = await generateInvoicePdf(userId, id);
    if (!pdf.ok) console.error(`PDF generation failed for invoice ${id}: ${pdf.error}`);
  } catch (err) {
    console.error(`PDF generation failed for invoice ${id}:`, err);
  }
  revalidatePath("/invoices");
  redirect(`/invoices/${id}`);
}

/** Re-render the stored PDF from the frozen snapshot (OWNER/ADMIN). */
export async function regeneratePdfAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const id = formData.get("id");
  if (typeof id !== "string" || !id) return;
  try {
    const result = await regenerateInvoicePdf(userId, id);
    if (!result.ok) {
      redirect(`/invoices/${id}?actionError=` + encodeURIComponent(result.error));
    }
  } catch (err) {
    if (err instanceof TenantError) {
      redirect(`/invoices/${id}?actionError=` + encodeURIComponent(err.message));
    }
    throw err;
  }
  revalidatePath("/invoices");
  redirect(`/invoices/${id}`);
}

/**
 * Send an issued invoice by email to the customer's stored address.
 * Queues the email and sends it right away (through the queue, so a
 * retry and the history both work); the invoice moves to SENT on the
 * first successful send. Never sent synchronously inside issue.
 */
export async function sendInvoiceEmailAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const id = formData.get("id");
  if (typeof id !== "string" || !id) return;
  try {
    const result = await queueInvoiceEmail(userId, id, { sendNow: true });
    if (!result.ok) {
      redirect(`/invoices/${id}?actionError=` + encodeURIComponent(result.error));
    }
  } catch (err) {
    if (err instanceof TenantError) {
      redirect(`/invoices/${id}?actionError=` + encodeURIComponent(err.message));
    }
    throw err;
  }
  revalidatePath(`/invoices/${id}`);
  revalidatePath("/emails");
  redirect(`/invoices/${id}?emailSent=1`);
}

export async function voidInvoiceAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const id = formData.get("id");
  if (typeof id !== "string" || !id) return;
  try {
    const result = await voidInvoice(userId, id);
    if (!result.ok) {
      redirect(`/invoices/${id}?actionError=` + encodeURIComponent(result.error));
    }
  } catch (err) {
    if (err instanceof TenantError) {
      redirect(`/invoices/${id}?actionError=` + encodeURIComponent(err.message));
    }
    throw err;
  }
  revalidatePath("/invoices");
  redirect(`/invoices/${id}`);
}

export async function deleteInvoiceAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const id = formData.get("id");
  if (typeof id !== "string" || !id) return;
  try {
    const result = await deleteInvoice(userId, id);
    if (!result.ok) {
      redirect("/invoices?deleteError=" + encodeURIComponent(result.error));
    }
  } catch (err) {
    if (err instanceof TenantError) {
      redirect("/invoices?deleteError=" + encodeURIComponent(err.message));
    }
    throw err;
  }
  revalidatePath("/invoices");
  redirect("/invoices");
}

// ---------------------------------------------------------------------------
// Payments & refunds (recorded on the invoice detail page)
// ---------------------------------------------------------------------------

export async function recordPaymentAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const userId = await requireUserId();
  const id = formData.get("id");
  if (typeof id !== "string" || !id) return { error: "Missing invoice id" };
  try {
    const result = await recordPayment(userId, id, formObject(formData));
    if (!result.ok) return { error: result.error };
  } catch (err) {
    if (err instanceof TenantError) return { error: err.message };
    throw err;
  }
  revalidatePath(`/invoices/${id}`);
  redirect(`/invoices/${id}`);
}

export async function deletePaymentAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const paymentId = formData.get("paymentId");
  const invoiceId = formData.get("id");
  if (typeof paymentId !== "string" || !paymentId) return;
  if (typeof invoiceId !== "string" || !invoiceId) return;
  try {
    const result = await deletePayment(userId, paymentId);
    if (!result.ok) {
      redirect(`/invoices/${invoiceId}?actionError=` + encodeURIComponent(result.error));
    }
  } catch (err) {
    if (err instanceof TenantError) {
      redirect(`/invoices/${invoiceId}?actionError=` + encodeURIComponent(err.message));
    }
    throw err;
  }
  revalidatePath(`/invoices/${invoiceId}`);
  redirect(`/invoices/${invoiceId}`);
}

export async function recordRefundAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const userId = await requireUserId();
  const paymentId = formData.get("paymentId");
  const invoiceId = formData.get("id");
  if (typeof paymentId !== "string" || !paymentId) return { error: "Missing payment id" };
  if (typeof invoiceId !== "string" || !invoiceId) return { error: "Missing invoice id" };
  try {
    const result = await recordRefund(userId, paymentId, formObject(formData));
    if (!result.ok) return { error: result.error };
  } catch (err) {
    if (err instanceof TenantError) return { error: err.message };
    throw err;
  }
  revalidatePath(`/invoices/${invoiceId}`);
  redirect(`/invoices/${invoiceId}`);
}

// ---------------------------------------------------------------------------
// Credit notes
// ---------------------------------------------------------------------------

function parseCreditItems(formData: FormData): unknown {
  const raw = formData.get("items");
  if (typeof raw !== "string") return [];
  try {
    return JSON.parse(raw);
  } catch {
    return "__invalid__";
  }
}

export async function createCreditNoteAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const userId = await requireUserId();
  const invoiceId = formData.get("id");
  if (typeof invoiceId !== "string" || !invoiceId) return { error: "Missing invoice id" };
  const items = parseCreditItems(formData);
  if (items === "__invalid__") return { error: "Credit lines could not be read" };
  const raw = formObject(formData);
  try {
    const result = await createCreditNote(userId, invoiceId, { ...raw, items });
    if (!result.ok) return { error: result.error };
    revalidatePath(`/invoices/${invoiceId}`);
    revalidatePath("/credit-notes");
    redirect(`/credit-notes/${result.data.id}`);
  } catch (err) {
    if (err instanceof TenantError) return { error: err.message };
    throw err;
  }
}
