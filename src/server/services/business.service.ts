import { prisma } from "@/lib/prisma";
import {
  canManageBusiness,
  getDefaultBusinessForUser,
  requireMembership,
  TenantError,
} from "@/lib/tenant";
import { logActivity } from "@/lib/activity";
import {
  businessProfileSchema,
  type BusinessProfileInput,
} from "@/lib/validation/business";

export type BusinessProfileResult =
  | { ok: true }
  | { ok: false; error: string };

/** The user's default business + settings + VAT rates, for the profile form. */
export async function getBusinessProfile(userId: string) {
  const business = await getDefaultBusinessForUser(userId);
  if (!business) return null;
  const [settings, taxRates] = await Promise.all([
    prisma.businessSettings.findUnique({ where: { businessId: business.id } }),
    prisma.taxRate.findMany({
      where: { businessId: business.id },
      orderBy: { code: "asc" },
    }),
  ]);
  return { business, settings, taxRates };
}

/**
 * Updates the business profile and settings in one transaction.
 * Only OWNER / ADMIN may edit. `logoUrl` / `signatureUrl` are set by
 * the caller (server action) after a validated upload — never from
 * raw client input. Every change is written to the ActivityLog.
 */
export async function updateBusinessProfile(
  userId: string,
  rawInput: unknown,
  files?: { logoUrl?: string; signatureUrl?: string },
): Promise<BusinessProfileResult> {
  const parsed = businessProfileSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const input: BusinessProfileInput = parsed.data;

  const business = await getDefaultBusinessForUser(userId);
  if (!business) return { ok: false, error: "No business found" };
  const membership = await requireMembership(userId, business.id);
  if (!canManageBusiness(membership.role)) {
    throw new TenantError(403, "Only owners and admins can edit the business profile");
  }

  // A default VAT rate must belong to this business.
  if (input.defaultVatRateId) {
    const rate = await prisma.taxRate.findFirst({
      where: { id: input.defaultVatRateId, businessId: business.id },
    });
    if (!rate) {
      return { ok: false, error: "Selected VAT rate does not belong to this business" };
    }
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.business.update({
        where: { id: business.id },
        data: {
          name: input.name,
          country: input.country,
          currency: input.currency,
          // Explicit nulls: an emptied field must clear the stored value,
          // not silently keep the old one.
          address: input.address ?? null,
          phone: input.phone ?? null,
          email: input.email ?? null,
          website: input.website ?? null,
          trn: input.trn ?? null,
          bankName: input.bankName ?? null,
          accountName: input.accountName ?? null,
          iban: input.iban ?? null,
          swift: input.swift ?? null,
          paymentInstructions: input.paymentInstructions ?? null,
          invoicePrefix: input.invoicePrefix.toUpperCase(),
          nextInvoiceNumber: input.nextInvoiceNumber,
          nextQuotationNumber: input.nextQuotationNumber,
          nextCreditNoteNumber: input.nextCreditNoteNumber,
          defaultVatRateId: input.defaultVatRateId ?? null,
          defaultTerms: input.defaultTerms ?? null,
          defaultFooter: input.defaultFooter ?? null,
          ...(files?.logoUrl ? { logoUrl: files.logoUrl } : {}),
          ...(files?.signatureUrl ? { signatureUrl: files.signatureUrl } : {}),
        },
      });
      await tx.businessSettings.upsert({
        where: { businessId: business.id },
        create: {
          businessId: business.id,
          locale: input.locale,
          timezone: input.timezone,
          dateFormat: input.dateFormat,
          pdfTemplate: input.pdfTemplate,
          primaryColor: input.primaryColor,
          emailFromName: input.emailFromName ?? null,
          emailFromAddress: input.emailFromAddress ?? null,
          emailProvider: input.emailProvider,
        },
        update: {
          locale: input.locale,
          timezone: input.timezone,
          dateFormat: input.dateFormat,
          pdfTemplate: input.pdfTemplate,
          primaryColor: input.primaryColor,
          emailFromName: input.emailFromName ?? null,
          emailFromAddress: input.emailFromAddress ?? null,
          emailProvider: input.emailProvider,
        },
      });
      await logActivity(tx, {
        businessId: business.id,
        userId,
        action: "business.updated",
        entityType: "Business",
        entityId: business.id,
        metadata: { name: input.name, currency: input.currency },
      });
    });
    return { ok: true };
  } catch (err) {
    console.error("updateBusinessProfile failed", err);
    return { ok: false, error: "Could not save the business profile. Please try again." };
  }
}
