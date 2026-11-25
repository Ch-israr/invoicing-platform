import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  canManageBusiness,
  canWrite,
  getDefaultBusinessForUser,
  requireCanWrite,
  requireMembership,
  scopeWhere,
  TenantError,
} from "@/lib/tenant";
import { logActivity } from "@/lib/activity";
import { PAGE_SIZE, pageCount as calcPageCount } from "@/lib/pagination";
import {
  advanceNextRun,
  isoDate,
  makeRunKey,
  parseIsoDate,
} from "@/lib/recurring-dates";
import { draftNumber } from "@/lib/numbering";
import {
  assertCustomerBelongs,
  computeInvoice,
  invoiceCreateData,
  issueInvoice,
} from "@/server/services/invoice.service";
import { generateInvoicePdf } from "@/server/pdf/service";
import { queueInvoiceEmail } from "@/server/email/service";
import type { EmailProvider } from "@/server/email/providers";
import {
  recurringSchema,
  type RecurringInput,
} from "@/lib/validation/recurring";
import {
  firstValidationError,
  invoiceItemSchema,
  stripEmptyLineItems,
  type InvoiceInput,
} from "@/lib/validation/invoice";
import type { ServiceResult } from "./invoice.service";

/**
 * Recurring invoices (ARCHITECTURE.md §1.5).
 *
 * A schedule stores the frozen line definitions (templateItems) plus
 * customer, template/locale and terms. Each run creates a DRAFT
 * invoice from those lines with totals recomputed by the money
 * engine — stored totals are never trusted.
 *
 * Idempotency: one invoice per schedule per period. The run key is
 * `${scheduleId}:${YYYY-MM-DD of nextRunAt}` and is stored on the
 * schedule's `lastRunKey` (unique). A run claims its period with an
 * optimistic-lock update (`lastRunKey` must still be the value read)
 * inside the same transaction that creates the invoice; a concurrent
 * run either sees the key already set or loses the update and skips.
 * The unique constraint is the final backstop (P2002 → already ran).
 *
 * Dates are UTC calendar days; nextRunAt always advances from the
 * *scheduled* date (not from "now") so a late run never shifts the
 * cadence. A schedule whose next run falls after its endDate simply
 * never runs again (the UI derives "Ended" from endDate).
 *
 * No cron daemon in this phase: due schedules run from the "Run due
 * schedules" button (or a single schedule's "Run now"). Production
 * scheduling is a Phase 8 concern.
 */

export type RecurringFilters = {
  status?: "ACTIVE" | "PAUSED" | "CANCELLED";
  page?: number;
};

export async function listRecurring(userId: string, filters: RecurringFilters) {
  const business = await getDefaultBusinessForUser(userId);
  if (!business) return { schedules: [], total: 0, page: 1, pageCount: 1 };
  const page = Math.max(1, filters.page ?? 1);
  const where: Prisma.RecurringInvoiceWhereInput = { businessId: business.id };
  if (filters.status) where.status = filters.status;
  const [schedules, total] = await Promise.all([
    prisma.recurringInvoice.findMany({
      where,
      orderBy: [{ status: "asc" }, { nextRunAt: "asc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        customer: { select: { id: true, name: true, companyName: true } },
        _count: { select: { generated: true } },
      },
    }),
    prisma.recurringInvoice.count({ where }),
  ]);
  return { schedules, total, page, pageCount: calcPageCount(total) };
}

export async function getRecurringDetail(userId: string, scheduleId: string) {
  const business = await getDefaultBusinessForUser(userId);
  if (!business) throw new TenantError(404, "Business not found");
  const schedule = await prisma.recurringInvoice.findFirst({
    where: { id: scheduleId, ...scopeWhere(business.id) },
    include: {
      customer: true,
      generated: {
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true,
          number: true,
          status: true,
          grandTotal: true,
          issueDate: true,
        },
      },
    },
  });
  if (!schedule) throw new TenantError(404, "Schedule not found");
  const membership = await requireMembership(userId, business.id);
  return {
    business,
    schedule,
    canManage: canManageBusiness(membership.role),
    canWrite: canWrite(membership.role),
    ended:
      schedule.endDate !== null &&
      schedule.nextRunAt.getTime() > schedule.endDate.getTime(),
  };
}

