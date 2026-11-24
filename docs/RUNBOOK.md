# Runbook — Deploying & Operating the Invoicing Platform

## Deploy target

Render: one **web service** (from the `Dockerfile`) + one **managed
Postgres 16** database. `render.yaml` in the repo root declares both;
review it before the first deploy (especially `NEXTAUTH_URL`).

## First deploy (checklist)

1. Push the repo to GitHub and connect it to Render.
2. Create the Postgres database from `render.yaml` (or manually).
3. Create the web service from `render.yaml`. Set these env vars in
   the Render dashboard (never in the repo):
   - `DATABASE_URL` — from the Render database (internal URL).
   - `NEXTAUTH_URL` — the public URL of the service
     (e.g. `https://invoicing-platform.onrender.com`).
   - `NEXTAUTH_SECRET` — generate with `openssl rand -base64 32`.
     **This signs every session. Keep it secret; losing it logs
     everyone out (see "Rotating NEXTAUTH_SECRET").**
   - `EMAIL_PROVIDER=log` to start (sends nothing). Switch to
     `resend` only after testing with a real key — see below.
   - `RESEND_API_KEY` — only when `EMAIL_PROVIDER=resend`.
   - `UPLOADS_DIR` — `/var/data/uploads` when a persistent disk is
     attached (see "Uploads"), otherwise unset (ephemeral).
4. Attach a **persistent disk** (Render dashboard → service →
   Disks) mounted at `/var/data`, and set
   `UPLOADS_DIR=/var/data/uploads`. Without it, logos, signatures and
   receipts are lost on every redeploy/restart — the app stores files
   on local disk by default.
5. Run the migrations once, from the Render Shell:
   `npx prisma migrate deploy`. (Do not use `prisma migrate dev` in
   production — it is interactive and can prompt.)
6. Create the first owner account — either register in the browser, or
   set `ADMIN_EMAIL` + `ADMIN_PASSWORD` in the dashboard and run
   `npm run db:seed` from the Render Shell. Remove those two variables
   afterwards. Never set `DEMO_SEED=1` in production.
7. Smoke-test: `/api/health` → `{"status":"ok","db":"ok"}`, log in,
   create a customer + invoice, issue it, download the PDF, send the
   test email (log provider: check the service logs for the rendered
   email), open a portal link in a private window.

## Environment variables

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | Yes | Postgres connection string. |
| `TEST_DATABASE_URL` | No (tests/CI) | Separate database for the test suite. |
| `NEXTAUTH_URL` | Yes | Public URL of the service. Must match the port/host the app runs on, or post-login redirects break. |
| `NEXTAUTH_SECRET` | Yes | `openssl rand -base64 32`. Signs sessions. |
| `EMAIL_PROVIDER` | No, default `log` | `log` (dev, prints to console) / `resend` / `smtp` (stub — throws). |
| `RESEND_API_KEY` | When `EMAIL_PROVIDER=resend` | Never tested against the real API — verify with a real send before relying on it. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | When `EMAIL_PROVIDER=smtp` | SMTP is a stub and throws; do not use yet. |
| `STORAGE_PROVIDER` | No, default `local` | `local` / `s3` (S3 provider not yet implemented). |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | When `STORAGE_PROVIDER=s3` | Not implemented yet. |
| `UPLOADS_DIR` | No | Where uploaded files live. Default `<cwd>/uploads`. Set to the persistent-disk path in production. |
| `CHROMIUM_EXECUTABLE_PATH` | No | Path to Chromium for PDF generation. The Dockerfile sets `/usr/bin/chromium`. Locally, the Playwright cache is used. |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | No | First-deploy owner bootstrap via `npm run db:seed`. Optional `ADMIN_NAME`, `ADMIN_BUSINESS_NAME`. |
| `DEMO_SEED` | No | `1` creates demo data. **Never in production.** |
| `PORT` | No | Render sets this. `next start` listens on it. |
| `NODE_ENV` | Set by the image | `production` in the Docker runner. |

## Backups

Postgres on Render is backed up automatically (retention depends on
the plan). In addition:

- **Manual backup:** `pg_dump "$DATABASE_URL" -Fc -f invoicing-$(date +%F).dump`
  (run from a machine that can reach the database; Render Shell works).
