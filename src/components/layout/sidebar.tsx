"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Receipt,
  FileText,
  Users,
  Package,
  Wallet,
  Landmark,
  Repeat,
  Undo2,
  BarChart3,
  Settings,
  FileSignature,
  Mail,
} from "lucide-react";
import { cn } from "@/lib/utils";

type NavItem = {
  label: string;
  href?: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Phase that delivers this section — shown instead of a link until then. */
  phase?: string;
};

const NAV: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Invoices", href: "/invoices", icon: Receipt },
  { label: "Quotations", href: "/quotations", icon: FileText },
  { label: "Customers", href: "/customers", icon: Users },
  { label: "Products", href: "/products", icon: Package },
  { label: "Payments", href: "/payments", icon: Wallet },
  { label: "Expenses", href: "/expenses", icon: Landmark },
  { label: "Recurring", href: "/recurring", icon: Repeat },
  { label: "Credit Notes", href: "/credit-notes", icon: Undo2 },
  { label: "Emails", href: "/emails", icon: Mail },
  { label: "Reports", href: "/reports", icon: BarChart3 },
  { label: "Settings", href: "/settings/business", icon: Settings },
];

export function Sidebar({ businessName }: { businessName: string }) {
  const pathname = usePathname();
  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r bg-card md:flex">
      <div className="flex h-16 items-center gap-2 border-b px-5">
        <FileSignature className="h-6 w-6 text-primary" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold leading-tight">
            {businessName}
          </p>
          <p className="text-xs text-muted-foreground">Invoicing Platform</p>
        </div>
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto p-3" aria-label="Main">
        {NAV.map((item) => {
          const Icon = item.icon;
          const active = item.href && pathname.startsWith(item.href);
          if (!item.href) {
            return (
              <span
                key={item.label}
                aria-disabled="true"
                title={`Available in ${item.phase}`}
                className="flex cursor-not-allowed items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground opacity-70"
              >
                <Icon className="h-4 w-4" />
                {item.label}
                <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium">
                  {item.phase}
                </span>
              </span>
            );
          }
          return (
            <Link
              key={item.label}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-accent",
                active
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t p-3 text-xs text-muted-foreground">
        Phase 7 — Portal, Reports, Analytics
      </div>
    </aside>
  );
}
