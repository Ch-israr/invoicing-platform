import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import {
  canManageBusiness,
  requireMembership,
  TenantError,
} from "@/lib/tenant";
import { logActivity } from "@/lib/activity";
import { deleteFile, readUpload, saveFile } from "@/lib/storage";
import {
  isSnapshotPayload,
  previewDataFromLive,
  previewDataFromSnapshot,
  type LiveBusiness,
  type LiveCustomer,
  type LiveInvoice,
} from "@/lib/invoice-preview";
import { getInvoiceForUser } from "@/server/services/invoice.service";
import { renderInvoicePdf } from "./generate";

/**
 * PDF lifecycle for invoices.
 *
 * - Issued invoices get a STORED PDF, generated at issue time (the
 *   issue action calls generateInvoicePdf) and served from storage.
 *   The PDF is rendered from the frozen InvoiceSnapshot — never from
 *   live customer/product rows — so later edits cannot change it.
 * - Drafts are never stored. Downloading a draft renders a fresh
 *   watermarked PDF in memory (clearly marked DRAFT).
 * - Regenerate (OWNER/ADMIN, issued only) re-renders the same
 *   snapshot with the current template code and replaces the stored
 *   file; the old file is deleted.
 */

export type PdfResult<T = void> =
  | ({ ok: true } & (T extends void ? object : { data: T }))
  | { ok: false; error: string };

export function pdfFileName(number: string): string {
  const safe = number.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 80) || "invoice";
  return `${safe}.pdf`;
}

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

type StoredPdf = {
  documentId: string;
  storageKey: string;
  fileSize: number;
  checksum: string;
  fileName: string;
};

/**
 * Generate (or re-generate) the stored PDF for an issued invoice.
 * Renders from the frozen snapshot, saves via the storage provider,
 * and upserts the InvoiceDocument row with a real SHA-256 checksum.
 * Returns the stored document metadata.
 */
export async function generateInvoicePdf(
  userId: string,
  invoiceId: string,
): Promise<PdfResult<StoredPdf>> {
  const { business, invoice } = await getInvoiceForUser(userId, invoiceId);
  if (invoice.status === "DRAFT") {
    return { ok: false, error: "Drafts do not have a stored PDF — download generates a watermarked preview" };
  }
  if (!invoice.snapshot || !isSnapshotPayload(invoice.snapshot.payload)) {
    return { ok: false, error: "This invoice has no snapshot to render from" };
  }
  const data = previewDataFromSnapshot(invoice.snapshot.payload);
  const buffer = await renderInvoicePdf(data);
  const checksum = sha256(buffer);
  const fileName = pdfFileName(invoice.number);

  const stored = await prisma.$transaction(async (tx) => {
    const existing = await tx.invoiceDocument.findMany({
      where: { invoiceId: invoice.id, type: "PDF" },
      orderBy: { createdAt: "desc" },
    });
    const { key } = await saveFile(business.id, "pdf", fileName, buffer);
    const document = await tx.invoiceDocument.create({
      data: {
        invoiceId: invoice.id,
        type: "PDF",
        storageKey: key,
        fileSize: buffer.length,
        checksum,
      },
    });
    for (const old of existing) {
      await tx.invoiceDocument.delete({ where: { id: old.id } });
    }
    await logActivity(tx, {
      businessId: business.id,
      userId,
      action: "invoice.pdf_generated",
      entityType: "Invoice",
      entityId: invoice.id,
      metadata: { number: invoice.number, fileSize: buffer.length, checksum },
    });
    return { document, oldKeys: existing.map((d) => d.storageKey) };
  });
  // Delete replaced files after the transaction commits.
  for (const key of stored.oldKeys) await deleteFile(key);

  return {
    ok: true,
    data: {
      documentId: stored.document.id,
      storageKey: stored.document.storageKey,
      fileSize: stored.document.fileSize ?? buffer.length,
      checksum,
      fileName,
    },
  };
}

/**
 * Regenerate the stored PDF for an issued invoice (OWNER/ADMIN only).
 * Re-renders the same frozen snapshot with the current template code.
 */
export async function regenerateInvoicePdf(
  userId: string,
  invoiceId: string,
): Promise<PdfResult<StoredPdf>> {
  const { business, invoice } = await getInvoiceForUser(userId, invoiceId);
  const membership = await requireMembership(userId, business.id);
  if (!canManageBusiness(membership.role)) {
    throw new TenantError(403, "Only owners and admins can regenerate PDFs");
  }
  if (invoice.status === "DRAFT") {
    return { ok: false, error: "Only issued invoices have a stored PDF" };
  }
  return generateInvoicePdf(userId, invoiceId);
}

