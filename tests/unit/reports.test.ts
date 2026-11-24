import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import {
  buildCustomerBalanceRows,
  buildProductRevenueRows,
  computeVatNet,
  mergeMonthlySeries,
  monthKey,
  parseDateRange,
} from "@/server/services/report.service";

/**
 * Report math — hand-calculated fixtures. These prove the pure
 * builders agree with ledger arithmetic before any DB is involved;
 * the integration tests then check the same totals against seeded
 * rows in the real tables.
 */

const d = (v: string) => new Decimal(v);

describe("parseDateRange", () => {
  it("defaults to the current month", () => {
    const now = new Date();
    const r = parseDateRange({});
    expect(r.from.getDate()).toBe(1);
    expect(r.from.getMonth()).toBe(now.getMonth());
    expect(r.from.getFullYear()).toBe(now.getFullYear());
    expect(r.to.getMonth()).toBe(now.getMonth());
  });

  it("accepts a valid explicit range", () => {
    const r = parseDateRange({ from: "2026-10-05", to: "2026-11-20" });
    expect(r.from.toISOString().slice(0, 10)).toBe("2026-10-05");
    expect(r.to.toISOString().slice(0, 10)).toBe("2026-11-20");
  });

  it("falls back to the current month on bad input", () => {
    const r = parseDateRange({ from: "not-a-date", to: "2026-13-40" });
    const now = new Date();
    expect(r.from.getDate()).toBe(1);
    expect(r.from.getMonth()).toBe(now.getMonth());
  });

  it("swaps the bounds when from is after to", () => {
    const r = parseDateRange({ from: "2026-11-20", to: "2026-10-05" });
    expect(r.from.toISOString().slice(0, 10)).toBe("2026-10-05");
    expect(r.to.toISOString().slice(0, 10)).toBe("2026-11-20");
  });
});

describe("monthKey", () => {
  it("formats YYYY-MM", () => {
    expect(monthKey(new Date("2026-11-24T10:00:00Z"))).toBe("2026-11");
    expect(monthKey(new Date("2026-01-03T00:00:00Z"))).toBe("2026-01");
  });
});

describe("mergeMonthlySeries", () => {
  it("aligns invoiced and paid months, filling gaps with zero", () => {
    const merged = mergeMonthlySeries(
      [
        { month: "2026-10", total: d("1000.00") },
        { month: "2026-11", total: d("500.00") },
      ],
      [
        { month: "2026-10", total: d("800.00") },
        { month: "2026-12", total: d("300.00") },
      ],
    );
    expect(merged).toEqual([
      { month: "2026-10", invoiced: d("1000.00"), paid: d("800.00") },
      { month: "2026-11", invoiced: d("500.00"), paid: d("0") },
      { month: "2026-12", invoiced: d("0"), paid: d("300.00") },
    ]);
  });

  it("returns an empty series for empty input", () => {
    expect(mergeMonthlySeries([], [])).toEqual([]);
  });
});

describe("computeVatNet", () => {
  it("subtracts input VAT from output VAT", () => {
    expect(computeVatNet(d("250.00"), d("47.50")).toString()).toBe("202.5");
  });

  it("can go negative when input exceeds output", () => {
    expect(computeVatNet(d("10.00"), d("25.00")).toString()).toBe("-15");
  });

  it("is zero when both are zero", () => {
    expect(computeVatNet(d("0"), d("0")).toString()).toBe("0");
  });
});

describe("buildCustomerBalanceRows", () => {
  it("combines per-customer maps and sorts by outstanding desc", () => {
    const rows = buildCustomerBalanceRows({
      customers: [
        { id: "c-a", name: "Alpha" },
        { id: "c-b", name: "Beta" },
        { id: "c-c", name: "Gamma" },
      ],
      invoicedByCustomer: new Map([
        ["c-a", d("1000.00")],
        ["c-b", d("500.00")],
      ]),
      paidByCustomer: new Map([
        ["c-a", d("600.00")],
        ["c-b", d("500.00")],
      ]),
      creditedByCustomer: new Map([["c-a", d("100.00")]]),
      outstandingByCustomer: new Map([
        ["c-a", d("300.00")],
        ["c-b", d("0")],
        ["c-c", d("150.00")],
      ]),
    });
    // Alpha: 1000 invoiced, 600 paid, 100 credited, 300 outstanding.
    // Beta:  500 invoiced, 500 paid, 0 credited, 0 outstanding.
    // Gamma: 0 invoiced, 0 paid, 0 credited, 150 outstanding (older invoice).
    expect(rows.map((r) => r.customerName)).toEqual(["Alpha", "Gamma", "Beta"]);
    const alpha = rows[0];
    expect(alpha.invoiced.toString()).toBe("1000");
    expect(alpha.paid.toString()).toBe("600");
    expect(alpha.credited.toString()).toBe("100");
    expect(alpha.outstanding.toString()).toBe("300");
    const gamma = rows[1];
    expect(gamma.invoiced.toString()).toBe("0");
    expect(gamma.outstanding.toString()).toBe("150");
  });
});

describe("buildProductRevenueRows", () => {
  it("labels custom lines, resolves names, sorts by revenue desc", () => {
    const rows = buildProductRevenueRows({
      groups: [
        { productId: null, quantity: d("1"), revenue: d("50.00"), invoices: 1 },
        { productId: "p-1", quantity: d("5"), revenue: d("500.00"), invoices: 2 },
        { productId: "p-gone", quantity: d("2"), revenue: d("120.00"), invoices: 1 },
      ],
      names: new Map([["p-1", { name: "Consulting", sku: "CONS-1" }]]),
    });
    // 500 (Consulting) > 120 (deleted) > 50 (custom lines).
    expect(rows.map((r) => r.productName)).toEqual([
      "Consulting",
      "Deleted product",
      "Custom lines (no product)",
    ]);
    expect(rows[0].quantity.toString()).toBe("5");
    expect(rows[0].sku).toBe("CONS-1");
    expect(rows[0].invoices).toBe(2);
    expect(rows[1].productId).toBe("p-gone");
    expect(rows[2].productId).toBeNull();
    expect(rows[2].sku).toBeNull();
  });
});
