import Link from "next/link";
import { redirect } from "next/navigation";
import { Banknote, CalendarClock, Clock, Package, Percent, Users, type LucideIcon } from "lucide-react";
import { auth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const REPORTS: Array<{
  href: string;
  title: string;
  description: string;
  icon: LucideIcon;
  chip: string;
}> = [
  {
    href: "/reports/revenue",
    title: "Revenue",
    description: "Invoiced vs paid vs outstanding over a date range, with a monthly breakdown.",
    icon: Banknote,
    chip: "bg-green-600/10 text-green-700 dark:text-green-400",
  },
  {
    href: "/reports/vat",
    title: "VAT",
    description: "Output VAT on issued invoices minus input VAT on expenses, per period.",
    icon: Percent,
    chip: "bg-blue-600/10 text-blue-700 dark:text-blue-400",
  },
  {
    href: "/reports/overdue",
    title: "Overdue invoices",
    description: "Invoices past their due date with balances, worst first.",
    icon: Clock,
    chip: "bg-red-600/10 text-red-700 dark:text-red-400",
  },
  {
    href: "/reports/aging",
    title: "A/R aging",
    description: "Open invoices grouped by how long they have been outstanding.",
    icon: CalendarClock,
    chip: "bg-rose-600/10 text-rose-700 dark:text-rose-400",
  },
  {
    href: "/reports/customers",
    title: "Customer balances",
    description: "Per-customer invoiced, paid, credited and outstanding.",
    icon: Users,
    chip: "bg-indigo-600/10 text-indigo-700 dark:text-indigo-400",
  },
  {
    href: "/reports/products",
    title: "Product revenue",
    description: "Quantity sold and revenue per product from issued invoices.",
    icon: Package,
    chip: "bg-amber-600/10 text-amber-700 dark:text-amber-400",
  },
];

export default async function ReportsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  return (
    <div className="-m-4 min-h-[calc(100dvh-4rem)] space-y-6 bg-muted/60 p-4 md:-m-6 md:p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Reports</h1>
        <p className="text-sm text-muted-foreground">
          Every figure is computed from your invoices, payments, credit
          notes and expenses — reports always tie back to the ledger.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2 [&>*]:min-w-0">
        {REPORTS.map((r) => {
          const Icon = r.icon;
          return (
            <Link key={r.href} href={r.href}>
              <Card className="h-full transition-colors hover:border-primary">
                <CardHeader>
                  <div className="flex items-start gap-3">
                    <span className={cn("inline-flex shrink-0 items-center justify-center rounded-lg p-2", r.chip)}>
                      <Icon className="h-5 w-5" aria-hidden />
                    </span>
                    <div className="min-w-0">
                      <CardTitle>{r.title}</CardTitle>
                      <CardDescription>{r.description}</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-sm font-medium text-primary">Open report →</p>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
