import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { TenantError } from "@/lib/tenant";
import { registerUserAccount } from "@/server/services/auth.service";
import { createCustomer } from "@/server/services/customer.service";
import { createProduct } from "@/server/services/product.service";
import {
  createInvoice,
  deleteInvoice,
  getInvoiceDetail,
  getInvoiceForUser,
  issueInvoice,
  listInvoices,
  updateInvoice,
  voidInvoice,
} from "@/server/services/invoice.service";

const uid = () => Math.random().toString(36).slice(2, 10);

async function makeAccount() {
  const email = `p3-${uid()}@example.com`;
  const result = await registerUserAccount({
    name: "Phase 3 Test",
    businessName: `Phase 3 ${uid()} LLC`,
    email,
    password: "correct-horse-battery",
  });
  if (!result.ok) throw new Error(`setup failed: ${result.error}`);
  return result;
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
  const rate = await prisma.taxRate.findFirst({
    where: { businessId, code: "STD_5" },
  });
  if (!rate) throw new Error("STD_5 rate missing");
  return rate;
}

async function zeroRate(businessId: string) {
  const rate = await prisma.taxRate.findFirst({
    where: { businessId, code: "ZERO" },
  });
  if (!rate) throw new Error("ZERO rate missing");
  return rate;
}

/**
 * Hand-calculated draft (same numbers as tests/unit/money.test.ts):
 *   L1: 2 × 100.00, 10% discount, STD 5% → net 200, disc 20, taxable 180, VAT 9, total 189
 *   L2: 1 × 50.00, ZERO 0% → taxable 50, VAT 0, total 50
 *   subtotal 250, discount 20, taxable 230, VAT 9, grand 239, balance 239
 */
