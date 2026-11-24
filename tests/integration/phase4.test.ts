import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
// The download route imports @/lib/auth (next-auth), which cannot be
// loaded in Vitest (next-auth imports next/server in a way Vitest
// cannot resolve). Mock it so the route can be exercised end to end;
// the services under test take userId directly and are unaffected.
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
import { auth } from "@/lib/auth";
const mockAuth = auth as unknown as ReturnType<typeof vi.fn>;
import { readUpload } from "@/lib/storage";
import { TenantError } from "@/lib/tenant";
import { registerUserAccount } from "@/server/services/auth.service";
import { createCustomer } from "@/server/services/customer.service";
import {
  createInvoice,
  issueInvoice,
} from "@/server/services/invoice.service";
import {
  generateInvoicePdf,
  getInvoicePdfForDownload,
  getLatestInvoiceDocument,
  regenerateInvoicePdf,
} from "@/server/pdf/service";
import { closePdfBrowser } from "@/server/pdf/generate";
import { GET as downloadPdf } from "@/app/api/invoices/[id]/pdf/route";

const uid = () => Math.random().toString(36).slice(2, 10);

async function makeAccount(businessName = `Phase 4 ${uid()} LLC`) {
  const result = await registerUserAccount({
    name: "Phase 4 Test",
    businessName,
    email: `p4-${uid()}@example.com`,
    password: "TestPass1234",
  });
  if (!result.ok) throw new Error(`setup failed: ${result.error}`);
  // registerUserAccount returns { ok: true, userId, businessId, ... } flat.
  return result as unknown as { userId: string; businessId: string };
}

async function makeCustomer(userId: string, name = "Acme Corp") {
  const created = await createCustomer(userId, {
    type: "COMPANY",
    name,
    companyName: name,
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

function invoiceInput(
  customerId: string,
  stdId: string,
  overrides: Record<string, unknown> = {},
) {
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
        discountType: "PERCENT" as const,
        discountValue: "10",
        taxRateId: stdId,
        taxCategory: "STANDARD" as const,
        taxInclusive: false,
      },
    ],
    ...overrides,
  };
}

async function makeIssuedInvoice(
  userId: string,
  businessId: string,
  overrides: Record<string, unknown> = {},
) {
  const customerId = await makeCustomer(userId);
  const std = await stdRate(businessId);
  const created = await createInvoice(userId, invoiceInput(customerId, std.id, overrides));
  if (!created.ok) throw new Error(`create failed: ${created.error}`);
  const issued = await issueInvoice(userId, created.data.id);
  if (!issued.ok) throw new Error(`issue failed: ${issued.error}`);
  return { invoiceId: created.data.id, number: issued.data.number };
}

/** Write PDF bytes to a temp file and return its path. */
function toTempFile(buffer: Buffer, name: string): string {
  const dir = mkdtempSync(join(tmpdir(), "phase4-pdf-"));
  const file = join(dir, name);
  writeFileSync(file, buffer);
  return file;
}

function pdfText(buffer: Buffer): string {
  const file = toTempFile(buffer, "invoice.pdf");
  try {
    return execFileSync("pdftotext", ["-layout", file, "-"], {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    }) as string;
  } finally {
    rmSync(file, { force: true });
  }
}

function pdfPages(buffer: Buffer): number {
  const file = toTempFile(buffer, "invoice.pdf");
  try {
    const info = execFileSync("pdfinfo", [file], { encoding: "utf8" }) as string;
    const match = info.match(/^Pages:\s+(\d+)$/m);
    if (!match) throw new Error(`pdfinfo output had no page count: ${info}`);
    return Number(match[1]);
  } finally {
    rmSync(file, { force: true });
  }
}

afterAll(async () => {
  await closePdfBrowser();
});