export async function getRecurringFormData(userId: string) {
  const business = await getDefaultBusinessForUser(userId);
  if (!business) return null;
  const [settings, customers, products, taxRates] = await Promise.all([
    prisma.businessSettings.findUnique({ where: { businessId: business.id } }),
    prisma.customer.findMany({
      where: { ...scopeWhere(business.id), status: "ACTIVE" },
      orderBy: { name: "asc" },
      select: { id: true, name: true, companyName: true },
    }),
    prisma.product.findMany({
      where: { ...scopeWhere(business.id), isActive: true },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        sku: true,
        description: true,
        unit: true,
        price: true,
        taxRateId: true,
        taxCategory: true,
      },
    }),
    prisma.taxRate.findMany({ where: scopeWhere(business.id), orderBy: { code: "asc" } }),
  ]);
  return { business, settings, customers, products, taxRates };
}

export async function createRecurring(
  userId: string,
  rawInput: unknown,
): Promise<ServiceResult<{ id: string }>> {
  const parsed = recurringSchema.safeParse(stripEmptyLineItems(rawInput));
  if (!parsed.success) {
    return { ok: false, ...firstValidationError(parsed.error) };
  }
  const business = await getDefaultBusinessForUser(userId);
  if (!business) return { ok: false, error: "No business found" };
  await requireCanWrite(userId, business.id);
  const input: RecurringInput = parsed.data;
  const customerError = await assertCustomerBelongs(business.id, input.customerId);
  if (customerError) return { ok: false, error: customerError };
  const schedule = await prisma.$transaction(async (tx) => {
    const created = await tx.recurringInvoice.create({
      data: {
        businessId: business.id,
        customerId: input.customerId,
        frequency: input.frequency,
        intervalDays: input.intervalDays ?? null,
        startDate: parseIsoDate(input.startDate),
        endDate: input.endDate ? parseIsoDate(input.endDate) : null,
        nextRunAt: parseIsoDate(input.startDate),
        status: "ACTIVE",
        autoSend: input.autoSend,
        // The frozen template: line definitions plus the document
        // settings the generated invoice needs (template/locale/
        // terms). parseTemplateItems reads this shape back.
        templateItems: {
          items: input.items,
          template: input.template,
          locale: input.locale,
          notes: input.notes ?? null,
          terms: input.terms ?? null,
        } as unknown as Prisma.InputJsonValue,
      },
    });
    await logActivity(tx, {
      businessId: business.id,
      userId,
      action: "recurring.created",
      entityType: "RecurringInvoice",
      entityId: created.id,
      metadata: { frequency: input.frequency, nextRunAt: input.startDate },
    });
    return created;
  });
  return { ok: true, data: { id: schedule.id } };
}

async function setScheduleStatus(
  userId: string,
  scheduleId: string,
  status: "ACTIVE" | "PAUSED" | "CANCELLED",
  action: string,
): Promise<ServiceResult> {
  const business = await getDefaultBusinessForUser(userId);
  if (!business) return { ok: false, error: "No business found" };
  const membership = await requireMembership(userId, business.id);
  if (status === "CANCELLED" && !canManageBusiness(membership.role)) {
    throw new TenantError(403, "Only owners and admins can cancel a schedule");
  }
  if (!canWrite(membership.role)) {
    throw new TenantError(403, "Your role is read-only");
  }
  const schedule = await prisma.recurringInvoice.findFirst({
    where: { id: scheduleId, ...scopeWhere(business.id) },
  });
  if (!schedule) throw new TenantError(404, "Schedule not found");
  if (schedule.status === status) return { ok: true };
  if (schedule.status === "CANCELLED") {
    return { ok: false, error: "A cancelled schedule cannot be changed" };
  }
  await prisma.recurringInvoice.update({
    where: { id: schedule.id },
    data: { status },
  });
  await logActivity(prisma, {
    businessId: business.id,
    userId,
    action,
    entityType: "RecurringInvoice",
    entityId: schedule.id,
    metadata: { status },
  });
  return { ok: true };
}

