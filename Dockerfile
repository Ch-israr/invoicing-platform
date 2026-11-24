# Production image (Render web service).
# Phase 8 notes:
# - PDF generation runs in-process (no separate worker in v1). The PDF
#   engine launches Chromium via CHROMIUM_EXECUTABLE_PATH, so the runner
#   installs the Alpine `chromium` package — without it every PDF
#   download fails with "Chromium executable not found". The invoice
#   text itself is rendered with the app's embedded Noto fonts, so no
#   extra font packages are needed.
# - .dockerignore keeps .env, uploads/, .next and node_modules out of
#   the build context. The runner copies only what the app needs.
# - This Dockerfile has NOT been built in the dev VM (no Docker daemon
#   there). It is validated by the `docker` job in .github/workflows/ci.yml.
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Engines are downloaded at build time on the host (Render has direct
# internet); generate the Prisma client for the target platform.
RUN npx prisma generate
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Chromium for the in-process PDF engine (see header comment).
RUN apk add --no-cache chromium
ENV CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium
RUN addgroup -S app && adduser -S app -G app
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/prisma ./prisma
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:${PORT:-3000}/api/health || exit 1
CMD ["npm", "run", "start"]
