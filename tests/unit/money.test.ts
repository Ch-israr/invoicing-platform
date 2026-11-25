import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import {
  applyInvoiceLevelDiscount,
  balanceDue,
  calculateInvoice,
  calculateLine,
  earlyDiscountDeadline,
  earlyDiscountSaving,
  isWithinEarlyDiscountWindow,
  round2,
  type LineInput,
} from "@/lib/money";

/**
 * Every expected number below was calculated by hand — none of them
 * comes from calling the engine. If the engine changes, these are the
 * values it must still produce.
 *
 * Conventions (see src/lib/money.ts):
 *   gross     = qty × unitPrice (as entered)
 *   net       = gross with VAT extracted when tax-inclusive
 *   discount  = % of net, or a fixed amount per line, clamped to net
 *   taxable   = net - discount, vat = taxable × rate, total = taxable + vat
 * Rounding is half-up to 2dp at line level; invoice totals sum the
 * rounded line values.
 */

const line = (overrides: Partial<LineInput>): LineInput => ({
  quantity: "1",
  unitPrice: "0",
  discountType: "NONE",
  discountValue: "0",
  taxRatePercent: "5",
  taxInclusive: false,
  ...overrides,
});

const str = (d: Decimal) => d.toString();

describe("round2", () => {
  it("rounds half-up to 2 decimal places", () => {
    expect(str(round2("2.005"))).toBe("2.01");
    expect(str(round2("2.004"))).toBe("2");
    expect(str(round2("0.005"))).toBe("0.01"); // half a fils rounds up
    expect(str(round2("99.999"))).toBe("100");
    expect(str(round2("30.015"))).toBe("30.02");
  });
});

describe("calculateLine — tax-exclusive prices", () => {
  it("2 × 100.00 at 5%, no discount → net 200, VAT 10, total 210", () => {
    const r = calculateLine(line({ quantity: "2", unitPrice: "100" }));
    expect(str(r.grossAmount)).toBe("200");
    expect(str(r.netAmount)).toBe("200");
    expect(str(r.discountAmount)).toBe("0");
    expect(str(r.taxableAmount)).toBe("200");
    expect(str(r.vatAmount)).toBe("10");
    expect(str(r.lineTotal)).toBe("210");
  });

  it("3 × 50.00 with 10% discount at 5% → disc 15, taxable 135, VAT 6.75, total 141.75", () => {
    const r = calculateLine(
      line({ quantity: "3", unitPrice: "50", discountType: "PERCENT", discountValue: "10" }),
    );
    expect(str(r.grossAmount)).toBe("150");
    expect(str(r.netAmount)).toBe("150");
    expect(str(r.discountAmount)).toBe("15");
    expect(str(r.taxableAmount)).toBe("135");
    expect(str(r.vatAmount)).toBe("6.75");
    expect(str(r.lineTotal)).toBe("141.75");
  });

  it("1 × 200.00 with fixed discount 25 at 5% → taxable 175, VAT 8.75, total 183.75", () => {
    const r = calculateLine(
      line({ unitPrice: "200", discountType: "FIXED", discountValue: "25" }),
    );
    expect(str(r.discountAmount)).toBe("25");
    expect(str(r.taxableAmount)).toBe("175");
    expect(str(r.vatAmount)).toBe("8.75");
    expect(str(r.lineTotal)).toBe("183.75");
  });

  it("a fixed discount larger than the line is clamped to the net value", () => {
    const r = calculateLine(
      line({ unitPrice: "10", discountType: "FIXED", discountValue: "50" }),
    );
    expect(str(r.discountAmount)).toBe("10");
    expect(str(r.taxableAmount)).toBe("0");
    expect(str(r.vatAmount)).toBe("0");
    expect(str(r.lineTotal)).toBe("0");
  });

  it("3 × 0.10 at 0% is exactly 0.30 — no float error", () => {
    const r = calculateLine(line({ quantity: "3", unitPrice: "0.10", taxRatePercent: "0" }));
    expect(str(r.netAmount)).toBe("0.3");
    expect(str(r.lineTotal)).toBe("0.3");
  });
});