export const pauseRecurring = (userId: string, id: string) =>
  setScheduleStatus(userId, id, "PAUSED", "recurring.paused");
export const resumeRecurring = (userId: string, id: string) =>
  setScheduleStatus(userId, id, "ACTIVE", "recurring.resumed");
export const cancelRecurring = (userId: string, id: string) =>
  setScheduleStatus(userId, id, "CANCELLED", "recurring.cancelled");

// ---------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------

export type RunRecurringResult = {
  created: string[];
  issued: string[];
  emailed: string[];
  skipped: { scheduleId: string; reason: string }[];
};

type ParsedTemplateItems = {
  items: RecurringInput["items"];
  template: "classic" | "modern" | "minimal";
  locale: "en" | "ar";
  notes?: string;
  terms?: string;
};

/**
 * Parse the frozen template items. The stored JSON is validated
 * against the same item schema the invoice builder uses — a
 * hand-edited or stale payload fails loudly instead of creating a
 * wrong invoice.
 */
export function parseTemplateItems(raw: unknown): ParsedTemplateItems {
  const parsed = invoiceItemSchema.array().min(1).safeParse(
    (raw as { items?: unknown })?.items ?? raw,
  );
  if (!parsed.success) {
    throw new Error("Stored recurring template lines are invalid");
  }
  const stored = raw as {
    template?: unknown;
    locale?: unknown;
    notes?: unknown;
    terms?: unknown;
  };
  return {
    items: parsed.data,
    template:
      stored.template === "modern" || stored.template === "minimal"
        ? stored.template
        : "classic",
    locale: stored.locale === "ar" ? "ar" : "en",
    notes: typeof stored.notes === "string" ? stored.notes : undefined,
    terms: typeof stored.terms === "string" ? stored.terms : undefined,
  };
}

