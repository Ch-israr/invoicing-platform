import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { parsePage } from "@/lib/pagination";
import { listCustomers } from "@/server/services/customer.service";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Pagination } from "@/components/shared/pagination";

function CustomerStatusPill({ status }: { status: string }) {
  const active = status === "ACTIVE";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        active
          ? "bg-green-600/10 text-green-700 dark:text-green-400"
          : "bg-slate-500/10 text-slate-600 dark:text-slate-400",
      )}
    >
      {active ? "Active" : "Inactive"}
    </span>
  );
}

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const params = await searchParams;

  const q = typeof params.q === "string" ? params.q : "";
  const type = params.type === "INDIVIDUAL" || params.type === "COMPANY" ? params.type : undefined;
  const status = params.status === "ACTIVE" || params.status === "INACTIVE" ? params.status : undefined;
  const page = parsePage(params.page);
  const deleteError = typeof params.deleteError === "string" ? params.deleteError : undefined;

  const { customers, total, pageCount } = await listCustomers(session.user.id, {
    q: q || undefined,
    type,
    status,
    page,
  });

  const makeHref = (p: number) => {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    if (type) sp.set("type", type);
    if (status) sp.set("status", status);
    sp.set("page", String(p));
    return `/customers?${sp.toString()}`;
  };

  return (
    <div className="-m-4 min-h-[calc(100dvh-4rem)] space-y-6 bg-muted/60 p-4 md:-m-6 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Customers</h1>
          <p className="text-sm text-muted-foreground">
            People and companies you bill.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <a href="/api/customers/export">Export CSV</a>
          </Button>
          <Button asChild>
            <Link href="/customers/new">New Customer</Link>
          </Button>
        </div>
      </div>

      {deleteError ? (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {deleteError}
        </p>
      ) : null}

      <form method="get" className="flex flex-wrap items-center gap-2">
        <Input
          name="q"
          defaultValue={q}
          placeholder="Search name, company or email"
          className="min-w-48 flex-1 sm:max-w-xs"
          aria-label="Search customers"
        />
        <Select name="type" defaultValue={type ?? ""} aria-label="Filter by type" className="w-40">
          <option value="">All types</option>
          <option value="COMPANY">Company</option>
          <option value="INDIVIDUAL">Individual</option>
        </Select>
        <Select name="status" defaultValue={status ?? ""} aria-label="Filter by status" className="w-40">
          <option value="">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="INACTIVE">Inactive</option>
        </Select>
        <Button type="submit" variant="outline">
          Filter
        </Button>
        {(q || type || status) && (
          <Button variant="ghost" asChild>
            <Link href="/customers">Clear</Link>
          </Button>
        )}
      </form>

      {customers.length === 0 ? (
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-muted-foreground">
              {total === 0 && !q && !type && !status
                ? "No customers yet. Add your first customer to start billing."
                : "No customers match these filters — try a different search or clear the filters."}
            </p>
            {total === 0 && !q && !type && !status ? (
              <Button asChild size="sm" className="mt-3">
                <Link href="/customers/new">Create your first customer</Link>
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="px-4 py-3 font-medium">Name</th>
                    <th className="hidden px-4 py-3 font-medium md:table-cell">Email</th>
                    <th className="hidden px-4 py-3 font-medium lg:table-cell">Phone</th>
                    <th className="px-4 py-3 font-medium">Type</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {customers.map((c) => (
                    <tr key={c.id} className="border-b last:border-0 hover:bg-muted/50">
                      <td className="px-4 py-3">
                        <Link href={`/customers/${c.id}`} className="font-medium hover:underline">
                          {c.companyName && c.companyName !== c.name
                            ? `${c.companyName} (${c.name})`
                            : c.name}
                        </Link>
                        {c.trn ? <span className="block text-xs text-muted-foreground">TRN {c.trn}</span> : null}
                      </td>
                      <td className="hidden px-4 py-3 md:table-cell">{c.email ?? "—"}</td>
                      <td className="hidden px-4 py-3 lg:table-cell">{c.phone ?? "—"}</td>
                      <td className="px-4 py-3">{c.type === "COMPANY" ? "Company" : "Individual"}</td>
                      <td className="px-4 py-3">
                        <CustomerStatusPill status={c.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <Pagination page={page} pageCount={pageCount} total={total} makeHref={makeHref} />
    </div>
  );
}
