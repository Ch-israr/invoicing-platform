import type { ReactNode } from "react";
import Link from "next/link";
import { FileSignature } from "lucide-react";

// The auth pages must render per request, not prerender at build time:
// a prerendered page's inline scripts are baked in without a nonce,
// and the CSP (script-src 'nonce-…') would block them in the browser,
// leaving the sign-in form dead. Rendering dynamically lets the
// middleware nonce reach every inline script.
export const dynamic = "force-dynamic";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-muted/40 px-4 py-12">
      <Link href="/" className="mb-8 flex items-center gap-2">
        <FileSignature className="h-7 w-7 text-primary" />
        <span className="text-lg font-semibold">Invoicing Platform</span>
      </Link>
      {children}
    </main>
  );
}
