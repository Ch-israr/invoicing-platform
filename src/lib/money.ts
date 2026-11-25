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
 *   discountTotal = Σ line discounts + invoice-level discount
 *   taxableAmount = Σ taxable = subtotal - discountTotal
 *   vatAmount     = Σ vat
 *   grandTotal    = Σ lineTotal = taxableAmount + vatAmount
 *   balance       = grandTotal - amountPaid
 *
 * Invoice-level discount (EN 16931 BR-S-08 / BR-CO-17): a document
 * discount lowers the taxable amount, so it is allocated across the
 * VAT rates in proportion to each rate's taxable base — the shares
 * sum exactly to the discount, with rounding residue going to the
 * largest base. A percentage discount is a % of the post-line-
 * discount taxable base (capped at 100); a fixed discount is capped
 * at that same base, so the taxable amount can never go negative.
 * The discount applies BEFORE tax: each rate's VAT is recomputed
 * from its reduced taxable base.
 *
 * Early-payment discount (Skonto): never reduces the invoice total.
 * It is granted at payment time — see earlyDiscountSaving() — and
 * recorded on the Payment row, where it counts toward the invoice's
 * effective paid amount.
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
  /** Line discounts + invoice-level discount. */
  discountTotal: Decimal;
  /** Line discounts only. */
  lineDiscountTotal: Decimal;
  /** Invoice-level discount actually applied (0 when none). */
  invoiceDiscountTotal: Decimal;
  taxableAmount: Decimal;
  vatAmount: Decimal;
  grandTotal: Decimal;
};

/** An invoice-level discount, as stored on the Invoice row. */
export type InvoiceDiscountInput = {
  type: DiscountTypeValue;
  value: Decimal.Value;
};

