# syntax=docker/dockerfile:1.7-labs

FROM node:20-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps/ui/package.json apps/ui/package.json
COPY packages/dsl/package.json packages/dsl/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/engine/package.json packages/engine/package.json
COPY packages/meiro/package.json packages/meiro/package.json
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm fetch --filter @decisioning/ui... \
    && pnpm install --frozen-lockfile --offline --filter @decisioning/ui...

FROM deps AS e2e-deps
RUN pnpm --filter @decisioning/ui exec playwright install --with-deps chromium

FROM base AS build
ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:3001
ARG NEXT_PUBLIC_API_KEY=
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_API_KEY=$NEXT_PUBLIC_API_KEY
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_OPTIONS=--max-old-space-size=2048
COPY --from=deps /app /app
COPY apps/ui/next.config.ts apps/ui/postcss.config.mjs apps/ui/tailwind.config.ts apps/ui/tsconfig.json apps/ui/next-env.d.ts apps/ui/
COPY apps/ui/src apps/ui/src
COPY packages/dsl packages/dsl
COPY packages/shared packages/shared
COPY packages/engine packages/engine
COPY packages/meiro packages/meiro
RUN pnpm --filter @decisioning/ui build

FROM e2e-deps AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=build /app/apps/ui/.next/standalone ./
COPY --from=build /app/apps/ui/.next/static ./apps/ui/.next/static
COPY apps/ui/playwright.config.js apps/ui/playwright.config.js
COPY apps/ui/e2e apps/ui/e2e
EXPOSE 3000
CMD ["sh", "-c", "HOSTNAME=0.0.0.0 node apps/ui/server.js"]
