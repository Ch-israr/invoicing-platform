# Invoicing Platform

Professional business invoicing & financial management — invoices, payments,
quotations, expenses, recurring billing, credit notes, reports and a customer
portal. UAE-focused: AED, 5% VAT, TRN, English + Arabic (RTL).

**Status: all 8 phases complete (local only — no repo, no deploy yet).**
See [ARCHITECTURE.md](ARCHITECTURE.md) for the design and the phase history,
[docs/USER_GUIDE.md](docs/USER_GUIDE.md) for how to use it,
[docs/API.md](docs/API.md) for the HTTP API,
[docs/RUNBOOK.md](docs/RUNBOOK.md) for deploying and operating it, and
[docs/SECURITY.md](docs/SECURITY.md) for the threat model and the known limits.

## What it does

| Area | Highlights |
|---|---|
| Invoices | Builder with live preview (EN/AR), Decimal money engine (incl./excl. VAT, % + fixed discounts), draft → issue → void, numbering locked in a transaction, issued invoices frozen as snapshots |
| PDF engine | 3 templates (classic / modern / minimal), embedded Noto Sans + Noto Sans Arabic, A4 with repeating headers, stored PDFs with SHA-256, download / print / regenerate |
| Payments | Partial + full payments, row-locked balance re-check (overpayment rejected), refunds, receipts |
| Quotations | Draft → send → accept / reject / expire, convert to a draft invoice, two-way link |
| Credit notes | Line-level quantities, lowered prices, capped at the outstanding balance, cancel reverses |
| Email | Queue with retries (3 attempts, 2/4/8-min backoff), history, manual retry; log provider in dev, Resend wired |
| Expenses | CRUD, categories seeded per business, receipt upload (image/PDF ≤ 5 MB), filtered totals |
| Recurring | Weekly/monthly/quarterly/yearly/custom, idempotent runs (one invoice per period), auto-send, month-end clamping, pause/cancel |
| Customer portal | Token-gated, no login: view invoice, download PDF, accept/reject quotations; tokens expire (30 days default) and are revocable |
| Reports | Revenue, VAT, overdue, customer balances, product revenue — all computed from the ledger tables; CSV + print export |
| Analytics | Dashboard charts (revenue 6 months, outstanding by status, top customers) |
| Audit trail | Every mutation writes an `ActivityLog` row (business, user, action, entity) |

## Stack

Next.js 15 (App Router) · React 19 · TypeScript (strict) · Tailwind CSS 4 ·
shadcn/ui · Auth.js v5 (NextAuth, credentials, JWT sessions) · PostgreSQL 16 ·
Prisma 6 · Zod · Vitest · Recharts · Playwright (PDF rendering via Chromium).

## Getting started (local)

Prerequisites: Node 20+, PostgreSQL 16 (or Docker).

```bash
# 1. Install dependencies (npm — pnpm is not used; see Troubleshooting)
npm install

# 2. Start PostgreSQL (creates `invoicing` and `invoicing_test` databases)
docker compose up -d db
#    …or point DATABASE_URL at your own Postgres 16 instance.

# 3. Environment
cp .env.example .env
#    Fill in NEXTAUTH_SECRET:  openssl rand -base64 32

# 4. Database — generate the client, apply migrations, optional demo seed
npm run db:generate
npm run db:migrate
DEMO_SEED=1 npm run db:seed   # staging only; production is never seeded

# 5. Run
npm run dev                    # http://localhost:3000
```

Register an account — a business workspace (with UAE tax rates STD 5%,
ZERO, EXEMPT) is created for you automatically. The dashboard shows real
figures from your records, or empty states when there is nothing yet.
There is no demo data in production.

To create the first owner on a fresh deploy instead of registering in the
browser, set `ADMIN_EMAIL` + `ADMIN_PASSWORD` and run `npm run db:seed`
(see [docs/RUNBOOK.md](docs/RUNBOOK.md)).

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Dev server (port 3000) |
| `npm run build` | Production build (stop the dev server first — building while it runs mixes `.next` and breaks Server Actions) |
| `npm run start` | Production server (port 3000, or `$PORT`) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm test` | Vitest (unit + integration; applies migrations to the test DB first) |
| `npm run db:migrate` | `prisma migrate dev` (creates a migration; interactive) |
| `npm run db:deploy` | `prisma migrate deploy` (CI / production) |
| `npm run db:seed` | Seed script (admin bootstrap and/or demo data, env-gated) |
| `npm run db:studio` | Prisma Studio |

## Project layout

```
prisma/            schema.prisma, migrations/, seed.ts
src/app/           (auth)/login, (auth)/register
                   (app)/dashboard, customers, products, invoices, payments,
                   quotations, credit-notes, expenses, recurring, reports,
                   emails, settings/business, portal-tokens
                   portal/[token]/ (public customer portal)
                   api/health, api/auth/[...nextauth], api/invoices/[id]/pdf,
                   api/portal/[token]/pdf, api/reports/[report],
                   api/customers/export, api/products/export, api/uploads/[...]
