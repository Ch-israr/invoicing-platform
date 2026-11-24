import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium, type Browser } from "playwright-core";
import { renderInvoiceHtml } from "./templates";
import type { InvoicePreviewData } from "@/lib/invoice-preview";

/**
 * PDF rendering — Playwright + Chromium, isolated in this module so
 * the web process never touches browser automation directly (the
 * architecture calls for a separate PDF worker process in production;
 * locally the same code runs in-process, which is fine for v1 and
 * keeps the deploy story simple until volume demands a queue).
 *
 * Rendering uses `page.setContent` with the standalone HTML from
 * templates.ts — no localhost round-trip, so the egress proxy can
 * never break it. Chromium is launched from the Playwright cache
 * (or CHROMIUM_EXECUTABLE_PATH) with --no-proxy-server for the same
 * reason.
 */

const CHROMIUM_CANDIDATES = [
  process.env.CHROMIUM_EXECUTABLE_PATH ?? "",
  path.join(os.homedir(), ".cache/ms-playwright/chromium-1254/chrome-linux64/chrome"),
  path.join(os.homedir(), ".cache/ms-playwright/chromium_headless_shell-1254/chrome-linux/headless_shell"),
].filter(Boolean);

export function findChromiumExecutable(): string | null {
  for (const candidate of CHROMIUM_CANDIDATES) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  return null;
}

let browserPromise: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    const executablePath = findChromiumExecutable();
    if (!executablePath) {
      throw new Error(
        "Chromium executable not found. Set CHROMIUM_EXECUTABLE_PATH or install the Playwright browser.",
      );
    }
    browserPromise = chromium.launch({
      executablePath,
      args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--no-proxy-server"],
    });
    // If the launch fails, clear the cached promise so the next call retries.
    browserPromise = browserPromise.catch((err) => {
      browserPromise = null;
      throw err;
    });
  }
  return browserPromise;
}

/** Close the shared browser (used by tests / graceful shutdown). */
export async function closePdfBrowser(): Promise<void> {
  if (browserPromise) {
    const browser = await browserPromise.catch(() => null);
    browserPromise = null;
    if (browser) await browser.close().catch(() => undefined);
  }
}

export type RenderPdfOptions = {
  /** Overlay the DRAFT watermark. Defaults to true when the invoice has no number. */
  watermarkDraft?: boolean;
};

/**
 * Render one invoice's PDF bytes from its preview data (snapshot for
 * issued invoices, live rows for drafts). Returns raw PDF bytes.
 */
export async function renderInvoicePdf(
  data: InvoicePreviewData,
  opts: RenderPdfOptions = {},
): Promise<Buffer> {
  const html = renderInvoiceHtml(data, opts);
  const browser = await getBrowser();
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: "load" });
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "0", bottom: "0", left: "0", right: "0" },
      preferCSSPageSize: true,
    });
    return Buffer.from(pdf);
  } finally {
    await context.close().catch(() => undefined);
  }
}
