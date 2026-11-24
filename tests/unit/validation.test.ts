import { describe, expect, it } from "vitest";
import { loginSchema, registerSchema } from "@/lib/validation/auth";
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
