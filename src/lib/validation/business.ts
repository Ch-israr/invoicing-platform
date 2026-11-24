import { z } from "zod";

/** Empty form fields arrive as "" — treat them as "not provided". */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v === "" || v === undefined ? undefined : v));

const optionalEmail = z
  .union([z.literal(""), z.string().trim().email("Enter a valid email address")])
  .optional()
  .transform((v) => (v === "" || v === undefined ? undefined : v));

export const CURRENCIES = ["AED", "USD", "EUR", "GBP", "SAR", "QAR", "KWD", "INR"] as const;
export const COUNTRIES = [
  { code: "AE", name: "United Arab Emirates" },
  { code: "SA", name: "Saudi Arabia" },
  { code: "QA", name: "Qatar" },
  { code: "KW", name: "Kuwait" },
  { code: "BH", name: "Bahrain" },
  { code: "OM", name: "Oman" },
  { code: "US", name: "United States" },
  { code: "GB", name: "United Kingdom" },
  { code: "IN", name: "India" },
  { code: "PK", name: "Pakistan" },
] as const;

/** Business profile (Business model) + preferences (BusinessSettings). */
export const businessProfileSchema = z.object({
  name: z.string().trim().min(2, "Company name must be at least 2 characters").max(200),
  country: z.string().length(2, "Country is required"),
  currency: z.enum(CURRENCIES),
  address: optionalText(1000),
  phone: optionalText(50),
  email: optionalEmail,
  website: optionalText(200),
  trn: optionalText(50),
  bankName: optionalText(200),
  accountName: optionalText(200),
  iban: optionalText(50),
  swift: optionalText(20),
  paymentInstructions: optionalText(2000),
  invoicePrefix: z
    .string()
    .trim()
    .min(1, "Invoice prefix is required")
    .max(10, "Invoice prefix must be 10 characters or fewer")
    .regex(/^[A-Z0-9-]+$/i, "Invoice prefix may only contain letters, numbers and dashes"),
  nextInvoiceNumber: z.coerce.number().int().min(1, "Next invoice number must be at least 1").max(999999),
  nextQuotationNumber: z.coerce.number().int().min(1, "Next quotation number must be at least 1").max(999999),
  nextCreditNoteNumber: z.coerce.number().int().min(1, "Next credit note number must be at least 1").max(999999),
  defaultVatRateId: optionalText(50),
  defaultTerms: optionalText(5000),
  defaultFooter: optionalText(2000),
  // BusinessSettings
  locale: z.enum(["en", "ar"]),
  timezone: z.string().trim().min(1, "Timezone is required").max(100),
  dateFormat: z.enum(["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"]),
  pdfTemplate: z.enum(["classic", "modern", "minimal"]),
  primaryColor: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, "Primary colour must be a hex colour like #0f172a"),
  emailFromName: optionalText(200),
  emailFromAddress: optionalEmail,
  emailProvider: z.enum(["log", "resend", "smtp"]),
});

export type BusinessProfileInput = z.infer<typeof businessProfileSchema>;
