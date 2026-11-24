# syntax=docker/dockerfile:1
FROM node:22-alpine AS build
# not /app: Vite confuses /app/index.html (the blog file) with the app page's URL /app/index.html
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM caddy:2-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build /build/dist /srv
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