export type RateGroupAllocation = {
  /** VAT rate in percent, e.g. 5 for 5%. */
  taxRatePercent: Decimal;
  /** Σ taxable (post line-discount, pre invoice-discount) at this rate. */
  taxableBefore: Decimal;
  /** This rate's share of the invoice-level discount. */
  discount: Decimal;
  /** taxableBefore - discount. VAT is charged on this. */
  taxableAfter: Decimal;
  /** VAT on taxableAfter, rounded half-up to 2dp. */
  vat: Decimal;
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

/**
 * Apply an invoice-level discount to already-computed line results.
 * Lines are grouped by VAT rate; the discount reduces each rate's
 * taxable base in proportion to that base, so the per-rate shares
 * sum exactly to the discount (rounding residue goes to the largest
 * base). VAT is then recomputed per rate from the reduced base.
 *
 * The raw discount amount is computed first, then capped at the
 * post-line-discount taxable base: a percentage is a % of that base
 * (capped at 100), a fixed amount is capped at the base itself.
 */
export function applyInvoiceLevelDiscount(
  groups: Array<{ taxRatePercent: Decimal.Value; result: LineResult }>,
  discount: InvoiceDiscountInput,
): {
  invoiceDiscountTotal: Decimal;
  allocations: RateGroupAllocation[];
  taxableAmount: Decimal;
  vatAmount: Decimal;
  grandTotal: Decimal;
} {
  const byRate = new Map<string, { rate: Decimal; taxableBefore: Decimal }>();
  for (const g of groups) {
    const rate = new Decimal(g.taxRatePercent);
    const key = rate.toString();
    const existing = byRate.get(key);
    if (existing) {
      existing.taxableBefore = existing.taxableBefore.add(g.result.taxableAmount);
    } else {
      byRate.set(key, { rate, taxableBefore: g.result.taxableAmount });
    }
  }
  const rateGroups = [...byRate.values()];
  const totalTaxable = rateGroups.reduce(
    (acc, g) => acc.add(g.taxableBefore),
    new Decimal(0),
  );

  // The discount amount actually applied (0 when NONE / zero / no base).
  let raw: Decimal;
  if (discount.type === "PERCENT") {
    const pct = new Decimal(discount.value);
    raw = pct.lessThanOrEqualTo(0)
      ? new Decimal(0)
      : round2(totalTaxable.mul(Decimal.min(pct, 100)).div(100));
  } else if (discount.type === "FIXED") {
    raw = round2(discount.value);
    if (raw.lessThan(0)) raw = new Decimal(0);
  } else {
    raw = new Decimal(0);
  }
  if (raw.greaterThan(totalTaxable)) raw = totalTaxable;

  const allocations: RateGroupAllocation[] = rateGroups.map((g) => {
    const share =
      raw.equals(0) || totalTaxable.equals(0)
        ? new Decimal(0)
        : round2(raw.mul(g.taxableBefore).div(totalTaxable));
    return {
      taxRatePercent: g.rate,
      taxableBefore: g.taxableBefore,
      discount: share,
      taxableAfter: g.taxableBefore.sub(share),
      vat: round2(g.taxableBefore.sub(share).mul(g.rate).div(100)),
    };
  });
  // Rounding residue (at most a few fils) goes to the largest base so
  // the shares sum exactly to the discount.
  const allocated = allocations.reduce(
    (acc, a) => acc.add(a.discount),
    new Decimal(0),
  );
  const residue = raw.sub(allocated);
  if (!residue.equals(0) && allocations.length > 0) {
    let largest = allocations[0];
    for (const a of allocations) {
      if (a.taxableBefore.greaterThan(largest.taxableBefore)) largest = a;
    }
    largest.discount = largest.discount.add(residue);
    // The residue is tiny; clamp so a share can never exceed its base.
    if (largest.discount.greaterThan(largest.taxableBefore)) {
      largest.discount = largest.taxableBefore;
    }
    if (largest.discount.lessThan(0)) largest.discount = new Decimal(0);
    largest.taxableAfter = largest.taxableBefore.sub(largest.discount);
    largest.vat = round2(largest.taxableAfter.mul(largest.taxRatePercent).div(100));
  }
  const invoiceDiscountTotal = allocations.reduce(
    (acc, a) => acc.add(a.discount),
    new Decimal(0),
  );
  const taxableAmount = allocations.reduce(
    (acc, a) => acc.add(a.taxableAfter),
    new Decimal(0),
  );
  const vatAmount = allocations.reduce((acc, a) => acc.add(a.vat), new Decimal(0));
  return {
    invoiceDiscountTotal,
    allocations,
    taxableAmount,
    vatAmount,
    grandTotal: taxableAmount.add(vatAmount),
  };
}

export function calculateInvoice(
  lines: LineInput[],
  invoiceDiscount: InvoiceDiscountInput = { type: "NONE", value: "0" },
): {
  lines: LineResult[];
  totals: InvoiceTotals;
} {
  const results = lines.map(calculateLine);
  const sum = (pick: (r: LineResult) => Decimal): Decimal =>
    results.reduce((acc, r) => acc.add(pick(r)), new Decimal(0));
  const subtotal = sum((r) => r.netAmount);
  const lineDiscountTotal = sum((r) => r.discountAmount);
  const applied = applyInvoiceLevelDiscount(
    results.map((result, i) => ({
      taxRatePercent: lines[i].taxRatePercent,
      result,
    })),
    invoiceDiscount,
  );
  return {
    lines: results,
    totals: {
      subtotal,
      discountTotal: lineDiscountTotal.add(applied.invoiceDiscountTotal),
      lineDiscountTotal,
      invoiceDiscountTotal: applied.invoiceDiscountTotal,
      taxableAmount: applied.taxableAmount,
      vatAmount: applied.vatAmount,
      grandTotal: applied.grandTotal,
    },
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

// ---------------------------------------------------------------------------
// Early-payment discount (Skonto)
// ---------------------------------------------------------------------------

/**
 * The last day the early-payment discount can be taken: the issue
 * date plus the validity window, as a UTC-midnight date.
 */
export function earlyDiscountDeadline(issueDate: Date, days: number): Date {
  const d = new Date(issueDate);
  d.setUTCHours(0, 0, 0, 0);
  return new Date(d.getTime() + Math.max(0, Math.floor(days)) * 86_400_000);
}

/** True when `today` (UTC day) is on or before the deadline. */
export function isWithinEarlyDiscountWindow(
  issueDate: Date,
  days: number,
  today = new Date(),
): boolean {
  const day = new Date(today);
  day.setUTCHours(0, 0, 0, 0);
  return day.getTime() <= earlyDiscountDeadline(issueDate, days).getTime();
}

/**
 * The saving an early-payment discount grants on the CURRENT
 * remaining balance: a percentage of the balance still owed, or a
 * fixed amount capped at the balance. Never more than the balance,
 * never negative, 0 when there is no discount configured.
 */
export function earlyDiscountSaving(
  balance: Decimal.Value,
  type: DiscountTypeValue,
  value: Decimal.Value,
): Decimal {
  const bal = new Decimal(balance);
  if (bal.lessThanOrEqualTo(0)) return new Decimal(0);
  if (type === "PERCENT") {
    const pct = new Decimal(value);
    if (pct.lessThanOrEqualTo(0)) return new Decimal(0);
    const saving = round2(bal.mul(Decimal.min(pct, 100)).div(100));
    return Decimal.min(saving, bal);
  }
  if (type === "FIXED") {
    const fixed = round2(value);
    if (fixed.lessThanOrEqualTo(0)) return new Decimal(0);
    return Decimal.min(fixed, bal);
  }
  return new Decimal(0);
}
