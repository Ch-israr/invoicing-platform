import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { TenantError } from "@/lib/tenant";
import { registerUserAccount } from "@/server/services/auth.service";
import {
  getBusinessProfile,
  updateBusinessProfile,
} from "@/server/services/business.service";
import {
  createCustomer,
  deleteCustomer,
  getCustomerDetail,
  getCustomerForUser,
  listCustomers,
  updateCustomer,
} from "@/server/services/customer.service";
import {
  createCategory,
  createProduct,
  deleteProduct,
  exportProductsCsv,
  getProductForUser,
  importProductsCsv,
  listProducts,
  renameCategory,
  updateProduct,
} from "@/server/services/product.service";

const uid = () => Math.random().toString(36).slice(2, 10);

async function makeAccount() {
  const email = `p2-${uid()}@example.com`;
  const result = await registerUserAccount({
    name: "Phase 2 Test",
    businessName: `Phase 2 ${uid()} LLC`,
    email,
    password: "correct-horse-battery",
  });
  if (!result.ok) throw new Error(`setup failed: ${result.error}`);
  return result;
}

/** A second user who is only a VIEWER in the given business. */
async function makeViewer(businessId: string) {
  const user = await prisma.user.create({
    data: {
      name: "Viewer",
      email: `viewer-${uid()}@example.com`,
      passwordHash: "not-a-real-hash",
    },
  });
  await prisma.businessMembership.create({
    data: { userId: user.id, businessId, role: "VIEWER" },
  });
  return user.id;
}

function businessInput(overrides: Record<string, unknown> = {}) {
  return {
    name: "Updated Business LLC",
    country: "AE",
    currency: "AED",
    invoicePrefix: "INV",
    nextInvoiceNumber: 1,
    nextQuotationNumber: 1,
    nextCreditNoteNumber: 1,
    locale: "en",
    timezone: "Asia/Dubai",
    dateFormat: "DD/MM/YYYY",
    pdfTemplate: "classic",
    primaryColor: "#0f172a",
    emailProvider: "log",
    ...overrides,
  };
}

describe("business profile", () => {
  it("OWNER can update the profile and the change is audit-logged", async () => {
    const a = await makeAccount();
    const result = await updateBusinessProfile(
      a.userId,
      businessInput({ name: "Renamed Trading LLC", trn: "100123456700003", iban: "AE070331234567890123456" }),
    );
    expect(result).toEqual({ ok: true });

    const profile = await getBusinessProfile(a.userId);
    expect(profile?.business.name).toBe("Renamed Trading LLC");
    expect(profile?.business.trn).toBe("100123456700003");
    expect(profile?.business.iban).toBe("AE070331234567890123456");

    const log = await prisma.activityLog.findFirst({
      where: { businessId: a.businessId, action: "business.updated" },
    });
    expect(log).not.toBeNull();
    expect(log?.userId).toBe(a.userId);
  });

  it("VIEWER cannot update the profile (403, no change)", async () => {
    const a = await makeAccount();
    const viewerId = await makeViewer(a.businessId);
    await expect(
      updateBusinessProfile(viewerId, businessInput({ name: "Hacked Name" })),
    ).rejects.toBeInstanceOf(TenantError);
    const profile = await getBusinessProfile(a.userId);
    expect(profile?.business.name).not.toBe("Hacked Name");
  });

  it("rejects a default VAT rate from another business", async () => {
    const a = await makeAccount();
    const b = await makeAccount();
    const bRate = await prisma.taxRate.findFirst({ where: { businessId: b.businessId } });
    const result = await updateBusinessProfile(
      a.userId,
      businessInput({ defaultVatRateId: bRate?.id }),
    );
    expect(result.ok).toBe(false);
  });

  it("rejects an invalid invoice prefix", async () => {
    const a = await makeAccount();
    const result = await updateBusinessProfile(
      a.userId,
      businessInput({ invoicePrefix: "INV!!!" }),
    );
    expect(result.ok).toBe(false);
  });
});

