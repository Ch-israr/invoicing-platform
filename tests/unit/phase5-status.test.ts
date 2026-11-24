import { describe, expect, it } from "vitest";
import { deriveInvoiceStatus } from "@/server/services/invoice.service";

/**
 * Status follows the money (see recomputeInvoiceState):
 *   balance 0 + money received  → PAID
 *   balance 0 + only credited   → status UNCHANGED (resolved by
 *                                  credit, not "paid")
 *   balance > 0 + paid/credited → PARTIALLY_PAID
 *   otherwise                   → status UNCHANGED
 * CANCELLED and DRAFT never move.
 */
describe("deriveInvoiceStatus", () => {
  it("full payment → PAID", () => {
    expect(deriveInvoiceStatus("ISSUED", "0", "239", "0")).toBe("PAID");
    expect(deriveInvoiceStatus("PARTIALLY_PAID", "0", "239", "0")).toBe("PAID");
    expect(deriveInvoiceStatus("SENT", "0", "100", "0")).toBe("PAID");
  });

  it("partial payment → PARTIALLY_PAID", () => {
    expect(deriveInvoiceStatus("ISSUED", "139", "100", "0")).toBe("PARTIALLY_PAID");
    expect(deriveInvoiceStatus("SENT", "50", "189", "0")).toBe("PARTIALLY_PAID");
  });

  it("credit only → PARTIALLY_PAID while a balance remains", () => {
    expect(deriveInvoiceStatus("ISSUED", "144.50", "0", "94.50")).toBe("PARTIALLY_PAID");
  });

  it("fully credited (balance 0, nothing received) keeps ISSUED — not PAID", () => {
    expect(deriveInvoiceStatus("ISSUED", "0", "0", "239")).toBe("ISSUED");
    expect(deriveInvoiceStatus("SENT", "0", "0", "239")).toBe("SENT");
  });

  it("nothing paid or credited → status unchanged", () => {
    expect(deriveInvoiceStatus("ISSUED", "239", "0", "0")).toBe("ISSUED");
    expect(deriveInvoiceStatus("SENT", "239", "0", "0")).toBe("SENT");
  });

  it("reversals return the invoice to ISSUED (payment deleted, refund in full, credit cancelled)", () => {
    expect(deriveInvoiceStatus("PARTIALLY_PAID", "239", "0", "0")).toBe("ISSUED");
    expect(deriveInvoiceStatus("PAID", "239", "0", "0")).toBe("ISSUED");
    expect(deriveInvoiceStatus("SENT", "239", "0", "0")).toBe("SENT");
  });

  it("CANCELLED and DRAFT never move", () => {
    expect(deriveInvoiceStatus("CANCELLED", "0", "239", "0")).toBe("CANCELLED");
    expect(deriveInvoiceStatus("CANCELLED", "100", "0", "0")).toBe("CANCELLED");
    expect(deriveInvoiceStatus("DRAFT", "0", "0", "0")).toBe("DRAFT");
  });

  it("paid + credited together still resolve to PAID when balance hits 0", () => {
    expect(deriveInvoiceStatus("PARTIALLY_PAID", "0", "100", "139")).toBe("PAID");
  });
});
