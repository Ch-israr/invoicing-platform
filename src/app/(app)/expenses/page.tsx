import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { parsePage } from "@/lib/pagination";
import { listExpenses, listExpenseCategories } from "@/server/services/expense.service";
import { formatMoney } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Pagination } from "@/components/shared/pagination";

const METHOD_LABELS: Record<string, string> = {
  CASH: "Cash",
  BANK_TRANSFER: "Bank transfer",
  CARD: "Card",
  OTHER: "Other",
};

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const params = await searchParams;

  const q = typeof params.q === "string" ? params.q : "";
  const from = typeof params.from === "string" ? params.from : "";
  const to = typeof params.to === "string" ? params.to : "";
  const categoryId = typeof params.categoryId === "string" ? params.categoryId : "";
  const page = parsePage(params.page);
  const deleteError = typeof params.deleteError === "string" ? params.deleteError : undefined;

  const [{ expenses, total, pageCount, totals, currency }, categories] = await Promise.all([
    listExpenses(session.user.id, {
      q: q || undefined,
      from: from || undefined,
      to: to || undefined,
      categoryId: categoryId || undefined,
      page,
    }),
    listExpenseCategories(session.user.id),
  ]);

  const makeHref = (p: number) => {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    if (from) sp.set("from", from);
    if (to) sp.set("to", to);
    if (categoryId) sp.set("categoryId", categoryId);
    sp.set("page", String(p));
    return `/expenses?${sp.toString()}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Expenses</h1>
          <p className="text-sm text-muted-foreground">
            Business spending, with categories and receipts.
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link href="/expenses/categories">Categories</Link>
          </Button>
          <Button asChild>
            <Link href="/expenses/new">New expense</Link>
          </Button>
        </div>
      </div>

      {deleteError ? (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {deleteError}
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Total (filtered)</p>
            <p className="mt-1 text-lg font-semibold">
              {formatMoney(totals.amount.toString(), currency)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">VAT in total</p>
            <p className="mt-1 text-lg font-semibold">
              {formatMoney(totals.vatAmount.toString(), currency)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Expenses</p>
            <p className="mt-1 text-lg font-semibold">{total}</p>
          </CardContent>
        </Card>
      </div>

      <form className="flex flex-wrap gap-2" method="get">
        <Input
          name="q"
          defaultValue={q}
          placeholder="Search title, vendor…"
          className="w-56"
        />
        <Input name="from" type="date" defaultValue={from} aria-label="From date" />
        <Input name="to" type="date" defaultValue={to} aria-label="To date" />
        <Select name="categoryId" defaultValue={categoryId}>
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Button type="submit" variant="outline">
          Filter
        </Button>
        {q || from || to || categoryId ? (
          <Button variant="ghost" asChild>
            <Link href="/expenses">Clear</Link>
          </Button>
        ) : null}
      </form>

      <Card>
        <CardContent className="p-0">
          {expenses.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">
              No expenses match. Add your first expense to start tracking
              spending.
            </p>
          ) : (
            <ul className="divide-y">
              {expenses.map((e) => (
                <li
                  key={e.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-6 py-4"
                >
                  <Link href={`/expenses/${e.id}`} className="min-w-0 hover:underline">
                    <p className="font-medium">
                      {e.title}
                      <span className="ml-2 text-sm font-normal text-muted-foreground">
                        {new Intl.DateTimeFormat("en-GB", {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                          timeZone: "UTC",
                        }).format(e.date)}
                      </span>
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {e.category?.name ?? "Uncategorised"}
                      {e.vendor ? ` · ${e.vendor}` : ""} ·{" "}
                      {METHOD_LABELS[e.method] ?? e.method}
                      {e.receiptUrl ? " · Receipt attached" : ""}
                    </p>
                  </Link>
                  <p className="font-medium">{formatMoney(e.amount.toString(), currency)}</p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {pageCount > 1 ? (
        <Pagination page={page} pageCount={pageCount} total={total} makeHref={makeHref} />
      ) : null}
    </div>
  );
}
