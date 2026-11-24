import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { apiRateLimit } from "@/lib/rate-limit";
import { exportCustomersCsv } from "@/server/services/customer.service";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  const limited = apiRateLimit(request, { prefix: "api:export", limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const csv = await exportCustomersCsv(session.user.id);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="customers.csv"',
    },
  });
}
