# Security

## Threat model (summary)

The app holds one business's financial records (invoices, payments,
customer contact details) and serves them to that business's own users
plus, via expiring links, to its customers. The threats it is built
against:

- **Cross-tenant data access** — a user of business A reading or
  changing business B's records.
- **Privilege escalation** — a MEMBER/VIEWER performing OWNER/ADMIN
  actions (deleting payments, revoking portal links, regenerating PDFs).
- **Credential guessing** — brute-forcing logins.
- **Abuse of public endpoints** — hammering the portal token check or
  the PDF downloads.
- **Injection / bad input** — malformed values crashing pages or
  reaching the database unvalidated.
- **Stolen portal links** — a forwarded or leaked customer link.
- **Secret leakage** — keys or passwords committed to the repo.

Out of scope for v1: online card payments (no gateway), 2FA, SSO,
per-row encryption at rest (relies on the database host).

## What is in place

### Tenant isolation + RBAC

- Every business-owned row carries `businessId`. Services resolve
  user-supplied IDs through `src/lib/tenant.ts` (`scopeWhere`,
  `requireMembership`, `requireCanWrite`, `canManageBusiness`).
- Cross-business access returns `404`, never data — including for
  invoices, customers, payments, portal tokens, uploads and reports.
- Roles: OWNER (all), ADMIN (all except deleting the business /
  managing owners), MEMBER (create/edit in their area), VIEWER
  (read-only). Role checks run server-side on every mutation, not just
  by hiding buttons.
- Integration tests prove both: a MEMBER of business B cannot read
  business A's invoice/customer/payment/portal token, and a MEMBER
  cannot regenerate PDFs, revoke portal links, delete payments, record
  refunds or delete expense categories (`tests/integration/phase8.test.ts`,
  `tests/integration/tenant-isolation.test.ts`).

### Authentication

- Auth.js v5, email + password, bcrypt cost 12, password minimum 10
  characters. Sessions are **JWT** (30-day expiry), signed with
  `NEXTAUTH_SECRET`.
- **Known limit — no server-side session revocation.** Auth.js v5
  forbids the Credentials provider with database sessions, so there is
  no "log out everywhere". Rotating `NEXTAUTH_SECRET` invalidates all
  sessions at once (see RUNBOOK.md). A stolen session cookie stays
  valid until it expires or the secret rotates.
- No 2FA in v1.

### Rate limiting

In-memory limiter (`src/lib/rate-limit.ts`). Single-instance only —
with more than one web instance, replace it with a Redis-backed
limiter (the portal and auth code call one helper, so the swap is in
one place).

| Endpoint | Limit |
|---|---|
| Login / register | 5 attempts/min/IP **and** 5/min per email address |
| Portal token verification | 10 attempts/min/IP |
| API routes (PDF, reports, exports, uploads) | 60/min/IP per route group |
| PDF download | 60/min/IP (same bucket as above) |

Exceeded limits return `429` with a `Retry-After` header. In local
dev, requests without proxy headers share the `unknown` IP bucket.

### Security headers

Set in `src/middleware.ts` on every route (including `/portal/*` and
`/api/*`):

- `Content-Security-Policy` with a per-request nonce for inline
  scripts (Next.js reads the `x-nonce` request header and adds the
  nonce to its own scripts). `style-src` allows `'unsafe-inline'`
  because Recharts renders charts with inline styles. `frame-ancestors
  'none'` blocks framing (no separate `X-Frame-Options` header — one
  mechanism, documented in the middleware).
- `Strict-Transport-Security` (+ `upgrade-insecure-requests`) — sent
  only when the request actually arrived over HTTPS (directly, or via
  `x-forwarded-proto`). Gating on `NODE_ENV` would be wrong: `next
  start` sets it to `production` even for local http runs, and the
  upgrade directive would break the page there.
- `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: strict-origin-when-cross-origin`,
  `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()`.

### Input validation