function draftInput(customerId: string, stdId: string, zeroId: string) {
  return {
    customerId,
    issueDate: "2026-11-24",
    dueDate: "2026-12-24",
    supplyDate: "2026-11-20",
    notes: "Thank you for your business",
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

describe("invoice drafts", () => {
  it("creates a draft with server-calculated totals and a DRAFT placeholder number", async () => {
    const a = await makeAccount();
    const customerId = await makeCustomer(a.userId);
    const std = await stdRate(a.businessId);
    const zero = await zeroRate(a.businessId);

    const created = await createInvoice(a.userId, draftInput(customerId, std.id, zero.id));
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error("create failed");

    const { invoice } = await getInvoiceForUser(a.userId, created.data.id);
    expect(invoice.status).toBe("DRAFT");
    expect(invoice.number.startsWith("DRAFT-")).toBe(true);
    expect(invoice.subtotal.toString()).toBe("250");
    expect(invoice.discountTotal.toString()).toBe("20");
    expect(invoice.taxableAmount.toString()).toBe("230");
    expect(invoice.vatAmount.toString()).toBe("9");
    expect(invoice.grandTotal.toString()).toBe("239");
    expect(invoice.balance.toString()).toBe("239");
    expect(invoice.amountPaid.toString()).toBe("0");
    expect(invoice.items).toHaveLength(2);
    expect(invoice.items[0]?.taxRate.toString()).toBe("5");
    expect(invoice.items[1]?.taxRate.toString()).toBe("0");
  });

  it("ignores client-supplied totals — the server always recalculates", async () => {
    const a = await makeAccount();
    const customerId = await makeCustomer(a.userId);
    const std = await stdRate(a.businessId);
    const zero = await zeroRate(a.businessId);

    const created = await createInvoice(a.userId, {
      ...draftInput(customerId, std.id, zero.id),
      // A malicious client trying to set its own totals.
      grandTotal: "1",
      subtotal: "1",
      vatAmount: "0",
      balance: "0",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error("create failed");
    const { invoice } = await getInvoiceForUser(a.userId, created.data.id);
    expect(invoice.grandTotal.toString()).toBe("239");
    expect(invoice.balance.toString()).toBe("239");
  });

  it("a tax-inclusive line is calculated correctly on a draft", async () => {
    const a = await makeAccount();
    const customerId = await makeCustomer(a.userId);
    const std = await stdRate(a.businessId);
    // 2 × 52.50 incl. VAT, 10% discount → net 100, disc 10, taxable 90, VAT 4.50, total 94.50
    const created = await createInvoice(a.userId, {
      customerId,
      issueDate: "2026-11-24",
      dueDate: "2026-12-24",
      template: "classic" as const,
      locale: "en" as const,
      items: [
        {
          description: "Inclusive service",
          quantity: "2",
          unit: "hour",
          unitPrice: "52.50",
          discountType: "PERCENT" as const,
          discountValue: "10",
          taxRateId: std.id,
          taxCategory: "STANDARD" as const,
          taxInclusive: true,
        },
      ],
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error("create failed");
    const { invoice } = await getInvoiceForUser(a.userId, created.data.id);
    expect(invoice.subtotal.toString()).toBe("100");
    expect(invoice.discountTotal.toString()).toBe("10");
    expect(invoice.taxableAmount.toString()).toBe("90");
    expect(invoice.vatAmount.toString()).toBe("4.5");
    expect(invoice.grandTotal.toString()).toBe("94.5");
  });

  it("a draft can be updated (totals recomputed) and deleted; VIEWER cannot create", async () => {
    const a = await makeAccount();
    const viewerId = await makeMember(a.businessId, "VIEWER");
    const customerId = await makeCustomer(a.userId);
    const std = await stdRate(a.businessId);
    const zero = await zeroRate(a.businessId);

    await expect(
      createInvoice(viewerId, draftInput(customerId, std.id, zero.id)),
    ).rejects.toBeInstanceOf(TenantError);

    const created = await createInvoice(a.userId, draftInput(customerId, std.id, zero.id));
    if (!created.ok) throw new Error("create failed");
    const id = created.data.id;

    // Update to a single line: 1 × 200 at 5% → grand 210.
    const updated = await updateInvoice(a.userId, id, {
      customerId,
      issueDate: "2026-11-24",
      dueDate: "2026-12-24",
      template: "classic" as const,
      locale: "en" as const,
      items: [
        {
          description: "One line",
          quantity: "1",
          unit: "pcs",
          unitPrice: "200",
          discountType: "NONE" as const,
          discountValue: "0",
          taxRateId: std.id,
          taxCategory: "STANDARD" as const,
          taxInclusive: false,
        },
      ],
    });
    expect(updated.ok).toBe(true);
    const { invoice } = await getInvoiceForUser(a.userId, id);
    expect(invoice.grandTotal.toString()).toBe("210");
    expect(invoice.items).toHaveLength(1);

    const deleted = await deleteInvoice(a.userId, id);
    expect(deleted.ok).toBe(true);
    await expect(getInvoiceForUser(a.userId, id)).rejects.toThrow("Invoice not found");
  });

  it("rejects a draft with no lines and a due date before the issue date", async () => {
    const a = await makeAccount();
    const customerId = await makeCustomer(a.userId);
    const std = await stdRate(a.businessId);
    const zero = await zeroRate(a.businessId);

    const noLines = await createInvoice(a.userId, {
      ...draftInput(customerId, std.id, zero.id),
      items: [],
    });
    expect(noLines.ok).toBe(false);

    const badDates = await createInvoice(a.userId, {
      ...draftInput(customerId, std.id, zero.id),
      issueDate: "2026-12-24",
      dueDate: "2026-11-24",
    });
    expect(badDates.ok).toBe(false);
  });

  it("a product pick prefills the line — price snapshot survives a later price change", async () => {
    const a = await makeAccount();
    const customerId = await makeCustomer(a.userId);
    const std = await stdRate(a.businessId);
    const product = await createProduct(a.userId, {
      name: "Consulting Hour",
      sku: "CONS-001",
      unit: "hour",
      price: "250",
      taxCategory: "STANDARD",
      isActive: true,
    });
    if (!product.ok) throw new Error("product setup failed");

    const created = await createInvoice(a.userId, {
      customerId,
      issueDate: "2026-11-24",
      dueDate: "2026-12-24",
      template: "classic" as const,
      locale: "en" as const,
      items: [
        {
          productId: product.data.id,
          description: "Consulting Hour",
          sku: "CONS-001",
          quantity: "2",
          unit: "hour",
          unitPrice: "250",
          discountType: "NONE" as const,
          discountValue: "0",
          taxRateId: std.id,
          taxCategory: "STANDARD" as const,
          taxInclusive: false,
        },
      ],
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error("create failed");
    const { invoice } = await getInvoiceForUser(a.userId, created.data.id);
    expect(invoice.grandTotal.toString()).toBe("525"); // 500 + 5% VAT
    expect(invoice.items[0]?.productId).toBe(product.data.id);
  });
});

describe("issue flow", () => {
  it("issues the next number, freezes a snapshot, increments the counter; second issue fails", async () => {
    const a = await makeAccount();
    const customerId = await makeCustomer(a.userId);
    const std = await stdRate(a.businessId);
    const zero = await zeroRate(a.businessId);

    const created = await createInvoice(a.userId, draftInput(customerId, std.id, zero.id));
    if (!created.ok) throw new Error("create failed");
    const id = created.data.id;

    const issued = await issueInvoice(a.userId, id);
    expect(issued.ok).toBe(true);
    if (!issued.ok) throw new Error("issue failed");
    expect(issued.data.number).toBe("INV-0001");

    const { invoice } = await getInvoiceForUser(a.userId, id);
    expect(invoice.status).toBe("ISSUED");
    expect(invoice.number).toBe("INV-0001");
    expect(invoice.grandTotal.toString()).toBe("239");
    expect(invoice.balance.toString()).toBe("239");

    const business = await prisma.business.findUnique({ where: { id: a.businessId } });
    expect(business?.nextInvoiceNumber).toBe(2);

    const snapshot = await prisma.invoiceSnapshot.findUnique({ where: { invoiceId: id } });
    expect(snapshot).not.toBeNull();
    const payload = snapshot?.payload as {
      invoice: { number: string; grandTotal: string };
      business: { name: string };
      customer: { name: string };
      items: Array<{ description: string; lineTotal: string }>;
    };
    expect(payload.invoice.number).toBe("INV-0001");
    expect(payload.invoice.grandTotal).toBe("239");
    expect(payload.business.name).toContain("Phase 3");
    expect(payload.customer.name).toBe("Acme Corp");
    expect(payload.items).toHaveLength(2);
    expect(payload.items[0]?.lineTotal).toBe("189");
    expect(payload.items[1]?.lineTotal).toBe("50");

    const second = await issueInvoice(a.userId, id);
    expect(second.ok).toBe(false);
    expect(second.ok === false && second.error).toMatch(/only a draft/i);

    // Issued invoices can no longer be edited or deleted.
    const updated = await updateInvoice(a.userId, id, draftInput(customerId, std.id, zero.id));
    expect(updated.ok).toBe(false);
    const deleted = await deleteInvoice(a.userId, id);
    expect(deleted.ok).toBe(false);
  });

  it("the second invoice takes INV-0002 and the snapshot stays frozen after edits", async () => {
    const a = await makeAccount();
    const customerId = await makeCustomer(a.userId);
    const std = await stdRate(a.businessId);
    const zero = await zeroRate(a.businessId);

    const first = await createInvoice(a.userId, draftInput(customerId, std.id, zero.id));
    if (!first.ok) throw new Error("create failed");
    expect((await issueInvoice(a.userId, first.data.id)).ok).toBe(true);

    const second = await createInvoice(a.userId, draftInput(customerId, std.id, zero.id));
    if (!second.ok) throw new Error("create failed");
    const issued = await issueInvoice(a.userId, second.data.id);
    expect(issued.ok).toBe(true);
    if (!issued.ok) throw new Error("issue failed");
    expect(issued.data.number).toBe("INV-0002");

    // Rename the customer and the business — the frozen snapshot must
    // still carry the names from issue time.
    await prisma.customer.update({
      where: { id: customerId },
      data: { name: "Renamed Corp", companyName: "Renamed Corp" },
    });
    const snapshot = await prisma.invoiceSnapshot.findUnique({
      where: { invoiceId: second.data.id },
    });
    const payload = snapshot?.payload as { customer: { name: string } };
    expect(payload.customer.name).toBe("Acme Corp");

    // The detail endpoint renders the snapshot for issued invoices.
    const detail = await getInvoiceDetail(a.userId, second.data.id);
    expect(detail.invoice.snapshot).not.toBeNull();
  });

  it("MEMBER cannot issue or void; ADMIN can", async () => {
    const a = await makeAccount();
    const memberId = await makeMember(a.businessId, "MEMBER");
    const adminId = await makeMember(a.businessId, "ADMIN");
    const customerId = await makeCustomer(a.userId);
    const std = await stdRate(a.businessId);
    const zero = await zeroRate(a.businessId);

    const created = await createInvoice(a.userId, draftInput(customerId, std.id, zero.id));
    if (!created.ok) throw new Error("create failed");
    const id = created.data.id;

    await expect(issueInvoice(memberId, id)).rejects.toBeInstanceOf(TenantError);
    const issued = await issueInvoice(adminId, id);
    expect(issued.ok).toBe(true);

    await expect(voidInvoice(memberId, id)).rejects.toBeInstanceOf(TenantError);
    const voided = await voidInvoice(adminId, id);
    expect(voided.ok).toBe(true);
    const { invoice } = await getInvoiceForUser(a.userId, id);
    expect(invoice.status).toBe("CANCELLED");
    // The number stays consumed — a new invoice still takes the next one.
    const business = await prisma.business.findUnique({ where: { id: a.businessId } });
    expect(business?.nextInvoiceNumber).toBe(2);
  });

  it("void rules: only issued + unpaid can be voided", async () => {
    const a = await makeAccount();
    const customerId = await makeCustomer(a.userId);
    const std = await stdRate(a.businessId);
    const zero = await zeroRate(a.businessId);

    const draft = await createInvoice(a.userId, draftInput(customerId, std.id, zero.id));
    if (!draft.ok) throw new Error("create failed");
    const voidDraft = await voidInvoice(a.userId, draft.data.id);
    expect(voidDraft.ok).toBe(false);

    const issued = await issueInvoice(a.userId, draft.data.id);
    expect(issued.ok).toBe(true);
    // Simulate a partial payment (Phase 5 will do this properly).
    await prisma.invoice.update({
      where: { id: draft.data.id },
      data: { amountPaid: new Prisma.Decimal(100), balance: new Prisma.Decimal(139) },
    });
    const voidPaid = await voidInvoice(a.userId, draft.data.id);
    expect(voidPaid.ok).toBe(false);
    expect(voidPaid.ok === false && voidPaid.error).toMatch(/payments/i);
  });
});

describe("invoice reads and tenant isolation", () => {
  it("list filters by status and search; overdue is derived, not stored", async () => {
    const a = await makeAccount();
    const customerId = await makeCustomer(a.userId);
    const std = await stdRate(a.businessId);
    const zero = await zeroRate(a.businessId);

    const draft = await createInvoice(a.userId, draftInput(customerId, std.id, zero.id));
    if (!draft.ok) throw new Error("create failed");
    const issued = await createInvoice(a.userId, {
      ...draftInput(customerId, std.id, zero.id),
      issueDate: "2019-12-01",
      dueDate: "2020-01-01", // long past due
    });
    if (!issued.ok) throw new Error("create failed");
    await issueInvoice(a.userId, issued.data.id);

    const all = await listInvoices(a.userId, {});
    expect(all.total).toBe(2);
    const drafts = await listInvoices(a.userId, { status: "DRAFT" });
    expect(drafts.total).toBe(1);
    const found = await listInvoices(a.userId, { q: "INV-0001" });
    expect(found.total).toBe(1);
    expect(found.invoices[0]?.isOverdue).toBe(true);
    const notOverdue = await listInvoices(a.userId, { status: "ISSUED" });
    expect(notOverdue.invoices[0]?.isOverdue).toBe(true);

    const detail = await getInvoiceDetail(a.userId, issued.data.id);
    expect(detail.isOverdue).toBe(true);
    expect(detail.daysOverdue).toBeGreaterThan(1000);
  });

  it("B cannot see, read, update, issue or void A's invoice", async () => {
    const a = await makeAccount();
    const b = await makeAccount();
    const customerId = await makeCustomer(a.userId);
    const std = await stdRate(a.businessId);
    const zero = await zeroRate(a.businessId);

    const created = await createInvoice(a.userId, draftInput(customerId, std.id, zero.id));
    if (!created.ok) throw new Error("create failed");
    const id = created.data.id;

    expect((await listInvoices(b.userId, {})).invoices).toEqual([]);
    await expect(getInvoiceForUser(b.userId, id)).rejects.toThrow("Invoice not found");
    await expect(
      updateInvoice(b.userId, id, draftInput(customerId, std.id, zero.id)),
    ).rejects.toThrow("Invoice not found");
    await expect(issueInvoice(b.userId, id)).rejects.toThrow("Invoice not found");
    await expect(voidInvoice(b.userId, id)).rejects.toThrow("Invoice not found");
    await expect(deleteInvoice(b.userId, id)).rejects.toThrow("Invoice not found");
  });

  it("rejects a customer or tax rate from another business", async () => {
    const a = await makeAccount();
    const b = await makeAccount();
    const bCustomerId = await makeCustomer(b.userId);
    const aStd = await stdRate(a.businessId);
    const aZero = await zeroRate(a.businessId);
    const bStd = await stdRate(b.businessId);

    const wrongCustomer = await createInvoice(
      a.userId,
      draftInput(bCustomerId, aStd.id, aZero.id),
    );
    expect(wrongCustomer.ok).toBe(false);

    const wrongRate = await createInvoice(a.userId, {
      customerId: await makeCustomer(a.userId),
      issueDate: "2026-11-24",
      dueDate: "2026-12-24",
      template: "classic" as const,
      locale: "en" as const,
      items: [
        {
          description: "Bad rate",
          quantity: "1",
          unit: "pcs",
          unitPrice: "10",
          discountType: "NONE" as const,
          discountValue: "0",
          taxRateId: bStd.id,
          taxCategory: "STANDARD" as const,
          taxInclusive: false,
        },
      ],
    });
    expect(wrongRate.ok).toBe(false);
  });
});
