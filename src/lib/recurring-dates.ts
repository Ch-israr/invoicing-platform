import type { RecurringFrequency } from "@prisma/client";

/**
 * Date math for recurring invoices (ARCHITECTURE.md §1.5).
 *
 * All dates are treated as UTC calendar days — schedules store
 * midnight-UTC dates, so every helper works in UTC to avoid
 * timezone drift. Month advances clamp to the last day of the
 * target month (31 Jan → 28 Feb, 29 Feb 2024 → 28 Feb 2025).
 */

export function daysInMonth(year: number, monthZeroBased: number): number {
  return new Date(Date.UTC(year, monthZeroBased + 1, 0)).getUTCDate();
}

/** Add whole calendar months, clamping the day to the target month. */
export function addMonthsClamped(date: Date, months: number): Date {
  const day = date.getUTCDate();
  const d = new Date(date);
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  d.setUTCDate(Math.min(day, daysInMonth(d.getUTCFullYear(), d.getUTCMonth())));
  return d;
}

/** Advance a run date by one period of the schedule's frequency. */
export function advanceNextRun(
  from: Date,
  frequency: RecurringFrequency,
  intervalDays?: number | null,
): Date {
  const d = new Date(from);
  switch (frequency) {
    case "WEEKLY":
      d.setUTCDate(d.getUTCDate() + 7);
      return d;
    case "MONTHLY":
      return addMonthsClamped(d, 1);
    case "QUARTERLY":
      return addMonthsClamped(d, 3);
    case "YEARLY":
      return addMonthsClamped(d, 12);
    case "CUSTOM": {
      if (!intervalDays || intervalDays < 1) {
        throw new Error("A custom recurring schedule needs intervalDays of at least 1");
      }
      d.setUTCDate(d.getUTCDate() + intervalDays);
      return d;
    }
  }
}

/** The idempotency key for one scheduled run: one invoice per schedule per period. */
export function makeRunKey(scheduleId: string, runAt: Date): string {
  return `${scheduleId}:${runAt.toISOString().slice(0, 10)}`;
}

/** "2026-11-24" (UTC) for a Date. */
export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Parse a YYYY-MM-DD date as UTC midnight. */
export function parseIsoDate(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

/** Whole days between two dates (UTC calendar days). */
export function daysBetween(from: Date, to: Date): number {
  const a = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const b = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  return Math.round((b - a) / 86_400_000);
}
