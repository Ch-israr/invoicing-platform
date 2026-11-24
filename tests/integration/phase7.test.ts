import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { registerUserAccount } from "@/server/services/auth.service";
import { createCustomer } from "@/server/services/customer.service";
import {
  createInvoice,
  daysOverdue,
  getInvoiceForUser,
  issueInvoice,
} from "@/server/services/invoice.service";
import { recordPayment } from "@/server/services/payment.service";
import {
  createQuotation,
  getQuotationDetail,
  sendQuotation,
} from "@/server/services/quotation.service";
import { createCreditNote } from "@/server/services/credit-note.service";
import { createExpense, listExpenseCategories } from "@/server/services/expense.service";
import {
  createPortalToken,
  decideQuotationViaPortal,
  getPortalInvoice,
  getPortalQuotation,
  hashPortalToken,
  listPortalTokens,
  revokePortalToken,
  verifyPortalToken,
} from "@/server/services/portal.service";
import {
  getCustomerBalances,
  getOverdueReport,
  getProductRevenue,
  getRevenueReport,
  getVatReport,
  parseDateRange,
} from "@/server/services/report.service";

const uid = () => Math.random().toString(36).slice(2, 10);
/** Unique IP per test so the in-memory portal rate limit never leaks across tests. */
const ip = () => `10.0.${uid().slice(0, 3)}.${Math.floor(Math.random() * 200) + 1}`;

async function makeAccount() {
  const result = await registerUserAccount({
    name: "Phase 7 Test",
    businessName: `Phase 7 ${uid()} LLC`,
    email: `p7-${uid()}@example.com`,
    password: "TestPass123!",
  });
  if (!result.ok) throw new Error(`setup failed: ${result.error}`);
  return result as unknown as { userId: string; businessId: string };
}

