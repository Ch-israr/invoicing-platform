import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { apiRateLimit } from "@/lib/rate-limit";
import { TenantError } from "@/lib/tenant";
import {
  getAgingReport,
  getCustomerBalances,
  getOverdueReport,
  getProductRevenue,
  getRevenueReport,
  getVatReport,
  parseDateRange,
  toIsoDay,
} from "@/server/services/report.service";
import {
  agingCsv,
  customersCsv,
  overdueCsv,
  productsCsv,
  revenueCsv,
  vatCsv,
} from "@/lib/report-csv";

const REPORTS = ["revenue", "vat", "overdue", "customers", "products", "aging"] as const;

/**
 * GET /api/reports/[report]?from=YYYY-MM-DD&to=YYYY-MM-DD — CSV export.
 * Same service functions as the on-screen reports, so the file always
 * matches what the page shows. Auth + tenant checks apply; cross-
 * business access returns 404.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ report: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  const limited = apiRateLimit(request, { prefix: "api:reports", limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const { report } = await params;
  if (!(REPORTS as readonly string[]).includes(report)) {
    return new NextResponse("Unknown report", { status: 404 });
  }
  const query = request.nextUrl.searchParams;
  const range = parseDateRange({
    from: query.get("from") ?? undefined,
    to: query.get("to") ?? undefined,
  });
  const fileName = `${report}-report-${toIsoDay(range.from)}-${toIsoDay(range.to)}.csv`;

  try {
    let csv: string;
    if (report === "revenue") {
      csv = revenueCsv(await getRevenueReport(session.user.id, range));
    } else if (report === "vat") {
      csv = vatCsv(await getVatReport(session.user.id, range));
    } else if (report === "overdue") {
      const { rows } = await getOverdueReport(session.user.id);
      csv = overdueCsv(rows);
    } else if (report === "aging") {
      const { rows } = await getAgingReport(session.user.id);
      csv = agingCsv(rows);
    } else if (report === "customers") {
      const { rows } = await getCustomerBalances(session.user.id, range);
      csv = customersCsv(rows);
    } else {
      const { rows } = await getProductRevenue(session.user.id, range);
      csv = productsCsv(rows);
    }
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    if (err instanceof TenantError) {
      return new NextResponse("Not found", { status: 404 });
    }
    console.error(`Report CSV failed for ${report}:`, err);
    return new NextResponse("Could not generate the report", { status: 500 });
  }
}