describe("PDF generation + storage", () => {
  it("issue → stored PDF with checksum matching the stored file", async () => {
    const a = await makeAccount();
    const { invoiceId, number } = await makeIssuedInvoice(a.userId, a.businessId);

    const generated = await generateInvoicePdf(a.userId, invoiceId);
    expect(generated.ok).toBe(true);
    if (!generated.ok) throw new Error("generate failed");

    expect(generated.data.fileName).toBe(`${number}.pdf`);
    expect(generated.data.fileSize).toBeGreaterThan(1000);
    expect(generated.data.checksum).toMatch(/^[0-9a-f]{64}$/);

    const doc = await getLatestInvoiceDocument(invoiceId);
    expect(doc).not.toBeNull();
    expect(doc!.checksum).toBe(generated.data.checksum);
    expect(doc!.fileSize).toBe(generated.data.fileSize);

    const stored = await readUpload(doc!.storageKey);
    expect(stored).not.toBeNull();
    expect(stored!.contentType).toBe("application/pdf");
    expect(stored!.buffer.subarray(0, 5).toString()).toBe("%PDF-");
    const actual = createHash("sha256").update(stored!.buffer).digest("hex");
    expect(actual).toBe(doc!.checksum);
  });

  it("download returns the stored bytes; cross-business access is refused", async () => {
    const a = await makeAccount();
    const b = await makeAccount();
    const { invoiceId, number } = await makeIssuedInvoice(a.userId, a.businessId);
    await generateInvoicePdf(a.userId, invoiceId);

    const download = await getInvoicePdfForDownload(a.userId, invoiceId);
    expect(download.ok).toBe(true);
    if (!download.ok) throw new Error("download failed");
    expect(download.data.fileName).toBe(`${number}.pdf`);
    expect(download.data.isDraft).toBe(false);
    expect(download.data.buffer.subarray(0, 5).toString()).toBe("%PDF-");
    const text = pdfText(download.data.buffer);
    expect(text).toContain(number);
    expect(text).toContain("Acme Corp");

    await expect(getInvoicePdfForDownload(b.userId, invoiceId)).rejects.toBeInstanceOf(
      TenantError,
    );
    await expect(generateInvoicePdf(b.userId, invoiceId)).rejects.toBeInstanceOf(
      TenantError,
    );
  });

  it("the download route returns 401 without a session, 200 + PDF headers with one, 404 cross-business", async () => {
    const a = await makeAccount();
    const b = await makeAccount();
    const { invoiceId, number } = await makeIssuedInvoice(a.userId, a.businessId);
    await generateInvoicePdf(a.userId, invoiceId);

    mockAuth.mockResolvedValue(null);
    const unauth = await downloadPdf(
      new Request(`http://localhost/api/invoices/${invoiceId}/pdf`) as never,
      { params: Promise.resolve({ id: invoiceId }) },
    );
    expect(unauth.status).toBe(401);

    mockAuth.mockResolvedValue({ user: { id: a.userId } });
    const ok = await downloadPdf(
      new Request(`http://localhost/api/invoices/${invoiceId}/pdf`) as never,
      { params: Promise.resolve({ id: invoiceId }) },
    );
    expect(ok.status).toBe(200);
    expect(ok.headers.get("Content-Type")).toBe("application/pdf");
    expect(ok.headers.get("Content-Disposition")).toBe(
      `attachment; filename="${number}.pdf"`,
    );
    const bytes = new Uint8Array(await ok.arrayBuffer());
    expect(Buffer.from(bytes).subarray(0, 5).toString()).toBe("%PDF-");
    expect(Number(ok.headers.get("Content-Length"))).toBe(bytes.length);

    mockAuth.mockResolvedValue({ user: { id: b.userId } });
    const foreign = await downloadPdf(
      new Request(`http://localhost/api/invoices/${invoiceId}/pdf`) as never,
      { params: Promise.resolve({ id: invoiceId }) },
    );
    expect(foreign.status).toBe(404);
  });

  it("drafts are not stored; download renders a watermarked PDF in memory", async () => {
    const a = await makeAccount();
    const customerId = await makeCustomer(a.userId);
    const std = await stdRate(a.businessId);
    const created = await createInvoice(a.userId, invoiceInput(customerId, std.id));
    if (!created.ok) throw new Error("create failed");

    const generated = await generateInvoicePdf(a.userId, created.data.id);
    expect(generated.ok).toBe(false);

    const download = await getInvoicePdfForDownload(a.userId, created.data.id);
    expect(download.ok).toBe(true);
    if (!download.ok) throw new Error("draft download failed");
    expect(download.data.isDraft).toBe(true);
    expect(download.data.fileName).toBe("DRAFT.pdf");
    const text = pdfText(download.data.buffer);
    expect(text).toContain("DRAFT");

    const doc = await getLatestInvoiceDocument(created.data.id);
    expect(doc).toBeNull();
  });

  it("regenerate replaces the stored file and keeps a single document row", async () => {
    const a = await makeAccount();
    const { invoiceId } = await makeIssuedInvoice(a.userId, a.businessId);
    const first = await generateInvoicePdf(a.userId, invoiceId);
    if (!first.ok) throw new Error("first generate failed");

    const second = await regenerateInvoicePdf(a.userId, invoiceId);
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error("regenerate failed");
    expect(second.data.storageKey).not.toBe(first.data.storageKey);

    const docs = await prisma.invoiceDocument.findMany({
      where: { invoiceId, type: "PDF" },
    });
    expect(docs).toHaveLength(1);
    expect(docs[0]!.checksum).toBe(second.data.checksum);

    // The replaced file is gone from disk.
    expect(await readUpload(first.data.storageKey)).toBeNull();
    const kept = await readUpload(second.data.storageKey);
    expect(kept).not.toBeNull();
    expect(createHash("sha256").update(kept!.buffer).digest("hex")).toBe(
      second.data.checksum,
    );
  });
});

