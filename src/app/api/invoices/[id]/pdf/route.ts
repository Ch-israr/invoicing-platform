import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { apiRateLimit } from "@/lib/rate-limit";
import { TenantError } from "@/lib/tenant";
import { getInvoicePdfForDownload } from "@/server/pdf/service";

/**
 * GET /api/invoices/[id]/pdf — download the invoice PDF.
 *
 * Issued invoices: serves the stored PDF (generated at issue time,
 * or on demand here if it does not exist yet). Drafts: renders a
 * fresh watermarked PDF in memory (never stored). Membership is
 * checked by the service; cross-business access returns 404, not
 * data — same convention as the rest of the app.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  // PDF rendering is the most expensive endpoint — 60 downloads/min/IP.
  const limited = apiRateLimit(request, { prefix: "api:pdf", limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const { id } = await params;
  try {
    const result = await getInvoicePdfForDownload(session.user.id, id);
    if (!result.ok) {
      return new NextResponse(result.error, { status: 422 });
    }
    const { buffer, fileName } = result.data;
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Content-Length": String(buffer.length),
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    if (err instanceof TenantError) {
      return new NextResponse("Not found", { status: 404 });
    }
    console.error(`PDF download failed for invoice ${id}:`, err);
    return new NextResponse("Could not generate the PDF", { status: 500 });
  }
}
