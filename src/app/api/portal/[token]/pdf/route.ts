import { NextResponse, type NextRequest } from "next/server";
import { headers } from "next/headers";
import {
  getPortalInvoice,
  verifyPortalToken,
} from "@/server/services/portal.service";
import { getInvoicePdfForPortal } from "@/server/pdf/service";

/**
 * GET /api/portal/[token]/pdf?invoiceId=<id> — download the stored
 * invoice PDF through a portal token (no login). The token must cover
 * the requested invoice: an invoice token covers its own invoice, a
 * customer token covers any of that customer's invoices. Drafts and
 * other customers' invoices return 404. The stored PDF is served as
 * generated at issue time; nothing is generated here.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const invoiceId = request.nextUrl.searchParams.get("invoiceId");
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  const ip = forwarded ? forwarded.split(",")[0].trim() : (h.get("x-real-ip") ?? "unknown");

  const verified = await verifyPortalToken(token, ip);
  if (!verified.ok || !invoiceId) {
    return new NextResponse("Not found", { status: 404 });
  }
  const context = verified.context;
  if (context.kind === "invoice" && context.invoiceId !== invoiceId) {
    return new NextResponse("Not found", { status: 404 });
  }
  if (context.kind === "quotation") {
    return new NextResponse("Not found", { status: 404 });
  }
  if (context.kind === "customer") {
    // Confirm the invoice belongs to this customer before serving.
    const data = await getPortalInvoice(context, invoiceId);
    if (!data) return new NextResponse("Not found", { status: 404 });
  }

  const result = await getInvoicePdfForPortal(invoiceId);
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
}
