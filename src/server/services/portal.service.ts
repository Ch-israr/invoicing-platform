import { randomBytes, createHash } from "node:crypto";
import type { CustomerPortalToken } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  canManageBusiness,
  getDefaultBusinessForUser,
  requireMembership,
  TenantError,
} from "@/lib/tenant";
import { checkRateLimit } from "@/lib/rate-limit";
import { logActivity } from "@/lib/activity";

/**
 * Customer portal — token-gated public access to invoices and
 * quotations. No login; a customer opens a link the business shared.
 *
 * Token format: `crypto.randomBytes(32)` rendered base64url (43 chars).
 * Only the SHA-256 hash is stored (tokenHash @unique). The plaintext is
 * returned to the business user exactly once, at creation, and never
 * stored or logged.
 *
 * Scope format: `invoice:<invoiceId>` | `quotation:<quotationId>` |
 * `customer:<customerId>`. A document token opens that document only;
 * a customer token opens the customer's portal dashboard (all of that
 * customer's issued invoices + sent quotations) and, from there, any
 * single document belonging to that customer.
 *
 * Default expiry: 30 days. Expired and revoked tokens are rejected
 * with the same generic message as an unknown token, so a prober
 * cannot tell which case applies.
 */

export const PORTAL_TOKEN_DEFAULT_EXPIRY_DAYS = 30;
/** Verification attempts allowed per IP per minute (failed + passed). */
export const PORTAL_VERIFY_RATE_LIMIT = 10;

export type PortalScope =
  | { kind: "invoice"; invoiceId: string }
  | { kind: "quotation"; quotationId: string }
  | { kind: "customer"; customerId: string };

export function parsePortalScope(scope: string): PortalScope | null {
  const [kind, id] = scope.split(":");
  if (!id) return null;
  if (kind === "invoice") return { kind: "invoice", invoiceId: id };
  if (kind === "quotation") return { kind: "quotation", quotationId: id };
  if (kind === "customer") return { kind: "customer", customerId: id };
  return null;
}

export function formatPortalScope(scope: PortalScope): string {
  if (scope.kind === "invoice") return `invoice:${scope.invoiceId}`;
  if (scope.kind === "quotation") return `quotation:${scope.quotationId}`;
  return `customer:${scope.customerId}`;
}

export function hashPortalToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export type PortalTokenResult =
  | { ok: true; data: { token: string; url: string; row: CustomerPortalToken } }
  | { ok: false; error: string };

function portalUrl(token: string): string {
  return `/portal/${token}`;
}

function normalizeExpiryDays(expiresInDays: number | undefined): number {
  if (expiresInDays === undefined) return PORTAL_TOKEN_DEFAULT_EXPIRY_DAYS;
  const n = Math.floor(expiresInDays);
  if (!Number.isFinite(n) || n < 1) return 1;
  if (n > 365) return 365;
  return n;
}

/**
 * Create a portal token for an invoice, a quotation, or a whole
 * customer. Only issued invoices and sent/accepted quotations can be
 * shared (drafts have no stable content to show). Returns the
 * plaintext token exactly once — the caller must show it to the
 * business user and never store it elsewhere.
 */
