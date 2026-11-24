import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  getDefaultBusinessForUser,
  requireCanWrite,
  TenantError,
} from "@/lib/tenant";
import { logActivity } from "@/lib/activity";
import { PAGE_SIZE, pageCount as calcPageCount } from "@/lib/pagination";
import { getInvoiceForUser } from "@/server/services/invoice.service";
import { getLatestInvoiceDocument } from "@/server/pdf/service";
import { pdfFileName } from "@/server/pdf/service";
import { readUpload } from "@/lib/storage";
import {
  configuredProviderName,
  getEmailProvider,
  type EmailMessage,
  type EmailProvider,
} from "./providers";
import { formatDateLong, renderInvoiceEmail } from "./templates";
import type { ServiceResult } from "@/server/services/invoice.service";

/**
 * Email queue (ARCHITECTURE.md §1.5).
 *
 * EmailLog rows are the queue: QUEUED → SENT / FAILED. Sending is
 * never done inside the invoice-issue request — the issue flow only
 * queues; the send action queues and then processes that row, and
 * `processEmailQueue` drains QUEUED rows for background/cron use.
 *
 * Retry: a failed attempt records the error and increments
 * `attempts`. After MAX_EMAIL_ATTEMPTS (3) the row stays FAILED and
 * is no longer retryable. Below that, `retryFailedEmails` re-queues
 * FAILED rows — with backoff (2^attempts minutes since the last
 * attempt) unless the user explicitly clicks Retry.
 *
 * The "log" provider is the default (EMAIL_PROVIDER=log): it prints
 * the rendered email and sends nothing. Real sending only happens
 * when EMAIL_PROVIDER=resend is configured.
 */

export const MAX_EMAIL_ATTEMPTS = 3;

/** Backoff before a failed row may be retried: 2^attempts minutes. */
export function retryDelayMs(attempts: number): number {
  return Math.pow(2, Math.max(0, attempts)) * 60_000;
}

/** True when a FAILED row is old enough to be retried (backoff elapsed). */
export function isRetryDue(updatedAt: Date, attempts: number, now = new Date()): boolean {
  return now.getTime() - updatedAt.getTime() >= retryDelayMs(attempts);
}

function senderAddress(settings: {
  emailFromName: string | null;
  emailFromAddress: string | null;
} | null, business: { name: string; email: string | null }): string {
  const address = settings?.emailFromAddress ?? business.email ?? "no-reply@localhost";
  const name = settings?.emailFromName ?? business.name;
  return name ? `"${name}" <${address}>` : address;
}

/**
 * Queue an email for an issued invoice, addressed to the customer's
 * stored email. The invoice must be issued (not a draft); the
 * customer's email is the only recipient — no address is ever
 * invented or taken from anywhere else.
 */
export async function queueInvoiceEmail(
  userId: string,
  invoiceId: string,
  opts?: { sendNow?: boolean; provider?: EmailProvider },
): Promise<ServiceResult<{ emailLogId: string }>> {
  const { business, invoice } = await getInvoiceForUser(userId, invoiceId);
  await requireCanWrite(userId, business.id);
  if (invoice.status === "DRAFT" || invoice.status === "CANCELLED") {
    return { ok: false, error: "Only an issued invoice can be sent by email" };
  }
  const to = invoice.customer.email;
  if (!to) {
    return { ok: false, error: "This customer has no email address — add one before sending" };
  }
  const rendered = renderInvoiceEmail({
    businessName: business.name,
    businessEmail: business.email,
    paymentInstructions: business.paymentInstructions,
    bankName: business.bankName,
    iban: business.iban,
    customerName: invoice.customer.companyName ?? invoice.customer.name,
    invoiceNumber: invoice.number,
    grandTotal: invoice.grandTotal.toString(),
    balance: invoice.balance.toString(),
    currency: invoice.currency,
    dueDateLabel: formatDateLong(invoice.dueDate),
  });
  const log = await prisma.emailLog.create({
    data: {
      businessId: business.id,
      relatedType: "Invoice",
      relatedId: invoice.id,
      to,
      subject: rendered.subject,
      provider: (opts?.provider?.name ?? configuredProviderName()) as string,
      status: "QUEUED",
    },
  });
  await logActivity(prisma, {
    businessId: business.id,
    userId,
    action: "email.queued",
    entityType: "EmailLog",
    entityId: log.id,
    metadata: { to, subject: rendered.subject, invoiceNumber: invoice.number },
  });
  if (opts?.sendNow) {
    const sent = await processEmailLog(log.id, opts.provider);
    if (!sent.ok) return { ok: false, error: sent.error };
  }
  return { ok: true, data: { emailLogId: log.id } };
}

/**
 * Attempt to send one queued EmailLog row. Returns the outcome and
 * persists SENT/FAILED + attempts on the row.
 */
