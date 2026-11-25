import { z } from "zod";
import { moneyString } from "./product";

/** Quantity: positive, up to 3 decimal places (DECIMAL(12,3)). */
export const quantityString = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,3})?$/, "Enter a valid quantity (up to 3 decimal places)")
  .refine((v) => Number(v) > 0, "Quantity must be greater than 0");

/** Discount percent: 0–100, up to 2 decimal places. */
const percentString = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,2})?$/, "Enter a valid percentage (up to 2 decimal places)")
  .refine((v) => Number(v) >= 0 && Number(v) <= 100, "Percentage must be between 0 and 100");

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v === "" || v === undefined ? undefined : v));

const optionalId = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v === "" || v === undefined ? undefined : v));

const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date")
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), "Enter a valid date");

export const invoiceItemSchema = z
  .object({
    productId: optionalId,
    description: z.string().trim().min(1, "Line description is required").max(5000),
    sku: optionalText(50),
    quantity: quantityString,
    unit: z.string().trim().min(1, "Unit is required").max(20).default("pcs"),
    unitPrice: moneyString,
    discountType: z.enum(["NONE", "PERCENT", "FIXED"]).default("NONE"),
    discountValue: z.string().trim().default("0"),
    taxRateId: optionalId,
    taxCategory: z.enum(["STANDARD", "ZERO_RATED", "EXEMPT", "OUT_OF_SCOPE"]),
    taxInclusive: z.boolean().default(false),
  })
  .superRefine((item, ctx) => {
    if (item.discountType === "PERCENT") {
      const parsed = percentString.safeParse(item.discountValue);
      if (!parsed.success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Discount must be a percentage between 0 and 100",
          path: ["discountValue"],
        });
      }
    } else if (item.discountType === "FIXED") {
      const parsed = moneyString.safeParse(item.discountValue);
      if (!parsed.success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Enter a valid fixed discount amount",
          path: ["discountValue"],
        });
      }
    }
  });

export type InvoiceItemInput = z.infer<typeof invoiceItemSchema>;

/**
 * A line that carries nothing — no product, no description, no SKU,
 * no price and no discount. Such lines come from the builder's blank
 * starting line (or an "Add line" the user never filled): the blank
 * line's defaults (quantity "1", unit "pcs", the default VAT rate)
 * are not content, so they don't count. A fully-empty line must never
 * block a save; a partially-filled line (e.g. a description with no
 * price) is NOT empty and is still rejected with a visible error.
 */
export function isEmptyLineItem(item: unknown): boolean {
  if (!item || typeof item !== "object") return false;
  const line = item as Record<string, unknown>;
  const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const price = text(line.unitPrice);
  const discountType = text(line.discountType);
  const discountValue = text(line.discountValue);
  const hasDiscount =
    discountType !== "" &&
    discountType !== "NONE" &&
    discountValue !== "" &&
    discountValue !== "0";
  return (
    text(line.productId) === "" &&
    text(line.description) === "" &&
    text(line.sku) === "" &&
    (price === "" || Number(price) === 0) &&
    !hasDiscount
  );
}

/**
 * Client-side twin of isEmptyLineItem, for the builder's LineState
 * shape. Delegates to isEmptyLineItem so the two can never drift:
 * the lines the client submits and the lines the server validates
 * are judged by the same rule.
 */
export function isEmptyLineState(line: {
  productId: string;
  description: string;
  sku: string;
  unitPrice: string;
  discountType: string;
  discountValue: string;
}): boolean {
  return isEmptyLineItem(line);
}

/** Drop fully-empty lines from a raw create/update input before it is
 * validated, so a blank starting line can never reject a save. The
 * input is returned unchanged when it has no items array. */
export function stripEmptyLineItems(rawInput: unknown): unknown {
  if (!rawInput || typeof rawInput !== "object") return rawInput;
  const obj = rawInput as Record<string, unknown>;
  if (!Array.isArray(obj.items)) return rawInput;
  return { ...obj, items: obj.items.filter((item) => !isEmptyLineItem(item)) };
}