export async function createPortalToken(
  userId: string,
  input: {
    invoiceId?: string;
    quotationId?: string;
    customerId?: string;
    expiresInDays?: number;
  },
): Promise<PortalTokenResult> {
  const business = await getDefaultBusinessForUser(userId);
  if (!business) throw new TenantError(404, "Business not found");
  const membership = await requireMembership(userId, business.id);
  if (!canManageBusiness(membership.role)) {
    throw new TenantError(403, "Only owners and admins can share portal links");
  }

  let customerId: string;
  let scope: PortalScope;
  if (input.invoiceId) {
    const invoice = await prisma.invoice.findFirst({
      where: { id: input.invoiceId, businessId: business.id },
      select: { id: true, customerId: true, status: true },
    });
    if (!invoice) throw new TenantError(404, "Invoice not found");
    if (invoice.status === "DRAFT" || invoice.status === "CANCELLED") {
      return { ok: false, error: "Only issued invoices can be shared on the portal" };
    }
    customerId = invoice.customerId;
    scope = { kind: "invoice", invoiceId: invoice.id };
  } else if (input.quotationId) {
    const quotation = await prisma.quotation.findFirst({
      where: { id: input.quotationId, businessId: business.id },
      select: { id: true, customerId: true, status: true },
    });
    if (!quotation) throw new TenantError(404, "Quotation not found");
    if (quotation.status !== "SENT" && quotation.status !== "ACCEPTED") {
      return { ok: false, error: "Only sent quotations can be shared on the portal" };
    }
    customerId = quotation.customerId;
    scope = { kind: "quotation", quotationId: quotation.id };
  } else if (input.customerId) {
    const customer = await prisma.customer.findFirst({
      where: { id: input.customerId, businessId: business.id },
      select: { id: true },
    });
    if (!customer) throw new TenantError(404, "Customer not found");
    customerId = customer.id;
    scope = { kind: "customer", customerId: customer.id };
  } else {
    return { ok: false, error: "Choose an invoice, a quotation or a customer to share" };
  }

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(
    Date.now() + normalizeExpiryDays(input.expiresInDays) * 86_400_000,
  );
  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.customerPortalToken.create({
      data: {
        customerId,
        invoiceId: scope.kind === "invoice" ? scope.invoiceId : null,
        quotationId: scope.kind === "quotation" ? scope.quotationId : null,
        tokenHash: hashPortalToken(token),
        scope: formatPortalScope(scope),
        expiresAt,
      },
    });
    await logActivity(tx, {
      businessId: business.id,
      userId,
      action: "portal.token_created",
      entityType: "CustomerPortalToken",
      entityId: created.id,
      metadata: { scope: formatPortalScope(scope), expiresAt: expiresAt.toISOString() },
    });
    return created;
  });

  return { ok: true, data: { token, url: portalUrl(token), row } };
}

export type PortalTokenView = {
  id: string;
  scope: string;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
};