describe("calculateLine — tax-inclusive prices", () => {
  it("1 × 105.00 incl. VAT at 5% → net 100, VAT 5, total 105", () => {
    const r = calculateLine(line({ unitPrice: "105", taxInclusive: true }));
    expect(str(r.grossAmount)).toBe("105");
    expect(str(r.netAmount)).toBe("100");
    expect(str(r.vatAmount)).toBe("5");
    expect(str(r.lineTotal)).toBe("105");
  });

  it("2 × 52.50 incl. VAT with 10% discount at 5% → net 100, disc 10, taxable 90, VAT 4.50, total 94.50", () => {
    const r = calculateLine(
      line({
        quantity: "2",
        unitPrice: "52.50",
        discountType: "PERCENT",
        discountValue: "10",
        taxInclusive: true,
      }),
    );
    expect(str(r.grossAmount)).toBe("105");
    expect(str(r.netAmount)).toBe("100");
    expect(str(r.discountAmount)).toBe("10");
    expect(str(r.taxableAmount)).toBe("90");
    expect(str(r.vatAmount)).toBe("4.5");
    expect(str(r.lineTotal)).toBe("94.5");
  });

  it("3 × 33.333 incl. VAT at 5% → net 95.24, VAT 4.76, total 100.00", () => {
    // gross 99.999; net = 99.999 / 1.05 = 95.23714… → 95.24
    // vat = 95.23714… × 0.05 = 4.76185… → 4.76
    const r = calculateLine(line({ quantity: "3", unitPrice: "33.333", taxInclusive: true }));
    expect(str(r.netAmount)).toBe("95.24");
    expect(str(r.vatAmount)).toBe("4.76");
    expect(str(r.lineTotal)).toBe("100");
  });
});

describe("calculateLine — rounding edges", () => {
  it("3 × 33.333 excl. VAT at 5% → net 100.00, VAT 5.00, total 105.00", () => {
    // net exact 99.999 → 100.00; vat exact 4.99995 → 5.00
    const r = calculateLine(line({ quantity: "3", unitPrice: "33.333" }));
    expect(str(r.netAmount)).toBe("100");
    expect(str(r.vatAmount)).toBe("5");
    expect(str(r.lineTotal)).toBe("105");
  });

  it("1 × 0.10 at 5% → VAT 0.005 rounds up to 0.01, total 0.11", () => {
    const r = calculateLine(line({ unitPrice: "0.10" }));
    expect(str(r.vatAmount)).toBe("0.01");
    expect(str(r.lineTotal)).toBe("0.11");
  });

  it("3 × 10.005 at 5% → net 30.02, VAT 1.50, total 31.52", () => {
    // net exact 30.015 → 30.02 (half-up); vat exact 1.50075 → 1.50
    const r = calculateLine(line({ quantity: "3", unitPrice: "10.005" }));
    expect(str(r.netAmount)).toBe("30.02");
    expect(str(r.vatAmount)).toBe("1.5");
    expect(str(r.lineTotal)).toBe("31.52");
  });
});

describe("calculateInvoice — mixed tax rates and discounts", () => {
  it("STANDARD + ZERO + EXEMPT lines add up: subtotal 280, VAT 5, grand 285", () => {
    const { lines, totals } = calculateInvoice([
      line({ unitPrice: "100", taxRatePercent: "5" }),
      line({ quantity: "2", unitPrice: "50", taxRatePercent: "0" }),
      line({ unitPrice: "80", taxRatePercent: "0" }),
    ]);
    expect(lines.map((l) => str(l.lineTotal))).toEqual(["105", "100", "80"]);
    expect(str(totals.subtotal)).toBe("280");
    expect(str(totals.discountTotal)).toBe("0");
    expect(str(totals.taxableAmount)).toBe("280");
    expect(str(totals.vatAmount)).toBe("5");
    expect(str(totals.grandTotal)).toBe("285");
  });

  it("discounted STANDARD line + ZERO line: subtotal 250, discount 20, taxable 230, VAT 9, grand 239", () => {
    const { totals } = calculateInvoice([
      line({ quantity: "2", unitPrice: "100", discountType: "PERCENT", discountValue: "10" }),
      line({ unitPrice: "50", taxRatePercent: "0" }),
    ]);
    expect(str(totals.subtotal)).toBe("250");
    expect(str(totals.discountTotal)).toBe("20");
    expect(str(totals.taxableAmount)).toBe("230");
    expect(str(totals.vatAmount)).toBe("9");
    expect(str(totals.grandTotal)).toBe("239");
  });

  it("invoice totals always satisfy grand = subtotal - discount + vat", () => {
    const { totals } = calculateInvoice([
      line({ quantity: "7", unitPrice: "33.333", discountType: "PERCENT", discountValue: "12.5" }),
      line({ quantity: "2", unitPrice: "52.50", taxInclusive: true }),
      line({ unitPrice: "0.10" }),
    ]);
    const check = totals.subtotal
      .sub(totals.discountTotal)
      .add(totals.vatAmount);
    expect(check.equals(totals.grandTotal)).toBe(true);
  });
});