/**
 * The first validation issue as a user-facing error, plus the index
 * of the offending line (into the items array as submitted) when the
 * issue is about a line item, so the form can highlight it.
 */
export function firstValidationError(error: z.ZodError): {
  error: string;
  lineIndex?: number;
} {
  const first = error.issues[0];
  if (!first) return { error: "Invalid input" };
  const out: { error: string; lineIndex?: number } = { error: first.message };
  if (first.path[0] === "items" && typeof first.path[1] === "number") {
    out.lineIndex = first.path[1];
  }
  return out;
}

/** Whole days, 0 or more (the early-payment validity window). */
const daysString = z
  .string()
  .trim()
  .regex(/^\d+$/, "Enter a whole number of days (0 or more)")
  .refine((v) => Number(v) >= 0, "Days must be 0 or more");

/** Validate one discount (invoice-level or early-payment) against
 * its type: PERCENT takes 0–100, FIXED takes a money amount ≥ 0.
 * The server clamps the applied amount to the taxable base / balance
 * when the totals are computed (see lib/money.ts). */
function discountRefine(
  type: "NONE" | "PERCENT" | "FIXED",
  value: string,
  ctx: z.RefinementCtx,
  valuePath: string[],
) {
  if (type === "PERCENT") {
    const parsed = percentString.safeParse(value);
    if (!parsed.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Discount must be a percentage between 0 and 100",
        path: valuePath,
      });
    }
  } else if (type === "FIXED") {
    const parsed = moneyString.safeParse(value);
    if (!parsed.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Enter a valid fixed discount amount",
        path: valuePath,
      });
    }
  }
}

export const invoiceSchema = z
  .object({
    customerId: z.string().trim().min(1, "Choose a customer"),
    issueDate: dateString,
    dueDate: dateString,
    supplyDate: z
      .string()
      .trim()
      .optional()
      .transform((v) => (v === "" || v === undefined ? undefined : v))
      .pipe(dateString.optional()),
    notes: optionalText(5000),
    terms: optionalText(5000),
    template: z.enum(["classic", "modern", "minimal"]).default("classic"),
    locale: z.enum(["en", "ar"]).default("en"),
    // Invoice-level discount (draft-time; locked once issued).
    invoiceDiscountType: z.enum(["NONE", "PERCENT", "FIXED"]).default("NONE"),
    invoiceDiscountValue: z.string().trim().default("0"),
    // Early-payment discount (draft-time; applies at payment time).
    earlyDiscountType: z.enum(["NONE", "PERCENT", "FIXED"]).default("NONE"),
    earlyDiscountValue: z.string().trim().default("0"),
    earlyDiscountDays: z.string().trim().default("0"),
    items: z
      .array(invoiceItemSchema)
      .min(1, "Add at least one line item")
      .max(100, "An invoice can have at most 100 lines"),
  })
  .superRefine((inv, ctx) => {
    if (inv.dueDate < inv.issueDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Due date cannot be before the issue date",
        path: ["dueDate"],
      });
    }
    discountRefine(inv.invoiceDiscountType, inv.invoiceDiscountValue, ctx, [
      "invoiceDiscountValue",
    ]);
    discountRefine(inv.earlyDiscountType, inv.earlyDiscountValue, ctx, [
      "earlyDiscountValue",
    ]);
    if (inv.earlyDiscountType !== "NONE") {
      const parsed = daysString.safeParse(inv.earlyDiscountDays);
      if (!parsed.success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Enter a whole number of days (0 or more)",
          path: ["earlyDiscountDays"],
        });
      }
    }
  });

export type InvoiceInput = z.infer<typeof invoiceSchema>;

/** Map a TaxRate code to its TaxCategory (used when a line picks a rate). */
export function taxCategoryForRateCode(code: string): InvoiceItemInput["taxCategory"] {
  switch (code.toUpperCase()) {
    case "ZERO":
      return "ZERO_RATED";
    case "EXEMPT":
      return "EXEMPT";
    case "OUT_OF_SCOPE":
      return "OUT_OF_SCOPE";
    default:
      return "STANDARD";
  }
}
