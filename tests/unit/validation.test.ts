import { describe, expect, it } from "vitest";
import { loginSchema, registerSchema } from "@/lib/validation/auth";
import { invoiceSchema } from "@/lib/validation/invoice";
import { paymentSchema } from "@/lib/validation/payment";
import { checkRateLimit, resetRateLimits } from "@/lib/rate-limit";
import { canManageBusiness, canWrite, hasRole, scopeWhere } from "@/lib/tenant";
import { slugifyBusinessName } from "@/server/services/auth.service";

describe("auth validation", () => {
  it("rejects a password shorter than 10 characters", () => {
    const result = registerSchema.safeParse({
      name: "Test User",
      businessName: "Test LLC",
      email: "test@example.com",
      password: "short",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a valid registration payload", () => {
    const result = registerSchema.safeParse({
      name: "Test User",
      businessName: "Test LLC",
      email: "Test@Example.com",
      password: "longenoughpassword",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      // Email is normalized to lowercase.
      expect(result.data.email).toBe("test@example.com");
    }
  });

  it("rejects an invalid email on login", () => {
    const result = loginSchema.safeParse({
      email: "not-an-email",
      password: "whatever",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an empty password on login", () => {
    const result = loginSchema.safeParse({
      email: "test@example.com",
      password: "",
    });
    expect(result.success).toBe(false);
  });
});

describe("rate limiter", () => {
  it("allows up to the limit, then blocks until the window resets", () => {
    resetRateLimits();
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit("test-key", 5, 60_000).allowed).toBe(true);
    }
    const blocked = checkRateLimit("test-key", 5, 60_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it("isolates counters per key", () => {
    resetRateLimits();
    for (let i = 0; i < 5; i++) checkRateLimit("key-a", 5, 60_000);
    expect(checkRateLimit("key-b", 5, 60_000).allowed).toBe(true);
  });
});

describe("tenant / RBAC helpers", () => {
  it("hasRole matches only listed roles", () => {
    expect(hasRole("OWNER", ["OWNER", "ADMIN"])).toBe(true);
    expect(hasRole("VIEWER", ["OWNER", "ADMIN"])).toBe(false);
  });

  it("canWrite allows OWNER/ADMIN/MEMBER but not VIEWER", () => {
    expect(canWrite("OWNER")).toBe(true);
    expect(canWrite("ADMIN")).toBe(true);
    expect(canWrite("MEMBER")).toBe(true);
    expect(canWrite("VIEWER")).toBe(false);
  });

  it("canManageBusiness allows only OWNER/ADMIN", () => {
    expect(canManageBusiness("OWNER")).toBe(true);
    expect(canManageBusiness("ADMIN")).toBe(true);
    expect(canManageBusiness("MEMBER")).toBe(false);
    expect(canManageBusiness("VIEWER")).toBe(false);
  });

  it("scopeWhere produces a businessId filter", () => {
    expect(scopeWhere("biz_123")).toEqual({ businessId: "biz_123" });
  });

  it("slugifyBusinessName produces a URL-safe slug with suffix", () => {
    const slug = slugifyBusinessName("Israr Trading LLC!");
    expect(slug).toMatch(/^israr-trading-llc-[a-z0-9]{6}$/);
  });
});

describe("invoice discount validation", () => {
  const base = {
    customerId: "c1",
    issueDate: "2026-11-25",
    dueDate: "2026-12-25",
    items: [
      {
        description: "Service",
        quantity: "1",
        unit: "hour",
        unitPrice: "100",
        discountType: "NONE",
        discountValue: "0",
        taxCategory: "STANDARD",
        taxInclusive: false,
      },
    ],
  };

  it("accepts an invoice with no discount fields (defaults to none)", () => {
    const result = invoiceSchema.safeParse(base);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.invoiceDiscountType).toBe("NONE");
      expect(result.data.earlyDiscountType).toBe("NONE");
    }
  });

  it("accepts a 10% invoice discount and a 2% / 10-day early-payment discount", () => {
    const result = invoiceSchema.safeParse({
      ...base,
      invoiceDiscountType: "PERCENT",
      invoiceDiscountValue: "10",
      earlyDiscountType: "PERCENT",
      earlyDiscountValue: "2",
      earlyDiscountDays: "10",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a percentage discount above 100", () => {
    const result = invoiceSchema.safeParse({
      ...base,
      invoiceDiscountType: "PERCENT",
      invoiceDiscountValue: "101",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a negative fixed discount", () => {
    const result = invoiceSchema.safeParse({
      ...base,
      invoiceDiscountType: "FIXED",
      invoiceDiscountValue: "-5",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a non-numeric discount value", () => {
    const result = invoiceSchema.safeParse({
      ...base,
      invoiceDiscountType: "PERCENT",
      invoiceDiscountValue: "ten",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a negative or fractional early-payment window", () => {
    expect(
      invoiceSchema.safeParse({
        ...base,
        earlyDiscountType: "PERCENT",
        earlyDiscountValue: "2",
        earlyDiscountDays: "-1",
      }).success,
    ).toBe(false);
    expect(
      invoiceSchema.safeParse({
        ...base,
        earlyDiscountType: "PERCENT",
        earlyDiscountValue: "2",
        earlyDiscountDays: "1.5",
      }).success,
    ).toBe(false);
  });

  it("accepts a 0-day early-payment window (pay today only)", () => {
    const result = invoiceSchema.safeParse({
      ...base,
      earlyDiscountType: "FIXED",
      earlyDiscountValue: "5",
      earlyDiscountDays: "0",
    });
    expect(result.success).toBe(true);
  });
});

describe("payment early-discount flag", () => {
  const base = {
    date: "2026-11-25",
    amount: "98.00",
    method: "BANK_TRANSFER",
  };

  it("parses a ticked checkbox to true and an absent one to false", () => {
    const ticked = paymentSchema.safeParse({ ...base, applyEarlyDiscount: "true" });
    expect(ticked.success).toBe(true);
    if (ticked.success) expect(ticked.data.applyEarlyDiscount).toBe(true);
    const unticked = paymentSchema.safeParse(base);
    expect(unticked.success).toBe(true);
    if (unticked.success) expect(unticked.data.applyEarlyDiscount).toBe(false);
  });
});