- Every Server Action and API route validates user input with Zod
  before use: numbers as Decimal-safe strings, dates as `YYYY-MM-DD`
  with a real-date check, enums whitelisted, strings length-capped,
  IDs resolved through tenant scoping (a malformed ID 404s, it never
  reaches the database raw).
- List-page filters whitelist enum values; `parsePage` clamps page
  numbers; date-range filters ignore malformed dates instead of
  passing an Invalid Date to Prisma (a `/expenses?from=garbage` 500
  was fixed in Phase 8).
- All database access is through Prisma (parameterised queries). There
  is no raw SQL with string interpolation.
- Redirect targets from form fields (`back`) are validated by
  `safeBackPath` — only same-site relative paths; protocol-relative
  (`//evil.com`) and absolute URLs fall back to a safe default.

### File uploads

- Allowlist by MIME type: PNG/JPEG/WebP for logos and signatures,
  plus PDF for expense receipts. 5 MB maximum, empty files rejected.
- Stored under business-scoped keys
  (`<businessId>/<kind>/<uuid>-<safe-name>`) outside the web root,
  served only through the authenticated `/api/uploads/[...key]` route
  with a content type derived from the extension. Uploaded files are
  never executed.
- Path traversal is rejected (`..` and absolute paths) in both
  `readUpload` and `deleteFile`.

### Customer portal tokens

- Tokens are `crypto.randomBytes(32)`, base64url. **Only the SHA-256
  hash is stored**; the plaintext is shown once at creation and never
  stored, logged or emailed.
- Scope is one of `invoice:<id> | quotation:<id> | customer:<id>`.
  A token can only see and decide what its scope covers.
- Default expiry 30 days (1–365 at creation), revocable by
  OWNER/ADMIN. Expired, revoked and unknown tokens all fail with the
  same generic message, so probers cannot tell the cases apart.
- Verification is rate-limited (10/min/IP) and failed verifications
  are logged without the token or its hash.

### Audit trail

Every mutation writes an `ActivityLog` row (`businessId`, `userId`,
`action`, `entityType`, `entityId`, metadata). There is no update or
delete API for logs. Covered actions include invoice create/issue/
update/void/delete, payment record/delete/refund, credit note
create/cancel, quotation create/send/accept/reject/expire/convert,
expense and category create/update/delete, recurring create/run/
pause/resume/cancel, portal token create/revoke, portal quotation
decisions (with `userId: null`), email queue/send/retry, PDF
generation, business settings changes, and user registration.
Login attempts (successful or failed) are **not** stored in
`ActivityLog` — that is a known gap; see "Not claimed" below.

### Secrets

- `.env` is gitignored; `.env.example` holds placeholders only and is
  the only env file tracked.
- No secret is stored in the database. Resend/SMTP/S3 keys live in
  environment variables only.
- Before every commit, the diff is scanned for token-like strings
  (`AAAA…`, `ghp_`, `sk-`, `xox`, passwords, private keys).

## What is NOT claimed

- **No FTA / e-invoicing compliance claim.** The app computes UAE VAT
  from configurable tax rates and stores TRNs, but it is not certified
  against any FTA schema and must not be described as compliant.
- **No 2FA, no SSO, no server-side session revocation** (see above).
- **Email is not proven end-to-end.** The default provider only logs
  rendered emails; Resend is wired but has never been exercised
  against the real API; SMTP is a stub that throws.
- **No automated security scanning in CI yet beyond `npm audit`.**
  `npm audit --audit-level=high` runs in CI; it could not be run in
  the dev VM (the egress proxy blocks the registry audit endpoint),
  so local results are unknown — CI is the source of truth.
- **No WAF / bot protection.** Cloudflare Bot Fight Mode and a
  `/download` rate-limit rule are still to be switched on at the
  edge (see RUNBOOK.md).
- **PDF generation is in-process** with no queue — a burst of large
  PDFs can slow the web process (see RUNBOOK.md known limits).

## Reporting a problem

If you find a security issue, do not open a public issue. Tell the
business owner directly and include the steps to reproduce; rotate
`NEXTAUTH_SECRET` and any exposed keys as a precaution (RUNBOOK.md).