src/components/    ui/ (shadcn-style primitives), layout/ (sidebar, header),
                   customers/, products/, invoices/, dashboard/ (charts),
                   portal/ (token manager), shared/
src/lib/           prisma.ts, auth.ts, tenant.ts (isolation + RBAC),
                   rate-limit.ts, client-ip.ts, validation/, utils.ts,
                   csv.ts, report-csv.ts, pagination.ts, activity.ts,
                   money.ts, invoice-preview.ts, storage/ (local disk in dev)
src/server/        services/ (auth, business, customer, product, invoice,
                   payment, quotation, credit-note, expense, recurring,
                   portal, report), email/ (queue + providers),
                   pdf/ (templates, generate, service)
src/middleware.ts  auth redirects + security headers (CSP nonce, HSTS in prod)
tests/             unit/ (money, validation, csv, rate limits, reports, …)
                   integration/ (auth, tenant isolation, phases 2–8)
docs/              USER_GUIDE.md (EN + AR), API.md, RUNBOOK.md, SECURITY.md
Dockerfile, docker-compose.yml, .github/workflows/ci.yml, render.yaml
```

Uploads (logos, signatures, receipts) are stored under `uploads/` in local
dev (gitignored) and served only to members of the owning business via
`/api/uploads/[...key]`, with an allowlist (PNG/JPEG/WebP, + PDF for
receipts), a 5 MB cap, and path-traversal guards. CSV import/export uses
the same columns as the template on the import page; rows that fail
validation are reported per-row and never silently skipped.

Key rules (from ARCHITECTURE.md):

- **Money is Decimal, never float** — Postgres `DECIMAL(19,4)`, Prisma
  `Decimal`. No float money maths anywhere.
- **Server is the source of truth** — frontend totals are never trusted;
  every input is validated with Zod before use.
- **Tenant isolation by construction** — every business-owned row carries
  `businessId`; resolve user-supplied IDs through `lib/tenant.ts`.
  Cross-business access returns 404, never data.
- **Sessions are JWT** (Auth.js v5, 30-day expiry). The architecture doc
  said "DB sessions", but Auth.js forbids the Credentials provider with
  database sessions, so JWT is used. There is no server-side session
  revocation ("log out everywhere") — rotating `NEXTAUTH_SECRET`
  invalidates all sessions (see RUNBOOK.md).
- **Issued documents are immutable** — corrections go through credit
  notes, never silent edits.
- **PDFs render in-process** — there is no queue/worker yet; PDF
  generation happens in the web process (see RUNBOOK.md known limits).
- **No cron daemon** — recurring schedules and the email queue are run
  from the manual "Run now" / "Process queue" buttons (see RUNBOOK.md).

## Environment variables

See `.env.example`. Never commit a real `.env` file. The full list, what
each one does, and which are required in production is in
[docs/RUNBOOK.md](docs/RUNBOOK.md).

## Deployment

Target: Render (web service from the Dockerfile + managed Postgres).
`Dockerfile`, `docker-compose.yml` and `render.yaml` are included; the
steps, env vars and backup procedure are in
[docs/RUNBOOK.md](docs/RUNBOOK.md). **Production deploy needs explicit
approval and has not happened yet.** CI (`.github/workflows/ci.yml`) runs
typecheck, lint, tests, build, `npm audit` and a Docker image build — it
has never run because there is no repo/remote yet.

## Troubleshooting

- **`prisma --version` / `prisma generate` fails with ECONNRESET:**
  the sandbox egress proxy resets Node's downloads from
  `binaries.prisma.sh`. Fetch the engines with curl instead:
  `bash scripts/setup-prisma-engines.sh` (downloads the query + schema
  engines for Prisma 6.14.0, verifies checksums, places them in the
  Prisma cache). This is a local-VM quirk, not an app bug.
- **`pnpm` fails with EPERM chown on this machine:** use npm (this
  project is npm-based; there is no `pnpm-lock.yaml`).
- **Postgres disappears after a VM restart:** apt-installed Postgres
  does not survive a restart. Reinstall from the apt cache
  (`dpkg -i` the `.deb`s in `/var/cache/apt/archives`), start the
  cluster (`pg_ctlcluster 16 main start`), recreate the role
  (needs `CREATEDB` for `migrate dev`) + databases, then
  `npm run db:migrate` + seed.
- **`/tmp` is wiped on restart:** QA scripts and `playwright-core`
  installs in `/tmp` disappear; the browser cache in `~/.cache`
  survives.
- **Build while the server runs breaks Server Actions:** stop the
  server (`fuser -k 3000/tcp`) before `npm run build`, then restart it
  on port 3000 (`.env` `NEXTAUTH_URL` must match the port).
- **"Too many sign-in attempts":** login/register are rate-limited to
  5 attempts/min/IP (plus 5/min per email). Wait a minute and retry.
- **Port 5432 in use:** change the `db` service port mapping in
  `docker-compose.yml` and update `DATABASE_URL` accordingly.