describe("balanceDue", () => {
  it("grand 239, paid 100 → balance 139; overpayment floors at 0", () => {
    expect(str(balanceDue("239", "100"))).toBe("139");
    expect(str(balanceDue("239", "300"))).toBe("0");
  });
});

describe("calculateInvoice — invoice-level discount", () => {
  it("10% on 1 × 100.00 at 5% → discount 10, taxable 90, VAT 4.50, total 94.50", () => {
    const { totals } = calculateInvoice(
      [line({ unitPrice: "100" })],
      { type: "PERCENT", value: "10" },
    );
    expect(str(totals.subtotal)).toBe("100");
    expect(str(totals.lineDiscountTotal)).toBe("0");
    expect(str(totals.invoiceDiscountTotal)).toBe("10");
    expect(str(totals.discountTotal)).toBe("10");
    expect(str(totals.taxableAmount)).toBe("90");
    expect(str(totals.vatAmount)).toBe("4.5");
    expect(str(totals.grandTotal)).toBe("94.5");
  });

  it("10% across 5% + 0% rates splits 10/10, VAT only on the reduced 5% base", () => {
    const { totals } = calculateInvoice(
      [
        line({ unitPrice: "100", taxRatePercent: "5" }),
        line({ unitPrice: "100", taxRatePercent: "0" }),
      ],
      { type: "PERCENT", value: "10" },
    );
    expect(str(totals.invoiceDiscountTotal)).toBe("20");
    expect(str(totals.taxableAmount)).toBe("180");
    expect(str(totals.vatAmount)).toBe("4.5");
    expect(str(totals.grandTotal)).toBe("184.5");
  });

  it("fixed 30 across 100 @5% + 200 @0% splits 10/20, VAT 4.50, total 274.50", () => {
    const { totals } = calculateInvoice(
      [
        line({ unitPrice: "100", taxRatePercent: "5" }),
        line({ unitPrice: "200", taxRatePercent: "0" }),
      ],
      { type: "FIXED", value: "30" },
    );
    expect(str(totals.invoiceDiscountTotal)).toBe("30");
    expect(str(totals.taxableAmount)).toBe("270");
    expect(str(totals.vatAmount)).toBe("4.5");
    expect(str(totals.grandTotal)).toBe("274.5");
  });

  it("line discount applies first, then the invoice discount on the reduced base", () => {
    // 2 × 100 with 10% line discount → taxable 180; 10% invoice
    // discount on 180 → 18; discount total 38; taxable 162.
    const { totals } = calculateInvoice(
      [line({ quantity: "2", unitPrice: "100", discountType: "PERCENT", discountValue: "10" })],
      { type: "PERCENT", value: "10" },
    );
    expect(str(totals.lineDiscountTotal)).toBe("20");
    expect(str(totals.invoiceDiscountTotal)).toBe("18");
    expect(str(totals.discountTotal)).toBe("38");
    expect(str(totals.taxableAmount)).toBe("162");
    expect(str(totals.vatAmount)).toBe("8.1");
    expect(str(totals.grandTotal)).toBe("170.1");
  });

  it("a fixed discount larger than the taxable base is capped at the base", () => {
    const { totals } = calculateInvoice(
      [line({ unitPrice: "10" })],
      { type: "FIXED", value: "100" },
    );
    expect(str(totals.invoiceDiscountTotal)).toBe("10");
    expect(str(totals.taxableAmount)).toBe("0");
    expect(str(totals.vatAmount)).toBe("0");
    expect(str(totals.grandTotal)).toBe("0");
  });

  it("a percentage above 100 is capped at 100", () => {
    const { totals } = calculateInvoice(
      [line({ unitPrice: "100" })],
      { type: "PERCENT", value: "150" },
    );
    expect(str(totals.invoiceDiscountTotal)).toBe("100");
    expect(str(totals.grandTotal)).toBe("0");
  });

  it("10% on a tax-inclusive 105.00 line → net 100, discount 10, VAT 4.50, total 94.50", () => {
    const { totals } = calculateInvoice(
      [line({ unitPrice: "105", taxInclusive: true })],
      { type: "PERCENT", value: "10" },
    );
    expect(str(totals.subtotal)).toBe("100");
    expect(str(totals.invoiceDiscountTotal)).toBe("10");
    expect(str(totals.taxableAmount)).toBe("90");
    expect(str(totals.vatAmount)).toBe("4.5");
    expect(str(totals.grandTotal)).toBe("94.5");
  });

  it("invoice totals still satisfy grand = subtotal - discount + vat", () => {
    const { totals } = calculateInvoice(
      [
        line({ quantity: "7", unitPrice: "33.333", discountType: "PERCENT", discountValue: "12.5" }),
        line({ quantity: "2", unitPrice: "52.50", taxInclusive: true }),
        line({ unitPrice: "0.10" }),
      ],
      { type: "PERCENT", value: "7.5" },
    );
    const check = totals.subtotal.sub(totals.discountTotal).add(totals.vatAmount);
    expect(check.equals(totals.grandTotal)).toBe(true);
  });
});

