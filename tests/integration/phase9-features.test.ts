import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { registerUserAccount } from "@/server/services/auth.service";
import { createCustomer } from "@/server/services/customer.service";
import {
  createInvoice,
  getInvoiceForUser,
  issueInvoice,
  updateInvoice,
} from "@/server/services/invoice.service";
import { deletePayment, recordPayment } from "@/server/services/payment.service";
import {
  getAgingReport,
  getOverdueReport,
} from "@/server/services/report.service";

const uid = () => Math.random().toString(36).slice(2, 10);

async function makeAccount() {
  const result = await registerUserAccount({
    name: "Phase 9 Test",
    businessName: `Phase 9 ${uid()} LLC`,
    email: `p9-${uid()}@example.com`,
    password: "QaTestPass1234",
  });
  if (!result.ok) throw new Error(`setup failed: ${result.error}`);
  return result as unknown as { userId: string; businessId: string };
}

async function makeCustomer(userId: string) {
  const created = await createCustomer(userId, {
    type: "COMPANY",
    name: "Acme Corp",
    companyName: "Acme Corp",
    email: `billing-${uid()}@example.com`,
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

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

/**
 * One line: 1 × 100.00 at STD 5% → subtotal 100, VAT 5, grand 105.
 * Discount fields are optional overrides.
 */
function draftInput(
  customerId: string,
  stdId: string,
  overrides: {
    issueDate?: string;
    dueDate?: string;
    invoiceDiscountType?: "NONE" | "PERCENT" | "FIXED";
    invoiceDiscountValue?: string;
    earlyDiscountType?: "NONE" | "PERCENT" | "FIXED";
    earlyDiscountValue?: string;
    earlyDiscountDays?: string;
  } = {},
) {
  return {
    customerId,
    issueDate: overrides.issueDate ?? "2026-11-25",
    dueDate: overrides.dueDate ?? "2026-12-25",
    template: "classic" as const,
    locale: "en" as const,
    invoiceDiscountType: overrides.invoiceDiscountType ?? "NONE",
    invoiceDiscountValue: overrides.invoiceDiscountValue ?? "0",
    earlyDiscountType: overrides.earlyDiscountType ?? "NONE",
    earlyDiscountValue: overrides.earlyDiscountValue ?? "0",
    earlyDiscountDays: overrides.earlyDiscountDays ?? "0",
    items: [
      {
        description: "Consulting",
        quantity: "1",
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

async function makeIssuedInvoice(
  userId: string,
  customerId: string,
  stdId: string,
  overrides: Parameters<typeof draftInput>[2] = {},
) {
  const created = await createInvoice(userId, draftInput(customerId, stdId, overrides));
  if (!created.ok) throw new Error(`create failed: ${created.error}`);
  const issued = await issueInvoice(userId, created.data.id);
  if (!issued.ok) throw new Error(`issue failed: ${issued.error}`);
  const { invoice } = await getInvoiceForUser(userId, created.data.id);
  return invoice;
}

describe("invoice-level discount", () => {
  it("a 10% discount lowers the taxable base: subtotal 100, discount 10, VAT 4.50, grand 94.50", async () => {
    const a = await makeAccount();
    const customerId = await makeCustomer(a.userId);
    const std = await stdRate(a.businessId);
    const created = await createInvoice(
      a.userId,
      draftInput(customerId, std.id, {
        invoiceDiscountType: "PERCENT",
        invoiceDiscountValue: "10",
      }),
    );
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error("create failed");
    const { invoice } = await getInvoiceForUser(a.userId, created.data.id);
    expect(invoice.subtotal.toString()).toBe("100");
    expect(invoice.discountTotal.toString()).toBe("10");
    expect(invoice.invoiceDiscountTotal.toString()).toBe("10");
    expect(invoice.taxableAmount.toString()).toBe("90");
    expect(invoice.vatAmount.toString()).toBe("4.5");
    expect(invoice.grandTotal.toString()).toBe("94.5");
    expect(invoice.balance.toString()).toBe("94.5");
  });

  it("a fixed discount larger than the subtotal is capped at the subtotal", async () => {
    const a = await makeAccount();
    const customerId = await makeCustomer(a.userId);
    const std = await stdRate(a.businessId);
    const created = await createInvoice(
      a.userId,
      draftInput(customerId, std.id, {
        invoiceDiscountType: "FIXED",
        invoiceDiscountValue: "1000",
      }),
    );
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error("create failed");
    const { invoice } = await getInvoiceForUser(a.userId, created.data.id);
    expect(invoice.invoiceDiscountTotal.toString()).toBe("100");
    expect(invoice.grandTotal.toString()).toBe("0");
  });

  it("editing a draft recomputes the discount, and issuing freezes it in the snapshot", async () => {
    const a = await makeAccount();
    const customerId = await makeCustomer(a.userId);
    const std = await stdRate(a.businessId);
    const created = await createInvoice(
      a.userId,
      draftInput(customerId, std.id, {
        invoiceDiscountType: "PERCENT",
        invoiceDiscountValue: "10",
      }),
    );
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error("create failed");
    const id = created.data.id;
    const updated = await updateInvoice(
      a.userId,
      id,
      draftInput(customerId, std.id, {
        invoiceDiscountType: "FIXED",
        invoiceDiscountValue: "25",
      }),
    );
    expect(updated.ok).toBe(true);
    const issued = await issueInvoice(a.userId, id);
    expect(issued.ok).toBe(true);
    const { invoice } = await getInvoiceForUser(a.userId, id);
    expect(invoice.invoiceDiscountTotal.toString()).toBe("25");
    expect(invoice.grandTotal.toString()).toBe("78.75"); // (100 − 25) + 3.75 VAT
    const snapshot = await prisma.invoiceSnapshot.findUnique({ where: { invoiceId: id } });
    expect(snapshot).not.toBeNull();
    const payload = snapshot!.payload as unknown as {
      invoice: Record<string, unknown>;
    };
    expect(payload.invoice.invoiceDiscountType).toBe("FIXED");
    expect(payload.invoice.invoiceDiscountValue).toBe("25");
    expect(payload.invoice.invoiceDiscountTotal).toBe("25");
    expect(payload.invoice.discountTotal).toBe("25");
    expect(payload.invoice.grandTotal).toBe("78.75");
  });

  it("rejects a percentage discount above 100", async () => {
    const a = await makeAccount();
    const customerId = await makeCustomer(a.userId);
    const std = await stdRate(a.businessId);
    const created = await createInvoice(
      a.userId,
      draftInput(customerId, std.id, {
        invoiceDiscountType: "PERCENT",
        invoiceDiscountValue: "101",
      }),
    );
    expect(created.ok).toBe(false);
  });
});

describe("early-payment discount", () => {
  it("paying balance − discount with the box ticked settles the invoice, and deleting the payment reverts it", async () => {
    const a = await makeAccount();
    const customerId = await makeCustomer(a.userId);
    const std = await stdRate(a.businessId);
    const today = new Date();
    const invoice = await makeIssuedInvoice(a.userId, customerId, std.id, {
      issueDate: isoDay(today),
      dueDate: isoDay(addDays(today, 30)),
      earlyDiscountType: "PERCENT",
      earlyDiscountValue: "2",
      earlyDiscountDays: "10",
    });
    expect(invoice.grandTotal.toString()).toBe("105");
    expect(invoice.balance.toString()).toBe("105");

    // Partial payment first, no discount: balance 55.
    const partial = await recordPayment(a.userId, invoice.id, {
      date: isoDay(today),
      amount: "50",
      method: "BANK_TRANSFER",
    });
    expect(partial.ok).toBe(true);
    let current = (await getInvoiceForUser(a.userId, invoice.id)).invoice;
    expect(current.status).toBe("PARTIALLY_PAID");
    expect(current.balance.toString()).toBe("55");

    // The saving is recomputed from the CURRENT balance: 2% of 55 = 1.10.
    // Paying 53.90 with the discount ticked settles it.
    const settled = await recordPayment(a.userId, invoice.id, {
      date: isoDay(today),
      amount: "53.90",
      method: "BANK_TRANSFER",
      applyEarlyDiscount: "true",
    });
    expect(settled.ok).toBe(true);
    if (!settled.ok) throw new Error(`settle failed: ${settled.error}`);
    current = (await getInvoiceForUser(a.userId, invoice.id)).invoice;
    expect(current.status).toBe("PAID");
    expect(current.balance.toString()).toBe("0");
    const payment = await prisma.payment.findUnique({
      where: { id: settled.data.id },
    });
    expect(payment?.earlyDiscountAmount.toString()).toBe("1.1");

    // Deleting the discounted payment reverts the discount.
    const deleted = await deletePayment(a.userId, settled.data.id);
    expect(deleted.ok).toBe(true);
    current = (await getInvoiceForUser(a.userId, invoice.id)).invoice;
    expect(current.status).toBe("PARTIALLY_PAID");
    expect(current.balance.toString()).toBe("55");
  });

  it("a partial payment with the discount ticked is rejected", async () => {
    const a = await makeAccount();
    const customerId = await makeCustomer(a.userId);
    const std = await stdRate(a.businessId);
    const today = new Date();
    const invoice = await makeIssuedInvoice(a.userId, customerId, std.id, {
      issueDate: isoDay(today),
      dueDate: isoDay(addDays(today, 30)),
      earlyDiscountType: "PERCENT",
      earlyDiscountValue: "2",
      earlyDiscountDays: "10",
    });
    const attempt = await recordPayment(a.userId, invoice.id, {
      date: isoDay(today),
      amount: "50",
      method: "BANK_TRANSFER",
      applyEarlyDiscount: "true",
    });
    expect(attempt.ok).toBe(false);
  });

  it("paying more than balance − discount with the box ticked is rejected", async () => {
    const a = await makeAccount();
    const customerId = await makeCustomer(a.userId);
    const std = await stdRate(a.businessId);
    const today = new Date();
    const invoice = await makeIssuedInvoice(a.userId, customerId, std.id, {
      issueDate: isoDay(today),
      dueDate: isoDay(addDays(today, 30)),
      earlyDiscountType: "PERCENT",
      earlyDiscountValue: "2",
      earlyDiscountDays: "10",
    });
    // Full balance 105 with the box ticked exceeds the discounted 102.90.
    const attempt = await recordPayment(a.userId, invoice.id, {
      date: isoDay(today),
      amount: "105",
      method: "BANK_TRANSFER",
      applyEarlyDiscount: "true",
    });
    expect(attempt.ok).toBe(false);
  });

  it("the discount cannot be taken after the window expires", async () => {
    const a = await makeAccount();
    const customerId = await makeCustomer(a.userId);
    const std = await stdRate(a.businessId);
    const today = new Date();
    const invoice = await makeIssuedInvoice(a.userId, customerId, std.id, {
      issueDate: isoDay(addDays(today, -20)),
      dueDate: isoDay(addDays(today, -10)),
      earlyDiscountType: "PERCENT",
      earlyDiscountValue: "2",
      earlyDiscountDays: "10",
    });
    const attempt = await recordPayment(a.userId, invoice.id, {
      date: isoDay(today),
      amount: "102.90",
      method: "BANK_TRANSFER",
      applyEarlyDiscount: "true",
    });
    expect(attempt.ok).toBe(false);
  });

  it("a 100% discount is refused — it would leave a $0 payment", async () => {
    const a = await makeAccount();
    const customerId = await makeCustomer(a.userId);
    const std = await stdRate(a.businessId);
    const today = new Date();
    const invoice = await makeIssuedInvoice(a.userId, customerId, std.id, {
      issueDate: isoDay(today),
      dueDate: isoDay(addDays(today, 30)),
      earlyDiscountType: "PERCENT",
      earlyDiscountValue: "100",
      earlyDiscountDays: "10",
    });
    const attempt = await recordPayment(a.userId, invoice.id, {
      date: isoDay(today),
      amount: "0.01",
      method: "BANK_TRANSFER",
      applyEarlyDiscount: "true",
    });
    expect(attempt.ok).toBe(false);
  });
});

describe("A/R aging report", () => {
  it("buckets open invoices by days overdue and agrees with the overdue report", async () => {
    const a = await makeAccount();
    const customerId = await makeCustomer(a.userId);
    const std = await stdRate(a.businessId);
    // "Today" for the reports, fixed so the buckets are deterministic.
    const now = new Date("2026-11-25T12:00:00Z");
    // One 105.00 invoice per bucket (due − issue = 5 days each).
    const offsets = [30, 0, -10, -40, -70, -100];
    for (const offset of offsets) {
      await makeIssuedInvoice(a.userId, customerId, std.id, {
        issueDate: isoDay(addDays(now, offset - 5)),
        dueDate: isoDay(addDays(now, offset)),
      });
    }
    const aging = await getAgingReport(a.userId, now);
    expect(aging.count).toBe(6);
    expect(aging.totalOutstanding.toString()).toBe("630");
    const byKey = new Map(aging.buckets.map((b) => [b.key, b]));
    expect(byKey.get("current")?.count).toBe(2); // due in 30 days + due today
    expect(byKey.get("current")?.total.toString()).toBe("210");
    expect(byKey.get("1-30")?.count).toBe(1);
    expect(byKey.get("1-30")?.total.toString()).toBe("105");
    expect(byKey.get("31-60")?.count).toBe(1);
    expect(byKey.get("61-90")?.count).toBe(1);
    expect(byKey.get("90+")?.count).toBe(1);
    // Overdue buckets: 4 × 105 = 420 — and the overdue report agrees.
    expect(aging.overdueTotal.toString()).toBe("420");
    const overdue = await getOverdueReport(a.userId, now);
    expect(overdue.count).toBe(4);
    expect(overdue.totalBalance.toString()).toBe("420");
    expect(overdue.totalBalance.toString()).toBe(aging.overdueTotal.toString());
    // The due-today invoice is Current, not overdue.
    const dueToday = aging.rows.find((r) => r.daysOverdue === 0);
    expect(dueToday?.bucket).toBe("current");
    expect(overdue.rows.some((r) => r.invoiceId === dueToday?.invoiceId)).toBe(false);
  });

  it("excludes paid invoices and invoices with no balance", async () => {
    const a = await makeAccount();
    const customerId = await makeCustomer(a.userId);
    const std = await stdRate(a.businessId);
    const now = new Date("2026-11-25T12:00:00Z");
    const invoice = await makeIssuedInvoice(a.userId, customerId, std.id, {
      issueDate: isoDay(addDays(now, -15)),
      dueDate: isoDay(addDays(now, -10)),
    });
    const paid = await recordPayment(a.userId, invoice.id, {
      date: "2026-11-25",
      amount: "105",
      method: "BANK_TRANSFER",
    });
    expect(paid.ok).toBe(true);
    const aging = await getAgingReport(a.userId, now);
    expect(aging.count).toBe(0);
    expect(aging.totalOutstanding.toString()).toBe("0");
  });
});
