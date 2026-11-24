import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  getBusinessForUser,
  getDefaultBusinessForUser,
  requireMembership,
  scopeWhere,
} from "@/lib/tenant";
import { registerUserAccount } from "@/server/services/auth.service";

const uid = () => Math.random().toString(36).slice(2, 10);

async function makeAccount() {
  const email = `tenant-${uid()}@example.com`;
  const result = await registerUserAccount({
    name: "Tenant Test",
    businessName: `Tenant ${uid()} LLC`,
    email,
    password: "correct-horse-battery",
  });
  if (!result.ok) throw new Error(`setup failed: ${result.error}`);
  return result;
}

describe("tenant isolation", () => {
  it("user B cannot resolve user A's business (404 semantics, no leak)", async () => {
    const a = await makeAccount();
    const b = await makeAccount();

    expect(await getBusinessForUser(b.userId, a.businessId)).toBeNull();
    expect(await getBusinessForUser(a.userId, a.businessId)).not.toBeNull();
    await expect(requireMembership(b.userId, a.businessId)).rejects.toThrow(
      "Business not found",
    );
  });

  it("a business-scoped customer query returns nothing for another business", async () => {
    const a = await makeAccount();
    const b = await makeAccount();

    await prisma.customer.create({
      data: {
        ...scopeWhere(a.businessId),
        type: "COMPANY",
        name: "Acme Corp",
        email: "billing@acme.example",
      },
    });

    const seenByA = await prisma.customer.findMany({
      where: scopeWhere(a.businessId),
    });
    expect(seenByA.map((c) => c.name)).toContain("Acme Corp");

    const seenByB = await prisma.customer.findMany({
      where: scopeWhere(b.businessId),
    });
    expect(seenByB).toEqual([]);
  });

  it("each user only sees their own default business", async () => {
    const a = await makeAccount();
    const b = await makeAccount();

    const defaultA = await getDefaultBusinessForUser(a.userId);
    const defaultB = await getDefaultBusinessForUser(b.userId);
    expect(defaultA?.id).toBe(a.businessId);
    expect(defaultB?.id).toBe(b.businessId);
    expect(defaultA?.id).not.toBe(defaultB?.id);
  });

  it("a user with no memberships has no default business", async () => {
    const user = await prisma.user.create({
      data: {
        name: "No Business",
        email: `nobiz-${uid()}@example.com`,
        passwordHash: "not-a-real-hash",
      },
    });
    expect(await getDefaultBusinessForUser(user.id)).toBeNull();
    expect(await getBusinessForUser(user.id, "nonexistent")).toBeNull();
  });
});
