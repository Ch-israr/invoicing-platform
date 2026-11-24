import { toCsv } from "./csv";
import type {
  CustomerBalanceRow,
  OverdueRow,
  ProductRevenueRow,
  RevenueReport,
  VatReport,
} from "@/server/services/report.service";
import { toIsoDay } from "@/server/services/report.service";

/** CSV exports for every report — money as plain 2dp numbers. */

function money(value: { toFixed: (n: number) => string }): string {
  return value.toFixed(2);
}

export function revenueCsv(report: RevenueReport): string {
  return toCsv(
    ["Month", "Invoiced", "Paid"],
    report.monthly.map((m) => [m.month, money(m.invoiced), money(m.paid)]),
  );
}

export function vatCsv(report: VatReport): string {
  return toCsv(
    ["Month", "Output VAT", "Input VAT", "Net VAT"],
    report.monthly.map((m) => [
      m.month,
      money(m.outputVat),
      money(m.inputVat),
      money(m.outputVat.sub(m.inputVat)),
    ]),
  );
}

export function overdueCsv(rows: OverdueRow[]): string {
  return toCsv(
    ["Invoice", "Customer", "Due date", "Days overdue", "Balance"],
    rows.map((r) => [
      r.number,
      r.customerName,
      toIsoDay(r.dueDate),
      r.daysOverdue,
      money(r.balance),
    ]),
  );
}

export function customersCsv(rows: CustomerBalanceRow[]): string {
  return toCsv(
    ["Customer", "Invoiced", "Paid", "Credited", "Outstanding"],
    rows.map((r) => [
      r.customerName,
      money(r.invoiced),
      money(r.paid),
      money(r.credited),
      money(r.outstanding),
    ]),
  );
}

export function productsCsv(rows: ProductRevenueRow[]): string {
  return toCsv(
    ["Product", "SKU", "Quantity sold", "Invoices", "Revenue"],
    rows.map((r) => [
      r.productName,
      r.sku ?? "",
      r.quantity.toString(),
      r.invoices,
      money(r.revenue),
    ]),
  );
}
