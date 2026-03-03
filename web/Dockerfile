# ── Stage 1: install dependencies ────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
# libc6-compat: glibc shim needed by some native modules on Alpine (musl)
# openssl: required by Prisma to detect the correct engine binary
RUN apk add --no-cache libc6-compat openssl
COPY package.json package-lock.json ./
RUN npm ci

# ── Stage 2: build the Next.js app ───────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app
RUN apk add --no-cache libc6-compat openssl
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1

# Generate Prisma client with the Linux binary included
RUN npx prisma generate

# Ensure public/ exists (this app has no static assets, but Next.js expects it)
RUN mkdir -p public

# Build the Next.js app (produces .next/standalone/)
RUN npm run build

# ── Stage 3: production runner (smallest possible image) ─────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

# OpenSSL is required by Prisma to load the correct engine binary at runtime
RUN apk add --no-cache openssl

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Run as a non-root user for security
RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 nextjs

# Pre-create the volume mount points with correct ownership so the nextjs user
# can write to them when Docker mounts the named volumes at runtime
RUN mkdir -p /data /uploads && chown nextjs:nodejs /data /uploads

# Standalone server + static assets + public files
COPY --from=builder /app/public                                            ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone            ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static                ./.next/static

# Prisma schema + migrations (needed by migrate deploy in entrypoint)
COPY --from=builder --chown=nextjs:nodejs /app/prisma                      ./prisma

# Prisma engine binary (talks to the database)
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.prisma        ./node_modules/.prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@prisma        ./node_modules/@prisma

# Prisma CLI (used in entrypoint to run migrations)
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/prisma         ./node_modules/prisma

# Entrypoint: runs migrations then starts the server
COPY --chown=nextjs:nodejs docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

USER nextjs
EXPOSE 3000

ENTRYPOINT ["/docker-entrypoint.sh"]
