import type { Business, BusinessMembership, Role } from "@prisma/client";
import { prisma } from "./prisma";

/**
 * Tenant isolation + RBAC.
 *
 * Rule: no business-owned row is ever read or written without a
 * businessId that the current user is a member of. Callers that receive
 * a businessId from the client MUST resolve it through
 * getBusinessForUser() / requireMembership() first — a null result means
 * "not found" (never leak whether the business exists to a non-member).
 */

export class TenantError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function hasRole(role: Role, allowed: Role[]): boolean {
  return allowed.includes(role);
}

/** Roles allowed to create / edit / delete business data. */
export function canWrite(role: Role): boolean {
  return role === "OWNER" || role === "ADMIN" || role === "MEMBER";
}

/** Roles allowed to manage the business itself and its members. */
export function canManageBusiness(role: Role): boolean {
  return role === "OWNER" || role === "ADMIN";
}

/** Spread into a Prisma `where` to scope any business-owned query. */
export function scopeWhere(businessId: string): { businessId: string } {
  return { businessId };
}

export async function getMembership(
  userId: string,
  businessId: string,
): Promise<BusinessMembership | null> {
  return prisma.businessMembership.findUnique({
    where: { userId_businessId: { userId, businessId } },
  });
}

/**
 * Returns the business only if the user is a member, otherwise null.
 * Use this for any user-supplied businessId — callers translate null
 * into a 404.
 */
export async function getBusinessForUser(
  userId: string,
  businessId: string,
): Promise<(Business & { membership: BusinessMembership }) | null> {
  const membership = await getMembership(userId, businessId);
  if (!membership) return null;
  const business = await prisma.business.findUnique({
    where: { id: businessId },
  });
  if (!business) return null;
  return { ...business, membership };
}

export async function requireMembership(
  userId: string,
  businessId: string,
): Promise<BusinessMembership> {
  const membership = await getMembership(userId, businessId);
  if (!membership) {
    throw new TenantError(404, "Business not found");
  }
  return membership;
}

export async function requireCanWrite(
  userId: string,
  businessId: string,
): Promise<BusinessMembership> {
  const membership = await requireMembership(userId, businessId);
  if (!canWrite(membership.role)) {
    throw new TenantError(403, "Your role is read-only");
  }
  return membership;
}

/**
 * Single-business UI first: the user's first (oldest) business.
 * Multi-business switching is a later phase; the data model already
 * supports it.
 */
export async function getDefaultBusinessForUser(
  userId: string,
): Promise<(Business & { membership: BusinessMembership }) | null> {
  const membership = await prisma.businessMembership.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" },
    include: { business: true },
  });
  if (!membership) return null;
  return { ...membership.business, membership };
}

export async function listBusinessesForUser(
  userId: string,
): Promise<(Business & { membership: BusinessMembership })[]> {
  const memberships = await prisma.businessMembership.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    include: { business: true },
  });
  return memberships.map((m) => ({ ...m.business, membership: m }));
}
