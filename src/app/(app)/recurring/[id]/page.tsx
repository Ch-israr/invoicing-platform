import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { TenantError } from "@/lib/tenant";
import { formatMoney } from "@/lib/utils";
import { getRecurringDetail } from "@/server/services/recurring.service";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  cancelRecurringAction,
  pauseRecurringAction,
  resumeRecurringAction,
  runRecurringNowAction,
} from "../actions";

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

export default async function RecurringDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const { id } = await params;
  const query = await searchParams;
  const actionError = typeof query.actionError === "string" ? query.actionError : undefined;
  const ran = typeof query.ran === "string" ? query.ran : undefined;

  let detail;
  try {
    detail = await getRecurringDetail(session.user.id, id);
  } catch (err) {
    if (err instanceof TenantError) notFound();
    throw err;
  }
  const { business, schedule, canManage, canWrite, ended } = detail;
  const customer = schedule.customer;

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">
            {customer.companyName ?? customer.name}
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
              {schedule.status.charAt(0) + schedule.status.slice(1).toLowerCase()}
              {ended && schedule.status === "ACTIVE" ? " · ended" : ""}
            </span>
            <span>
              {FREQUENCY_LABELS[schedule.frequency] ?? schedule.frequency}
              {schedule.frequency === "CUSTOM" && schedule.intervalDays
                ? ` · every ${schedule.intervalDays} days`
                : ""}
            </span>
            <span>Next run {formatDate(schedule.nextRunAt)}</span>
            {schedule.autoSend ? <span>· Auto-send on</span> : null}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canWrite && schedule.status === "ACTIVE" ? (
            <form action={runRecurringNowAction}>
              <input type="hidden" name="id" value={schedule.id} />
              <Button type="submit" variant="default">
                Run now
              </Button>
            </form>
          ) : null}
          {canWrite && schedule.status === "ACTIVE" ? (
            <form action={pauseRecurringAction}>
              <input type="hidden" name="id" value={schedule.id} />
              <Button type="submit" variant="outline">
                Pause
              </Button>
            </form>
          ) : null}
          {canWrite && schedule.status === "PAUSED" ? (
            <form action={resumeRecurringAction}>
              <input type="hidden" name="id" value={schedule.id} />
              <Button type="submit" variant="outline">
                Resume
              </Button>
            </form>
          ) : null}
          {canManage && schedule.status !== "CANCELLED" ? (
            <form action={cancelRecurringAction}>
              <input type="hidden" name="id" value={schedule.id} />
              <Button type="submit" variant="outline">
                Cancel schedule
              </Button>
            </form>
          ) : null}
        </div>
      </div>

      {actionError ? (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {actionError}
        </p>
      ) : null}
      {ran ? (
        <p className="rounded-md bg-green-600/10 px-3 py-2 text-sm text-green-700 dark:text-green-400">
          Created {ran} invoice{ran === "1" ? "" : "s"} for this period.
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Started</p>
            <p className="mt-1 font-semibold">{formatDate(schedule.startDate)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Ends</p>
            <p className="mt-1 font-semibold">
              {schedule.endDate ? formatDate(schedule.endDate) : "No end"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Last run</p>
            <p className="mt-1 font-semibold">
              {schedule.lastRunAt ? formatDate(schedule.lastRunAt) : "Never"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Invoices generated</p>
            <p className="mt-1 font-semibold">{schedule.generated.length}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Generated invoices</CardTitle>
        </CardHeader>
        <CardContent>
          {schedule.generated.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing generated yet. The first invoice appears on{" "}
              {formatDate(schedule.nextRunAt)} — or press “Run now”.
            </p>
          ) : (
            <ul className="divide-y">
              {schedule.generated.map((inv) => (
                <li
                  key={inv.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-3 first:pt-0 last:pb-0"
                >
                  <Link href={`/invoices/${inv.id}`} className="hover:underline">
                    <p className="font-medium">
                      {inv.number}
                      <span className="ml-2 text-sm font-normal text-muted-foreground">
                        {inv.status} · {formatDate(inv.issueDate)}
                      </span>
                    </p>
                  </Link>
                  <p className="font-medium">
                    {formatMoney(inv.grandTotal.toString(), business.currency)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <p className="text-sm text-muted-foreground">
        Paused schedules never generate. Cancelling stops the schedule for
        good — invoices already created are untouched. Each run creates
        exactly one invoice per period, even if it is triggered twice.
      </p>
    </div>
  );
}
