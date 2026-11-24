import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { TenantError } from "@/lib/tenant";
import { registerUserAccount } from "@/server/services/auth.service";
import { createCustomer } from "@/server/services/customer.service";
import {
  createInvoice,
  getInvoiceDetail,
  getInvoiceForUser,
  issueInvoice,
  voidInvoice,
} from "@/server/services/invoice.service";
import {
  deletePayment,
  getReceiptData,
  listPayments,
  recordPayment,
  recordRefund,
} from "@/server/services/payment.service";
import {
  acceptQuotation,
  convertQuotationToInvoice,
  createQuotation,
  expireQuotation,
  getQuotationDetail,
  rejectQuotation,
  sendQuotation,
} from "@/server/services/quotation.service";
import {
  cancelCreditNote,
  createCreditNote,
  getCreditNoteDetail,
} from "@/server/services/credit-note.service";

const uid = () => Math.random().toString(36).slice(2, 10);

async function makeAccount() {
  const result = await registerUserAccount({
    name: "Phase 5 Test",
    businessName: `Phase 5 ${uid()} LLC`,
    email: `p5-${uid()}@example.com`,
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
 * Hand-calculated reference invoice (same numbers as Phase 3):
 *   L1: 2 × 100.00, 10% discount, STD 5% → net 200, disc 20, taxable 180, VAT 9, total 189
 *   L2: 1 × 50.00, ZERO 0% → taxable 50, VAT 0, total 50
 *   subtotal 250, discount 20, taxable 230, VAT 9, grand 239, balance 239
 * A 1-unit credit of L1 reverses 100 − 10% + 5% VAT = 94.50.
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

function quotationInput(customerId: string, stdId: string, zeroId: string) {
  const { dueDate, supplyDate, template, locale, ...rest } = draftInput(customerId, stdId, zeroId);
  void dueDate;
  void supplyDate;
  void template;
  void locale;
  return { ...rest, expiryDate: "2026-12-24" };
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
  const { invoice } = await getInvoiceForUser(userId, created.data.id);
  return { invoice, customerId };
}

async function makeDraftInvoice(userId: string) {
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
  return created.data.id;
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

describe("payments", () => {
  it("partial payment moves status to PARTIALLY_PAID with the exact balance", async () => {
    const a = await makeAccount();
    const { invoice } = await makeIssuedInvoice(a.userId);
    const paid = await recordPayment(a.userId, invoice.id, {
      date: "2026-11-24",
      amount: "100",
      method: "BANK_TRANSFER",
      reference: "TRF-1",
    });
    expect(paid.ok).toBe(true);
    if (!paid.ok) throw new Error(paid.error);

    const { invoice: after } = await getInvoiceForUser(a.userId, invoice.id);
    expect(after.status).toBe("PARTIALLY_PAID");
    expect(after.amountPaid.toString()).toBe("100");
    expect(after.balance.toString()).toBe("139");
    expect(after.grandTotal.toString()).toBe("239");

    const allocations = await prisma.paymentAllocation.findMany({
      where: { invoiceId: invoice.id },
    });
    expect(allocations).toHaveLength(1);
    expect(allocations[0]?.amount.toString()).toBe("100");

    const listed = await listPayments(a.userId, {});
    expect(listed.total).toBe(1);
    expect(listed.payments[0]?.reference).toBe("TRF-1");
  });

  it("full payment moves status to PAID with zero balance", async () => {
    const a = await makeAccount();
    const { invoice } = await makeIssuedInvoice(a.userId);
    await recordPayment(a.userId, invoice.id, { date: "2026-11-24", amount: "100", method: "CASH" });
    const paid = await recordPayment(a.userId, invoice.id, { date: "2026-11-25", amount: "139", method: "CARD" });
    expect(paid.ok).toBe(true);
    const { invoice: after } = await getInvoiceForUser(a.userId, invoice.id);
    expect(after.status).toBe("PAID");
    expect(after.amountPaid.toString()).toBe("239");
    expect(after.balance.toString()).toBe("0");
  });

  it("overpayment is rejected and the balance is unchanged", async () => {
    const a = await makeAccount();
    const { invoice } = await makeIssuedInvoice(a.userId);
    const tooMuch = await recordPayment(a.userId, invoice.id, { date: "2026-11-24", amount: "240", method: "CASH" });
    expect(tooMuch.ok).toBe(false);
    await recordPayment(a.userId, invoice.id, { date: "2026-11-24", amount: "100", method: "CASH" });
    const second = await recordPayment(a.userId, invoice.id, { date: "2026-11-24", amount: "200", method: "CASH" });
    expect(second.ok).toBe(false);
    const { invoice: after } = await getInvoiceForUser(a.userId, invoice.id);
    expect(after.balance.toString()).toBe("139");
    expect(after.status).toBe("PARTIALLY_PAID");
  });

  it("payments against a draft are rejected", async () => {
    const a = await makeAccount();
    const draftId = await makeDraftInvoice(a.userId);
    const result = await recordPayment(a.userId, draftId, { date: "2026-11-24", amount: "10", method: "CASH" });
    expect(result.ok).toBe(false);
  });

  it("deleting a payment reverses amountPaid, balance and status", async () => {
    const a = await makeAccount();
    const { invoice } = await makeIssuedInvoice(a.userId);
    const paid = await recordPayment(a.userId, invoice.id, { date: "2026-11-24", amount: "100", method: "CASH" });
    if (!paid.ok) throw new Error(paid.error);
    const deleted = await deletePayment(a.userId, paid.data.id);
    expect(deleted.ok).toBe(true);
    const { invoice: after } = await getInvoiceForUser(a.userId, invoice.id);
    expect(after.status).toBe("ISSUED");
    expect(after.amountPaid.toString()).toBe("0");
    expect(after.balance.toString()).toBe("239");
    expect(await prisma.payment.count({ where: { invoiceId: invoice.id } })).toBe(0);
    expect(await prisma.paymentAllocation.count({ where: { invoiceId: invoice.id } })).toBe(0);
  });

  it("VIEWER cannot record and MEMBER cannot delete (RBAC)", async () => {
    const a = await makeAccount();
    const viewerId = await makeMember(a.businessId, "VIEWER");
    const memberId = await makeMember(a.businessId, "MEMBER");
    const { invoice } = await makeIssuedInvoice(a.userId);
    await expect(
      recordPayment(viewerId, invoice.id, { date: "2026-11-24", amount: "10", method: "CASH" }),
    ).rejects.toBeInstanceOf(TenantError);
    const paid = await recordPayment(a.userId, invoice.id, { date: "2026-11-24", amount: "100", method: "CASH" });
    if (!paid.ok) throw new Error(paid.error);
    await expect(deletePayment(memberId, paid.data.id)).rejects.toBeInstanceOf(TenantError);
  });

  it("receipt data shows the payment and the ledger state", async () => {
    const a = await makeAccount();
    const { invoice } = await makeIssuedInvoice(a.userId);
    const paid = await recordPayment(a.userId, invoice.id, { date: "2026-11-24", amount: "100", method: "BANK_TRANSFER", reference: "R-9" });
    if (!paid.ok) throw new Error(paid.error);
    const receipt = await getReceiptData(a.userId, paid.data.id);
    expect(receipt.payment.reference).toBe("R-9");
    expect(receipt.invoice.number).toBe(invoice.number);
    expect(receipt.totalPaid.toString()).toBe("100");
    expect(receipt.balance.toString()).toBe("139");
    expect(receipt.customer.name).toBe("Acme Corp");
  });
});

// ---------------------------------------------------------------------------
// Refunds
// ---------------------------------------------------------------------------

describe("refunds", () => {
  it("a refund reduces net paid and moves status back to PARTIALLY_PAID", async () => {
    const a = await makeAccount();
    const { invoice } = await makeIssuedInvoice(a.userId);
    const paid = await recordPayment(a.userId, invoice.id, { date: "2026-11-24", amount: "239", method: "CARD" });
    if (!paid.ok) throw new Error(paid.error);
    const refunded = await recordRefund(a.userId, paid.data.id, {
      date: "2026-11-25",
      amount: "39",
      reason: "Customer overpaid by card",
    });
    expect(refunded.ok).toBe(true);
    const { invoice: after } = await getInvoiceForUser(a.userId, invoice.id);
    expect(after.status).toBe("PARTIALLY_PAID");
    expect(after.amountPaid.toString()).toBe("200");
    expect(after.balance.toString()).toBe("39");
  });

  it("a refund cannot exceed the unrefunded amount and needs a reason", async () => {
    const a = await makeAccount();
    const { invoice } = await makeIssuedInvoice(a.userId);
    const paid = await recordPayment(a.userId, invoice.id, { date: "2026-11-24", amount: "100", method: "CASH" });
    if (!paid.ok) throw new Error(paid.error);
    const tooMuch = await recordRefund(a.userId, paid.data.id, { date: "2026-11-25", amount: "101", reason: "x" });
    expect(tooMuch.ok).toBe(false);
    const noReason = await recordRefund(a.userId, paid.data.id, { date: "2026-11-25", amount: "10", reason: "" });
    expect(noReason.ok).toBe(false);
    const ok = await recordRefund(a.userId, paid.data.id, { date: "2026-11-25", amount: "100", reason: "Full refund" });
    expect(ok.ok).toBe(true);
    const { invoice: after } = await getInvoiceForUser(a.userId, invoice.id);
    expect(after.status).toBe("ISSUED");
    expect(after.amountPaid.toString()).toBe("0");
    expect(after.balance.toString()).toBe("239");
  });

  it("a payment with refunds cannot be deleted", async () => {
    const a = await makeAccount();
    const { invoice } = await makeIssuedInvoice(a.userId);
    const paid = await recordPayment(a.userId, invoice.id, { date: "2026-11-24", amount: "100", method: "CASH" });
    if (!paid.ok) throw new Error(paid.error);
    await recordRefund(a.userId, paid.data.id, { date: "2026-11-25", amount: "10", reason: "Partial" });
    const deleted = await deletePayment(a.userId, paid.data.id);
    expect(deleted.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Quotations
// ---------------------------------------------------------------------------

describe("quotations", () => {
  it("creates a draft with server-calculated totals", async () => {
    const a = await makeAccount();
    const customerId = await makeCustomer(a.userId);
    const std = await stdRate(a.businessId);
    const zero = await zeroRate(a.businessId);
    const created = await createQuotation(a.userId, quotationInput(customerId, std.id, zero.id));
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error(created.error);
    const { quotation } = await getQuotationDetail(a.userId, created.data.id);
    expect(quotation.status).toBe("DRAFT");
    expect(quotation.number.startsWith("DRAFT-")).toBe(true);
    expect(quotation.grandTotal.toString()).toBe("239");
    expect(quotation.subtotal.toString()).toBe("250");
    expect(quotation.vatAmount.toString()).toBe("9");
  });

  it("send assigns QTN-0001 and increments the counter", async () => {
    const a = await makeAccount();
    const customerId = await makeCustomer(a.userId);
    const std = await stdRate(a.businessId);
    const zero = await zeroRate(a.businessId);
    const q1 = await createQuotation(a.userId, quotationInput(customerId, std.id, zero.id));
    const q2 = await createQuotation(a.userId, quotationInput(customerId, std.id, zero.id));
    if (!q1.ok || !q2.ok) throw new Error("create failed");
    const sent1 = await sendQuotation(a.userId, q1.data.id);
    expect(sent1.ok).toBe(true);
    if (!sent1.ok) throw new Error(sent1.error);
    expect(sent1.data.number).toBe("QTN-0001");
    const sent2 = await sendQuotation(a.userId, q2.data.id);
    expect(sent2.ok).toBe(true);
    if (!sent2.ok) throw new Error(sent2.error);
    expect(sent2.data.number).toBe("QTN-0002");
    const again = await sendQuotation(a.userId, q1.data.id);
    expect(again.ok).toBe(false);
  });

  it("accept / reject / expire only work from SENT", async () => {
    const a = await makeAccount();
    const customerId = await makeCustomer(a.userId);
    const std = await stdRate(a.businessId);
    const zero = await zeroRate(a.businessId);
    const q = await createQuotation(a.userId, quotationInput(customerId, std.id, zero.id));
    if (!q.ok) throw new Error("create failed");
    expect((await acceptQuotation(a.userId, q.data.id)).ok).toBe(false);
    await sendQuotation(a.userId, q.data.id);
    expect((await acceptQuotation(a.userId, q.data.id)).ok).toBe(true);
    const { quotation } = await getQuotationDetail(a.userId, q.data.id);
    expect(quotation.status).toBe("ACCEPTED");
    expect((await rejectQuotation(a.userId, q.data.id)).ok).toBe(false);
    expect((await expireQuotation(a.userId, q.data.id)).ok).toBe(false);

    const q2 = await createQuotation(a.userId, quotationInput(customerId, std.id, zero.id));
    if (!q2.ok) throw new Error("create failed");
    await sendQuotation(a.userId, q2.data.id);
    expect((await rejectQuotation(a.userId, q2.data.id)).ok).toBe(true);
    const q3 = await createQuotation(a.userId, quotationInput(customerId, std.id, zero.id));
    if (!q3.ok) throw new Error("create failed");
    await sendQuotation(a.userId, q3.data.id);
    expect((await expireQuotation(a.userId, q3.data.id)).ok).toBe(true);
  });

  it("converting creates a draft invoice with the same totals and links both ways", async () => {
    const a = await makeAccount();
    const customerId = await makeCustomer(a.userId);
    const std = await stdRate(a.businessId);
    const zero = await zeroRate(a.businessId);
    const q = await createQuotation(a.userId, quotationInput(customerId, std.id, zero.id));
    if (!q.ok) throw new Error("create failed");
    await sendQuotation(a.userId, q.data.id);
    const converted = await convertQuotationToInvoice(a.userId, q.data.id);
    expect(converted.ok).toBe(true);
    if (!converted.ok) throw new Error(converted.error);

    const { invoice } = await getInvoiceForUser(a.userId, converted.data.invoiceId);
    expect(invoice.status).toBe("DRAFT");
    expect(invoice.grandTotal.toString()).toBe("239");
    expect(invoice.subtotal.toString()).toBe("250");
    expect(invoice.vatAmount.toString()).toBe("9");
    expect(invoice.items).toHaveLength(2);
    expect(invoice.items[0]?.description).toBe("Consulting");
    expect(invoice.items[0]?.taxInclusive).toBe(false);
    expect(invoice.customerId).toBe(customerId);

    const { quotation } = await getQuotationDetail(a.userId, q.data.id);
    expect(quotation.status).toBe("ACCEPTED");
    expect(quotation.convertedInvoiceId).toBe(converted.data.invoiceId);
    expect(quotation.convertedInvoice?.id).toBe(converted.data.invoiceId);

    const again = await convertQuotationToInvoice(a.userId, q.data.id);
    expect(again.ok).toBe(false);
  });

  it("converting a draft fails", async () => {
    const a = await makeAccount();
    const customerId = await makeCustomer(a.userId);
    const std = await stdRate(a.businessId);
    const zero = await zeroRate(a.businessId);
    const q = await createQuotation(a.userId, quotationInput(customerId, std.id, zero.id));
    if (!q.ok) throw new Error("create failed");
    const converted = await convertQuotationToInvoice(a.userId, q.data.id);
    expect(converted.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Credit notes
// ---------------------------------------------------------------------------

describe("credit notes", () => {
  it("a partial credit reduces the balance and moves status to PARTIALLY_PAID", async () => {
    const a = await makeAccount();
    const { invoice } = await makeIssuedInvoice(a.userId);
    const l1 = invoice.items[0]!;
    // 1 unit of L1: 100 − 10% discount + 5% VAT = 94.50
    const created = await createCreditNote(a.userId, invoice.id, {
      reason: "Returned goods",
      items: [{ invoiceItemId: l1.id, quantity: "1" }],
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error(created.error);
    expect(created.data.number).toBe("CN-0001");
    const { note } = await getCreditNoteDetail(a.userId, created.data.id);
    expect(note.grandTotal.toString()).toBe("94.5");
    expect(note.subtotal.toString()).toBe("100");
    expect(note.vatAmount.toString()).toBe("4.5");
    const { invoice: after } = await getInvoiceForUser(a.userId, invoice.id);
    expect(after.balance.toString()).toBe("144.5");
    expect(after.status).toBe("PARTIALLY_PAID");
    expect(after.amountPaid.toString()).toBe("0");
  });

  it("a lowered credit price skips the original discount", async () => {
    const a = await makeAccount();
    const { invoice } = await makeIssuedInvoice(a.userId);
    const l2 = invoice.items[1]!;
    const created = await createCreditNote(a.userId, invoice.id, {
      reason: "Goodwill",
      items: [{ invoiceItemId: l2.id, quantity: "1", unitPrice: "25" }],
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error(created.error);
    const { note } = await getCreditNoteDetail(a.userId, created.data.id);
    expect(note.grandTotal.toString()).toBe("25");
  });

  it("quantity is capped at the remaining uncredited quantity", async () => {
    const a = await makeAccount();
    const { invoice } = await makeIssuedInvoice(a.userId);
    const l1 = invoice.items[0]!;
    const tooMany = await createCreditNote(a.userId, invoice.id, {
      reason: "Too many",
      items: [{ invoiceItemId: l1.id, quantity: "3" }],
    });
    expect(tooMany.ok).toBe(false);
    const one = await createCreditNote(a.userId, invoice.id, {
      reason: "One unit",
      items: [{ invoiceItemId: l1.id, quantity: "1" }],
    });
    expect(one.ok).toBe(true);
    const twoMore = await createCreditNote(a.userId, invoice.id, {
      reason: "Two more",
      items: [{ invoiceItemId: l1.id, quantity: "2" }],
    });
    expect(twoMore.ok).toBe(false);
  });

  it("the credit total can never exceed the outstanding balance", async () => {
    const a = await makeAccount();
    const { invoice } = await makeIssuedInvoice(a.userId);
    await recordPayment(a.userId, invoice.id, { date: "2026-11-24", amount: "100", method: "CASH" });
    const l1 = invoice.items[0]!;
    const l2 = invoice.items[1]!;
    // Full credit would be 239; balance is only 139.
    const created = await createCreditNote(a.userId, invoice.id, {
      reason: "Everything",
      items: [
        { invoiceItemId: l1.id, quantity: "2" },
        { invoiceItemId: l2.id, quantity: "1" },
      ],
    });
    expect(created.ok).toBe(false);
    const { invoice: after } = await getInvoiceForUser(a.userId, invoice.id);
    expect(after.balance.toString()).toBe("139");
  });

  it("a fully credited invoice keeps ISSUED with balance 0 (resolved, not paid)", async () => {
    const a = await makeAccount();
    const { invoice } = await makeIssuedInvoice(a.userId);
    const l1 = invoice.items[0]!;
    const l2 = invoice.items[1]!;
    const created = await createCreditNote(a.userId, invoice.id, {
      reason: "Full return",
      items: [
        { invoiceItemId: l1.id, quantity: "2" },
        { invoiceItemId: l2.id, quantity: "1" },
      ],
    });
    expect(created.ok).toBe(true);
    const { invoice: after, fullyCredited } = await getInvoiceDetail(a.userId, invoice.id);
    expect(after.balance.toString()).toBe("0");
    expect(after.status).toBe("ISSUED");
    expect(fullyCredited).toBe(true);
  });

  it("cancelling a credit note restores the balance and frees the quantities", async () => {
    const a = await makeAccount();
    const { invoice } = await makeIssuedInvoice(a.userId);
    const l1 = invoice.items[0]!;
    const created = await createCreditNote(a.userId, invoice.id, {
      reason: "Returned goods",
      items: [{ invoiceItemId: l1.id, quantity: "1" }],
    });
    if (!created.ok) throw new Error(created.error);
    const cancelled = await cancelCreditNote(a.userId, created.data.id);
    expect(cancelled.ok).toBe(true);
    const { invoice: after } = await getInvoiceForUser(a.userId, invoice.id);
    expect(after.balance.toString()).toBe("239");
    expect(after.status).toBe("ISSUED");
    const again = await createCreditNote(a.userId, invoice.id, {
      reason: "Returned goods again",
      items: [{ invoiceItemId: l1.id, quantity: "2" }],
    });
    expect(again.ok).toBe(true);
  });

  it("a fully paid invoice cannot be credited", async () => {
    const a = await makeAccount();
    const { invoice } = await makeIssuedInvoice(a.userId);
    await recordPayment(a.userId, invoice.id, { date: "2026-11-24", amount: "239", method: "CASH" });
    const l1 = invoice.items[0]!;
    const created = await createCreditNote(a.userId, invoice.id, {
      reason: "Too late",
      items: [{ invoiceItemId: l1.id, quantity: "1" }],
    });
    expect(created.ok).toBe(false);
  });

  it("a void is blocked once a credit note exists", async () => {
    const a = await makeAccount();
    const { invoice } = await makeIssuedInvoice(a.userId);
    const l1 = invoice.items[0]!;
    await createCreditNote(a.userId, invoice.id, {
      reason: "Partial",
      items: [{ invoiceItemId: l1.id, quantity: "1" }],
    });
    const result = await voidInvoice(a.userId, invoice.id);
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tenant isolation
// ---------------------------------------------------------------------------

describe("phase 5 tenant isolation", () => {
  it("another business cannot see or touch payments, quotations or credit notes", async () => {
    const a = await makeAccount();
    const b = await makeAccount();
    const { invoice } = await makeIssuedInvoice(a.userId);
    const paid = await recordPayment(a.userId, invoice.id, { date: "2026-11-24", amount: "50", method: "CASH" });
    if (!paid.ok) throw new Error(paid.error);
    await expect(recordPayment(b.userId, invoice.id, { date: "2026-11-24", amount: "10", method: "CASH" })).rejects.toBeInstanceOf(TenantError);
    await expect(deletePayment(b.userId, paid.data.id)).rejects.toBeInstanceOf(TenantError);
    await expect(getReceiptData(b.userId, paid.data.id)).rejects.toBeInstanceOf(TenantError);
    expect((await listPayments(b.userId, {})).total).toBe(0);

    const customerId = await makeCustomer(a.userId);
    const std = await stdRate(a.businessId);
    const zero = await zeroRate(a.businessId);
    const q = await createQuotation(a.userId, quotationInput(customerId, std.id, zero.id));
    if (!q.ok) throw new Error("create failed");
    await expect(getQuotationDetail(b.userId, q.data.id)).rejects.toBeInstanceOf(TenantError);
    await expect(sendQuotation(b.userId, q.data.id)).rejects.toBeInstanceOf(TenantError);

    const l1 = invoice.items[0]!;
    const note = await createCreditNote(a.userId, invoice.id, {
      reason: "Return",
      items: [{ invoiceItemId: l1.id, quantity: "1" }],
    });
    if (!note.ok) throw new Error(note.error);
    await expect(getCreditNoteDetail(b.userId, note.data.id)).rejects.toBeInstanceOf(TenantError);
    await expect(cancelCreditNote(b.userId, note.data.id)).rejects.toBeInstanceOf(TenantError);
  });
});
