import { z } from "zod";
import { quantityString } from "./invoice";
import { moneyString } from "./product";

const optionalMoney = moneyString.optional().transform((v) => v ?? undefined);

/**
 * A credit note reverses part of an issued invoice, line by line.
 * Each line references an invoice item: the description, VAT rate and
 * tax-inclusive flag come from that item (server-side), so a credit
 * can never invent a different rate. Quantity is capped at the
 * item's remaining uncredited quantity; unitPrice defaults to the
 * item's price but may be lowered for a partial (e.g. goodwill)
 * credit. The note's grand total is capped at the invoice balance.
 */
export const creditNoteItemSchema = z.object({
  invoiceItemId: z.string().trim().min(1, "Choose an invoice line to credit"),
  quantity: quantityString,
  unitPrice: optionalMoney,
});

export const creditNoteSchema = z.object({
  reason: z.string().trim().min(1, "A reason is required").max(1000),
  items: z
    .array(creditNoteItemSchema)
    .min(1, "Add at least one line to credit")
    .max(100, "A credit note can have at most 100 lines"),
});

export type CreditNoteInput = z.infer<typeof creditNoteSchema>;
export type CreditNoteItemInput = z.infer<typeof creditNoteItemSchema>;