/** Latest stored PDF document for an invoice, if one exists. */
export async function getLatestInvoiceDocument(invoiceId: string) {
  return prisma.invoiceDocument.findFirst({
    where: { invoiceId, type: "PDF" },
    orderBy: { createdAt: "desc" },
  });
}

export type DownloadablePdf = {
  buffer: Buffer;
  fileName: string;
  isDraft: boolean;
};

/**
 * Resolve the PDF bytes for download, given an already-loaded invoice
 * + business (the caller owns the authorization — membership check for
 * the app route, token verification for the portal route).
 * - Issued + stored PDF exists: serve the stored file (checksum is
 *   verified; a mismatch triggers regeneration).
 * - Issued + no stored PDF yet: generate + store, then serve.
 * - Draft: render a fresh watermarked PDF in memory (never stored).
 */
type LoadedInvoice = LiveInvoice & {
  id: string;
  snapshot: { payload: unknown } | null;
  customer: LiveCustomer;
};

/**
 * Resolve the PDF bytes for download, given an already-loaded invoice
 * + business (the caller owns the authorization — membership check for
 * the app route, token verification for the portal route).
 * - Issued + stored PDF exists: serve the stored file (checksum is
 *   verified; a mismatch triggers regeneration).
 * - Issued + no stored PDF yet: generate + store, then serve (only
 *   when a userId is supplied to log the generation under; the portal
 *   never generates — issued invoices already have a stored PDF).
 * - Draft: render a fresh watermarked PDF in memory (never stored).
 */
export async function resolveInvoicePdf(
  business: LiveBusiness & { id: string },
  invoice: LoadedInvoice,
  generateForUserId?: string | null,
): Promise<PdfResult<DownloadablePdf>> {
  if (invoice.status === "DRAFT") {
    const data = previewDataFromLive(invoice, business, invoice.customer, true);
    const buffer = await renderInvoicePdf(data, { watermarkDraft: true });
    return { ok: true, data: { buffer, fileName: "DRAFT.pdf", isDraft: true } };
  }

  if (!invoice.snapshot || !isSnapshotPayload(invoice.snapshot.payload)) {
    return { ok: false, error: "This invoice has no snapshot to render from" };
  }
  const fileName = pdfFileName(invoice.number);
  const existing = await getLatestInvoiceDocument(invoice.id);
  if (existing) {
    const file = await readUpload(existing.storageKey);
    if (file && existing.checksum === sha256(file.buffer)) {
      return { ok: true, data: { buffer: file.buffer, fileName, isDraft: false } };
    }
    // Stored file missing or corrupted — regenerate below.
  }
  if (!generateForUserId) {
    return { ok: false, error: "The stored PDF is not available yet" };
  }
  const generated = await generateInvoicePdf(generateForUserId, invoice.id);
  if (!generated.ok) return { ok: false, error: generated.error };
  const file = await readUpload(generated.data.storageKey);
  if (!file) return { ok: false, error: "Generated PDF could not be read back" };
  return { ok: true, data: { buffer: file.buffer, fileName, isDraft: false } };
}

/** App download: membership-checked. */
export async function getInvoicePdfForDownload(
  userId: string,
  invoiceId: string,
): Promise<PdfResult<DownloadablePdf>> {
  const { business, invoice } = await getInvoiceForUser(userId, invoiceId);
  return resolveInvoicePdf(business, invoice, userId);
}

/**
 * Portal download: the caller must already have verified the portal
 * token and confirmed it covers this invoice. Serves the stored PDF
 * only (issued invoices always have one); never generates.
 */
export async function getInvoicePdfForPortal(
  invoiceId: string,
): Promise<PdfResult<DownloadablePdf>> {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId },
    include: {
      customer: true,
      items: { orderBy: { sortOrder: "asc" } },
      snapshot: true,
    },
  });
  if (!invoice) return { ok: false, error: "Invoice not found" };
  const business = await prisma.business.findUnique({
    where: { id: invoice.businessId },
  });
  if (!business) return { ok: false, error: "Invoice not found" };
  return resolveInvoicePdf(business, invoice, null);
}
