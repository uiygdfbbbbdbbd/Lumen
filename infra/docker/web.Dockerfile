# syntax=docker/dockerfile:1.7
FROM node:26-bookworm-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
RUN pnpm turbo run build --filter=@lumen/web...

FROM caddy:2-alpine
COPY infra/caddy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/apps/web/dist /srv
EXPOSE 80 443
