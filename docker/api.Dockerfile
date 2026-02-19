# syntax=docker/dockerfile:1.7-labs

FROM node:20-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/dsl/package.json packages/dsl/package.json
COPY packages/engine/package.json packages/engine/package.json
COPY packages/meiro/package.json packages/meiro/package.json
COPY packages/policies/package.json packages/policies/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/wbs-mapping/package.json packages/wbs-mapping/package.json
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm fetch --filter @decisioning/api...

FROM base AS build
COPY --from=deps /app /app
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --offline --filter @decisioning/api...
RUN pnpm --filter @decisioning/api prisma:generate
RUN pnpm --filter @decisioning/api build

FROM base AS runtime
WORKDIR /app
COPY --from=build /app /app
EXPOSE 3001
CMD ["pnpm", "--filter", "@decisioning/api", "start:docker"]
