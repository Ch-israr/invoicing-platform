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
