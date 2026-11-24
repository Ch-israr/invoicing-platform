import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { parsePage } from "@/lib/pagination";
import { listEmails } from "@/server/email/service";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Pagination } from "@/components/shared/pagination";
import {
  processEmailQueueAction,
  retryAllFailedEmailsAction,
  retryEmailAction,
} from "./actions";

const STATUSES = ["QUEUED", "SENT", "FAILED"] as const;

export default async function EmailsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const params = await searchParams;

  const q = typeof params.q === "string" ? params.q : "";
  const status =
    typeof params.status === "string" &&
    (STATUSES as readonly string[]).includes(params.status)
      ? (params.status as (typeof STATUSES)[number])
      : undefined;
  const page = parsePage(params.page);
  const notice =
    typeof params.retried === "string"
      ? `${params.retried} email${params.retried === "1" ? "" : "s"} re-queued${params.skipped ? ` (${params.skipped} skipped)` : ""}`
      : typeof params.sent === "string"
        ? `Queue processed: ${params.sent} sent, ${params.failed ?? "0"} failed`
        : typeof params.actionError === "string"
          ? params.actionError
          : undefined;

  const { emails, total, pageCount } = await listEmails(session.user.id, {
    q: q || undefined,
    status,
    page,
  });

  const makeHref = (p: number) => {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    if (status) sp.set("status", status);
    sp.set("page", String(p));
    return `/emails?${sp.toString()}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Emails</h1>
          <p className="text-sm text-muted-foreground">
            Every email the platform queued or sent. Failed emails retry
            up to 3 times — a manual retry skips the backoff wait.
          </p>
        </div>
        <div className="flex gap-2">
          <form action={processEmailQueueAction}>
            <Button type="submit" variant="outline">
              Process queue now
            </Button>
          </form>
          <form action={retryAllFailedEmailsAction}>
            <Button type="submit" variant="outline">
              Retry all failed
            </Button>
          </form>
        </div>
      </div>

      {notice ? (
        <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
          {notice}
        </p>
      ) : null}

      <form className="flex flex-wrap gap-2" method="get">
        <Input
          name="q"
          defaultValue={q}
          placeholder="Search recipient or subject…"
          className="w-72"
        />
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
        {q || status ? (
          <Button variant="ghost" asChild>
            <Link href="/emails">Clear</Link>
          </Button>
        ) : null}
      </form>

      <Card>
        <CardContent className="p-0">
          {emails.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">
              No emails yet. Send an invoice from its detail page.
            </p>
          ) : (
            <ul className="divide-y">
              {emails.map((e) => (
                <li
                  key={e.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-6 py-4"
                >
                  <div className="min-w-0">
                    <p className="font-medium">{e.subject}</p>
                    <p className="text-sm text-muted-foreground">
                      To {e.to} · {e.status}
                      {e.attempts > 0 ? ` · ${e.attempts} attempt${e.attempts === 1 ? "" : "s"}` : ""}
                      {e.sentAt ? ` · sent ${e.sentAt.toLocaleString()}` : ""}
                      {e.relatedType === "Invoice" ? (
                        <>
                          {" · "}
                          <Link href={`/invoices/${e.relatedId}`} className="underline">
                            View invoice
                          </Link>
                        </>
                      ) : null}
                    </p>
                    {e.error ? (
                      <p className="text-sm text-destructive">{e.error}</p>
                    ) : null}
                  </div>
                  {e.status === "FAILED" && e.attempts < 3 ? (
                    <form action={retryEmailAction}>
                      <input type="hidden" name="id" value={e.id} />
                      <Button type="submit" variant="outline" size="sm">
                        Retry
                      </Button>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {pageCount > 1 ? (
        <Pagination page={page} pageCount={pageCount} total={total} makeHref={makeHref} />
      ) : null}
      {total > 0 ? (
        <p className="text-sm text-muted-foreground">
          {total} email{total === 1 ? "" : "s"}
        </p>
      ) : null}
    </div>
  );
}
