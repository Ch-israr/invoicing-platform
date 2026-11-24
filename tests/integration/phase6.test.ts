import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { TenantError } from "@/lib/tenant";
import { registerUserAccount } from "@/server/services/auth.service";
import { createCustomer } from "@/server/services/customer.service";
import {
  createInvoice,
  getInvoiceForUser,
  issueInvoice,
} from "@/server/services/invoice.service";
import {
  getInvoiceEmailHistory,
  listEmails,
  processEmailLog,
  processEmailQueue,
  queueInvoiceEmail,
  retryEmailLog,
  retryFailedEmails,
} from "@/server/email/service";
import type { EmailMessage, EmailProvider } from "@/server/email/providers";
import { generateInvoicePdf } from "@/server/pdf/service";
import {
  DEFAULT_EXPENSE_CATEGORIES,
  createExpense,
  createExpenseCategory,
  deleteExpense,
  deleteExpenseCategory,
  listExpenseCategories,
  listExpenses,
  updateExpense,
} from "@/server/services/expense.service";
import {
  cancelRecurring,
  createRecurring,
  getRecurringDetail,
  pauseRecurring,
  resumeRecurring,
  runDueSchedules,
  runRecurring,
} from "@/server/services/recurring.service";

const uid = () => Math.random().toString(36).slice(2, 10);

async function makeAccount() {
  const result = await registerUserAccount({
    name: "Phase 6 Test",
    businessName: `Phase 6 ${uid()} LLC`,
    email: `p6-${uid()}@example.com`,
    password: "TestPass1234",
  });
  if (!result.ok) throw new Error(`setup failed: ${result.error}`);
  return result as unknown as { userId: string; businessId: string };
}

async function makeMember(businessId: string, role: "MEMBER" | "ADMIN" | "VIEWER" = "MEMBER") {
  const user = await prisma.user.create({
    data: {
      name: `${role} User`,
      email: `${role.toLowerCase()}-${uid()}@example.com`,
      passwordHash: "not-a-real-hash",
    },
  });
  await prisma.businessMembership.create({
    data: { userId: user.id, businessId, role },
  });
  return user.id;
}

async function makeCustomer(userId: string, email = "billing@acme.example") {
  const created = await createCustomer(userId, {
    type: "COMPANY",
    name: "Acme Corp",
    companyName: "Acme Corp",
    email,
    country: "AE",
    status: "ACTIVE",
  });
  if (!created.ok) throw new Error(`customer setup failed: ${created.error}`);
  return created.data.id;
}

async function stdRate(businessId: string) {
  const rate = await prisma.taxRate.findFirst({ where: { businessId, code: "STD_5" } });
  if (!rate) throw new Error("STD_5 rate missing");
  return rate;
}

/** One line: 2 × 100.00, STD 5% → net 200, VAT 10, total 210. */
function oneLine(customerId: string, stdId: string) {
  return {
    customerId,
    issueDate: "2026-11-24",
    dueDate: "2026-12-24",
    template: "classic" as const,
    locale: "en" as const,
    items: [
      {
        description: "Consulting",
        quantity: "2",
        unit: "hour",
        unitPrice: "100",
        discountType: "NONE" as const,
        discountValue: "0",
        taxRateId: stdId,
        taxCategory: "STANDARD" as const,
        taxInclusive: false,
      },
    ],
  };
}

async function makeIssuedInvoice(userId: string, businessId: string) {
  const customerId = await makeCustomer(userId);
  const std = await stdRate(businessId);
  const created = await createInvoice(userId, oneLine(customerId, std.id));
  if (!created.ok) throw new Error(`create failed: ${created.error}`);
  const issued = await issueInvoice(userId, created.data.id);
  if (!issued.ok) throw new Error(`issue failed: ${issued.error}`);
  const { invoice } = await getInvoiceForUser(userId, created.data.id);
  return { invoice, customerId };
}

function recurringInput(customerId: string, stdId: string, overrides: Record<string, unknown> = {}) {
  return {
    customerId,
    frequency: "MONTHLY" as const,
    startDate: "2026-11-01",
    autoSend: false,
    template: "classic" as const,
    locale: "en" as const,
    items: oneLine(customerId, stdId).items,
    ...overrides,
  };
}

