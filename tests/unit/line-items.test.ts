import { describe, expect, it } from "vitest";
import {
  firstValidationError,
  invoiceSchema,
  isEmptyLineItem,
  isEmptyLineState,
  stripEmptyLineItems,
} from "@/lib/validation/invoice";

/** The blank line exactly as the builder serializes it (undefined
 * fields are dropped by JSON.stringify). */
function blankLineJson(taxRateId: string) {
  return {
    description: "",
    quantity: "1",
    unit: "pcs",
    unitPrice: "",
    discountType: "NONE",
    discountValue: "0",
    taxRateId,
    taxCategory: "STANDARD",
    taxInclusive: false,
  };
}

function filledLineJson(taxRateId: string) {
  return {
    description: "Consulting",
    quantity: "2",
    unit: "hour",
    unitPrice: "100",
    discountType: "PERCENT",
    discountValue: "10",
    taxRateId,
    taxCategory: "STANDARD",
    taxInclusive: false,
  };
}

function blankLineState() {
  return {
    productId: "",
    description: "",
    sku: "",
    unitPrice: "",
    discountType: "NONE",
    discountValue: "0",
  };
}

describe("isEmptyLineItem (server shape)", () => {
  it("treats the builder's blank line as empty", () => {
    expect(isEmptyLineItem(blankLineJson("rate-1"))).toBe(true);
  });

  it("treats a filled line as non-empty", () => {
    expect(isEmptyLineItem(filledLineJson("rate-1"))).toBe(false);
  });

  it("treats a description-only line as non-empty (partial, not empty)", () => {
    expect(
      isEmptyLineItem({ ...blankLineJson("rate-1"), description: "Consulting" }),
    ).toBe(false);
  });

  it("treats a price-only line as non-empty (partial, not empty)", () => {
    expect(isEmptyLineItem({ ...blankLineJson("rate-1"), unitPrice: "100" })).toBe(false);
  });

  it("treats a zero price with nothing else as empty", () => {
    expect(isEmptyLineItem({ ...blankLineJson("rate-1"), unitPrice: "0" })).toBe(true);
  });

  it("treats a discount on an otherwise blank line as non-empty", () => {
    expect(
      isEmptyLineItem({
        ...blankLineJson("rate-1"),
        discountType: "PERCENT",
        discountValue: "10",
      }),
    ).toBe(false);
  });

  it("treats a product pick with nothing else as non-empty", () => {
    expect(isEmptyLineItem({ ...blankLineJson("rate-1"), productId: "prod-1" })).toBe(
      false,
    );
  });

  it("treats non-objects as non-empty (malformed, not blank)", () => {
    expect(isEmptyLineItem(null)).toBe(false);
    expect(isEmptyLineItem("nope")).toBe(false);
  });
});

describe("isEmptyLineState (client shape)", () => {
  it("agrees with the server rule on the blank line", () => {
    expect(isEmptyLineState(blankLineState())).toBe(true);
  });

  it("agrees with the server rule on filled and partial lines", () => {
    expect(isEmptyLineState({ ...blankLineState(), description: "Consulting" })).toBe(
      false,
    );
    expect(
      isEmptyLineState({ ...blankLineState(), description: "x", unitPrice: "100" }),
    ).toBe(false);
    expect(isEmptyLineState({ ...blankLineState(), unitPrice: "0" })).toBe(true);
  });

  it("agrees with isEmptyLineItem case by case", () => {
    const cases: Array<ReturnType<typeof blankLineState>> = [
      blankLineState(),
      { ...blankLineState(), description: "Consulting" },
      { ...blankLineState(), unitPrice: "100" },
      { ...blankLineState(), unitPrice: "0" },
      { ...blankLineState(), discountType: "PERCENT", discountValue: "10" },
      { ...blankLineState(), productId: "prod-1" },
      { ...blankLineState(), sku: "SKU-1" },
    ];
    for (const c of cases) {
      expect(isEmptyLineState(c)).toBe(isEmptyLineItem(c));
    }
  });
});

describe("stripEmptyLineItems", () => {
  it("drops empty lines and keeps filled ones, in order", () => {
    const input = {
      customerId: "c-1",
      items: [blankLineJson("rate-1"), filledLineJson("rate-1")],
    };
    const out = stripEmptyLineItems(input) as { items: unknown[] };
    expect(out.items).toHaveLength(1);
    expect(out.items[0]).toEqual(filledLineJson("rate-1"));
  });

  it("leaves an input without an items array untouched", () => {
    const input = { customerId: "c-1" };
    expect(stripEmptyLineItems(input)).toEqual(input);
    expect(stripEmptyLineItems(null)).toBeNull();
  });
});

describe("firstValidationError", () => {
  it("points at the offending line index for a bad line item", () => {
    const parsed = invoiceSchema.safeParse({
      customerId: "c-1",
      issueDate: "2026-11-24",
      dueDate: "2026-12-24",
      items: [
        filledLineJson("rate-1"),
        { ...filledLineJson("rate-1"), unitPrice: "" },
      ],
    });
    expect(parsed.success).toBe(false);
    if (parsed.success) throw new Error("unreachable");
    const err = firstValidationError(parsed.error);
    expect(err.lineIndex).toBe(1);
    expect(err.error).toMatch(/amount/i);
  });

  it("has no line index for a top-level error", () => {
    const parsed = invoiceSchema.safeParse({
      customerId: "",
      issueDate: "2026-11-24",
      dueDate: "2026-12-24",
      items: [filledLineJson("rate-1")],
    });
    expect(parsed.success).toBe(false);
    if (parsed.success) throw new Error("unreachable");
    const err = firstValidationError(parsed.error);
    expect(err.lineIndex).toBeUndefined();
    expect(err.error).toMatch(/customer/i);
  });

  it("reports 'Add at least one line item' when every line was empty", () => {
    const parsed = invoiceSchema.safeParse({
      customerId: "c-1",
      issueDate: "2026-11-24",
      dueDate: "2026-12-24",
      items: [],
    });
    expect(parsed.success).toBe(false);
    if (parsed.success) throw new Error("unreachable");
    expect(firstValidationError(parsed.error).error).toMatch(
      /at least one line item/i,
    );
  });
});
