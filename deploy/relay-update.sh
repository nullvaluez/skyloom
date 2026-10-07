#!/usr/bin/env bash
# Install or update ONLY the multiplayer relay (the game itself is hosted
# elsewhere, e.g. on Netlify) and (re)start it with PM2. No site build, so it
# needs almost no memory. Run it from the site's folder as the site user:
#
#   bash deploy/relay-update.sh
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v pm2 >/dev/null 2>&1; then
  echo "PM2 is not installed for this user yet. Run:  npm install -g pm2   then run this script again."
  exit 1
fi
if [ ! -f deploy/relay.env ] || ! grep -q '^MP_ORIGINS=' deploy/relay.env; then
  echo "Missing deploy/relay.env with your game's address. Create it from the example:"
  echo "  cp deploy/relay.env.example deploy/relay.env   (then edit MP_ORIGINS)"
  exit 1
fi

git pull --ff-only
# The relay's one dependency, at the version package.json pins, into server/.
WS="$(node -p "require('./package.json').dependencies.ws")"
npm install --prefix server --no-save --no-package-lock --no-audit --no-fund "ws@${WS}"

if pm2 describe skyloom-relay >/dev/null 2>&1; then
  pm2 reload deploy/ecosystem.config.cjs --only skyloom-relay --update-env
else
  pm2 start deploy/ecosystem.config.cjs --only skyloom-relay
fi
pm2 save

sleep 2
if curl -fsS http://127.0.0.1:8787/healthz >/dev/null 2>&1; then
  echo "Multiplayer relay: OK"
else
  echo "The relay is not answering yet: check  pm2 logs skyloom-relay"
fi
