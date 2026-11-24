import { NextResponse, type NextRequest } from "next/server";

// Auth.js middleware cannot import the Prisma adapter (Prisma does not
// run on the Edge runtime), so middleware only checks for the presence
// of the session cookie. Full session validation happens in the (app)
// layout via auth(). A forged cookie name gets no data — every page
// still calls auth() and validates the JWT signature.
const SESSION_COOKIES = [
  "authjs.session-token",
  "__Secure-authjs.session-token",
];

const PROTECTED_PREFIXES = [
  "/dashboard",
  "/invoices",
  "/quotations",
  "/customers",
  "/products",
  "/payments",
  "/expenses",
  "/recurring",
  "/credit-notes",
  "/reports",
  "/emails",
  "/settings",
];

function hasSessionCookie(req: NextRequest): boolean {
  return SESSION_COOKIES.some((name) => req.cookies.has(name));
}

/**
 * Security headers (Phase 8).
 *
 * Content-Security-Policy uses a per-request nonce for inline scripts:
 * Next.js reads the `x-nonce` request header and adds the same nonce to
 * the inline `<script>` tags it renders (RSC payload, hydration), so a
 * strict `script-src` does not break the app. Two catches, both found
 * in Phase 8 verification:
 * (1) Prerendered (static) pages are baked at build time, so their
 * inline scripts can never carry a nonce — the auth pages are forced
 * dynamic (`export const dynamic = "force-dynamic"` in
 * `src/app/(auth)/layout.tsx`) for exactly this reason.
 * (2) The next-themes blocking theme script is rendered by that
 * library, not by Next.js, so it gets the nonce via the `nonce` prop
 * (read from `x-nonce` in `src/app/layout.tsx`).
 * Styles need 'unsafe-inline': Recharts renders charts with inline
 * style attributes and Tailwind utilities rely on them in places —
 * the compiled CSS file itself is served from 'self'. Frames are
 * blocked via CSP `frame-ancestors 'none'` (no separate
 * X-Frame-Options header — one mechanism, documented here). HSTS and
 * upgrade-insecure-requests are sent only when the request actually
 * arrived over HTTPS (directly, or via the `x-forwarded-proto` header
 * a host like Render sets): gating on NODE_ENV would be wrong, because
 * `next start` sets NODE_ENV=production even for local http runs, and
 * upgrade-insecure-requests on plain http://localhost would make the
 * browser upgrade the app's own scripts to https and break the page.
 */
function securityHeaders(nonce: string, isHttps: boolean): Record<string, string> {
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(isHttps ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
  const headers: Record<string, string> = {
    "Content-Security-Policy": csp,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
  };
  if (isHttps) {
    headers["Strict-Transport-Security"] =
      "max-age=63072000; includeSubDomains; preload";
  }
  return headers;
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isProtected = PROTECTED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
  const isAuthPage = pathname === "/login" || pathname === "/register";
  const hasSession = hasSessionCookie(req);

  // Per-request nonce for the CSP (and for Next.js' own inline scripts).
  // Web Crypto is available in the Edge runtime; node:crypto is not.
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);

  let response: NextResponse;
  if (isProtected && !hasSession) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    response = NextResponse.redirect(url);
  } else if (isAuthPage && hasSession) {
    const url = req.nextUrl.clone();
    url.pathname = "/dashboard";
    response = NextResponse.redirect(url);
  } else {
    response = NextResponse.next({ request: { headers: requestHeaders } });
  }

  const isHttps =
    req.nextUrl.protocol === "https:" ||
    req.headers.get("x-forwarded-proto") === "https";
  const headers = securityHeaders(nonce, isHttps);
  for (const [key, value] of Object.entries(headers)) {
    response.headers.set(key, value);
  }
  return response;
}

export const config = {
  // Run on every route except static assets and the favicon, so the
  // security headers (and the CSP nonce) also cover /portal/* and /api/*.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff|woff2|ttf)$).*)",
  ],
};