export async function processEmailLog(
  emailLogId: string,
  provider?: EmailProvider,
): Promise<ServiceResult<{ status: "SENT" | "FAILED" }>> {
  const log = await prisma.emailLog.findUnique({ where: { id: emailLogId } });
  if (!log) return { ok: false, error: "Email not found" };
  if (log.status === "SENT") return { ok: true, data: { status: "SENT" } };
  if (log.status === "FAILED" && log.attempts >= MAX_EMAIL_ATTEMPTS) {
    return { ok: false, error: "This email has used all 3 attempts and can no longer be retried" };
  }

  const business = await prisma.business.findUnique({ where: { id: log.businessId } });
  if (!business) return { ok: false, error: "Business not found" };
  const settings = await prisma.businessSettings.findUnique({
    where: { businessId: business.id },
  });

  // Re-render from the current invoice so a re-send always uses the
  // frozen snapshot values (the subject/body are derived from the
  // stored invoice, and the PDF attachment comes from storage).
  let message: EmailMessage;
  try {
    // The recipient is the address recorded when the email was
    // queued — the audit trail (EmailLog.to) always matches what
    // was actually sent.
    message = await buildInvoiceEmailMessage(log.relatedType, log.relatedId, log.to, business, settings);
  } catch (err) {
    const error = err instanceof Error ? err.message : "Could not render the email";
    await markFailed(log.id, log.attempts, error);
    return { ok: false, error };
  }

  const sender = provider ?? getEmailProvider(log.provider as "log" | "resend" | "smtp");
  try {
    await sender.send(message);
  } catch (err) {
    const error = err instanceof Error ? err.message : "Sending failed";
    await markFailed(log.id, log.attempts, error);
    return { ok: false, error };
  }

  await prisma.$transaction(async (tx) => {
    await tx.emailLog.update({
      where: { id: log.id },
      data: { status: "SENT", sentAt: new Date(), attempts: { increment: 1 }, error: null },
    });
    // First successful send moves an issued invoice to SENT.
    if (log.relatedType === "Invoice") {
      const invoice = await tx.invoice.findUnique({
        where: { id: log.relatedId },
        select: { status: true },
      });
      if (invoice?.status === "ISSUED") {
        await tx.invoice.update({
          where: { id: log.relatedId },
          data: { status: "SENT" },
        });
      }
    }
    await logActivity(tx, {
      businessId: business.id,
      action: "email.sent",
      entityType: "EmailLog",
      entityId: log.id,
      metadata: { to: log.to, subject: log.subject, provider: sender.name },
    });
  });
  return { ok: true, data: { status: "SENT" } };
}

async function markFailed(emailLogId: string, attempts: number, error: string): Promise<void> {
  await prisma.emailLog.update({
    where: { id: emailLogId },
    data: {
      status: "FAILED",
      attempts: { increment: 1 },
      error: error.slice(0, 1000),
    },
  });
}

async function buildInvoiceEmailMessage(
  relatedType: string,
  relatedId: string,
  to: string,
  business: {
    id: string;
    name: string;
    email: string | null;
    paymentInstructions: string | null;
    bankName: string | null;
    iban: string | null;
  },
  settings: {
    emailFromName: string | null;
    emailFromAddress: string | null;
  } | null,
): Promise<EmailMessage> {
  if (relatedType !== "Invoice") {
    throw new Error(`No email template for ${relatedType}`);
  }
  const invoice = await prisma.invoice.findUnique({
    where: { id: relatedId },
    include: { customer: true },
  });
  if (!invoice) throw new Error("The related invoice no longer exists");
  const rendered = renderInvoiceEmail({
    businessName: business.name,
    businessEmail: business.email,
    paymentInstructions: business.paymentInstructions,
    bankName: business.bankName,
    iban: business.iban,
    customerName: invoice.customer.companyName ?? invoice.customer.name,
    invoiceNumber: invoice.number,
    grandTotal: invoice.grandTotal.toString(),
    balance: invoice.balance.toString(),
    currency: invoice.currency,
    dueDateLabel: formatDateLong(invoice.dueDate),
  });
  // Attach the stored invoice PDF when one exists. A missing file
  // never blocks the send — the email still goes out.
  let attachments: EmailMessage["attachments"];
  const document = await getLatestInvoiceDocument(invoice.id);
  if (document) {
    const file = await readUpload(document.storageKey);
    if (file) {
      attachments = [
        {
          fileName: pdfFileName(invoice.number),
          contentType: "application/pdf",
          content: file.buffer,
        },
      ];
    } else {
      console.warn(`[email] stored PDF ${document.storageKey} could not be read — sending without attachment`);
    }
  }
  return {
    to,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    from: senderAddress(settings, business),
    attachments,
  };
}

