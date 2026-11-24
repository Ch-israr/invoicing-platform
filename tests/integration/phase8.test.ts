import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { TenantError } from "@/lib/tenant";
import { registerUserAccount } from "@/server/services/auth.service";
import { createCustomer, getCustomerDetail } from "@/server/services/customer.service";
import {
  createInvoice,
  getInvoiceDetail,
  issueInvoice,
} from "@/server/services/invoice.service";
import {
  deletePayment,
  getReceiptData,
  listPayments,
  recordPayment,
  recordRefund,
} from "@/server/services/payment.service";
import { createCreditNote } from "@/server/services/credit-note.service";
import {
  createExpense,
  createExpenseCategory,
  deleteExpense,
  deleteExpenseCategory,
  listExpenses,
  updateExpense,
} from "@/server/services/expense.service";
import {
  createCategory,
  deleteCategory,
  renameCategory,
} from "@/server/services/product.service";
import {
  createPortalToken,
  listPortalTokens,
  revokePortalToken,
} from "@/server/services/portal.service";
import { regenerateInvoicePdf } from "@/server/pdf/service";

const uid = () => Math.random().toString(36).slice(2, 10);

async function makeAccount() {
  const result = await registerUserAccount({
    name: "Phase 8 Test",
    businessName: `Phase 8 ${uid()} LLC`,
    email: `p8-${uid()}@example.com`,
    password: "TestPass123!",
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

async function makeCustomer(userId: string) {
  const created = await createCustomer(userId, {
    type: "COMPANY",
    name: "Acme Corp",
    companyName: "Acme Corp",
    email: "billing@acme.example",
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

async function zeroRate(businessId: string) {
  const rate = await prisma.taxRate.findFirst({ where: { businessId, code: "ZERO" } });
  if (!rate) throw new Error("ZERO rate missing");
  return rate;
}

/**
 * Hand-calculated reference invoice (same numbers as Phase 3/5):
 * L1: 2 × 100.00, 10% discount, STD 5% → total 189
 * L2: 1 × 50.00, ZERO 0% → total 50
 * grand 239, balance 239. A 1-unit credit of L1 reverses 94.50.
 */
function draftInput(customerId: string, stdId: string, zeroId: string) {
  return {
    customerId,
    issueDate: "2026-11-24",
    dueDate: "2026-12-24",
    supplyDate: "2026-11-20",
    template: "classic" as const,
    locale: "en" as const,
    items: [
      {
        description: "Consulting",
        quantity: "2",
        unit: "hour",
        unitPrice: "100",
        discountType: "PERCENT" as const,
        discountValue: "10",
        taxRateId: stdId,
        taxCategory: "STANDARD" as const,
        taxInclusive: false,
      },
      {
        description: "Export goods",
        quantity: "1",
        unit: "pcs",
        unitPrice: "50",
        discountType: "NONE" as const,
        discountValue: "0",
        taxRateId: zeroId,
        taxCategory: "ZERO_RATED" as const,
        taxInclusive: false,
      },
    ],
  };
}

async function makeIssuedInvoice(userId: string) {
  const customerId = await makeCustomer(userId);
  const a = await prisma.businessMembership.findFirst({
    where: { userId },
    select: { businessId: true },
  });
  if (!a) throw new Error("no business");
  const std = await stdRate(a.businessId);
  const zero = await zeroRate(a.businessId);
  const created = await createInvoice(userId, draftInput(customerId, std.id, zero.id));
  if (!created.ok) throw new Error(`create failed: ${created.error}`);
  const issued = await issueInvoice(userId, created.data.id);
  if (!issued.ok) throw new Error(`issue failed: ${issued.error}`);
  const { invoice } = await getInvoiceDetail(userId, created.data.id);
  return { invoice, customerId };
}

async function logActions(businessId: string): Promise<string[]> {
  const rows = await prisma.activityLog.findMany({
    where: { businessId },
    orderBy: { createdAt: "asc" },
    select: { action: true },
  });
  return rows.map((r) => r.action);
}

describe("audit trail (Phase 8)", () => {
  it("issue → pay → credit note all write ActivityLog rows, in order", async () => {
    const a = await makeAccount();
    const { invoice } = await makeIssuedInvoice(a.userId);
    const paid = await recordPayment(a.userId, invoice.id, {
      date: "2026-11-24",
      amount: "100",
      method: "CASH",
    });
    expect(paid.ok).toBe(true);
    const l1 = invoice.items[0]!;
    const credited = await createCreditNote(a.userId, invoice.id, {
      reason: "Returned goods",
      items: [{ invoiceItemId: l1.id, quantity: "1" }],
    });
    expect(credited.ok).toBe(true);

    const actions = await logActions(a.businessId);
    // Registration itself is audited too.
    expect(actions).toContain("user.registered");
    for (const expected of [
      "invoice.created",
      "invoice.issued",
      "payment.recorded",
      "credit_note.created",
    ]) {
      expect(actions).toContain(expected);
    }
    const ordered = ["invoice.created", "invoice.issued", "payment.recorded", "credit_note.created"]
      .map((name) => actions.indexOf(name));
    expect(ordered).toEqual([...ordered].sort((x, y) => x - y));

    // Every row carries the acting user and the business.
    const rows = await prisma.activityLog.findMany({
      where: { businessId: a.businessId, action: "payment.recorded" },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.userId).toBe(a.userId);
    expect(rows[0]!.entityType).toBe("Payment");
  });

  it("expense and category mutations are audited", async () => {
    const a = await makeAccount();
    const cat = await createExpenseCategory(a.userId, { name: "Fuel" });
    expect(cat.ok).toBe(true);
    if (!cat.ok) throw new Error(cat.error);
    const exp = await createExpense(a.userId, {
      title: "Petrol",
      date: "2026-11-20",
      amount: "50",
      vatAmount: "2.5",
      method: "CASH",
    });
    expect(exp.ok).toBe(true);
    if (!exp.ok) throw new Error(exp.error);
    const updated = await updateExpense(a.userId, exp.data.id, {
      title: "Petrol (revised)",
      date: "2026-11-20",
      amount: "55",
      vatAmount: "2.75",
      method: "CASH",
    });
    expect(updated.ok).toBe(true);
    const deleted = await deleteExpense(a.userId, exp.data.id);
    expect(deleted.ok).toBe(true);
    const catDeleted = await deleteExpenseCategory(a.userId, cat.data.id);
    expect(catDeleted.ok).toBe(true);

    const prodCat = await createCategory(a.userId, { name: "Services" });
    expect(prodCat.ok).toBe(true);
    if (!prodCat.ok) throw new Error(prodCat.error);
    const renamed = await renameCategory(a.userId, prodCat.data.id, { name: "Consulting" });
    expect(renamed.ok).toBe(true);
    const prodDeleted = await deleteCategory(a.userId, prodCat.data.id);
    expect(prodDeleted.ok).toBe(true);

    const actions = await logActions(a.businessId);
    for (const expected of [
      "expense_category.created",
      "expense.created",
      "expense.updated",
      "expense.deleted",
      "expense_category.deleted",
      "product_category.created",
      "product_category.updated",
      "product_category.deleted",
    ]) {
      expect(actions).toContain(expected);
    }
  });

  it("a malformed expense date filter is ignored instead of 500ing", async () => {
    const a = await makeAccount();
    await createExpense(a.userId, {
      title: "Office rent",
      date: "2026-11-01",
      amount: "1000",
      vatAmount: "50",
      method: "BANK_TRANSFER",
    });
    // Before Phase 8, `new Date("garbageT00:00:00Z")` was Invalid Date and
    // Prisma threw, 500ing /expenses?from=garbage.
    const bad = await listExpenses(a.userId, { from: "garbage", to: "not-a-date", page: 1 });
    expect(bad.expenses.map((e) => e.title)).toContain("Office rent");
    const filtered = await listExpenses(a.userId, { from: "2026-11-15", page: 1 });
    expect(filtered.expenses.map((e) => e.title)).not.toContain("Office rent");
  });
});

describe("tenant isolation at the service layer (Phase 8)", () => {
  it("a MEMBER of business B cannot read business A's invoice, customer, payment or portal token", async () => {
    const a = await makeAccount();
    const b = await makeAccount();
    const memberB = await makeMember(b.businessId, "MEMBER");
    const { invoice, customerId } = await makeIssuedInvoice(a.userId);
    const paid = await recordPayment(a.userId, invoice.id, {
      date: "2026-11-24",
      amount: "100",
      method: "CASH",
    });
    expect(paid.ok).toBe(true);
    const payments = await listPayments(a.userId, {});
    expect(payments.payments).toHaveLength(1);
    const paymentId = payments.payments[0]!.id;
    const token = await createPortalToken(a.userId, { invoiceId: invoice.id });
    expect(token.ok).toBe(true);
    if (!token.ok) throw new Error(token.error);

    await expect(getInvoiceDetail(memberB, invoice.id)).rejects.toBeInstanceOf(TenantError);
    await expect(getCustomerDetail(memberB, customerId)).rejects.toBeInstanceOf(TenantError);
    await expect(getReceiptData(memberB, paymentId)).rejects.toBeInstanceOf(TenantError);
    // B's own payment list never contains A's payment.
    const bPayments = await listPayments(memberB, {});
    expect(bPayments.payments).toEqual([]);
    // B cannot see or revoke A's portal token.
    await expect(listPortalTokens(memberB, { invoiceId: invoice.id })).rejects.toBeInstanceOf(
      TenantError,
    );
    await expect(revokePortalToken(memberB, token.data.row.id)).rejects.toBeInstanceOf(
      TenantError,
    );
  });
});

describe("MEMBER role limits (Phase 8)", () => {
  it("MEMBER cannot regenerate PDFs, revoke portal links, delete payments, record refunds or delete expense categories", async () => {
    const a = await makeAccount();
    const member = await makeMember(a.businessId, "MEMBER");
    const { invoice } = await makeIssuedInvoice(a.userId);
    const paid = await recordPayment(a.userId, invoice.id, {
      date: "2026-11-24",
      amount: "100",
      method: "CASH",
    });
    expect(paid.ok).toBe(true);
    const payments = await listPayments(a.userId, {});
    const paymentId = payments.payments[0]!.id;
    const token = await createPortalToken(a.userId, { invoiceId: invoice.id });
    expect(token.ok).toBe(true);
    if (!token.ok) throw new Error(token.error);
    const cat = await createExpenseCategory(a.userId, { name: "Fuel" });
    expect(cat.ok).toBe(true);
    if (!cat.ok) throw new Error(cat.error);

    // The role check happens before any PDF rendering, so no browser is launched.
    await expect(regenerateInvoicePdf(member, invoice.id)).rejects.toThrow(
      "Only owners and admins can regenerate PDFs",
    );
    await expect(revokePortalToken(member, token.data.row.id)).rejects.toThrow(
      "Only owners and admins can revoke portal links",
    );
    await expect(deletePayment(member, paymentId)).rejects.toThrow(
      "Only owners and admins can delete payments",
    );
    await expect(
      recordRefund(member, paymentId, { date: "2026-11-24", amount: "10", reason: "Goodwill" }),
    ).rejects.toThrow("Only owners and admins can record refunds");
    await expect(deleteExpenseCategory(member, cat.data.id)).rejects.toThrow(
      "Only owners and admins can delete categories",
    );

    // The same actions succeed for an ADMIN — the boundary is the role.
    const admin = await makeMember(a.businessId, "ADMIN");
    const adminDelete = await deletePayment(admin, paymentId);
    expect(adminDelete.ok).toBe(true);
    const adminRevoke = await revokePortalToken(admin, token.data.row.id);
    expect(adminRevoke.ok).toBe(true);
  });
});
