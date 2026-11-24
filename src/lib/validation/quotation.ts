import { z } from "zod";
import { invoiceItemSchema } from "./invoice";

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

/**
 * A quotation is an invoice that hasn't happened yet: same customer
 * picker, same line items, same money engine. It has an expiry date
 * instead of a due/supply date, and no template/locale of its own —
 * the preview renders with the business settings defaults.
 * The number (QTN-0001) is assigned when the quotation is sent.
 */
export const quotationSchema = z
  .object({
    customerId: z.string().trim().min(1, "Choose a customer"),
    issueDate: dateString,
    expiryDate: dateString,
    notes: optionalText(5000),
    terms: optionalText(5000),
    items: z
      .array(invoiceItemSchema)
      .min(1, "Add at least one line item")
      .max(100, "A quotation can have at most 100 lines"),
  })
  .superRefine((q, ctx) => {
    if (q.expiryDate < q.issueDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Expiry date cannot be before the issue date",
        path: ["expiryDate"],
      });
    }
  });

export type QuotationInput = z.infer<typeof quotationSchema>;
export type QuotationItemInput = z.infer<typeof invoiceItemSchema>;
