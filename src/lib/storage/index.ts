import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Storage abstraction (ARCHITECTURE.md §1.2).
 * Dev uses local disk; production will use an S3-compatible provider
 * behind this same interface. Files are stored outside the web root
 * and served only through the authenticated /api/uploads route.
 *
 * Keys look like `<businessId>/<kind>/<uuid>-<safe-name>` so a key
 * alone proves which business owns the file.
 */

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 MB
export const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];

export function uploadsDir(): string {
  return process.env.UPLOADS_DIR ?? path.join(process.cwd(), "uploads");
}

export function validateImageFile(file: File): string | null {
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    return "Only PNG, JPEG or WebP images are allowed";
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return "File must be 5 MB or smaller";
  }
  if (file.size === 0) {
    return "File is empty";
  }
  return null;
}

/** Expense receipts: an image or a PDF, 5 MB or smaller. */
export const ALLOWED_RECEIPT_TYPES = [...ALLOWED_IMAGE_TYPES, "application/pdf"];

export function validateReceiptFile(file: File): string | null {
  if (!ALLOWED_RECEIPT_TYPES.includes(file.type)) {
    return "Receipt must be a PNG, JPEG, WebP image or a PDF";
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return "File must be 5 MB or smaller";
  }
  if (file.size === 0) {
    return "File is empty";
  }
  return null;
}

function safeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 80) || "file";
}

export type StorageKind = "logo" | "signature" | "pdf" | "receipt";

/** Save an arbitrary buffer (PDFs, images) under a business-scoped key. */
export async function saveFile(
  businessId: string,
  kind: StorageKind,
  filename: string,
  buffer: Buffer,
): Promise<{ key: string; url: string }> {
  const key = `${businessId}/${kind}/${randomUUID()}-${safeFileName(filename)}`;
  const dest = path.join(uploadsDir(), ...key.split("/"));
  await mkdir(path.dirname(dest), { recursive: true });
  await writeFile(dest, buffer);
  return { key, url: `/api/uploads/${key}` };
}

/** Best-effort delete (used when a stored PDF is replaced). */
export async function deleteFile(key: string): Promise<void> {
  if (key.includes("..") || path.isAbsolute(key)) return;
  const file = path.join(uploadsDir(), ...key.split("/"));
  if (!file.startsWith(uploadsDir())) return;
  await unlink(file).catch(() => undefined);
}

export async function saveUpload(
  businessId: string,
  kind: "logo" | "signature",
  file: File,
): Promise<{ key: string; url: string }> {
  return saveFile(businessId, kind, file.name, Buffer.from(await file.arrayBuffer()));
}

export async function readUpload(
  key: string,
): Promise<{ buffer: Buffer; contentType: string } | null> {
  // Keys are business-scoped paths only — reject anything that tries
  // to escape the uploads directory.
  if (key.includes("..") || path.isAbsolute(key)) return null;
  const file = path.join(uploadsDir(), ...key.split("/"));
  if (!file.startsWith(uploadsDir())) return null;
  try {
    const buffer = await readFile(file);
    const ext = path.extname(file).toLowerCase();
    const contentType =
      ext === ".png"
        ? "image/png"
        : ext === ".jpg" || ext === ".jpeg"
          ? "image/jpeg"
          : ext === ".webp"
            ? "image/webp"
            : ext === ".pdf"
              ? "application/pdf"
              : "application/octet-stream";
    return { buffer, contentType };
  } catch {
    return null;
  }
}
