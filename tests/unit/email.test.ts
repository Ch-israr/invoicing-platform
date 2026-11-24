import { describe, expect, it } from "vitest";
import { isRetryDue, retryDelayMs } from "@/server/email/service";
import { renderInvoiceEmail } from "@/server/email/templates";
import { LogEmailProvider, getEmailProvider } from "@/server/email/providers";

describe("retryDelayMs", () => {
  it("backs off exponentially: 2, 4, 8 minutes", () => {
    expect(retryDelayMs(1)).toBe(2 * 60_000);
    expect(retryDelayMs(2)).toBe(4 * 60_000);
    expect(retryDelayMs(3)).toBe(8 * 60_000);
  });
});

describe("isRetryDue", () => {
  it("is not due before the backoff elapses", () => {
    const now = new Date("2026-11-24T12:00:00Z");
    const oneMinuteAgo = new Date("2026-11-24T11:59:00Z");
    expect(isRetryDue(oneMinuteAgo, 1, now)).toBe(false);
  });
  it("is due once the backoff has elapsed", () => {
    const now = new Date("2026-11-24T12:00:00Z");
    const threeMinutesAgo = new Date("2026-11-24T11:57:00Z");
    expect(isRetryDue(threeMinutesAgo, 1, now)).toBe(true);
  });
  it("a second failure waits twice as long", () => {
    const now = new Date("2026-11-24T12:00:00Z");
    const threeMinutesAgo = new Date("2026-11-24T11:57:00Z");
    expect(isRetryDue(threeMinutesAgo, 2, now)).toBe(false);
  });
});

describe("renderInvoiceEmail", () => {
  const base = {
    businessName: "QA Trading LLC",
    businessEmail: "hello@qa.example",
    paymentInstructions: "Pay by bank transfer.",
    bankName: "Emirates NBD",
    iban: "AE070331234567890123456",
    customerName: "Acme Trading LLC",
    invoiceNumber: "INV-0001",
    grandTotal: "525.0000",
    balance: "525.0000",
    currency: "AED",
    dueDateLabel: "24 Dec 2026",
  };

  it("subject carries number, business, total and due date", () => {
    const { subject } = renderInvoiceEmail(base);
    expect(subject).toContain("INV-0001");
    expect(subject).toContain("QA Trading LLC");
    expect(subject).toContain("525.00");
    expect(subject).toContain("24 Dec 2026");
  });

  it("text and html bodies carry the same facts", () => {
    const { html, text } = renderInvoiceEmail(base);
    for (const body of [html, text]) {
      expect(body).toContain("INV-0001");
      expect(body).toContain("Acme Trading LLC");
      expect(body).toContain("525.00");
      expect(body).toContain("24 Dec 2026");
      expect(body).toContain("Emirates NBD");
    }
  });

  it("escapes customer input in the html body", () => {
    const { html } = renderInvoiceEmail({ ...base, customerName: "<b>Acme</b>" });
    expect(html).not.toContain("<b>Acme</b>");
    expect(html).toContain("&lt;b&gt;Acme&lt;/b&gt;");
  });

  it("omits the payment section when there are no payment details", () => {
    const { text } = renderInvoiceEmail({
      ...base,
      paymentInstructions: null,
      bankName: null,
      iban: null,
    });
    expect(text).not.toContain("Payment details");
  });
});

describe("getEmailProvider", () => {
  it("defaults to the log provider (sends nothing)", async () => {
    const provider = getEmailProvider("log");
    expect(provider.name).toBe("log");
    // Must resolve without throwing and without sending anywhere.
    await expect(
      provider.send({
        to: "nobody@example.com",
        subject: "test",
        html: "<p>hi</p>",
        text: "hi",
        from: "sender@example.com",
      }),
    ).resolves.toBeUndefined();
  });

  it("the log provider is the default when no name is given", () => {
    expect(getEmailProvider().name).toBe("log");
    expect(new LogEmailProvider().name).toBe("log");
  });
});
