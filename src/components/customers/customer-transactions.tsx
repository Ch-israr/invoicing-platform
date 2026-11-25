"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { formatMoney } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import {
  INVOICE_STATUS_LABELS,
  InvoiceStatusBadge,
} from "@/components/invoices/status-badge";

/** One row of the unified transaction list. All values are JSON-safe —
 * the server page serializes Decimals to numbers and Dates to ISO strings. */
export type CustomerTransactionRow = {
  id: string;
  kind: "invoice" | "payment" | "credit-note";
  date: string; // ISO
  typeLabel: string;
  detail: string | null;
  number: string;
  href: string;
  amount: number; // signed — credit notes are negative
  statusKey: string;
  isOverdue: boolean;
  dueLabel: string | null;
};

const TYPE_LABELS: Record<CustomerTransactionRow["kind"], string> = {
  invoice: "Invoice",
  payment: "Payment",
  "credit-note": "Credit note",
};

function shortDate(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}

function statusLabel(row: CustomerTransactionRow): string {
  if (row.kind === "payment") return "Received";
  if (row.isOverdue) return "Overdue";
  return INVOICE_STATUS_LABELS[row.statusKey] ?? row.statusKey;
}

type DateRange = "all" | "30" | "90" | "year";

function inRange(iso: string, range: DateRange): boolean {
  if (range === "all") return true;
  const d = new Date(iso).getTime();
  const now = Date.now();
  if (range === "30") return d >= now - 30 * 24 * 60 * 60 * 1000;
  if (range === "90") return d >= now - 90 * 24 * 60 * 60 * 1000;
  return new Date(iso).getUTCFullYear() === new Date().getUTCFullYear();
}

export function CustomerTransactions({
  rows,
  currency,
}: {
  rows: CustomerTransactionRow[];
  currency: string;
}) {
  const [type, setType] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");
  const [range, setRange] = useState<DateRange>("all");

  const typeOptions = useMemo(
    () =>
      (Object.keys(TYPE_LABELS) as CustomerTransactionRow["kind"][]).filter(
        (k) => rows.some((r) => r.kind === k),
      ),
    [rows],
  );
  const statusOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const row of rows) seen.set(statusLabel(row), statusLabel(row));
    return [...seen.keys()].sort();
  }, [rows]);

  const filtered = useMemo(
    () =>
      rows.filter(
        (row) =>
          (type === "all" || row.kind === type) &&
          (status === "all" || statusLabel(row) === status) &&
          inRange(row.date, range),
      ),
    [rows, type, status, range],
  );

  const filtersActive = type !== "all" || status !== "all" || range !== "all";

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1.5">
            <CardTitle>Transactions</CardTitle>
            <CardDescription>
              {rows.length === 0
                ? "No transactions yet — create the first invoice to start billing this customer."
                : "Invoices, payments and credit notes for this customer, newest first."}
            </CardDescription>
          </div>
          <p className="shrink-0 text-sm text-muted-foreground">
            {filtered.length} of {rows.length}{" "}
            {rows.length === 1 ? "transaction" : "transactions"}
          </p>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {rows.length === 0 ? (
          <div>
            <p className="text-sm text-muted-foreground">Nothing here yet.</p>
            <Button asChild size="sm" className="mt-3">
              <Link href="/invoices/new">Create invoice</Link>
            </Button>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={type}
                onChange={(e) => setType(e.target.value)}
                className="w-40"
                aria-label="Filter by type"
              >
                <option value="all">All types</option>
                {typeOptions.map((k) => (
                  <option key={k} value={k}>
                    {TYPE_LABELS[k]}
                  </option>
                ))}
              </Select>
              <Select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="w-44"
                aria-label="Filter by status"
              >
                <option value="all">All statuses</option>
                {statusOptions.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
              <Select
                value={range}
                onChange={(e) => setRange(e.target.value as DateRange)}
                className="w-44"
                aria-label="Filter by date"
              >
                <option value="all">All dates</option>
                <option value="30">Last 30 days</option>
                <option value="90">Last 90 days</option>
                <option value="year">This year</option>
              </Select>
              {filtersActive ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setType("all");
                    setStatus("all");
                    setRange("all");
                  }}
                >
                  Clear filters
                </Button>
              ) : null}
            </div>

            {filtered.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No transactions match these filters.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[620px] text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th scope="col" className="py-2 pr-3 font-medium">Date</th>
                      <th scope="col" className="py-2 pr-3 font-medium">Type</th>
                      <th scope="col" className="py-2 pr-3 font-medium">No.</th>
                      <th scope="col" className="py-2 pr-3 text-right font-medium">Amount</th>
                      <th scope="col" className="py-2 pr-3 font-medium">Status</th>
                      <th scope="col" className="py-2 text-right font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((row) => (
                      <tr key={row.id} className="border-b last:border-0 hover:bg-muted/50">
                        <td className="whitespace-nowrap py-2.5 pr-3">{shortDate(row.date)}</td>
                        <td className="py-2.5 pr-3">
                          <span className="font-medium">{row.typeLabel}</span>
                          {row.detail ? (
                            <span className="block text-xs text-muted-foreground">{row.detail}</span>
                          ) : null}
                        </td>
                        <td className="whitespace-nowrap py-2.5 pr-3 font-medium">{row.number}</td>
                        <td className="whitespace-nowrap py-2.5 pr-3 text-right font-medium tabular-nums">
                          {formatMoney(row.amount, currency)}
                        </td>
                        <td className="py-2.5 pr-3">
                          {row.kind === "payment" ? (
                            <span className="inline-flex items-center rounded-full bg-green-600/10 px-2 py-0.5 text-xs font-medium text-green-700 dark:text-green-400">
                              Received
                            </span>
                          ) : (
                            <InvoiceStatusBadge status={row.statusKey} isOverdue={row.isOverdue} />
                          )}
                          {row.dueLabel ? (
                            <span className="block text-xs text-muted-foreground">{row.dueLabel}</span>
                          ) : null}
                        </td>
                        <td className="whitespace-nowrap py-2.5 text-right">
                          <Link href={row.href} className="font-medium text-primary hover:underline">
                            View
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
