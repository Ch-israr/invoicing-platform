import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { parsePage } from "@/lib/pagination";
import { listRecurring } from "@/server/services/recurring.service";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Pagination } from "@/components/shared/pagination";
import { runDueSchedulesAction } from "./actions";

const STATUSES = ["ACTIVE", "PAUSED", "CANCELLED"] as const;

const FREQUENCY_LABELS: Record<string, string> = {
  WEEKLY: "Weekly",
  MONTHLY: "Monthly",
  QUARTERLY: "Every 3 months",
  YEARLY: "Yearly",
  CUSTOM: "Custom",
};

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export default async function RecurringPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const params = await searchParams;

  const status =
    typeof params.status === "string" &&
    (STATUSES as readonly string[]).includes(params.status)
      ? (params.status as (typeof STATUSES)[number])
      : undefined;
  const page = parsePage(params.page);
  const notice =
    typeof params.ran === "string"
      ? `Ran due schedules: ${params.ran} invoice${params.ran === "1" ? "" : "s"} created` +
        (params.issued ? `, ${params.issued} issued` : "") +
        (params.emailed ? `, ${params.emailed} emailed` : "")
      : typeof params.actionError === "string"
        ? params.actionError
        : undefined;

  const { schedules, total, pageCount } = await listRecurring(session.user.id, {
    status,
    page,
  });

  const makeHref = (p: number) => {
    const sp = new URLSearchParams();
    if (status) sp.set("status", status);
    sp.set("page", String(p));
    return `/recurring?${sp.toString()}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Recurring invoices</h1>
          <p className="text-sm text-muted-foreground">
            Schedules that create invoices on a repeat. There is no
            background worker yet — due schedules run from the button
            below (production scheduling is a launch concern).
          </p>
        </div>
        <div className="flex gap-2">
          <form action={runDueSchedulesAction}>
            <Button type="submit" variant="outline">
              Run due schedules now
            </Button>
          </form>
          <Button asChild>
            <Link href="/recurring/new">New schedule</Link>
          </Button>
        </div>
      </div>

      {notice ? (
        <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
          {notice}
        </p>
      ) : null}

      <form className="flex flex-wrap gap-2" method="get">
        <Select name="status" defaultValue={status ?? ""}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.charAt(0) + s.slice(1).toLowerCase()}
            </option>
          ))}
        </Select>
        <Button type="submit" variant="outline">
          Filter
        </Button>
        {status ? (
          <Button variant="ghost" asChild>
            <Link href="/recurring">Clear</Link>
          </Button>
        ) : null}
      </form>

      <Card>
        <CardContent className="p-0">
          {schedules.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">
              No schedules yet. Create one to invoice a customer on a
              repeat — weekly, monthly, quarterly, yearly, or a custom
              interval.
            </p>
          ) : (
            <ul className="divide-y">
              {schedules.map((s) => {
                const ended =
                  s.endDate !== null && s.nextRunAt.getTime() > s.endDate.getTime();
                return (
                  <li
                    key={s.id}
                    className="flex flex-wrap items-center justify-between gap-2 px-6 py-4"
                  >
                    <Link href={`/recurring/${s.id}`} className="min-w-0 hover:underline">
                      <p className="font-medium">
                        {s.customer.companyName ?? s.customer.name}
                        <span className="ml-2 text-sm font-normal text-muted-foreground">
                          {FREQUENCY_LABELS[s.frequency] ?? s.frequency}
                          {s.frequency === "CUSTOM" && s.intervalDays
                            ? ` · every ${s.intervalDays} days`
                            : ""}
                          {s.autoSend ? " · auto-send" : ""}
                        </span>
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {s.status === "ACTIVE"
                          ? ended
                            ? "Ended"
                            : `Next run ${formatDate(s.nextRunAt)}`
                          : s.status.charAt(0) + s.status.slice(1).toLowerCase()}
                        {s.lastRunAt ? ` · last run ${formatDate(s.lastRunAt)}` : ""}
                        {` · ${s._count.generated} invoice${s._count.generated === 1 ? "" : "s"} generated`}
                      </p>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {pageCount > 1 ? (
        <Pagination page={page} pageCount={pageCount} total={total} makeHref={makeHref} />
      ) : null}
      {total > 0 ? (
        <p className="text-sm text-muted-foreground">
          {total} schedule{total === 1 ? "" : "s"}
        </p>
      ) : null}
    </div>
  );
}