/** Tokens for one document (or customer), newest first. */
export async function listPortalTokens(
  userId: string,
  input: { invoiceId?: string; quotationId?: string; customerId?: string },
): Promise<PortalTokenView[]> {
  const business = await getDefaultBusinessForUser(userId);
  if (!business) throw new TenantError(404, "Business not found");
  await requireMembership(userId, business.id);
  // Tenant check on the document itself: without it, anyone who knows
  // (or guesses) an invoice id could list another business's portal
  // tokens (scope + expiry metadata). The detail pages load the
  // document first so the UI path was already safe; the service now
  // enforces it for every caller.
  if (input.invoiceId) {
    const invoice = await prisma.invoice.findFirst({
      where: { id: input.invoiceId, businessId: business.id },
      select: { id: true },
    });
    if (!invoice) throw new TenantError(404, "Invoice not found");
  } else if (input.quotationId) {
    const quotation = await prisma.quotation.findFirst({
      where: { id: input.quotationId, businessId: business.id },
      select: { id: true },
    });
    if (!quotation) throw new TenantError(404, "Quotation not found");
  } else if (input.customerId) {
    const customer = await prisma.customer.findFirst({
      where: { id: input.customerId, businessId: business.id },
      select: { id: true },
    });
    if (!customer) throw new TenantError(404, "Customer not found");
  }
  const rows = await prisma.customerPortalToken.findMany({
    where: {
      customerId: input.customerId,
      invoiceId: input.invoiceId,
      quotationId: input.quotationId,
    },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((r) => ({
    id: r.id,
    scope: r.scope,
    expiresAt: r.expiresAt,
    revokedAt: r.revokedAt,
    createdAt: r.createdAt,
  }));
}

/** Revoke a token (OWNER/ADMIN). Revocation is permanent. */
export async function revokePortalToken(
  userId: string,
  tokenId: string,
): Promise<{ ok: boolean; error?: string }> {
  const business = await getDefaultBusinessForUser(userId);
  if (!business) throw new TenantError(404, "Business not found");
  const membership = await requireMembership(userId, business.id);
  if (!canManageBusiness(membership.role)) {
    throw new TenantError(403, "Only owners and admins can revoke portal links");
  }
  const row = await prisma.customerPortalToken.findUnique({
    where: { id: tokenId },
    include: { customer: { select: { businessId: true } } },
  });
  if (!row || row.customer.businessId !== business.id) {
    throw new TenantError(404, "Portal link not found");
  }
  if (row.revokedAt) return { ok: true };
  await prisma.$transaction(async (tx) => {
    await tx.customerPortalToken.update({
      where: { id: tokenId },
      data: { revokedAt: new Date() },
    });
    await logActivity(tx, {
      businessId: business.id,
      userId,
      action: "portal.token_revoked",
      entityType: "CustomerPortalToken",
      entityId: tokenId,
      metadata: { scope: row.scope },
    });
  });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Verification (public, no login)
// ---------------------------------------------------------------------------

export type PortalContext =
  | {
      kind: "invoice";
      scope: PortalScope;
      businessId: string;
      customerId: string;
      invoiceId: string;
    }
  | {
      kind: "quotation";
      scope: PortalScope;
      businessId: string;
      customerId: string;
      quotationId: string;
    }
  | {
      kind: "customer";
      scope: PortalScope;
      businessId: string;
      customerId: string;
    };

export type PortalVerifyResult =
  | { ok: true; context: PortalContext }
  | { ok: false; error: string; rateLimited?: boolean };

const GENERIC_INVALID = "This link is no longer valid.";

/**
 * Verify a presented portal token. Rate-limited per IP; expired,
 * revoked and unknown tokens all fail with the same generic message.
 * On success returns the token's scope plus the business/customer it
 * belongs to — every later query must be scoped by those ids.
 */
export async function verifyPortalToken(
  token: string,
  ip: string,
): Promise<PortalVerifyResult> {
  const limit = checkRateLimit(
    `portal:${ip}`,
    PORTAL_VERIFY_RATE_LIMIT,
    60_000,
  );
  if (!limit.allowed) {
    console.warn(`Portal verification rate-limited for IP ${ip}`);
    return { ok: false, error: "Too many attempts — try again shortly.", rateLimited: true };
  }
  if (!token || token.length < 20) {
    console.warn(`Portal verification failed for IP ${ip}: malformed token`);
    return { ok: false, error: GENERIC_INVALID };
  }
  const row = await prisma.customerPortalToken.findUnique({
    where: { tokenHash: hashPortalToken(token) },
  });
  if (!row || row.revokedAt || row.expiresAt.getTime() < Date.now()) {
    console.warn(
      `Portal verification failed for IP ${ip}: ${!row ? "unknown" : row.revokedAt ? "revoked" : "expired"} token ${row?.id ?? ""}`,
    );
    return { ok: false, error: GENERIC_INVALID };
  }
  const scope = parsePortalScope(row.scope);
  if (!scope) return { ok: false, error: GENERIC_INVALID };
  const customer = await prisma.customer.findUnique({
    where: { id: row.customerId },
    select: { businessId: true },
  });
  if (!customer) return { ok: false, error: GENERIC_INVALID };

  if (scope.kind === "invoice") {
    return {
      ok: true,
      context: {
        kind: "invoice",
        scope,
        businessId: customer.businessId,
        customerId: row.customerId,
        invoiceId: scope.invoiceId,
      },
    };
  }
  if (scope.kind === "quotation") {
    return {
      ok: true,
      context: {
        kind: "quotation",
        scope,
        businessId: customer.businessId,
        customerId: row.customerId,
        quotationId: scope.quotationId,
      },
    };
  }
  return {
    ok: true,
    context: {
      kind: "customer",
      scope,
      businessId: customer.businessId,
      customerId: row.customerId,
    },
  };
}

// ---------------------------------------------------------------------------
// Portal data resolution — every query is scoped by the verified token.
// ---------------------------------------------------------------------------

const BILLED_STATUSES = ["ISSUED", "SENT", "PARTIALLY_PAID", "PAID"] as const;

/** Load an invoice for the portal, scoped by a verified token. */
export async function getPortalInvoice(context: PortalContext, invoiceId: string) {
  const invoice = await prisma.invoice.findFirst({
    where: {
      id: invoiceId,
      businessId: context.businessId,
      customerId: context.customerId,
      status: { in: [...BILLED_STATUSES] },
    },
    include: {
      customer: true,
      snapshot: true,
      items: { orderBy: { sortOrder: "asc" } },
      documents: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  if (!invoice) return null;
  // A single-invoice token only opens its own invoice.
  if (context.kind === "invoice" && context.invoiceId !== invoiceId) return null;
  const business = await prisma.business.findUnique({
    where: { id: context.businessId },
  });
  if (!business) return null;
  return { business, invoice };
}

/** Load a quotation for the portal, scoped by a verified token. */
export async function getPortalQuotation(context: PortalContext, quotationId: string) {
  const quotation = await prisma.quotation.findFirst({
    where: {
      id: quotationId,
      businessId: context.businessId,
      customerId: context.customerId,
    },
    include: { customer: true, items: { orderBy: { sortOrder: "asc" } } },
  });
  if (!quotation) return null;
  if (context.kind === "quotation" && context.quotationId !== quotationId) return null;
  const business = await prisma.business.findUnique({
    where: { id: context.businessId },
  });
  const settings = await prisma.businessSettings.findUnique({
    where: { businessId: context.businessId },
  });
  if (!business) return null;
  return { business, settings, quotation };
}

/** Customer dashboard: their issued invoices + sent/accepted quotations. */
export async function getPortalCustomerDocuments(context: PortalContext) {
  const [customer, invoices, quotations] = await Promise.all([
    prisma.customer.findUnique({ where: { id: context.customerId } }),
    prisma.invoice.findMany({
      where: {
        businessId: context.businessId,
        customerId: context.customerId,
        status: { in: [...BILLED_STATUSES] },
      },
      orderBy: { issueDate: "desc" },
      select: {
        id: true,
        number: true,
        status: true,
        issueDate: true,
        dueDate: true,
        grandTotal: true,
        balance: true,
      },
    }),
    prisma.quotation.findMany({
      where: {
        businessId: context.businessId,
        customerId: context.customerId,
        status: { in: ["SENT", "ACCEPTED", "REJECTED", "EXPIRED"] },
      },
      orderBy: { issueDate: "desc" },
      select: {
        id: true,
        number: true,
        status: true,
        issueDate: true,
        expiryDate: true,
        grandTotal: true,
      },
    }),
  ]);
  return { customer, invoices, quotations };
}

/**
 * Accept / reject a quotation from the portal. Only a token whose
 * scope covers that quotation (quotation token, or customer token for
 * the same customer) may do it — an invoice token can never accept a
 * quotation. Only SENT quotations can be decided.
 */
export async function decideQuotationViaPortal(
  token: string,
  ip: string,
  quotationId: string,
  decision: "ACCEPTED" | "REJECTED",
): Promise<{ ok: boolean; error?: string }> {
  const verified = await verifyPortalToken(token, ip);
  if (!verified.ok) return { ok: false, error: verified.error };
  const context = verified.context;
  if (context.kind === "invoice") {
    return { ok: false, error: "This link does not cover that quotation" };
  }
  if (context.kind === "quotation" && context.quotationId !== quotationId) {
    return { ok: false, error: "This link does not cover that quotation" };
  }
  const data = await getPortalQuotation(context, quotationId);
  if (!data) return { ok: false, error: GENERIC_INVALID };
  if (data.quotation.status !== "SENT") {
    return { ok: false, error: "This quotation can no longer be decided" };
  }
  await prisma.$transaction(async (tx) => {
    await tx.quotation.update({
      where: { id: quotationId },
      data: { status: decision },
    });
    await logActivity(tx, {
      businessId: context.businessId,
      userId: null,
      action: decision === "ACCEPTED" ? "portal.quotation_accepted" : "portal.quotation_rejected",
      entityType: "Quotation",
      entityId: quotationId,
      metadata: { via: "portal" },
    });
  });
  return { ok: true };
}
