import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const REPORTS = [
  {
    href: "/reports/revenue",
    title: "Revenue",
    description: "Invoiced vs paid vs outstanding over a date range, with a monthly breakdown.",
  },
  {
    href: "/reports/vat",
    title: "VAT",
    description: "Output VAT on issued invoices minus input VAT on expenses, per period.",
  },
  {
    href: "/reports/overdue",
    title: "Overdue invoices",
    description: "Invoices past their due date with balances, worst first.",
  },
  {
    href: "/reports/customers",
    title: "Customer balances",
    description: "Per-customer invoiced, paid, credited and outstanding.",
  },
  {
    href: "/reports/products",
    title: "Product revenue",
    description: "Quantity sold and revenue per product from issued invoices.",
  },
];

export default async function ReportsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Reports</h1>
        <p className="text-sm text-muted-foreground">
          Every figure is computed from your invoices, payments, credit
          notes and expenses — reports always tie back to the ledger.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {REPORTS.map((r) => (
          <Link key={r.href} href={r.href}>
            <Card className="h-full transition-colors hover:border-primary">
              <CardHeader>
                <CardTitle>{r.title}</CardTitle>
                <CardDescription>{r.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-primary">Open report →</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
