import Decimal from "decimal.js";

/**
 * Money engine — pure functions, Decimal only, never float.
 *
 * Money is stored as DECIMAL(19,4) in Postgres and Prisma Decimal.
 * Display rounding is half-up to 2 decimal places (AED fils) and happens
 * at LINE level; invoice totals are the SUM of the rounded line values,
 * so `grandTotal = subtotal - discountTotal + vatAmount` always holds
 * exactly and the rendered invoice always adds up.
 *
 * Per line:
 *   gross     = quantity × unitPrice (as entered)
 *   net       = gross with VAT extracted when the price is tax-inclusive
 *               (gross / (1 + rate/100)), otherwise gross itself
 *   discount  = PERCENT → net × pct/100, FIXED → fixed amount per line,
 *               clamped to [0, net] so a line can never go negative
 *   taxable   = net - discount            (the amount VAT is charged on)
 *   vat       = taxable × rate/100
 *   lineTotal = taxable + vat
 * Each of discount / taxable / vat is rounded half-up to 2dp; lineTotal
 * is the exact sum of the rounded taxable + rounded vat (never rounded
 * independently, so no 0.01 drift).
 *
 * Invoice totals:
 *   subtotal      = Σ net (before discount, VAT excluded)
 *   discountTotal = Σ discounts
 *   taxableAmount = Σ taxable = subtotal - discountTotal
 *   vatAmount     = Σ vat
 *   grandTotal    = Σ lineTotal = taxableAmount + vatAmount
 *   balance       = grandTotal - amountPaid
 *
 * The server recalculates all of this on every save/issue and never
 * trusts client-supplied totals. The same functions are imported by the
 * builder for the live preview — preview totals are display-only.
 */

export type DiscountTypeValue = "NONE" | "PERCENT" | "FIXED";

export type LineInput = {
  quantity: Decimal.Value;
  unitPrice: Decimal.Value;
  discountType: DiscountTypeValue;
  discountValue: Decimal.Value;
  /** VAT rate in percent, e.g. 5 for 5%. */
  taxRatePercent: Decimal.Value;
  /** True when unitPrice already includes VAT. */
  taxInclusive: boolean;
};

export type LineResult = {
  /** quantity × unitPrice as entered (includes VAT when taxInclusive). */
  grossAmount: Decimal;
  /** Pre-tax amount before discount. */
  netAmount: Decimal;
  discountAmount: Decimal;
  /** netAmount - discountAmount. VAT is charged on this. */
  taxableAmount: Decimal;
  vatAmount: Decimal;
  /** taxableAmount + vatAmount. */
  lineTotal: Decimal;
};

export type InvoiceTotals = {
  subtotal: Decimal;
  discountTotal: Decimal;
  taxableAmount: Decimal;
  vatAmount: Decimal;
  grandTotal: Decimal;
};

/** Round half-up to 2 decimal places. */
export function round2(value: Decimal.Value): Decimal {
  return new Decimal(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/** Quantity is DECIMAL(12,3) — round half-up to 3 places. */
export function roundQty(value: Decimal.Value): Decimal {
  return new Decimal(value).toDecimalPlaces(3, Decimal.ROUND_HALF_UP);
}

export function calculateLine(input: LineInput): LineResult {
  const quantity = new Decimal(input.quantity);
  const unitPrice = new Decimal(input.unitPrice);
  const rate = new Decimal(input.taxRatePercent);
  const discountValue = new Decimal(input.discountValue);

  const gross = quantity.mul(unitPrice);
  const net = input.taxInclusive
    ? gross.div(Decimal.add(1, rate.div(100)))
    : gross;

  let discount: Decimal;
  if (input.discountType === "PERCENT") {
    discount = net.mul(discountValue).div(100);
  } else if (input.discountType === "FIXED") {
    discount = discountValue;
  } else {
    discount = new Decimal(0);
  }
  // A discount can never exceed the line's net value.
  if (discount.lessThan(0)) discount = new Decimal(0);
  if (discount.greaterThan(net)) discount = net;

  const taxableExact = net.sub(discount);
  const vatExact = taxableExact.mul(rate).div(100);

  const netAmount = round2(net);
  const discountAmount = round2(discount);
  const taxableAmount = round2(taxableExact);
  const vatAmount = round2(vatExact);
  const lineTotal = taxableAmount.add(vatAmount);

  return {
    grossAmount: round2(gross),
    netAmount,
    discountAmount,
    taxableAmount,
    vatAmount,
    lineTotal,
  };
}

export function calculateInvoice(lines: LineInput[]): {
  lines: LineResult[];
  totals: InvoiceTotals;
} {
  const results = lines.map(calculateLine);
  const sum = (pick: (r: LineResult) => Decimal): Decimal =>
    results.reduce((acc, r) => acc.add(pick(r)), new Decimal(0));
  const subtotal = sum((r) => r.netAmount);
  const discountTotal = sum((r) => r.discountAmount);
  const taxableAmount = sum((r) => r.taxableAmount);
  const vatAmount = sum((r) => r.vatAmount);
  const grandTotal = sum((r) => r.lineTotal);
  return {
    lines: results,
    totals: { subtotal, discountTotal, taxableAmount, vatAmount, grandTotal },
  };
}

/** Balance still owed on an invoice. */
export function balanceDue(
  grandTotal: Decimal.Value,
  amountPaid: Decimal.Value,
): Decimal {
  const balance = new Decimal(grandTotal).sub(new Decimal(amountPaid));
  return balance.lessThan(0) ? new Decimal(0) : round2(balance);
}