/** Drain QUEUED rows (oldest first). Used by the manual "process queue" action and by any future worker/cron. */
export async function processEmailQueue(opts?: {
  userId?: string;
  businessId?: string;
  limit?: number;
  provider?: EmailProvider;
}): Promise<{ sent: number; failed: number }> {
  let businessId = opts?.businessId;
  if (!businessId && opts?.userId) {
    const business = await getDefaultBusinessForUser(opts.userId);
    if (!business) return { sent: 0, failed: 0 };
    businessId = business.id;
  }
  const queued = await prisma.emailLog.findMany({
    where: { status: "QUEUED", ...(businessId ? { businessId } : {}) },
    orderBy: { createdAt: "asc" },
    take: Math.max(1, Math.min(opts?.limit ?? 10, 50)),
    select: { id: true },
  });
  let sent = 0;
  let failed = 0;
  for (const row of queued) {
    const result = await processEmailLog(row.id, opts?.provider);
    if (result.ok) sent += 1;
    else failed += 1;
  }
  return { sent, failed };
}

/**
 * Re-queue FAILED rows that still have attempts left. Backoff
 * (2^attempts minutes) applies unless `force` is set — the manual
 * Retry button passes force so the user is never told to wait.
 */
export async function retryFailedEmails(
  userId: string,
  opts?: { force?: boolean; provider?: EmailProvider },
): Promise<{ retried: number; skipped: number }> {
  const business = await getDefaultBusinessForUser(userId);
  if (!business) throw new TenantError(404, "Business not found");
  await requireCanWrite(userId, business.id);
  const failed = await prisma.emailLog.findMany({
    where: { businessId: business.id, status: "FAILED" },
    orderBy: { updatedAt: "asc" },
  });
  const now = new Date();
  let retried = 0;
  let skipped = 0;
  for (const row of failed) {
    if (row.attempts >= MAX_EMAIL_ATTEMPTS) {
      skipped += 1;
      continue;
    }
    if (!opts?.force && !isRetryDue(row.updatedAt, row.attempts, now)) {
      skipped += 1;
      continue;
    }
    await prisma.emailLog.update({
      where: { id: row.id },
      data: { status: "QUEUED", error: null },
    });
    retried += 1;
  }
  if (retried > 0) {
    await processEmailQueue({ businessId: business.id, provider: opts?.provider });
  }
  return { retried, skipped };
}

/** Re-queue and immediately re-send one FAILED row (manual Retry). */
export async function retryEmailLog(
  userId: string,
  emailLogId: string,
  provider?: EmailProvider,
): Promise<ServiceResult<{ status: "SENT" | "FAILED" }>> {
  const business = await getDefaultBusinessForUser(userId);
  if (!business) throw new TenantError(404, "Business not found");
  const log = await prisma.emailLog.findFirst({
    where: { id: emailLogId, businessId: business.id },
  });
  if (!log) throw new TenantError(404, "Email not found");
  await requireCanWrite(userId, business.id);
  if (log.status !== "FAILED") {
    return { ok: false, error: "Only a failed email can be retried" };
  }
  if (log.attempts >= MAX_EMAIL_ATTEMPTS) {
    return { ok: false, error: "This email has used all 3 attempts and can no longer be retried" };
  }
  await prisma.emailLog.update({
    where: { id: log.id },
    data: { status: "QUEUED", error: null },
  });
  // The retry itself is audited (processEmailLog logs email.sent on
  // success; a retry that fails again leaves its trace in EmailLog).
  await logActivity(prisma, {
    businessId: business.id,
    userId,
    action: "email.retried",
    entityType: "EmailLog",
    entityId: log.id,
    metadata: { to: log.to, subject: log.subject, attempt: log.attempts + 1 },
  });
  return processEmailLog(log.id, provider);
}

export type EmailFilters = {
  status?: "QUEUED" | "SENT" | "FAILED";
  q?: string;
  page?: number;
};

export async function listEmails(userId: string, filters: EmailFilters) {
  const business = await getDefaultBusinessForUser(userId);
  if (!business) return { emails: [], total: 0, page: 1, pageCount: 1 };
  const page = Math.max(1, filters.page ?? 1);
  const where: Prisma.EmailLogWhereInput = { businessId: business.id };
  if (filters.status) where.status = filters.status;
  if (filters.q) {
    const q = filters.q.trim();
    where.OR = [
      { to: { contains: q, mode: "insensitive" } },
      { subject: { contains: q, mode: "insensitive" } },
    ];
  }
  const [emails, total] = await Promise.all([
    prisma.emailLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.emailLog.count({ where }),
  ]);
  return { emails, total, page, pageCount: calcPageCount(total) };
}

/** Email history for one invoice (shown on its detail page). */
export async function getInvoiceEmailHistory(userId: string, invoiceId: string) {
  const { business, invoice } = await getInvoiceForUser(userId, invoiceId);
  const emails = await prisma.emailLog.findMany({
    where: { businessId: business.id, relatedType: "Invoice", relatedId: invoice.id },
    orderBy: { createdAt: "desc" },
  });
  return { business, invoice, emails };
}
