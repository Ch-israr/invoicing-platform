# API Reference

The app is primarily a server-rendered web application; most mutations go
through Server Actions (form posts), not this HTTP API. The routes below
are the JSON/file endpoints that exist today.

> **Not versioned yet.** The routes live under `/api/*` with no `/v1`
> prefix. A `/api/v1` prefix is planned before any third-party
> integration is built on this API — do not build external clients
> against the current paths as a stable contract.

## Authentication

All routes except `/api/health` and `/api/portal/[token]/pdf` require a
signed-in session (Auth.js session cookie, JWT, 30-day expiry). There
are no API keys yet.

- Unauthenticated → `401 Unauthorized`.
- Authenticated but the resource belongs to another business → `404 Not
  Found` (deliberately — the API never confirms that another business's
  resource exists).
- Rate-limited → `429 Too Many Requests` with a `Retry-After` header
  (seconds).

## Endpoints

### `GET /api/health`

No auth. Used by the Docker `HEALTHCHECK` and by Render.

```json
{ "status": "ok", "db": "ok", "time": "2026-11-24T16:03:10.283Z" }
```

- `status: "ok"` and `db: "ok"` when the database answers; otherwise
  `500` with `status: "error"`.

### `GET /api/customers/export`

Auth required. Downloads all customers of the caller's business as CSV
(RFC 4180). Rate limit: 60/min/IP.

- `200` — `Content-Type: text/csv; charset=utf-8`,
  `Content-Disposition: attachment; filename="customers.csv"`.

### `GET /api/products/export`

Auth required. Downloads all products of the caller's business as CSV.
Rate limit: 60/min/IP. Same response shape as the customers export
(`products.csv`).

### `GET /api/invoices/[id]/pdf`

Auth required. Downloads the invoice PDF. Rate limit: 60/min/IP.

- Issued invoices: the stored PDF (generated at issue time, regenerated
  on demand if missing).
- Drafts: a fresh watermarked PDF rendered in memory (never stored).
- `200` — `Content-Type: application/pdf`,
  `Content-Disposition: attachment; filename="INV-0001.pdf"`.
- `404` — invoice not found or belongs to another business.
- `422` — the PDF could not be generated (e.g. Chromium unavailable).

### `GET /api/portal/[token]/pdf?invoiceId=<id>`

No login. Downloads the stored PDF through a customer-portal token.
The token must cover the requested invoice: an invoice token covers
its own invoice, a customer token covers any of that customer's
invoices, a quotation token covers nothing here.

- `200` — the stored PDF, same headers as above.
- `404` — unknown, expired or revoked token; wrong invoice for the
  token; draft invoice; or the invoice belongs to another customer.
  (All failure cases return the same 404 so probers learn nothing.)
- `422` — no stored PDF exists for the invoice.
- Token verification is rate-limited to 10 attempts/min/IP (shared
  with the portal pages).

### `GET /api/reports/[report]?from=YYYY-MM-DD&to=YYYY-MM-DD`

Auth required. Downloads a report as CSV, using the same service
functions as the on-screen report, so the file always matches the
page. Rate limit: 60/min/IP.

`[report]` is one of `revenue`, `vat`, `overdue`, `customers`,
`products`. Unknown names → `404 Unknown report`.

- `revenue` — invoiced vs paid vs credited vs outstanding, monthly
  breakdown. `from`/`to` default to the current month.
- `vat` — output VAT on issued invoices minus input VAT on expenses,
  from actual tax amounts.
- `overdue` — past-due open invoices with days overdue and balances
  (as-of-now; `from`/`to` ignored).
- `customers` — per-customer invoiced / paid / credited / outstanding.
- `products` — per-product quantity sold and revenue (VAT-inclusive
  line totals, so the total ties to the revenue report's invoiced
  figure).
- `200` — `Content-Type: text/csv; charset=utf-8`,
  `Content-Disposition: attachment; filename="<report>-report-<from>-<to>.csv"`.
- Malformed `from`/`to` values fall back to the defaults (current
  month); they never 500.

### `GET /api/uploads/[...key]`

Auth required. Serves an uploaded file (logo, signature, receipt).
Keys are `<businessId>/<kind>/<file>`; the caller must be a member of
that business. Rate limit: 60/min/IP.

- `200` — `Content-Type` is derived from the file extension
  (`image/png`, `image/jpeg`, `image/webp`, `application/pdf`,
  otherwise `application/octet-stream`); files are never executed.
- `404` — missing file, unknown business, or the caller is not a
  member of the owning business. Path-traversal keys (`..`, absolute
  paths) are rejected.

### `/api/auth/*`

Auth.js (NextAuth) routes: sign-in, sign-out, session, CSRF. Used by
the login/register pages. Login is rate-limited (5 attempts/min/IP
and 5/min per email address).

## Error conventions

| Status | Meaning |
|---|---|
| `400` | Invalid input (validation failed) |
| `401` | Not signed in |
| `403` | Signed in, but the role does not allow this (OWNER/ADMIN-only actions) |
| `404` | Not found — also used for "belongs to another business" |
| `422` | The request is valid but cannot be fulfilled (e.g. PDF generation failed) |
| `429` | Rate limit exceeded (`Retry-After` header in seconds) |
| `500` | Unexpected server error (message is generic; details go to the server log) |

Server Actions (form posts) do not return these codes — they return a
`{ error }` state rendered on the page, or redirect on success.
