/**
 * Email providers (ARCHITECTURE.md §1.2).
 *
 * One interface, three providers selected by EMAIL_PROVIDER:
 * - "log" (default): prints the rendered email to the server log and
 *   sends nothing. This is what runs locally and in tests.
 * - "resend": sends via the Resend HTTP API (RESEND_API_KEY). Only
 *   used when explicitly configured — nothing is sent in this repo's
 *   default setup.
 * - "smtp": not implemented in this build (no SMTP client is
 *   installed). Selecting it fails loudly with a clear message
 *   instead of silently dropping mail. Use "resend" or "log".
 *
 * Providers never invent an address: the caller supplies `from`.
 */

export type EmailAttachment = {
  fileName: string;
  contentType: string;
  /** Raw bytes; the provider base64-encodes them if its API needs it. */
  content: Buffer;
};

export type EmailMessage = {
  to: string;
  subject: string;
  /** Rendered HTML body. */
  html: string;
  /** Plain-text body (same content, no markup). */
  text: string;
  from: string;
  attachments?: EmailAttachment[];
};

export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage): Promise<void>;
}

export class LogEmailProvider implements EmailProvider {
  readonly name = "log";

  async send(message: EmailMessage): Promise<void> {
    const attachments = (message.attachments ?? [])
      .map((a) => `${a.fileName} (${a.content.length} bytes)`)
      .join(", ");
    console.log(
      [
        `[email:log] To: ${message.to}`,
        `  From: ${message.from}`,
        `  Subject: ${message.subject}`,
        attachments ? `  Attachments: ${attachments}` : "  Attachments: none",
        `  Body (text):`,
        ...message.text.split("\n").map((line) => `    ${line}`),
      ].join("\n"),
    );
  }
}

export class ResendEmailProvider implements EmailProvider {
  readonly name = "resend";

  async send(message: EmailMessage): Promise<void> {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      throw new Error(
        "RESEND_API_KEY is not set — set it in .env to send via Resend",
      );
    }
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: message.from,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
        attachments: (message.attachments ?? []).map((a) => ({
          filename: a.fileName,
          content: a.content.toString("base64"),
        })),
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `Resend rejected the email (HTTP ${res.status})${body ? `: ${body.slice(0, 300)}` : ""}`,
      );
    }
  }
}

export class SmtpEmailProvider implements EmailProvider {
  readonly name = "smtp";

  async send(): Promise<void> {
    throw new Error(
      "SMTP sending is not implemented in this build — set EMAIL_PROVIDER=resend or log",
    );
  }
}

export type EmailProviderName = "log" | "resend" | "smtp";

/** The provider name configured for this process (default "log"). */
export function configuredProviderName(): EmailProviderName {
  const raw = (process.env.EMAIL_PROVIDER ?? "log").trim().toLowerCase();
  if (raw === "resend" || raw === "smtp") return raw;
  return "log";
}

export function getEmailProvider(name?: EmailProviderName): EmailProvider {
  switch (name ?? configuredProviderName()) {
    case "resend":
      return new ResendEmailProvider();
    case "smtp":
      return new SmtpEmailProvider();
    case "log":
    default:
      return new LogEmailProvider();
  }
}
