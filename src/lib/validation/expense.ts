import { z } from "zod";
import { moneyString } from "./product";

/** Amount: positive money, up to 4 decimal places. */
const positiveMoney = moneyString.refine(
  (v) => Number(v) > 0,
  "Amount must be greater than 0",
);

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

export const expenseSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  date: dateString,
  amount: positiveMoney,
  vatAmount: moneyString.default("0"),
  categoryId: optionalId,
  vendor: optionalText(200),
  method: z.enum(["CASH", "BANK_TRANSFER", "CARD", "OTHER"]).default("BANK_TRANSFER"),
  description: optionalText(5000),
});

export type ExpenseInput = z.infer<typeof expenseSchema>;

export const expenseCategorySchema = z.object({
  name: z.string().trim().min(1, "Category name is required").max(100),
});

export type ExpenseCategoryInput = z.infer<typeof expenseCategorySchema>;