async function makeCustomer(userId: string, name = "Acme Corp") {
  const created = await createCustomer(userId, {
    type: "COMPANY",
    name,
    companyName: name,
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

async function zeroRate(businessId: string) {
  const rate = await prisma.taxRate.findFirst({ where: { businessId, code: "ZERO" } });
  if (!rate) throw new Error("ZERO rate missing");
  return rate;
}

/**
 * Hand-calculated reference invoice (same numbers as Phase 3/5):
 *   L1: 2 × 100.00, 10% discount, STD 5% → net 200, disc 20, taxable 180, VAT 9, total 189
 *   L2: 1 × 50.00, ZERO 0% → taxable 50, VAT 0, total 50
 *   subtotal 250, discount 20, taxable 230, VAT 9, grand 239, balance 239
 * A 1-unit credit of L1 reverses 100 − 10% + 5% VAT = 94.50.
 */
function draftInput(
  customerId: string,
  stdId: string,
  zeroId: string,
  overrides: { issueDate?: string; dueDate?: string; productId?: string } = {},
) {
  return {
    customerId,
    issueDate: overrides.issueDate ?? "2026-11-10",
    dueDate: overrides.dueDate ?? "2026-12-10",
    supplyDate: "2026-11-05",
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
        productId: overrides.productId,
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

async function makeIssuedInvoice(
  userId: string,
  customerId: string,
  overrides: { issueDate?: string; dueDate?: string; productId?: string } = {},
) {
  const a = await prisma.businessMembership.findFirst({
    where: { userId },
    select: { businessId: true },
  });
  if (!a) throw new Error("no business");
  const std = await stdRate(a.businessId);
  const zero = await zeroRate(a.businessId);
  const created = await createInvoice(
    userId,
    draftInput(customerId, std.id, zero.id, overrides),
  );
  if (!created.ok) throw new Error(`create failed: ${created.error}`);
  const issued = await issueInvoice(userId, created.data.id);
  if (!issued.ok) throw new Error(`issue failed: ${issued.error}`);
  const { invoice } = await getInvoiceForUser(userId, created.data.id);
  return invoice;
}

async function makeSentQuotation(userId: string, customerId: string) {
  const a = await prisma.businessMembership.findFirst({
    where: { userId },
    select: { businessId: true },
  });
  if (!a) throw new Error("no business");
  const std = await stdRate(a.businessId);
  const zero = await zeroRate(a.businessId);
  const input = draftInput(customerId, std.id, zero.id);
  const { dueDate, supplyDate, template, locale, ...rest } = input;
  void dueDate;
  void supplyDate;
  void template;
  void locale;
  const created = await createQuotation(userId, { ...rest, expiryDate: "2026-12-24" });
  if (!created.ok) throw new Error(`quotation create failed: ${created.error}`);
  const sent = await sendQuotation(userId, created.data.id);
  if (!sent.ok) throw new Error(`quotation send failed: ${sent.error}`);
  return created.data.id;
}

/**
 * Seeded ledger for the report tests (all amounts hand-calculated):
 *   Inv 1 (Nov 10, due Dec 10): grand 239.00, VAT 9.00
 *     − payment 100.00 on Nov 15
 *     − credit note 94.50 (1 × L1)
 *     → balance 44.50, PARTIALLY_PAID
 *   Inv 2 (Oct 5, due Oct 20): grand 239.00, VAT 9.00, no payment
 *     → balance 239.00, overdue
 *   Expense (Nov 5, Office): amount 100.00, VAT 5.00
 *   Product "Consulting" linked to Inv 1 L1 (2 × 100, line total 189.00)
 */
async function seedLedger(userId: string) {
  const a = await prisma.businessMembership.findFirst({
    where: { userId },
    select: { businessId: true },
  });
  if (!a) throw new Error("no business");
  const customerId = await makeCustomer(userId);
  const product = await prisma.product.create({
    data: {
      businessId: a.businessId,
      name: "Consulting",
      sku: "CONS-1",
      price: 100,
    },
  });
  const inv1 = await makeIssuedInvoice(userId, customerId, {
    productId: product.id,
  });
  const inv2 = await makeIssuedInvoice(userId, customerId, {
    issueDate: "2026-10-05",
    dueDate: "2026-10-20",
  });
  const paid = await recordPayment(userId, inv1.id, {
    date: "2026-11-15",
    amount: "100",
    method: "BANK_TRANSFER",
  });
  if (!paid.ok) throw new Error(`payment failed: ${paid.error}`);
  const l1 = (await getInvoiceForUser(userId, inv1.id)).invoice.items.find(
    (i) => i.description === "Consulting",
  );
  if (!l1) throw new Error("L1 missing");
  const credit = await createCreditNote(userId, inv1.id, {
    reason: "Returned goods",
    items: [{ invoiceItemId: l1.id, quantity: "1" }],
  });
  if (!credit.ok) throw new Error(`credit failed: ${credit.error}`);
  const categories = await listExpenseCategories(userId);
  const office = categories.find((c) => c.name === "Office");
  if (!office) throw new Error("seeded Office category missing");
  const expense = await createExpense(userId, {
    title: "Office supplies",
    date: "2026-11-05",
    amount: "100",
    vatAmount: "5",
    categoryId: office.id,
    method: "BANK_TRANSFER",
  });
  if (!expense.ok) throw new Error(`expense failed: ${expense.error}`);
  return { customerId, product, inv1, inv2 };
}

// ---------------------------------------------------------------------------
// Portal
// ---------------------------------------------------------------------------

describe("portal tokens", () => {
  it("generates a token, stores only its hash, and verifies it", async () => {
    const a = await makeAccount();
    const customerId = await makeCustomer(a.userId);
    const inv = await makeIssuedInvoice(a.userId, customerId);
    const created = await createPortalToken(a.userId, { invoiceId: inv.id });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error(created.error);
    const { token, row } = created.data;
    expect(token.length).toBe(43);
    expect(row.scope).toBe(`invoice:${inv.id}`);
    // Only the hash is stored — the plaintext never appears in the row.
    const stored = await prisma.customerPortalToken.findUnique({ where: { id: row.id } });
    expect(stored?.tokenHash).toBe(hashPortalToken(token));
    expect(stored?.tokenHash).not.toBe(token);
    // Default expiry is 30 days out.
    const days = (stored!.expiresAt.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29);
    expect(days).toBeLessThan(31);

    const verified = await verifyPortalToken(token, ip());
    expect(verified.ok).toBe(true);
    if (!verified.ok) throw new Error(verified.error);
    expect(verified.context.kind).toBe("invoice");
    const data = await getPortalInvoice(verified.context, inv.id);
    expect(data?.invoice.id).toBe(inv.id);
    expect(data?.invoice.number).toBe(inv.number);
  });

  it("rejects an expired token with the generic message", async () => {
    const a = await makeAccount();
    const customerId = await makeCustomer(a.userId);
    const inv = await makeIssuedInvoice(a.userId, customerId);
    const created = await createPortalToken(a.userId, { invoiceId: inv.id });
    if (!created.ok) throw new Error(created.error);
    await prisma.customerPortalToken.update({
      where: { id: created.data.row.id },
      data: { expiresAt: new Date("2020-01-01") },
    });
    const verified = await verifyPortalToken(created.data.token, ip());
    expect(verified.ok).toBe(false);
    if (verified.ok) throw new Error("expired token verified");
    expect(verified.error).toBe("This link is no longer valid.");
  });

  it("rejects a revoked token with the same generic message", async () => {
    const a = await makeAccount();
    const customerId = await makeCustomer(a.userId);
    const inv = await makeIssuedInvoice(a.userId, customerId);
    const created = await createPortalToken(a.userId, { invoiceId: inv.id });
    if (!created.ok) throw new Error(created.error);
    const revoked = await revokePortalToken(a.userId, created.data.row.id);
    expect(revoked.ok).toBe(true);
    const verified = await verifyPortalToken(created.data.token, ip());
    expect(verified.ok).toBe(false);
    if (verified.ok) throw new Error("revoked token verified");
    expect(verified.error).toBe("This link is no longer valid.");
  });

  it("rejects an unknown token with the same generic message", async () => {
    const verified = await verifyPortalToken("a".repeat(43), ip());
    expect(verified.ok).toBe(false);
    if (verified.ok) throw new Error("unknown token verified");
    expect(verified.error).toBe("This link is no longer valid.");
  });

  it("a token cannot see another customer's invoice", async () => {
    const a = await makeAccount();
    const customerA = await makeCustomer(a.userId, "Alpha LLC");
    const customerB = await makeCustomer(a.userId, "Beta LLC");
    const invA = await makeIssuedInvoice(a.userId, customerA);
    const invB = await makeIssuedInvoice(a.userId, customerB);
    const created = await createPortalToken(a.userId, { invoiceId: invA.id });
    if (!created.ok) throw new Error(created.error);
    const verified = await verifyPortalToken(created.data.token, ip());
    expect(verified.ok).toBe(true);
    if (!verified.ok) throw new Error(verified.error);
    // Own invoice resolves; the other customer's invoice does not.
    expect((await getPortalInvoice(verified.context, invA.id))?.invoice.id).toBe(invA.id);
    expect(await getPortalInvoice(verified.context, invB.id)).toBeNull();

    // A customer-level token lists only that customer's documents.
    const custToken = await createPortalToken(a.userId, { customerId: customerA });
    if (!custToken.ok) throw new Error(custToken.error);
    const custVerified = await verifyPortalToken(custToken.data.token, ip());
    expect(custVerified.ok).toBe(true);
    if (!custVerified.ok) throw new Error(custVerified.error);
    expect((await getPortalInvoice(custVerified.context, invB.id))).toBeNull();
  });

  it("refuses to share a draft invoice", async () => {
    const a = await makeAccount();
    const customerId = await makeCustomer(a.userId);
    const b = await prisma.businessMembership.findFirst({
      where: { userId: a.userId },
      select: { businessId: true },
    });
    const std = await stdRate(b!.businessId);
    const zero = await zeroRate(b!.businessId);
    const draft = await createInvoice(a.userId, draftInput(customerId, std.id, zero.id));
    if (!draft.ok) throw new Error(draft.error);
    const created = await createPortalToken(a.userId, { invoiceId: draft.data.id });
    expect(created.ok).toBe(false);
  });

  it("lists tokens for a document", async () => {
    const a = await makeAccount();
    const customerId = await makeCustomer(a.userId);
    const inv = await makeIssuedInvoice(a.userId, customerId);
    await createPortalToken(a.userId, { invoiceId: inv.id, expiresInDays: 7 });
    await createPortalToken(a.userId, { invoiceId: inv.id, expiresInDays: 30 });
    const tokens = await listPortalTokens(a.userId, { invoiceId: inv.id });
    expect(tokens).toHaveLength(2);
    expect(tokens[0].scope).toBe(`invoice:${inv.id}`);
  });
});

describe("portal quotation decisions", () => {
  it("accepts a quotation via a quotation token", async () => {
    const a = await makeAccount();
    const customerId = await makeCustomer(a.userId);
    const qid = await makeSentQuotation(a.userId, customerId);
    const created = await createPortalToken(a.userId, { quotationId: qid });
    if (!created.ok) throw new Error(created.error);
    const decided = await decideQuotationViaPortal(
      created.data.token,
      ip(),
      qid,
      "ACCEPTED",
    );
    expect(decided.ok).toBe(true);
    const { quotation } = await getQuotationDetail(a.userId, qid);
    expect(quotation.status).toBe("ACCEPTED");
  });

  it("rejects a quotation via a quotation token", async () => {
    const a = await makeAccount();
    const customerId = await makeCustomer(a.userId);
    const qid = await makeSentQuotation(a.userId, customerId);
    const created = await createPortalToken(a.userId, { quotationId: qid });
    if (!created.ok) throw new Error(created.error);
    const decided = await decideQuotationViaPortal(
      created.data.token,
      ip(),
      qid,
      "REJECTED",
    );
    expect(decided.ok).toBe(true);
    const { quotation } = await getQuotationDetail(a.userId, qid);
    expect(quotation.status).toBe("REJECTED");
  });

  it("an invoice token cannot accept a quotation", async () => {
    const a = await makeAccount();
    const customerId = await makeCustomer(a.userId);
    const inv = await makeIssuedInvoice(a.userId, customerId);
    const qid = await makeSentQuotation(a.userId, customerId);
    const created = await createPortalToken(a.userId, { invoiceId: inv.id });
    if (!created.ok) throw new Error(created.error);
    const decided = await decideQuotationViaPortal(
      created.data.token,
      ip(),
      qid,
      "ACCEPTED",
    );
    expect(decided.ok).toBe(false);
    const { quotation } = await getQuotationDetail(a.userId, qid);
    expect(quotation.status).toBe("SENT");
  });

  it("a quotation token for one quotation cannot decide another", async () => {
    const a = await makeAccount();
    const customerId = await makeCustomer(a.userId);
    const q1 = await makeSentQuotation(a.userId, customerId);
    const q2 = await makeSentQuotation(a.userId, customerId);
    const created = await createPortalToken(a.userId, { quotationId: q1 });
    if (!created.ok) throw new Error(created.error);
    const decided = await decideQuotationViaPortal(
      created.data.token,
      ip(),
      q2,
      "ACCEPTED",
    );
    expect(decided.ok).toBe(false);
    const { quotation } = await getQuotationDetail(a.userId, q2);
    expect(quotation.status).toBe("SENT");
  });

  it("a customer token can accept that customer's quotation", async () => {
    const a = await makeAccount();
    const customerId = await makeCustomer(a.userId);
    const qid = await makeSentQuotation(a.userId, customerId);
    const created = await createPortalToken(a.userId, { customerId });
    if (!created.ok) throw new Error(created.error);
    const decided = await decideQuotationViaPortal(
      created.data.token,
      ip(),
      qid,
      "ACCEPTED",
    );
    expect(decided.ok).toBe(true);
    const { quotation } = await getQuotationDetail(a.userId, qid);
    expect(quotation.status).toBe("ACCEPTED");
  });

  it("portal quotation loads through its token", async () => {
    const a = await makeAccount();
    const customerId = await makeCustomer(a.userId);
    const qid = await makeSentQuotation(a.userId, customerId);
    const created = await createPortalToken(a.userId, { quotationId: qid });
    if (!created.ok) throw new Error(created.error);
    const verified = await verifyPortalToken(created.data.token, ip());
    expect(verified.ok).toBe(true);
    if (!verified.ok) throw new Error(verified.error);
    const data = await getPortalQuotation(verified.context, qid);
    expect(data?.quotation.id).toBe(qid);
  });
});

describe("portal rate limiting", () => {
  it("allows the happy path and then blocks the 11th attempt in a minute", async () => {
    const a = await makeAccount();
    const customerId = await makeCustomer(a.userId);
    const inv = await makeIssuedInvoice(a.userId, customerId);
    const created = await createPortalToken(a.userId, { invoiceId: inv.id });
    if (!created.ok) throw new Error(created.error);
    const testIp = ip();
    for (let i = 0; i < 10; i++) {
      const v = await verifyPortalToken(created.data.token, testIp);
      expect(v.ok).toBe(true);
    }
    const blocked = await verifyPortalToken(created.data.token, testIp);
    expect(blocked.ok).toBe(false);
    if (blocked.ok) throw new Error("11th attempt not blocked");
    expect(blocked.rateLimited).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Reports — totals must tie exactly to the seeded ledger
// ---------------------------------------------------------------------------

const NOV = parseDateRange({ from: "2026-11-01", to: "2026-11-30" });

describe("revenue report", () => {
  it("ties invoiced / paid / credited / outstanding to the ledger", async () => {
    const a = await makeAccount();
    await seedLedger(a.userId);
    const r = await getRevenueReport(a.userId, NOV);
    // Invoiced: Inv 1 only (239.00); Inv 2 is October.
    expect(r.invoiced.toString()).toBe("239");
    expect(r.invoicedCount).toBe(1);
    expect(r.paid.toString()).toBe("100");
    expect(r.paidCount).toBe(1);
    expect(r.credited.toString()).toBe("94.5");
    // Outstanding in range: Inv 1 balance 44.50 (239 − 100 − 94.50).
    expect(r.outstanding.toString()).toBe("44.5");
    expect(r.monthly).toHaveLength(1);
    expect(r.monthly[0].month).toBe("2026-11");
    expect(r.monthly[0].invoiced.toString()).toBe("239");
    expect(r.monthly[0].paid.toString()).toBe("100");
  });
});

describe("VAT report", () => {
  it("output minus input VAT, from actual tax amounts", async () => {
    const a = await makeAccount();
    await seedLedger(a.userId);
    const r = await getVatReport(a.userId, NOV);
    // Output: Inv 1 VAT 9.00 (Inv 2 is October). Input: expense VAT 5.00.
    expect(r.outputVat.toString()).toBe("9");
    expect(r.inputVat.toString()).toBe("5");
    expect(r.netVat.toString()).toBe("4");
    expect(r.monthly).toHaveLength(1);
    expect(r.monthly[0].outputVat.toString()).toBe("9");
    expect(r.monthly[0].inputVat.toString()).toBe("5");
  });
});

describe("overdue report", () => {
  it("lists only past-due open invoices, worst first", async () => {
    const a = await makeAccount();
    const { inv2 } = await seedLedger(a.userId);
    const r = await getOverdueReport(a.userId);
    expect(r.count).toBe(1);
    expect(r.rows).toHaveLength(1);
    const row = r.rows[0];
    expect(row.invoiceId).toBe(inv2.id);
    expect(row.balance.toString()).toBe("239");
    expect(row.daysOverdue).toBe(daysOverdue(new Date("2026-10-20")));
    expect(row.daysOverdue).toBeGreaterThan(0);
    expect(r.totalBalance.toString()).toBe("239");
  });
});

describe("customer balances", () => {
  it("per-customer invoiced / paid / credited / outstanding", async () => {
    const a = await makeAccount();
    await seedLedger(a.userId);
    const { rows, totals } = await getCustomerBalances(a.userId, NOV);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.customerName).toBe("Acme Corp");
    expect(row.invoiced.toString()).toBe("239");
    expect(row.paid.toString()).toBe("100");
    expect(row.credited.toString()).toBe("94.5");
    // Outstanding is the live balance of ALL open invoices:
    // Inv 1 44.50 + Inv 2 239.00 = 283.50.
    expect(row.outstanding.toString()).toBe("283.5");
    expect(totals.invoiced.toString()).toBe("239");
    expect(totals.outstanding.toString()).toBe("283.5");
  });
});

describe("product revenue", () => {
  it("quantity and line totals per product from issued invoices", async () => {
    const a = await makeAccount();
    await seedLedger(a.userId);
    const { rows, totalRevenue, totalQuantity } = await getProductRevenue(a.userId, NOV);
    expect(rows).toHaveLength(2);
    // Consulting: 2 × 100, 10% discount, 5% VAT → line total 189.00.
    const consulting = rows.find((r) => r.productName === "Consulting");
    expect(consulting?.quantity.toString()).toBe("2");
    expect(consulting?.revenue.toString()).toBe("189");
    expect(consulting?.invoices).toBe(1);
    expect(consulting?.sku).toBe("CONS-1");
    // L2 has no product → custom lines: 1 × 50 = 50.00.
    const custom = rows.find((r) => r.productId === null);
    expect(custom?.quantity.toString()).toBe("1");
    expect(custom?.revenue.toString()).toBe("50");
    expect(totalRevenue.toString()).toBe("239");
    expect(totalQuantity.toString()).toBe("3");
  });
});
