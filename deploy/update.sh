#!/usr/bin/env bash
# Install or update Skyloom on CloudPanel and (re)start it with PM2.
# Run it from the site's folder, logged in (SSH) as the site user:
#
#   bash deploy/update.sh
#
# It pulls the latest code, installs packages, builds the site with
# multiplayer pointed at this same domain (/mp), and (re)starts both
# processes: skyloom-app (the website) and skyloom-relay (multiplayer).
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v pm2 >/dev/null 2>&1; then
  echo "PM2 is not installed for this user yet. Run:  npm install -g pm2   then run this script again."
  exit 1
fi

git pull --ff-only
npm ci --no-audit --no-fund
NEXT_PUBLIC_MP_URL=/mp npm run build

if pm2 describe skyloom-app >/dev/null 2>&1; then
  pm2 reload deploy/ecosystem.config.cjs --update-env
else
  pm2 start deploy/ecosystem.config.cjs
fi
pm2 save

sleep 2
if curl -fsS http://127.0.0.1:8787/healthz >/dev/null 2>&1; then
  echo "Skyloom is running. Multiplayer relay: OK"
else
  echo "The website is running, but the multiplayer relay is not answering yet: check  pm2 logs skyloom-relay"
fi
