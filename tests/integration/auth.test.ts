import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  BCRYPT_COST,
  registerUserAccount,
  verifyCredentials,
} from "@/server/services/auth.service";

const uid = () => Math.random().toString(36).slice(2, 10);

describe("registration service", () => {
  it("creates a user, an OWNER membership, a business, settings and UAE tax rates", async () => {
    const email = `phase1-${uid()}@example.com`;
    const result = await registerUserAccount({
      name: "Phase One",
      businessName: "Phase One Trading LLC",
      email,
      password: "correct-horse-battery",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const user = await prisma.user.findUnique({
      where: { id: result.userId },
    });
    expect(user).not.toBeNull();
    // Password is bcrypt-hashed at cost 12, never stored in plain text.
    expect(user!.passwordHash).toMatch(/^\$2[ab]\$12\$/);
    expect(user!.passwordHash).not.toContain("correct-horse-battery");

    const membership = await prisma.businessMembership.findUnique({
      where: {
        userId_businessId: { userId: result.userId, businessId: result.businessId },
      },
    });
    expect(membership?.role).toBe("OWNER");

    const settings = await prisma.businessSettings.findUnique({
      where: { businessId: result.businessId },
    });
    expect(settings?.locale).toBe("en");
    expect(settings?.timezone).toBe("Asia/Dubai");

    const rates = await prisma.taxRate.findMany({
      where: { businessId: result.businessId },
      orderBy: { code: "asc" },
    });
    expect(rates.map((r) => r.code)).toEqual(["EXEMPT", "STD_5", "ZERO"]);
    const std = rates.find((r) => r.code === "STD_5");
    expect(std?.rate.toString()).toBe("5");
    expect(std?.isDefault).toBe(true);

    const business = await prisma.business.findUnique({
      where: { id: result.businessId },
    });
    expect(business?.currency).toBe("AED");
    expect(business?.defaultVatRateId).toBe(std?.id);
  });

  it("rejects a duplicate email", async () => {
    const email = `dup-${uid()}@example.com`;
    const first = await registerUserAccount({
      name: "Dup",
      businessName: "Dup LLC",
      email,
      password: "correct-horse-battery",
    });
    expect(first.ok).toBe(true);
    const second = await registerUserAccount({
      name: "Dup",
      businessName: "Dup LLC",
      email,
      password: "correct-horse-battery",
    });
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.error).toMatch(/already exists/);
    }
  });

  it("rejects a short password", async () => {
    const result = await registerUserAccount({
      name: "Short",
      businessName: "Short LLC",
      email: `short-${uid()}@example.com`,
      password: "tiny",
    });
    expect(result.ok).toBe(false);
  });
});

describe("credential verification", () => {
  let email: string;

  beforeAll(async () => {
    email = `login-${uid()}@example.com`;
    const result = await registerUserAccount({
      name: "Login Test",
      businessName: "Login Test LLC",
      email,
      password: "correct-horse-battery",
    });
    expect(result.ok).toBe(true);
  });

  it("returns the user for correct credentials", async () => {
    const user = await verifyCredentials(email, "correct-horse-battery");
    expect(user).not.toBeNull();
    expect(user?.email).toBe(email);
    // No password hash leaks through the credential check.
    expect(user).not.toHaveProperty("passwordHash");
  });

  it("returns null for a wrong password", async () => {
    expect(
      await verifyCredentials(email, "wrong-password-here"),
    ).toBeNull();
  });

  it("returns null for an unknown email", async () => {
    expect(
      await verifyCredentials(`nobody-${uid()}@example.com`, "whatever-password"),
    ).toBeNull();
  });

  it("uses bcrypt cost 12", () => {
    expect(BCRYPT_COST).toBe(12);
  });
});
