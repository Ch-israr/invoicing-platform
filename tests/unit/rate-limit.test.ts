import { beforeEach, describe, expect, it } from "vitest";
import {
  apiRateLimit,
  checkRateLimit,
  clientIpFromHeaders,
  resetRateLimits,
} from "@/lib/rate-limit";
import { safeBackPath } from "@/lib/utils";

function headers(ip: string): Headers {
  return new Headers({ "x-forwarded-for": ip });
}

describe("checkRateLimit", () => {
  beforeEach(() => resetRateLimits());

  it("allows the first 5 login attempts from one IP, then blocks the 6th", () => {
    const key = "auth-login:203.0.113.7";
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit(key, 5, 60_000).allowed).toBe(true);
    }
    const sixth = checkRateLimit(key, 5, 60_000);
    expect(sixth.allowed).toBe(false);
    expect(sixth.retryAfterMs).toBeGreaterThan(0);
  });

  it("a different IP gets its own bucket", () => {
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit("auth-login:203.0.113.7", 5, 60_000).allowed).toBe(true);
    }
    expect(checkRateLimit("auth-login:198.51.100.9", 5, 60_000).allowed).toBe(true);
  });

  it("reset clears the counters", () => {
    const key = "auth-login:203.0.113.7";
    for (let i = 0; i < 6; i++) checkRateLimit(key, 5, 60_000);
    expect(checkRateLimit(key, 5, 60_000).allowed).toBe(false);
    resetRateLimits();
    expect(checkRateLimit(key, 5, 60_000).allowed).toBe(true);
  });
});

describe("apiRateLimit", () => {
  beforeEach(() => resetRateLimits());

  it("allows normal requests and returns 429 with Retry-After after the limit", () => {
    const opts = { prefix: "api:test", limit: 60, windowMs: 60_000 };
    for (let i = 0; i < 60; i++) {
      expect(apiRateLimit({ headers: headers("203.0.113.7") }, opts)).toBeNull();
    }
    const limited = apiRateLimit({ headers: headers("203.0.113.7") }, opts);
    expect(limited).not.toBeNull();
    expect(limited!.status).toBe(429);
    expect(limited!.headers.get("Retry-After")).toMatch(/^\d+$/);
  });

  it("different route groups do not share a bucket", () => {
    const a = { prefix: "api:pdf", limit: 1, windowMs: 60_000 };
    const b = { prefix: "api:reports", limit: 1, windowMs: 60_000 };
    expect(apiRateLimit({ headers: headers("203.0.113.7") }, a)).toBeNull();
    expect(apiRateLimit({ headers: headers("203.0.113.7") }, a)!.status).toBe(429);
    expect(apiRateLimit({ headers: headers("203.0.113.7") }, b)).toBeNull();
  });

  it("clientIpFromHeaders prefers x-forwarded-for's first entry", () => {
    expect(clientIpFromHeaders(headers("203.0.113.7, 10.0.0.1"))).toBe("203.0.113.7");
    expect(clientIpFromHeaders(new Headers({ "x-real-ip": "198.51.100.9" }))).toBe(
      "198.51.100.9",
    );
    expect(clientIpFromHeaders(new Headers())).toBe("unknown");
  });
});

describe("safeBackPath", () => {
  it("allows same-site relative paths", () => {
    expect(safeBackPath("/invoices", "/emails")).toBe("/invoices");
    expect(safeBackPath("/emails?retried=1", "/emails")).toBe("/emails?retried=1");
  });

  it("rejects protocol-relative and absolute URLs", () => {
    expect(safeBackPath("//evil.com", "/emails")).toBe("/emails");
    expect(safeBackPath("https://evil.com", "/emails")).toBe("/emails");
    expect(safeBackPath("http://evil.com/x", "/emails")).toBe("/emails");
  });

  it("rejects non-strings and backslashes", () => {
    expect(safeBackPath(undefined, "/emails")).toBe("/emails");
    expect(safeBackPath("", "/emails")).toBe("/emails");
    expect(safeBackPath("/\\evil.com", "/emails")).toBe("/emails");
  });
});
