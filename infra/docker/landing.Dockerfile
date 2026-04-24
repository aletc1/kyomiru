FROM node:20-slim AS base
RUN npm install -g pnpm@10

FROM base AS deps
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/config/package.json ./packages/config/
COPY apps/landing/package.json ./apps/landing/
RUN pnpm install --frozen-lockfile

FROM base AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/landing/node_modules ./apps/landing/node_modules
COPY . .
RUN pnpm --filter @kyomiru/landing build

FROM nginx:alpine AS runtime
COPY --from=build /app/apps/landing/dist /usr/share/nginx/html
COPY infra/docker/landing.nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
