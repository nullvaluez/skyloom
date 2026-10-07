# Skyloom multiplayer relay (MULTIPLAYER.md). Keyless, in-memory, writes nothing.
# Build from the repo root:
#   docker build -f deploy/relay.Dockerfile -t skyloom-relay .
# Run behind Caddy on the same host (MP_TRUST_PROXY=loopback stays correct):
#   docker run -d --network host -e MP_ORIGINS=https://skyloom.example.com skyloom-relay
# On a platform edge (Fly.io): MP_HOST=0.0.0.0 MP_TRUST_PROXY=all MP_CLIENT_IP_HEADER=fly-client-ip
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
# The relay's ONE dependency, at the exact version the app's package.json pins.
COPY package.json /tmp/skyloom-package.json
RUN WS="$(node -p "require('/tmp/skyloom-package.json').dependencies.ws")" \
 && npm install --no-save --no-package-lock --no-audit --no-fund "ws@${WS}" \
 && rm /tmp/skyloom-package.json && npm cache clean --force
COPY server ./server
COPY lib/fly/mp/protocol.mjs ./lib/fly/mp/protocol.mjs
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- "http://127.0.0.1:${MP_PORT:-8787}/healthz" > /dev/null || exit 1
# node directly (not npm run mp): npm does not forward SIGTERM, and the relay
# needs it to send `bye` and close every socket with 1012 before exiting.
CMD ["node", "server/mp-relay.mjs"]
