/**
 * PM2 process file for Skyloom on CloudPanel (MULTIPLAYER.md, "Deploy on
 * CloudPanel"). From the site's folder, as the site user:
 *
 *   pm2 start deploy/ecosystem.config.cjs && pm2 save
 *
 *   skyloom-app    the website (next start) on 127.0.0.1:3000 — the "App Port"
 *                  you gave CloudPanel when creating the Node.js site
 *   skyloom-relay  the multiplayer relay on 127.0.0.1:8787 — CloudPanel's nginx
 *                  sends /mp to it (deploy/cloudpanel-nginx.conf)
 *
 * Both listen on localhost only; CloudPanel's nginx is the public HTTPS door.
 * The relay stores nothing: a restart only makes players reconnect.
 */
const path = require('path');

const root = path.resolve(__dirname, '..');
const APP_PORT = process.env.SKYLOOM_APP_PORT || '3000';

module.exports = {
  apps: [
    {
      name: 'skyloom-app',
      cwd: root,
      script: 'node_modules/next/dist/bin/next',
      args: `start -H 127.0.0.1 -p ${APP_PORT}`,
      env: { NODE_ENV: 'production' },
      max_memory_restart: '1500M',
    },
    {
      name: 'skyloom-relay',
      cwd: root,
      script: 'server/mp-relay.mjs',
      env: { NODE_ENV: 'production', MP_HOST: '127.0.0.1', MP_PORT: '8787' },
      // PM2 stops with SIGINT: the relay says bye, closes every player with
      // 1012 (they reconnect on their own) and exits after 1 s.
      kill_timeout: 3000,
      max_memory_restart: '256M',
    },
  ],
};
