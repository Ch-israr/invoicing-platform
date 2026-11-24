import bcrypt from "bcryptjs";
import { logActivity } from "@/lib/activity";
import { prisma } from "@/lib/prisma";
import { registerSchema, type RegisterInput } from "@/lib/validation/auth";

export const BCRYPT_COST = 12;

/** Slug for a business name, with a random suffix to keep it unique. */
export function slugifyBusinessName(name: string): string {
  const base =
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "business";
  return `${base}-${Math.random().toString(36).slice(2, 8)}`;
}

export type RegisterResult =
  | { ok: true; userId: string; businessId: string }
  | { ok: false; error: string };

/**
 * Creates a user and their first business in one transaction, with the
 * user as OWNER, UAE default tax rates and default settings.
 * Used by the register server action and by tests. Does NOT sign in —
 * the caller does that (server actions run outside a request in tests).
 */
export async function registerUserAccount(
  input: RegisterInput,
): Promise<RegisterResult> {
  const parsed = registerSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { name, businessName, email, password } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return { ok: false, error: "An account with this email already exists" };
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { name, email, passwordHash },
      });

      const business = await tx.business.create({
        data: {
          name: businessName,
          slug: slugifyBusinessName(businessName),
          country: "AE",
          currency: "AED",
        },
      });

      await tx.businessMembership.create({
        data: { userId: user.id, businessId: business.id, role: "OWNER" },
      });

      await tx.businessSettings.create({
        data: {
          businessId: business.id,
          locale: "en",
          timezone: "Asia/Dubai",
          pdfTemplate: "classic",
          emailProvider: "log",
        },
      });

      // UAE default tax rates (configurable per business, version-aware
      // via validFrom/validTo — never hardcoded in calculation code).
      const std = await tx.taxRate.create({
        data: {
          businessId: business.id,
          code: "STD_5",
          name: "Standard rate 5%",
          rate: 5,
          country: "AE",
          isDefault: true,
        },
      });
      await tx.taxRate.create({
        data: {
          businessId: business.id,
          code: "ZERO",
          name: "Zero-rated 0%",
          rate: 0,
          country: "AE",
        },
      });
      await tx.taxRate.create({
        data: {
          businessId: business.id,
          code: "EXEMPT",
          name: "Exempt 0%",
          rate: 0,
          country: "AE",
        },
      });

      await tx.business.update({
        where: { id: business.id },
        data: { defaultVatRateId: std.id },
      });

      // Registration is the one auth event in the audit trail (failed
      // logins are not stored — see docs/SECURITY.md). The business
      // exists by now, so the row has a businessId like every other.
      await logActivity(tx, {
        businessId: business.id,
        userId: user.id,
        action: "user.registered",
        entityType: "User",
        entityId: user.id,
        metadata: { email },
      });

      return { userId: user.id, businessId: business.id };
    });

    return { ok: true, ...result };
  } catch (err) {
    console.error("registerUserAccount failed", err);
    return { ok: false, error: "Registration failed. Please try again." };
  }
}

/** Returns the user (without password hash) when credentials are valid. */
export async function verifyCredentials(email: string, password: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.passwordHash) return null;
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return null;
  return { id: user.id, name: user.name, email: user.email };
}
