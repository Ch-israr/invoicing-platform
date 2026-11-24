import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { apiRateLimit } from "@/lib/rate-limit";
import { getBusinessForUser } from "@/lib/tenant";
import { readUpload } from "@/lib/storage";

/**
 * Serves uploaded files (logos, signatures) only to members of the
 * business that owns them. Keys are `<businessId>/<kind>/<file>`.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ key: string[] }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  const limited = apiRateLimit(request, { prefix: "api:uploads", limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const { key } = await params;
  const joined = key.join("/");
  const [businessId] = joined.split("/");
  if (!businessId) return new NextResponse("Not found", { status: 404 });

  const business = await getBusinessForUser(session.user.id, businessId);
  if (!business) return new NextResponse("Not found", { status: 404 });

  const file = await readUpload(joined);
  if (!file) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(new Uint8Array(file.buffer), {
    headers: {
      "Content-Type": file.contentType,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
