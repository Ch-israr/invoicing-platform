import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { TenantError } from "@/lib/tenant";
import { formatMoney } from "@/lib/utils";
import { getCustomerDetail } from "@/server/services/customer.service";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DeleteButton } from "@/components/shared/delete-button";
import { deleteCustomerAction } from "../actions";

function dec(value: unknown): number {
  return value === null || value === undefined ? 0 : Number(value);
}

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const { id } = await params;

  let detail;
  try {
    detail = await getCustomerDetail(session.user.id, id);
  } catch (err) {
    if (err instanceof TenantError) notFound();
    throw err;
  }

  const { business, customer, stats, invoices, payments } = detail;
  const currency = business.currency;

  const statCards = [
    { label: "Invoices", value: String(stats.invoiceCount), hint: "Total invoices" },
    { label: "Total Billed", value: formatMoney(dec(stats.totalBilled), currency), hint: "Issued and paid invoices" },
    { label: "Total Paid", value: formatMoney(dec(stats.totalPaid), currency), hint: "Payments received" },
    { label: "Outstanding", value: formatMoney(dec(stats.outstanding), currency), hint: "Unpaid balances" },
    { label: "Overdue", value: formatMoney(dec(stats.overdueBalance), currency), hint: `${stats.overdueCount} invoice(s) past due` },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{customer.name}</h1>
          <p className="text-sm text-muted-foreground">
            {customer.type === "COMPANY" ? "Company" : "Individual"}
            {customer.companyName ? ` · ${customer.companyName}` : ""}
            {` · ${customer.status === "ACTIVE" ? "Active" : "Inactive"}`}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link href={`/customers/${customer.id}/edit`}>Edit</Link>
          </Button>
          <form action={deleteCustomerAction}>
            <input type="hidden" name="id" value={customer.id} />
            <DeleteButton label="Delete" />
          </form>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {statCards.map((s) => (
          <Card key={s.label}>
            <CardHeader className="pb-2">
              <CardDescription>{s.label}</CardDescription>
              <CardTitle className="text-xl">{s.value}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">{s.hint}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
          <p><span className="text-muted-foreground">Email: </span>{customer.email ?? "—"}</p>
          <p><span className="text-muted-foreground">Phone: </span>{customer.phone ?? "—"}</p>
          <p><span className="text-muted-foreground">Country: </span>{customer.country}</p>
          <p><span className="text-muted-foreground">TRN: </span>{customer.trn ?? "—"}</p>
          <p><span className="text-muted-foreground">Billing address: </span>{customer.billingAddress ?? "—"}</p>
          <p><span className="text-muted-foreground">Shipping address: </span>{customer.shippingAddress ?? "—"}</p>
          {customer.notes ? (
            <p className="sm:col-span-2"><span className="text-muted-foreground">Notes: </span>{customer.notes}</p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Invoice History</CardTitle>
          <CardDescription>
            {invoices.length === 0
              ? "No invoices yet — invoices arrive with Phase 3."
              : "Latest invoices for this customer."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {invoices.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing here yet.</p>
          ) : (
            <ul className="space-y-2">
              {invoices.map((inv) => (
                <li key={inv.id} className="flex items-center justify-between text-sm">
                  <span>
                    {inv.number} · {inv.status.replace("_", " ")} · due{" "}
                    {new Date(inv.dueDate).toLocaleDateString()}
                  </span>
                  <span className="font-medium">
                    {formatMoney(dec(inv.grandTotal), currency)}
                    {dec(inv.balance) > 0 ? ` (${formatMoney(dec(inv.balance), currency)} due)` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Payment History</CardTitle>
          <CardDescription>
            {payments.length === 0
              ? "No payments recorded yet."
              : "Latest payments from this customer."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {payments.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing here yet.</p>
          ) : (
            <ul className="space-y-2">
              {payments.map((p) => (
                <li key={p.id} className="flex items-center justify-between text-sm">
                  <span>
                    {new Date(p.date).toLocaleDateString()} · {p.method.replace("_", " ")} · Invoice {p.invoice.number}
                    {p.reference ? ` · ${p.reference}` : ""}
                  </span>
                  <span className="font-medium">{formatMoney(dec(p.amount), currency)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