describe("real PDF output", () => {
  it("a 1-page invoice extracts the number and totals; a long invoice paginates", async () => {
    const a = await makeAccount();
    const { invoiceId, number } = await makeIssuedInvoice(a.userId, a.businessId);
    const download = await getInvoicePdfForDownload(a.userId, invoiceId);
    if (!download.ok) throw new Error("download failed");
    expect(pdfPages(download.data.buffer)).toBe(1);
    const text = pdfText(download.data.buffer);
    expect(text).toContain(number);
    // Single-item fixture: 2 × 100 − 10% + 5% VAT → grand total 189.
    expect(text).toContain("189");
    expect(text).toContain("Tax Invoice");

    // 80-line invoice: many pages, repeating headers, last line present.
    const customerId = await makeCustomer(a.userId);
    const std = await stdRate(a.businessId);
    const items = Array.from({ length: 80 }, (_, i) => ({
      description: `Service line ${i + 1}`,
      quantity: "1",
      unit: "pcs",
      unitPrice: "10",
      discountType: "NONE" as const,
      discountValue: "0",
      taxRateId: std.id,
      taxCategory: "STANDARD" as const,
      taxInclusive: false,
    }));
    const created = await createInvoice(
      a.userId,
      invoiceInput(customerId, std.id, { items }),
    );
    if (!created.ok) throw new Error(`long create failed: ${created.error}`);
    const issued = await issueInvoice(a.userId, created.data.id);
    if (!issued.ok) throw new Error("long issue failed");
    const longDownload = await getInvoicePdfForDownload(a.userId, created.data.id);
    if (!longDownload.ok) throw new Error("long download failed");
    const pages = pdfPages(longDownload.data.buffer);
    expect(pages).toBeGreaterThanOrEqual(3);
    const longText = pdfText(longDownload.data.buffer);
    expect(longText).toContain("Service line 80");
    expect(longText).toContain("Service line 1");
    // Repeating header: the column label appears once per page.
    const headerCount = (longText.match(/Description/g) ?? []).length;
    expect(headerCount).toBeGreaterThanOrEqual(3);
  });

  it("an Arabic invoice extracts real Arabic text (RTL)", async () => {
    const a = await makeAccount("شركة الاختبار ذ.م.م");
    const customerId = await makeCustomer(a.userId, "شركة بيتا");
    const std = await stdRate(a.businessId);
    const created = await createInvoice(
      a.userId,
      invoiceInput(customerId, std.id, { locale: "ar" as const }),
    );
    if (!created.ok) throw new Error(`ar create failed: ${created.error}`);
    const issued = await issueInvoice(a.userId, created.data.id);
    if (!issued.ok) throw new Error("ar issue failed");
    const download = await getInvoicePdfForDownload(a.userId, created.data.id);
    if (!download.ok) throw new Error("ar download failed");
    const text = pdfText(download.data.buffer);
    expect(text).toContain("فاتورة ضريبية");
    expect(text).toContain("شركة الاختبار");
    expect(text).toContain("شركة بيتا");
    // No tofu boxes: pdftotext would show them as missing glyphs, not Arabic.
    expect(text).toMatch(/[\u0600-\u06FF]/);
  });

  it("all three templates generate a valid 1-page PDF with the invoice number", async () => {
    const a = await makeAccount();
    for (const template of ["classic", "modern", "minimal"] as const) {
      const customerId = await makeCustomer(a.userId);
      const std = await stdRate(a.businessId);
      const created = await createInvoice(
        a.userId,
        invoiceInput(customerId, std.id, { template }),
      );
      if (!created.ok) throw new Error(`${template} create failed: ${created.error}`);
      const issued = await issueInvoice(a.userId, created.data.id);
      if (!issued.ok) throw new Error(`${template} issue failed`);
      const download = await getInvoicePdfForDownload(a.userId, created.data.id);
      if (!download.ok) throw new Error(`${template} download failed`);
      expect(pdfPages(download.data.buffer)).toBe(1);
      expect(pdfText(download.data.buffer)).toContain(issued.data.number);
    }
  });

  it("the PDF is frozen: editing the customer after issue does not change it", async () => {
    const a = await makeAccount();
    const customerId = await makeCustomer(a.userId, "Original Name LLC");
    const std = await stdRate(a.businessId);
    const created = await createInvoice(a.userId, invoiceInput(customerId, std.id));
    if (!created.ok) throw new Error("create failed");
    const issued = await issueInvoice(a.userId, created.data.id);
    if (!issued.ok) throw new Error("issue failed");

    const before = await getInvoicePdfForDownload(a.userId, created.data.id);
    if (!before.ok) throw new Error("before download failed");
    const textBefore = pdfText(before.data.buffer);
    expect(textBefore).toContain("Original Name LLC");

    // Mutate the live rows after issue.
    await prisma.customer.update({
      where: { id: customerId },
      data: { name: "Renamed LLC", companyName: "Renamed LLC" },
    });
    await prisma.product.updateMany({
      where: { businessId: a.businessId },
      data: { price: new Prisma.Decimal("9999") },
    });

    const regen = await regenerateInvoicePdf(a.userId, created.data.id);
    expect(regen.ok).toBe(true);
    const after = await getInvoicePdfForDownload(a.userId, created.data.id);
    if (!after.ok) throw new Error("after download failed");
    const textAfter = pdfText(after.data.buffer);
    expect(textAfter).not.toContain("Renamed LLC");
    expect(textAfter).toContain("Original Name LLC");
    expect(textAfter).not.toContain("9999");
    // Totals unchanged: the frozen grand total is still 189.
    expect(textAfter).toContain("189");
    expect(textBefore).toBe(textAfter);
  });
});