describe("applyInvoiceLevelDiscount — allocation", () => {
  const grouped = (specs: Array<{ rate: string; taxable: string }>) =>
    specs.map((s) => ({
      taxRatePercent: s.rate,
      result: calculateLine(
        line({ unitPrice: s.taxable, taxRatePercent: s.rate }),
      ),
    }));

  it("per-rate shares sum exactly to the discount, residue to the largest base", () => {
    // Bases 33.33 @5%, 33.33 @0%, 33.34 @10%; 10% of 100 = 10.00.
    // Raw shares 3.33 / 3.33 / 3.33 sum to 9.99 — the 0.01 residue
    // goes to the largest base (33.34, the 10% group).
    const { invoiceDiscountTotal, allocations, vatAmount, grandTotal } =
      applyInvoiceLevelDiscount(
        grouped([
          { rate: "5", taxable: "33.33" },
          { rate: "0", taxable: "33.33" },
          { rate: "10", taxable: "33.34" },
        ]),
        { type: "PERCENT", value: "10" },
      );
    expect(str(invoiceDiscountTotal)).toBe("10");
    expect(allocations.map((a) => str(a.discount))).toEqual(["3.33", "3.33", "3.34"]);
    expect(allocations.map((a) => str(a.taxableAfter))).toEqual(["30", "30", "30"]);
    // VAT: 30 × 5% + 30 × 0% + 30 × 10% = 1.50 + 0 + 3.00
    expect(str(vatAmount)).toBe("4.5");
    expect(str(grandTotal)).toBe("94.5");
  });

  it("NONE discount allocates nothing and VAT is unchanged", () => {
    const { invoiceDiscountTotal, vatAmount, grandTotal } = applyInvoiceLevelDiscount(
      grouped([{ rate: "5", taxable: "100" }]),
      { type: "NONE", value: "0" },
    );
    expect(str(invoiceDiscountTotal)).toBe("0");
    expect(str(vatAmount)).toBe("5");
    expect(str(grandTotal)).toBe("105");
  });
});

describe("early-payment discount helpers", () => {
  it("saving is a % of the current balance still owed", () => {
    expect(str(earlyDiscountSaving("90", "PERCENT", "2"))).toBe("1.8");
    expect(str(earlyDiscountSaving("587.50", "PERCENT", "2"))).toBe("11.75");
  });

  it("a fixed saving is capped at the balance", () => {
    expect(str(earlyDiscountSaving("90", "FIXED", "5"))).toBe("5");
    expect(str(earlyDiscountSaving("90", "FIXED", "100"))).toBe("90");
  });

  it("a percentage above 100 is capped at the whole balance", () => {
    expect(str(earlyDiscountSaving("90", "PERCENT", "150"))).toBe("90");
  });

  it("no discount, zero value or zero balance → saving 0", () => {
    expect(str(earlyDiscountSaving("90", "NONE", "10"))).toBe("0");
    expect(str(earlyDiscountSaving("90", "PERCENT", "0"))).toBe("0");
    expect(str(earlyDiscountSaving("0", "PERCENT", "10"))).toBe("0");
  });

  it("the deadline is the issue date plus the window, in UTC days", () => {
    const deadline = earlyDiscountDeadline(new Date("2026-11-25T00:00:00Z"), 10);
    expect(deadline.toISOString()).toBe("2026-12-05T00:00:00.000Z");
    expect(earlyDiscountDeadline(new Date("2026-11-25T00:00:00Z"), 0).toISOString()).toBe(
      "2026-11-25T00:00:00.000Z",
    );
  });

  it("the window includes the deadline day but not the day after", () => {
    const issue = new Date("2026-11-25T00:00:00Z");
    expect(isWithinEarlyDiscountWindow(issue, 10, new Date("2026-11-25T12:00:00Z"))).toBe(true);
    expect(isWithinEarlyDiscountWindow(issue, 10, new Date("2026-12-05T23:59:59Z"))).toBe(true);
    expect(isWithinEarlyDiscountWindow(issue, 10, new Date("2026-12-06T00:00:00Z"))).toBe(false);
  });
});