- **Restore:** `pg_restore -d "$DATABASE_URL" --clean invoicing-YYYY-MM-DD.dump`
  — practice this on a throwaway database first, never blind on
  production.
- **Restore drill:** at least once before launch, and quarterly after:
  restore the latest backup to a fresh database, point a staging
  instance at it, log in and open an invoice. Record the date and the
  result.
- **Uploaded files** are not in the database backup. Back up the
  persistent disk (Render disk snapshots) or move to S3 storage when
  it is implemented.

## Rotating NEXTAUTH_SECRET

1. Generate a new secret: `openssl rand -base64 32`.
2. Set it in the Render dashboard and redeploy.
3. **Effect:** every session is invalidated immediately — all users
   must sign in again. That is also the only "log out everywhere"
   mechanism (there is no server-side session revocation — see
   SECURITY.md).
4. Do this immediately if the secret is ever exposed, and after any
   team member with dashboard access leaves.

## Failed deploy

1. Check the Render deploy logs first — most failures are a failed
   `npm run build` or a failed `prisma migrate deploy`.
2. `npm run build` failing: run it locally (`npm run typecheck` and
   `npm run lint` too) and fix before re-pushing.
3. Migration failing: never edit a migration that has already run in
   production. Create a new migration that fixes the state.
4. App boots but `/api/health` returns `500` or `db: "error"`: the
   database is unreachable — check `DATABASE_URL` and that the
   database service is running.
5. PDF downloads fail with `422`: Chromium is missing — check
   `CHROMIUM_EXECUTABLE_PATH` and that the image was built from the
   current `Dockerfile` (it installs the Alpine `chromium` package).
6. Roll back: redeploy the previous commit from the Render dashboard.
   Do **not** roll back a migration that already ran — roll the code
   back only, then fix forward with a new migration.

## Monitoring checklist

- **Uptime:** Render's health check hits `/api/health` (configured
  in the `Dockerfile` and `render.yaml`).
- **Logs to watch:** failed email sends (`EmailLog` status FAILED,
  `/emails` page), failed portal verifications (logged without the
  token), `PDF generation failed` lines, `429` bursts in the access
  log.
- **Weekly:** check the overdue report, the email queue (failed rows),
  and disk usage (uploads + Postgres).
- **Monthly:** review the `ActivityLog` for unexpected admin actions
  (there is no UI for it yet — query the table directly), rotate
  `NEXTAUTH_SECRET` if anyone with access left, and confirm the
  latest backup restores.

## Recurring invoices & email queue (no cron daemon)

There is **no background worker and no cron daemon** in v1. Recurring
schedules run when someone clicks "Run due schedules now" / "Run now",
and the email queue drains when someone clicks "Process queue now".
For unattended operation, add a scheduled trigger before relying on
automatic runs — the intended shape is a secured cron endpoint (shared
secret header) that calls the existing `runDueSchedules` /
`processEmailQueue` services, invoked by Render Cron Jobs. Until that
exists, treat recurring billing as manually triggered.

## Known limits (do not promise otherwise)

- **PDF generation is in-process** with no queue/worker. A burst of
  large PDFs can slow the web process. If PDF volume grows, split the
  PDF engine into a worker (the `Dockerfile` header and
  ARCHITECTURE.md §1.2 describe the intended shape).
- **JWT sessions, no server-side revocation** (see SECURITY.md and
  "Rotating NEXTAUTH_SECRET" above).
- **In-memory rate limiting** — per-instance only. With more than one
  web instance, switch `src/lib/rate-limit.ts` to a Redis-backed
  limiter.
- **Email:** the log provider sends nothing; Resend is wired but has
  never been exercised against the real API; SMTP is a stub that
  throws. Verify with a real send before telling customers invoices
  are emailed.
- **Storage:** local disk only (S3 provider not implemented). On
  Render, files live or die with the persistent disk.
- **No 2FA, no SSO.** Passwords are bcrypt-hashed (cost 12).
- **Reports have CSV + print export only** — no report PDFs, no Excel
  (CSV covers it).
- **Product revenue is VAT-inclusive** (line totals), so it ties to
  the revenue report's invoiced total rather than net revenue.
- **A partially-credited invoice with zero paid shows
  PARTIALLY_PAID** — the status reads "partially resolved", not
  "partially paid".
- **No FTA / e-invoicing compliance claim** (see SECURITY.md).
