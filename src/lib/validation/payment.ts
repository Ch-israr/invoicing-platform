import { z } from "zod";
import { moneyString } from "./product";

const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date")
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), "Enter a valid date");

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v === "" || v === undefined ? undefined : v));

/** Payment amount must be greater than zero (moneyString alone allows 0). */
const positiveMoney = moneyString.refine(
  (v) => Number(v) > 0,
  "Amount must be greater than 0",
);

export const paymentSchema = z.object({
  date: dateString,
  amount: positiveMoney,
  method: z.enum(["CASH", "BANK_TRANSFER", "CARD", "OTHER"]).default("BANK_TRANSFER"),
  reference: optionalText(200),
  notes: optionalText(5000),
});

export type PaymentInput = z.infer<typeof paymentSchema>;

export const refundSchema = z.object({
  date: dateString,
  amount: positiveMoney,
  reason: z.string().trim().min(1, "A reason is required").max(1000),
});

export type RefundInput = z.infer<typeof refundSchema>;
