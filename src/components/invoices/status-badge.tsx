import { cn } from "@/lib/utils";

const STYLES: Record<string, string> = {
  DRAFT: "bg-slate-500/10 text-slate-600 dark:text-slate-400",
  ISSUED: "bg-blue-600/10 text-blue-700 dark:text-blue-400",
  SENT: "bg-indigo-600/10 text-indigo-700 dark:text-indigo-400",
  PARTIALLY_PAID: "bg-amber-600/10 text-amber-700 dark:text-amber-400",
  PAID: "bg-green-600/10 text-green-700 dark:text-green-400",
  CANCELLED: "bg-red-600/10 text-red-700 dark:text-red-400",
  ACCEPTED: "bg-green-600/10 text-green-700 dark:text-green-400",
  REJECTED: "bg-red-600/10 text-red-700 dark:text-red-400",
  EXPIRED: "bg-slate-500/10 text-slate-600 dark:text-slate-400",
};

export const INVOICE_STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  ISSUED: "Issued",
  SENT: "Sent",
  PARTIALLY_PAID: "Partially paid",
  PAID: "Paid",
  CANCELLED: "Cancelled",
  ACCEPTED: "Accepted",
  REJECTED: "Rejected",
  EXPIRED: "Expired",
};

export function InvoiceStatusBadge({
  status,
  isOverdue,
}: {
  status: string;
  isOverdue?: boolean;
}) {
  if (isOverdue) {
    return (
      <span className="inline-flex items-center rounded-full bg-red-600/10 px-2 py-0.5 text-xs font-medium text-red-700 dark:text-red-400">
        Overdue
      </span>
    );
  }
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        STYLES[status] ?? STYLES.DRAFT,
      )}
    >
      {INVOICE_STATUS_LABELS[status] ?? status}
    </span>
  );
}