describe("customers", () => {
  it("CRUD works and is scoped to the owner's business", async () => {
    const a = await makeAccount();
    const b = await makeAccount();

    const created = await createCustomer(a.userId, {
      type: "COMPANY",
      name: "Acme Corp",
      companyName: "Acme Corp",
      email: "billing@acme.example",
      country: "AE",
      status: "ACTIVE",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error("create failed");
    const id = created.data.id;

    // B cannot see, read, update or delete A's customer.
    expect((await listCustomers(b.userId, {})).customers).toEqual([]);
    await expect(getCustomerForUser(b.userId, id)).rejects.toThrow("Customer not found");
    await expect(
      updateCustomer(b.userId, id, {
        type: "COMPANY",
        name: "Hijacked",
        country: "AE",
        status: "ACTIVE",
      }),
    ).rejects.toThrow("Customer not found");
    await expect(deleteCustomer(b.userId, id)).rejects.toThrow("Customer not found");

    // A can update and sees it in search.
    const updated = await updateCustomer(a.userId, id, {
      type: "COMPANY",
      name: "Acme Corporation",
      companyName: "Acme Corporation",
      email: "billing@acme.example",
      country: "AE",
      status: "ACTIVE",
    });
    expect(updated.ok).toBe(true);
    const found = await listCustomers(a.userId, { q: "Acme Corp" });
    expect(found.total).toBe(1);
    expect(found.customers[0]?.name).toBe("Acme Corporation");

    const deleted = await deleteCustomer(a.userId, id);
    expect(deleted.ok).toBe(true);
    expect((await listCustomers(a.userId, {})).total).toBe(0);
  });

  it("cannot delete a customer that has invoices", async () => {
    const a = await makeAccount();
    const created = await createCustomer(a.userId, {
      type: "INDIVIDUAL",
      name: "Billed Person",
      country: "AE",
      status: "ACTIVE",
    });
    if (!created.ok) throw new Error("create failed");
    await prisma.invoice.create({
      data: {
        businessId: a.businessId,
        customerId: created.data.id,
        number: "INV-0001",
        status: "ISSUED",
        dueDate: new Date("2030-01-01"),
        grandTotal: new Prisma.Decimal(100),
        balance: new Prisma.Decimal(100),
      },
    });
    const result = await deleteCustomer(a.userId, created.data.id);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/cannot be deleted/i);
  });

  it("detail page stats come from real invoice and payment rows", async () => {
    const a = await makeAccount();
    const created = await createCustomer(a.userId, {
      type: "COMPANY",
      name: "Stats Co",
      country: "AE",
      status: "ACTIVE",
    });
    if (!created.ok) throw new Error("create failed");
    const customerId = created.data.id;

    const overdue = await prisma.invoice.create({
      data: {
        businessId: a.businessId,
        customerId,
        number: "INV-0001",
        status: "ISSUED",
        dueDate: new Date("2020-01-01"), // past due
        grandTotal: new Prisma.Decimal(500),
        amountPaid: new Prisma.Decimal(200),
        balance: new Prisma.Decimal(300),
      },
    });
    await prisma.invoice.create({
      data: {
        businessId: a.businessId,
        customerId,
        number: "INV-0002",
        status: "PAID",
        dueDate: new Date("2030-01-01"),
        grandTotal: new Prisma.Decimal(100),
        amountPaid: new Prisma.Decimal(100),
        balance: new Prisma.Decimal(0),
      },
    });
    await prisma.payment.create({
      data: {
        businessId: a.businessId,
        invoiceId: overdue.id,
        amount: new Prisma.Decimal(200),
        method: "BANK_TRANSFER",
      },
    });

    const detail = await getCustomerDetail(a.userId, customerId);
    expect(detail.stats.invoiceCount).toBe(2);
    expect(Number(detail.stats.totalBilled)).toBe(600);
    expect(Number(detail.stats.totalPaid)).toBe(300);
    expect(Number(detail.stats.outstanding)).toBe(300);
    expect(Number(detail.stats.overdueBalance)).toBe(300);
    expect(detail.stats.overdueCount).toBe(1);
    expect(detail.invoices).toHaveLength(2);
    expect(detail.payments).toHaveLength(1);
  });
});

describe("products", () => {
  it("rejects a negative price", async () => {
    const a = await makeAccount();
    const result = await createProduct(a.userId, {
      name: "Bad Item",
      unit: "pcs",
      price: "-5",
      taxCategory: "STANDARD",
      isActive: true,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a duplicate SKU in the same business but allows it in another", async () => {
    const a = await makeAccount();
    const b = await makeAccount();
    const input = {
      name: "Widget",
      sku: "W-001",
      unit: "pcs",
      price: "10.00",
      taxCategory: "STANDARD" as const,
      isActive: true,
    };
    expect((await createProduct(a.userId, input)).ok).toBe(true);
    const dup = await createProduct(a.userId, { ...input, name: "Widget 2" });
    expect(dup.ok).toBe(false);
    expect(dup.ok === false && dup.error).toMatch(/SKU "W-001" is already used/);
    expect((await createProduct(b.userId, input)).ok).toBe(true);
  });

  it("tenant isolation: B cannot read, update or delete A's product", async () => {
    const a = await makeAccount();
    const b = await makeAccount();
    const created = await createProduct(a.userId, {
      name: "Secret Item",
      unit: "pcs",
      price: "1.00",
      taxCategory: "STANDARD",
      isActive: true,
    });
    if (!created.ok) throw new Error("create failed");
    const id = created.data.id;

    expect((await listProducts(b.userId, {})).products).toEqual([]);
    await expect(getProductForUser(b.userId, id)).rejects.toThrow("Product not found");
    await expect(
      updateProduct(b.userId, id, {
        name: "Hijacked",
        unit: "pcs",
        price: "999",
        taxCategory: "STANDARD",
        isActive: true,
      }),
    ).rejects.toThrow("Product not found");
    await expect(deleteProduct(b.userId, id)).rejects.toThrow("Product not found");
  });

  it("categories are unique per business and rename enforces it", async () => {
    const a = await makeAccount();
    expect((await createCategory(a.userId, { name: "Services" })).ok).toBe(true);
    const dup = await createCategory(a.userId, { name: "Services" });
    expect(dup.ok).toBe(false);
    const other = await createCategory(a.userId, { name: "Goods" });
    if (!other.ok) throw new Error("create failed");
    const renamed = await renameCategory(a.userId, other.data.id, { name: "Services" });
    expect(renamed.ok).toBe(false);
  });

  it("CSV import creates valid rows, creates unknown categories, and reports every bad row", async () => {
    const a = await makeAccount();
    const csv = [
      "Name,SKU,Description,Category,Unit,Price,Tax Category,Tax Rate Code,Active",
      "Consulting,CONS-1,Advice,Services,hour,350,STANDARD,STD_5,yes",
      "Bad price,BAD-1,,Services,pcs,not-a-number,STANDARD,STD_5,yes",
      "Bad tax,BAD-2,,Services,pcs,10,STANDARD,NOPE,yes",
      ",BAD-3,,Services,pcs,10,STANDARD,STD_5,yes",
      "Dup in file,CONS-1,,Services,pcs,10,STANDARD,STD_5,yes",
      "Support plan,SUP-1,Annual support,Services,year,1200,ZERO_RATED,ZERO,yes",
    ].join("\n");

    const result = await importProductsCsv(a.userId, csv);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("import failed");
    expect(result.data.created).toBe(2);
    // Rows 3 (bad price), 4 (bad tax code), 5 (missing name), 6 (dup SKU).
    expect(result.data.errors.map((e) => e.row).sort()).toEqual([3, 4, 5, 6]);
    expect(result.data.errors.every((e) => e.message.length > 0)).toBe(true);

    const { products } = await listProducts(a.userId, {});
    expect(products.map((p) => p.name).sort()).toEqual(["Consulting", "Support plan"]);
    const category = await prisma.productCategory.findFirst({
      where: { businessId: a.businessId, name: "Services" },
    });
    expect(category).not.toBeNull();
  });

  it("CSV export then import round-trips into another business", async () => {
    const a = await makeAccount();
    const b = await makeAccount();
    await createProduct(a.userId, {
      name: "Round Trip Widget",
      sku: "RT-1",
      description: "Has, commas and \"quotes\"",
      unit: "pcs",
      price: "12.3456",
      taxCategory: "STANDARD",
      isActive: true,
    });
    const exported = await exportProductsCsv(a.userId);
    const imported = await importProductsCsv(b.userId, exported);
    expect(imported.ok).toBe(true);
    if (!imported.ok) throw new Error("import failed");
    expect(imported.data.created).toBe(1);
    expect(imported.data.errors).toEqual([]);
    const { products } = await listProducts(b.userId, {});
    expect(products).toHaveLength(1);
    expect(products[0]?.name).toBe("Round Trip Widget");
    expect(products[0]?.description).toBe('Has, commas and "quotes"');
    expect(products[0]?.price.toString()).toBe("12.3456");
  });
});
