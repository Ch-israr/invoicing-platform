import { describe, expect, it } from "vitest";
import { escapeHtml, renderInvoiceHtml } from "@/server/pdf/templates";
import type { InvoicePreviewData } from "@/lib/invoice-preview";

function fixture(overrides: Partial<InvoicePreviewData> = {}): InvoicePreviewData {
  return {
    number: "INV-0001",
    status: "ISSUED",
    template: "classic",
    locale: "en",
    currency: "AED",
    issueDate: "2026-11-24",
    dueDate: "2026-12-24",
    supplyDate: "2026-11-20",
    business: {
      name: "Acme Trading LLC",
      address: "Sheikh Zayed Road, Dubai",
      phone: "+971 4 000 0000",
      email: "billing@acme.example",
      website: "https://acme.example",
      trn: "100200300400005",
      bankName: "Emirates NBD",
      accountName: "Acme Trading LLC",
      iban: "AE070331234567890123456",
      swift: "EBILAEAD",
      paymentInstructions: "Please quote your invoice number",
      logoUrl: null,
      signatureUrl: null,
      terms: "Payment due within 30 days.",
      footer: "Thank you for your business",
    },
    customer: {
      name: "Sara Ahmed",
      companyName: "Beta Retail FZE",
      email: "accounts@beta.example",
      phone: "+971 50 000 0000",
      billingAddress: "JAFZA, Dubai",
      trn: "100200300400006",
    },
    items: [
      {
        description: "Consulting",
        sku: "CONS-001",
        quantity: "2",
        unit: "hour",
        unitPrice: "100",
        discountType: "PERCENT",
        discountValue: "10",
        taxRate: "5",
        taxCategory: "STANDARD",
        taxInclusive: false,
        netAmount: "200",
        discountAmount: "20",
        taxableAmount: "180",
        vatAmount: "9",
        lineTotal: "189",
      },
      {
        description: "Export goods",
        sku: null,
        quantity: "1",
        unit: "pcs",
        unitPrice: "50",
        discountType: "NONE",
        discountValue: "0",
        taxRate: "0",
        taxCategory: "ZERO_RATED",
        taxInclusive: false,
        netAmount: "50",
        discountAmount: "0",
        taxableAmount: "50",
        vatAmount: "0",
        lineTotal: "50",
      },
    ],
    totals: {
      subtotal: "250",
      discountTotal: "20",
      taxableAmount: "230",
      vatAmount: "9",
      grandTotal: "239",
      amountPaid: "0",
      balance: "239",
    },
    notes: "Thank you for your business",
    terms: "Payment due within 30 days.",
    ...overrides,
  };
}

describe("renderInvoiceHtml", () => {
  it("renders the invoice number, customer, lines and totals", () => {
    const html = renderInvoiceHtml(fixture());
    expect(html).toContain("INV-0001");
    expect(html).toContain("Acme Trading LLC");
    expect(html).toContain("Beta Retail FZE");
    expect(html).toContain("Consulting");
    expect(html).toContain("Export goods");
    // en-AE money formatting: AED 239.00
    expect(html).toContain("239.00");
    expect(html).toContain("9.00");
    expect(html).toContain("Tax Invoice");
    expect(html).toContain("100200300400005"); // business TRN
  });

  it("the three templates produce distinct HTML", () => {
    const classic = renderInvoiceHtml(fixture({ template: "classic" }));
    const modern = renderInvoiceHtml(fixture({ template: "modern" }));
    const minimal = renderInvoiceHtml(fixture({ template: "minimal" }));
    expect(classic).toContain("template-classic");
    expect(modern).toContain("template-modern");
    expect(minimal).toContain("template-minimal");
    // modern has the accent band + accent colour; minimal has none of it
    expect(modern).toContain("accent-band");
    expect(classic).not.toContain("accent-band");
    expect(minimal).not.toContain("accent-band");
    expect(modern).toContain("#4f46e5");
    expect(classic).not.toContain("#4f46e5");
    expect(classic).not.toBe(modern);
    expect(classic).not.toBe(minimal);
    expect(modern).not.toBe(minimal);
  });

  it("falls back to classic for an unknown template", () => {
    const html = renderInvoiceHtml(fixture({ template: "fancy" }));
    expect(html).toContain("template-classic");
  });

  it("Arabic locale renders RTL with real Arabic labels", () => {
    const html = renderInvoiceHtml(
      fixture({
        locale: "ar",
        business: {
          ...fixture().business,
          name: "شركة الاختبار",
        },
        customer: {
          ...fixture().customer,
          name: "سارة أحمد",
          companyName: "شركة بيتا",
        },
      }),
    );
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('lang="ar"');
    expect(html).toContain("فاتورة ضريبية");
    expect(html).toContain("شركة الاختبار");
    expect(html).toContain("شركة بيتا");
    expect(html).toContain("المجموع الإجمالي");
    // Amounts render with the Arabic dirham symbol (this Node/ICU
    // build formats ar-AE amounts with Latin digits — the real PDF
    // extraction test asserts the Arabic text itself).
    expect(html).toContain("د.إ");
  });

  it("drafts are watermarked and show the draft label, not a number", () => {
    const html = renderInvoiceHtml(fixture({ number: null, status: "DRAFT" }));
    expect(html).toContain("DRAFT");
    expect(html).toContain('class="watermark"');
    expect(html).not.toContain("INV-0001");
  });

  it("an issued invoice is not watermarked unless requested", () => {
    const html = renderInvoiceHtml(fixture());
    expect(html).not.toContain('class="watermark"');
    const forced = renderInvoiceHtml(fixture(), { watermarkDraft: true });
    expect(forced).toContain('class="watermark"');
  });

  it("escapes user-controlled strings (no raw HTML injection)", () => {
    const html = renderInvoiceHtml(
      fixture({
        business: { ...fixture().business, name: "<script>alert(1)</script>" },
        items: [
          {
            ...fixture().items[0]!,
            description: "<img src=x onerror=alert(2)>",
          },
          fixture().items[1]!,
        ],
      }),
    );
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain("<img src=x onerror=alert(2)>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("&lt;img src=x onerror=alert(2)&gt;");
  });

  it("escapeHtml handles all special characters", () => {
    expect(escapeHtml(`a&b<c>d"e'f`)).toBe("a&amp;b&lt;c&gt;d&quot;e&#39;f");
  });

  it("includes repeating-header print CSS for multi-page tables", () => {
    const html = renderInvoiceHtml(fixture());
    expect(html).toContain("table-header-group");
    expect(html).toContain("@page");
    expect(html).toContain("size: A4");
    expect(html).toContain("page-break-inside: avoid");
  });

  it("renders many lines (multi-page input) without dropping any", () => {
    const items = Array.from({ length: 80 }, (_, i) => ({
      ...fixture().items[0]!,
      description: `Line ${i + 1}`,
      sku: `SKU-${i + 1}`,
    }));
    const html = renderInvoiceHtml(fixture({ items }));
    for (const n of [1, 40, 80]) {
      expect(html).toContain(`Line ${n}`);
    }
    expect(html).toContain("SKU-80");
  });

  it("omits empty optional sections (no bank block without bank data)", () => {
    const html = renderInvoiceHtml(
      fixture({
        business: {
          ...fixture().business,
          bankName: null,
          iban: null,
          paymentInstructions: null,
        },
        notes: null,
        terms: null,
      }),
    );
    expect(html).not.toContain("Bank Details");
    expect(html).not.toContain("Notes");
  });
});
