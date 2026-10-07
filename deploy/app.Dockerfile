# Skyloom web app (Next.js `next start`) for the one-VPS recipe in
# deploy/docker-compose.yml. NEXT_PUBLIC_MP_URL is inlined at BUILD time;
# '/mp' = the relay on the same origin, proxied by Caddy.
FROM node:22-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
ARG NEXT_PUBLIC_MP_URL=/mp
ENV NEXT_PUBLIC_MP_URL=${NEXT_PUBLIC_MP_URL}
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY --from=build --chown=node:node /app/package.json /app/next.config.mjs ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/.next ./.next
USER node
EXPOSE 3000
CMD ["node", "node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", "3000"]
