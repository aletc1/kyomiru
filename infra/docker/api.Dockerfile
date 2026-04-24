FROM node:20-slim AS base
RUN npm install -g pnpm@10

FROM base AS deps
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/config/package.json ./packages/config/
COPY packages/shared/package.json ./packages/shared/
COPY packages/db/package.json ./packages/db/
COPY packages/providers/package.json ./packages/providers/
COPY apps/api/package.json ./apps/api/
RUN pnpm install --frozen-lockfile

FROM base AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=deps /app/packages/db/node_modules ./packages/db/node_modules
COPY --from=deps /app/packages/providers/node_modules ./packages/providers/node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY . .
# `--legacy` is required on pnpm v10 because the workspace does not enable
# `inject-workspace-packages`. Without it, `pnpm deploy` refuses to run.
RUN pnpm --filter @kyomiru/shared build \
 && pnpm --filter @kyomiru/db build \
 && pnpm --filter @kyomiru/providers build \
 && pnpm --filter @kyomiru/api build \
 && pnpm --filter=@kyomiru/api deploy --prod --legacy /prod/api

FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /prod/api .
EXPOSE 3000
CMD ["node", "dist/server.js"]