export async function runRecurring(opts: {
  userId: string;
  /** Run one schedule only (its next period, even if not yet due). */
  scheduleId?: string;
  now?: Date;
  provider?: EmailProvider;
}): Promise<RunRecurringResult> {
  const now = opts.now ?? new Date();
  const business = await getDefaultBusinessForUser(opts.userId);
  if (!business) throw new TenantError(404, "Business not found");
  await requireCanWrite(opts.userId, business.id);

  const where: Prisma.RecurringInvoiceWhereInput = {
    businessId: business.id,
    status: "ACTIVE",
  };
  if (opts.scheduleId) {
    where.id = opts.scheduleId;
  } else {
    where.nextRunAt = { lte: now };
  }
  const schedules = await prisma.recurringInvoice.findMany({
    where,
    orderBy: { nextRunAt: "asc" },
  });

  const result: RunRecurringResult = { created: [], issued: [], emailed: [], skipped: [] };

  for (const schedule of schedules) {
    // A schedule that has passed its end date never runs again.
    if (schedule.endDate && schedule.nextRunAt.getTime() > schedule.endDate.getTime()) {
      result.skipped.push({ scheduleId: schedule.id, reason: "past end date" });
      continue;
    }
    const runKey = makeRunKey(schedule.id, schedule.nextRunAt);
    const runDate = isoDate(schedule.nextRunAt);
    const dueDate = isoDate(
      new Date(schedule.nextRunAt.getTime() + 30 * 86_400_000),
    );

    let createdId: string | null = null;
    try {
      createdId = await prisma.$transaction(async (tx) => {
        const fresh = await tx.recurringInvoice.findUnique({
          where: { id: schedule.id },
        });
        if (!fresh || fresh.status !== "ACTIVE") return null;
        if (fresh.lastRunKey === runKey) return null; // already ran
        if (fresh.nextRunAt.getTime() !== schedule.nextRunAt.getTime()) return null; // moved on

        // Claim this period: only proceed if lastRunKey is still the
        // value we read. A concurrent run either loses this update
        // (count 0 → skip) or hits the unique constraint (P2002).
        const claimed = await tx.recurringInvoice.updateMany({
          where: { id: schedule.id, lastRunKey: fresh.lastRunKey },
          data: {
            lastRunKey: runKey,
            lastRunAt: now,
            nextRunAt: advanceNextRun(fresh.nextRunAt, fresh.frequency, fresh.intervalDays),
          },
        });
        if (claimed.count === 0) return null;

        const parsed = parseTemplateItems(fresh.templateItems);
        const taxRates = await tx.taxRate.findMany({
          where: scopeWhere(business.id),
        });
        const input: InvoiceInput = {
          customerId: fresh.customerId,
          issueDate: runDate,
          dueDate,
          supplyDate: undefined,
          notes: parsed.notes,
          terms: parsed.terms,
          template: parsed.template,
          locale: parsed.locale,
          // Recurring templates never carry an invoice-level or
          // early-payment discount — generated invoices start with none.
          invoiceDiscountType: "NONE",
          invoiceDiscountValue: "0",
          earlyDiscountType: "NONE",
          earlyDiscountValue: "0",
          earlyDiscountDays: "0",
          items: parsed.items,
        };
        const computed = computeInvoice(input, taxRates, business.defaultVatRateId);
        if (typeof computed === "string") {
          throw new Error(`Recurring lines no longer compute: ${computed}`);
        }
        const id = randomUUID();
        const created = await tx.invoice.create({
          data: {
            ...invoiceCreateData(id, business, input, computed, draftNumber(id)),
            recurringInvoice: { connect: { id: schedule.id } },
          },
        });
        await logActivity(tx, {
          businessId: business.id,
          userId: opts.userId,
          action: "recurring.ran",
          entityType: "Invoice",
          entityId: created.id,
          metadata: { scheduleId: schedule.id, runKey, issueDate: runDate },
        });
        return created.id;
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        result.skipped.push({ scheduleId: schedule.id, reason: "already ran (duplicate run key)" });
        continue;
      }
      throw err;
    }
    if (!createdId) {
      result.skipped.push({ scheduleId: schedule.id, reason: "already ran or no longer active" });
      continue;
    }
    result.created.push(createdId);

    if (schedule.autoSend) {
      const issued = await issueInvoice(opts.userId, createdId);
      if (!issued.ok) {
        result.skipped.push({ scheduleId: schedule.id, reason: `created but could not issue: ${issued.error}` });
        continue;
      }
      result.issued.push(createdId);
      // Stored PDF, best-effort — a PDF failure never un-issues.
      try {
        const pdf = await generateInvoicePdf(opts.userId, createdId);
        if (!pdf.ok) console.error(`PDF generation failed for recurring invoice ${createdId}: ${pdf.error}`);
      } catch (err) {
        console.error(`PDF generation failed for recurring invoice ${createdId}:`, err);
      }
      const emailed = await queueInvoiceEmail(opts.userId, createdId, {
        sendNow: true,
        provider: opts.provider,
      });
      if (emailed.ok) result.emailed.push(createdId);
      else {
        result.skipped.push({ scheduleId: schedule.id, reason: `issued but email failed: ${emailed.error}` });
      }
    }
  }
  return result;
}

/** Run every due schedule for the user's business. */
export async function runDueSchedules(opts: {
  userId: string;
  now?: Date;
  provider?: EmailProvider;
}): Promise<RunRecurringResult> {
  return runRecurring({ userId: opts.userId, now: opts.now, provider: opts.provider });
}
