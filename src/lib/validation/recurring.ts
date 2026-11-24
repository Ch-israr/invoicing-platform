import { z } from "zod";
import { invoiceItemSchema } from "./invoice";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v === "" || v === undefined ? undefined : v));

const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date")
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), "Enter a valid date");

export const recurringSchema = z
  .object({
    customerId: z.string().trim().min(1, "Choose a customer"),
    frequency: z.enum(["WEEKLY", "MONTHLY", "QUARTERLY", "YEARLY", "CUSTOM"]),
    intervalDays: z
      .union([z.string(), z.number()])
      .optional()
      .transform((v) =>
        v === "" || v === undefined ? undefined : Number(v),
      )
      .pipe(z.number().int().min(1).max(365).optional()),
    startDate: dateString,
    endDate: z
      .string()
      .trim()
      .optional()
      .transform((v) => (v === "" || v === undefined ? undefined : v))
      .pipe(dateString.optional()),
    autoSend: z
      .union([z.boolean(), z.string()])
      .optional()
      .transform((v) => v === true || v === "on" || v === "true"),
    template: z.enum(["classic", "modern", "minimal"]).default("classic"),
    locale: z.enum(["en", "ar"]).default("en"),
    notes: optionalText(5000),
    terms: optionalText(5000),
    items: z
      .array(invoiceItemSchema)
      .min(1, "Add at least one line item")
      .max(100, "A schedule can have at most 100 lines"),
  })
  .superRefine((input, ctx) => {
    if (input.frequency === "CUSTOM" && !input.intervalDays) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A custom schedule needs an interval in days",
        path: ["intervalDays"],
      });
    }
    if (input.endDate && input.endDate < input.startDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "End date cannot be before the start date",
        path: ["endDate"],
      });
    }
  });

export type RecurringInput = z.infer<typeof recurringSchema>;
