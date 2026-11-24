import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Validate a redirect target coming from user input (e.g. a hidden
 * `back` form field). Only same-site relative paths are allowed — a
 * value like `//evil.com` (protocol-relative) or `https://evil.com`
 * falls back to the default. Prevents open-redirect attacks where a
 * crafted form sends a signed-in user to an external site.
 */
export function safeBackPath(value: unknown, fallback: string): string {
  if (typeof value !== "string" || value.length === 0) return fallback;
  if (!value.startsWith("/") || value.startsWith("//")) return fallback;
  if (value.includes("\\")) return fallback;
  return value;
}

/** Format a Decimal/number as money in the business currency. */
export function formatMoney(
  value: number | string,
  currency = "AED",
  locale = "en-AE",
): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value));
}
