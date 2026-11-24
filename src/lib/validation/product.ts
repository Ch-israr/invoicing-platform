import { z } from "zod";

/** Decimal money as a string: digits, optional fraction of up to 4 places, never negative. */
export const moneyString = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,4})?$/, "Enter a valid amount (up to 4 decimal places)")
  .refine((v) => Number(v) >= 0, "Amount cannot be negative");

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

export const productSchema = z.object({
  name: z.string().trim().min(2, "Item name must be at least 2 characters").max(200),
  sku: optionalText(50),
  description: optionalText(5000),
  categoryId: optionalId,
  unit: z.string().trim().min(1, "Unit is required").max(20).default("pcs"),
  price: moneyString,
  taxRateId: optionalId,
  taxCategory: z.enum(["STANDARD", "ZERO_RATED", "EXEMPT", "OUT_OF_SCOPE"]),
  isActive: z.boolean().default(true),
});

export type ProductInput = z.infer<typeof productSchema>;

export const productCategorySchema = z.object({
  name: z.string().trim().min(1, "Category name is required").max(100),
});

export type ProductCategoryInput = z.infer<typeof productCategorySchema>;
