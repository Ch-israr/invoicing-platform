import { z } from "zod";

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

export const customerSchema = z.object({
  type: z.enum(["INDIVIDUAL", "COMPANY"]),
  name: z.string().trim().min(2, "Customer name must be at least 2 characters").max(200),
  companyName: optionalText(200),
  email: optionalEmail,
  phone: optionalText(50),
  billingAddress: optionalText(1000),
  shippingAddress: optionalText(1000),
  country: z.string().trim().length(2, "Country is required").default("AE"),
  trn: optionalText(50),
  notes: optionalText(5000),
  status: z.enum(["ACTIVE", "INACTIVE"]),
});

export type CustomerInput = z.infer<typeof customerSchema>;