/** A provider that fails the first N sends, then succeeds. */
function flakyProvider(failures: number): EmailProvider & { sent: EmailMessage[] } {
  const sent: EmailMessage[] = [];
  let calls = 0;
  return {
    name: "flaky",
    sent,
    async send(message: EmailMessage): Promise<void> {
      calls += 1;
      if (calls <= failures) throw new Error(`simulated provider failure #${calls}`);
      sent.push(message);
    },
  };
}

/** A provider that captures every message it is asked to send. */
function capturingProvider(): EmailProvider & { sent: EmailMessage[] } {
  const sent: EmailMessage[] = [];
  return {
    name: "capture",
    sent,
    async send(message: EmailMessage): Promise<void> {
      sent.push(message);
    },
  };
}

// ---------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------

describe("email queue", () => {
  it("queues and sends an issued invoice, moving it to SENT", async () => {
    const { userId, businessId } = await makeAccount();
    const { invoice } = await makeIssuedInvoice(userId, businessId);

    const queued = await queueInvoiceEmail(userId, invoice.id, { sendNow: true });
    expect(queued.ok).toBe(true);
    if (!queued.ok) throw new Error("queue failed");

    const log = await prisma.emailLog.findUniqueOrThrow({ where: { id: queued.data.emailLogId } });
    expect(log.status).toBe("SENT");
    expect(log.sentAt).not.toBeNull();
    expect(log.attempts).toBe(1);
    expect(log.to).toBe("billing@acme.example");
    expect(log.subject).toContain(invoice.number);

    const after = await getInvoiceForUser(userId, invoice.id);
    expect(after.invoice.status).toBe("SENT");
  });

  it("queue without sendNow stays QUEUED until the queue is processed", async () => {
    const { userId, businessId } = await makeAccount();
    const { invoice } = await makeIssuedInvoice(userId, businessId);

    const queued = await queueInvoiceEmail(userId, invoice.id);
    expect(queued.ok).toBe(true);
    let log = await prisma.emailLog.findFirstOrThrow({ where: { relatedId: invoice.id } });
    expect(log.status).toBe("QUEUED");

    const result = await processEmailQueue({ businessId });
    expect(result).toEqual({ sent: 1, failed: 0 });
    log = await prisma.emailLog.findFirstOrThrow({ where: { relatedId: invoice.id } });
    expect(log.status).toBe("SENT");
  });

  it("a failing provider records FAILED, and a retry succeeds", async () => {
    const { userId, businessId } = await makeAccount();
    const { invoice } = await makeIssuedInvoice(userId, businessId);
    const flaky = flakyProvider(1);

    const queued = await queueInvoiceEmail(userId, invoice.id, {
      sendNow: true,
      provider: flaky,
    });
    expect(queued.ok).toBe(false);
    if (queued.ok) throw new Error("expected failure");
    expect(queued.error).toContain("simulated provider failure #1");

    const log = await prisma.emailLog.findFirstOrThrow({ where: { relatedId: invoice.id } });
    expect(log.status).toBe("FAILED");
    expect(log.attempts).toBe(1);
    expect(log.error).toContain("simulated provider failure #1");

    // The invoice is still ISSUED — a failed send never marks it sent.
    const stillIssued = await getInvoiceForUser(userId, invoice.id);
    expect(stillIssued.invoice.status).toBe("ISSUED");

    // Retry with a working provider succeeds (manual retry skips backoff).
    const retried = await retryEmailLog(userId, log.id, flaky);
    expect(retried.ok).toBe(true);
    const after = await prisma.emailLog.findUniqueOrThrow({ where: { id: log.id } });
    expect(after.status).toBe("SENT");
    expect(after.attempts).toBe(2);
  });

  it("after 3 failed attempts the email is no longer retryable", async () => {
    const { userId, businessId } = await makeAccount();
    const { invoice } = await makeIssuedInvoice(userId, businessId);
    const alwaysFailing = flakyProvider(99);

    const queued = await queueInvoiceEmail(userId, invoice.id);
    expect(queued.ok).toBe(true);
    if (!queued.ok) throw new Error("queue failed");
    const logId = queued.data.emailLogId;

    for (let i = 0; i < 3; i++) {
      const result = await processEmailLog(logId, alwaysFailing);
      expect(result.ok).toBe(false);
    }
    const log = await prisma.emailLog.findUniqueOrThrow({ where: { id: logId } });
    expect(log.status).toBe("FAILED");
    expect(log.attempts).toBe(3);

    const retry = await retryEmailLog(userId, logId, alwaysFailing);
    expect(retry.ok).toBe(false);
    if (retry.ok) throw new Error("retry should fail");
    expect(retry.error).toContain("all 3 attempts");

    const bulk = await retryFailedEmails(userId, { force: true });
    expect(bulk.retried).toBe(0);
    expect(bulk.skipped).toBe(1);
  });

  it("retry-all respects the backoff unless forced", async () => {
    const { userId: u2, businessId: b2 } = await makeAccount();
    const { invoice } = await makeIssuedInvoice(u2, b2);
    const alwaysFailing = flakyProvider(99);

    const queued = await queueInvoiceEmail(u2, invoice.id);
    if (!queued.ok) throw new Error("queue failed");
    await processEmailLog(queued.data.emailLogId, alwaysFailing);

    // Fresh failure (1 attempt, 2-minute backoff) is skipped without force…
    const unforced = await retryFailedEmails(u2);
    expect(unforced).toEqual({ retried: 0, skipped: 1 });
    // …and re-queued with force.
    const forced = await retryFailedEmails(u2, { force: true });
    expect(forced.retried).toBe(1);
    expect(forced.skipped).toBe(0);
  });

  it("refuses to send a draft and an invoice whose customer has no email", async () => {
    const { userId, businessId } = await makeAccount();
    const customerId = await makeCustomer(userId);
    const std = await stdRate(businessId);
    const draft = await createInvoice(userId, oneLine(customerId, std.id));
    if (!draft.ok) throw new Error("create failed");
    const draftSend = await queueInvoiceEmail(userId, draft.data.id);
    expect(draftSend.ok).toBe(false);
    if (draftSend.ok) throw new Error("draft send should fail");
    expect(draftSend.error).toContain("issued invoice");

    // Customer without an email address.
    const noEmail = await prisma.customer.create({
      data: {
        businessId,
        type: "INDIVIDUAL",
        name: "No Mail",
        email: null,
        country: "AE",
        status: "ACTIVE",
      },
    });
    const created = await createInvoice(userId, oneLine(noEmail.id, std.id));
    if (!created.ok) throw new Error("create failed");
    const issued = await issueInvoice(userId, created.data.id);
    if (!issued.ok) throw new Error(`issue failed: ${issued.error}`);
    const noEmailSend = await queueInvoiceEmail(userId, created.data.id);
    expect(noEmailSend.ok).toBe(false);
    if (noEmailSend.ok) throw new Error("no-email send should fail");
    expect(noEmailSend.error).toContain("no email address");
  });

  it("attaches the stored invoice PDF to the email", async () => {
    const { userId, businessId } = await makeAccount();
    const { invoice } = await makeIssuedInvoice(userId, businessId);
    const generated = await generateInvoicePdf(userId, invoice.id);
    expect(generated.ok).toBe(true);

    const capture = capturingProvider();
    const queued = await queueInvoiceEmail(userId, invoice.id, {
      sendNow: true,
      provider: capture,
    });
    expect(queued.ok).toBe(true);
    expect(capture.sent).toHaveLength(1);
    const attachment = capture.sent[0]?.attachments?.[0];
    expect(attachment?.fileName).toBe(`${invoice.number}.pdf`);
    expect(attachment?.contentType).toBe("application/pdf");
    expect(attachment?.content.length).toBeGreaterThan(1000);
  });

  it("email history and listing are scoped to the business", async () => {
    const { userId, businessId } = await makeAccount();
    const { invoice } = await makeIssuedInvoice(userId, businessId);
    await queueInvoiceEmail(userId, invoice.id, { sendNow: true });

    const history = await getInvoiceEmailHistory(userId, invoice.id);
    expect(history.emails).toHaveLength(1);
    expect(history.emails[0]?.status).toBe("SENT");

    const listed = await listEmails(userId, {});
    expect(listed.emails.some((e) => e.relatedId === invoice.id)).toBe(true);
    const filtered = await listEmails(userId, { status: "FAILED" });
    expect(filtered.emails.some((e) => e.relatedId === invoice.id)).toBe(false);

    // Another business cannot see or send this invoice's email.
    const other = await makeAccount();
    await expect(queueInvoiceEmail(other.userId, invoice.id)).rejects.toBeInstanceOf(TenantError);
    const otherList = await listEmails(other.userId, {});
    expect(otherList.emails.some((e) => e.relatedId === invoice.id)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------

describe("expenses", () => {
  it("seeds the default categories once, on first use", async () => {
    const { userId, businessId } = await makeAccount();
    const first = await listExpenseCategories(userId);
    expect(first.map((c) => c.name).sort()).toEqual([...DEFAULT_EXPENSE_CATEGORIES].sort());
    const second = await listExpenseCategories(userId);
    expect(second).toHaveLength(DEFAULT_EXPENSE_CATEGORIES.length);
    expect(
      await prisma.expenseCategory.count({ where: { businessId } }),
    ).toBe(DEFAULT_EXPENSE_CATEGORIES.length);
  });

  it("creates, filters and totals expenses", async () => {
    const { userId } = await makeAccount();
    const categories = await listExpenseCategories(userId);
    const office = categories.find((c) => c.name === "Office");
    const travel = categories.find((c) => c.name === "Travel");
    if (!office || !travel) throw new Error("seeded categories missing");

    const a = await createExpense(userId, {
      title: "Office rent",
      date: "2026-11-01",
      amount: "1000",
      vatAmount: "50",
      categoryId: office.id,
      vendor: "Landlord LLC",
      method: "BANK_TRANSFER",
    });
    expect(a.ok).toBe(true);
    const b = await createExpense(userId, {
      title: "Taxi to client",
      date: "2026-11-15",
      amount: "80",
      vatAmount: "0",
      categoryId: travel.id,
      method: "CASH",
    });
    expect(b.ok).toBe(true);
    await createExpense(userId, {
      title: "December rent",
      date: "2026-12-01",
      amount: "1000",
      vatAmount: "50",
      categoryId: office.id,
      method: "BANK_TRANSFER",
    });

    const all = await listExpenses(userId, {});
    expect(all.total).toBe(3);
    expect(all.totals.amount.toString()).toBe("2080");
    expect(all.totals.vatAmount.toString()).toBe("100");

    const november = await listExpenses(userId, { from: "2026-11-01", to: "2026-11-30" });
    expect(november.total).toBe(2);
    expect(november.totals.amount.toString()).toBe("1080");

    const officeOnly = await listExpenses(userId, { categoryId: office.id });
    expect(officeOnly.total).toBe(2);

    const searched = await listExpenses(userId, { q: "taxi" });
    expect(searched.total).toBe(1);
    expect(searched.expenses[0]?.title).toBe("Taxi to client");
  });

  it("updates an expense and enforces delete RBAC", async () => {
    const { userId, businessId } = await makeAccount();
    const member = await makeMember(businessId, "MEMBER");
    const viewer = await makeMember(businessId, "VIEWER");

    const created = await createExpense(userId, {
      title: "Software",
      date: "2026-11-10",
      amount: "99",
      vatAmount: "0",
      method: "CARD",
    });
    if (!created.ok) throw new Error("create failed");
    const id = created.data.id;

    const updated = await updateExpense(member, id, {
      title: "Software subscription",
      date: "2026-11-10",
      amount: "119",
      vatAmount: "0",
      method: "CARD",
    });
    expect(updated.ok).toBe(true);
    const after = await prisma.expense.findUniqueOrThrow({ where: { id } });
    expect(after.amount.toString()).toBe("119");

    // MEMBER cannot delete; VIEWER cannot create.
    await expect(deleteExpense(member, id)).rejects.toBeInstanceOf(TenantError);
    await expect(
      createExpense(viewer, { title: "X", date: "2026-11-10", amount: "1", method: "CASH" }),
    ).rejects.toBeInstanceOf(TenantError);

    const ownerDelete = await deleteExpense(userId, id);
    expect(ownerDelete.ok).toBe(true);
    expect(await prisma.expense.findUnique({ where: { id } })).toBeNull();
  });

  it("rejects duplicate category names and unlinks expenses on category delete", async () => {
    const { userId } = await makeAccount();
    const first = await createExpenseCategory(userId, { name: "Fuel" });
    expect(first.ok).toBe(true);
    const dup = await createExpenseCategory(userId, { name: "Fuel" });
    expect(dup.ok).toBe(false);
    if (dup.ok) throw new Error("duplicate category should fail");
    expect(dup.error).toContain("already exists");

    if (!first.ok) throw new Error("category create failed");
    const expense = await createExpense(userId, {
      title: "Petrol",
      date: "2026-11-12",
      amount: "50",
      vatAmount: "0",
      categoryId: first.data.id,
      method: "CASH",
    });
    expect(expense.ok).toBe(true);
    const deleted = await deleteExpenseCategory(userId, first.data.id);
    expect(deleted.ok).toBe(true);
    if (!expense.ok) throw new Error("expense create failed");
    const after = await prisma.expense.findUniqueOrThrow({ where: { id: expense.data.id } });
    expect(after.categoryId).toBeNull();
  });

  it("expenses are isolated between businesses", async () => {
    const { userId } = await makeAccount();
    const other = await makeAccount();
    const created = await createExpense(userId, {
      title: "Secret spend",
      date: "2026-11-10",
      amount: "10",
      vatAmount: "0",
      method: "CASH",
    });
    if (!created.ok) throw new Error("create failed");
    const otherList = await listExpenses(other.userId, {});
    expect(otherList.expenses.some((e) => e.id === created.data.id)).toBe(false);
    await expect(
      updateExpense(other.userId, created.data.id, {
        title: "Hijack",
        date: "2026-11-10",
        amount: "10",
        vatAmount: "0",
        method: "CASH",
      }),
    ).rejects.toBeInstanceOf(TenantError);
  });
});

// ---------------------------------------------------------------------------
// Recurring
// ---------------------------------------------------------------------------

describe("recurring invoices", () => {
  it("runs once per period: running twice creates exactly one invoice", async () => {
    const { userId, businessId } = await makeAccount();
    const customerId = await makeCustomer(userId);
    const std = await stdRate(businessId);
    const created = await createRecurring(userId, recurringInput(customerId, std.id));
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error("create failed");

    const first = await runRecurring({ userId, now: new Date("2026-11-01T00:00:00Z") });
    expect(first.created).toHaveLength(1);
    expect(first.skipped).toHaveLength(0);

    const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: first.created[0] } });
    expect(invoice.status).toBe("DRAFT");
    expect(invoice.grandTotal.toString()).toBe("210");
    expect(invoice.issueDate.toISOString().slice(0, 10)).toBe("2026-11-01");
    expect(invoice.recurringInvoiceId).toBe(created.data.id);

    const schedule = await prisma.recurringInvoice.findUniqueOrThrow({ where: { id: created.data.id } });
    expect(schedule.nextRunAt.toISOString().slice(0, 10)).toBe("2026-12-01");
    expect(schedule.lastRunKey).toBe(`${created.data.id}:2026-11-01`);

    // Second run for the same period creates nothing.
    const second = await runRecurring({ userId, now: new Date("2026-11-01T00:00:00Z") });
    expect(second.created).toHaveLength(0);
    expect(
      await prisma.invoice.count({ where: { recurringInvoiceId: created.data.id } }),
    ).toBe(1);

    // The next period creates the second invoice.
    const third = await runRecurring({ userId, now: new Date("2026-12-01T00:00:00Z") });
    expect(third.created).toHaveLength(1);
    expect(
      await prisma.invoice.count({ where: { recurringInvoiceId: created.data.id } }),
    ).toBe(2);
  });

  it("monthly runs clamp month ends (31 Jan → 28 Feb)", async () => {
    const { userId, businessId } = await makeAccount();
    const customerId = await makeCustomer(userId);
    const std = await stdRate(businessId);
    const created = await createRecurring(
      userId,
      recurringInput(customerId, std.id, { startDate: "2026-01-31" }),
    );
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error("create failed");
    await runRecurring({ userId, now: new Date("2026-01-31T00:00:00Z") });
    const schedule = await prisma.recurringInvoice.findUniqueOrThrow({ where: { id: created.data.id } });
    expect(schedule.nextRunAt.toISOString().slice(0, 10)).toBe("2026-02-28");
  });

  it("a paused schedule never generates; resuming runs it again", async () => {
    const { userId, businessId } = await makeAccount();
    const customerId = await makeCustomer(userId);
    const std = await stdRate(businessId);
    const created = await createRecurring(userId, recurringInput(customerId, std.id));
    if (!created.ok) throw new Error("create failed");
    await pauseRecurring(userId, created.data.id);

    const paused = await runRecurring({ userId, now: new Date("2026-11-01T00:00:00Z") });
    expect(paused.created).toHaveLength(0);
    expect(
      await prisma.invoice.count({ where: { recurringInvoiceId: created.data.id } }),
    ).toBe(0);

    await resumeRecurring(userId, created.data.id);
    const resumed = await runRecurring({ userId, now: new Date("2026-11-01T00:00:00Z") });
    expect(resumed.created).toHaveLength(1);
  });

  it("autoSend issues the invoice and emails it", async () => {
    const { userId, businessId } = await makeAccount();
    const customerId = await makeCustomer(userId);
    const std = await stdRate(businessId);
    const created = await createRecurring(
      userId,
      recurringInput(customerId, std.id, { autoSend: true }),
    );
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error("create failed");

    const result = await runRecurring({ userId, now: new Date("2026-11-01T00:00:00Z") });
    expect(result.created).toHaveLength(1);
    expect(result.issued).toHaveLength(1);
    expect(result.emailed).toHaveLength(1);

    const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: result.created[0] } });
    expect(invoice.status).toBe("SENT");
    expect(invoice.number).toMatch(/^INV-\d+$/);
    const email = await prisma.emailLog.findFirstOrThrow({ where: { relatedId: invoice.id } });
    expect(email.status).toBe("SENT");
  });

  it("a custom interval and an end date are honoured", async () => {
    const { userId, businessId } = await makeAccount();
    const customerId = await makeCustomer(userId);
    const std = await stdRate(businessId);
    const created = await createRecurring(
      userId,
      recurringInput(customerId, std.id, {
        frequency: "CUSTOM",
        intervalDays: 10,
        startDate: "2026-11-01",
        endDate: "2026-11-15",
      }),
    );
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error("create failed");

    await runRecurring({ userId, now: new Date("2026-11-01T00:00:00Z") });
    let schedule = await prisma.recurringInvoice.findUniqueOrThrow({ where: { id: created.data.id } });
    expect(schedule.nextRunAt.toISOString().slice(0, 10)).toBe("2026-11-11");

    await runRecurring({ userId, now: new Date("2026-11-11T00:00:00Z") });
    schedule = await prisma.recurringInvoice.findUniqueOrThrow({ where: { id: created.data.id } });
    expect(schedule.nextRunAt.toISOString().slice(0, 10)).toBe("2026-11-21");

    // Next run is past the end date — nothing more is generated.
    const afterEnd = await runRecurring({ userId, now: new Date("2026-11-21T00:00:00Z") });
    expect(afterEnd.created).toHaveLength(0);
    expect(
      await prisma.invoice.count({ where: { recurringInvoiceId: created.data.id } }),
    ).toBe(2);
  });

  it("a cancelled schedule cannot run or resume", async () => {
    const { userId, businessId } = await makeAccount();
    const customerId = await makeCustomer(userId);
    const std = await stdRate(businessId);
    const created = await createRecurring(userId, recurringInput(customerId, std.id));
    if (!created.ok) throw new Error("create failed");
    const cancelled = await cancelRecurring(userId, created.data.id);
    expect(cancelled.ok).toBe(true);

    const ran = await runRecurring({ userId, now: new Date("2026-11-01T00:00:00Z") });
    expect(ran.created).toHaveLength(0);
    const resumed = await resumeRecurring(userId, created.data.id);
    expect(resumed.ok).toBe(false);
  });

  it("recurring schedules are isolated between businesses", async () => {
    const { userId, businessId } = await makeAccount();
    const other = await makeAccount();
    const customerId = await makeCustomer(userId);
    const std = await stdRate(businessId);
    const created = await createRecurring(userId, recurringInput(customerId, std.id));
    if (!created.ok) throw new Error("create failed");

    await expect(getRecurringDetail(other.userId, created.data.id)).rejects.toBeInstanceOf(
      TenantError,
    );
    const otherRun = await runRecurring({ userId: other.userId, now: new Date("2026-11-01T00:00:00Z") });
    expect(otherRun.created).toHaveLength(0);
    expect(
      await prisma.invoice.count({ where: { recurringInvoiceId: created.data.id } }),
    ).toBe(0);
  });

  it("runDueSchedules only runs schedules that are due", async () => {
    const { userId, businessId } = await makeAccount();
    const customerId = await makeCustomer(userId);
    const std = await stdRate(businessId);
    const due = await createRecurring(userId, recurringInput(customerId, std.id, { startDate: "2026-11-01" }));
    const future = await createRecurring(userId, recurringInput(customerId, std.id, { startDate: "2027-01-01" }));
    expect(due.ok && future.ok).toBe(true);

    const result = await runDueSchedules({ userId, now: new Date("2026-11-15T00:00:00Z") });
    expect(result.created).toHaveLength(1);
    if (!due.ok) throw new Error("create failed");
    const dueInvoice = await prisma.invoice.findFirstOrThrow({
      where: { recurringInvoiceId: due.data.id },
    });
    expect(result.created[0]).toBe(dueInvoice.id);
  });
});
