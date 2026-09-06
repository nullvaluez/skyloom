/**
 * R24 (E CERT) — the LAUNCH SHIM. A `node -r` preload, never imported by a
 * harness: `node -r ./scripts/_pw-shim.js scripts/verify-X.js`.
 *
 * WHY (recon HARN-ENV-1, measured): 92 of the browser harnesses do
 *   `const { chromium } = require('playwright');`
 *   `await chromium.launch({ channel: 'chrome', args: ['--enable-gpu', ...] })`
 * Neither half holds in this container:
 *   • `playwright` is installed GLOBALLY (/opt/node22/lib/node_modules,
 *     1.56.1) and is invisible to a `require` rooted in the repo — the repo
 *     has no playwright dependency at all;
 *   • Google Chrome stable is NOT installed (`/opt/google` absent), so the
 *     `channel: 'chrome'` pin throws before a single gate runs. Bundled
 *     chromium-1194 IS present under /opt/pw-browsers.
 *   • the explicit `--use-angle=swiftshader` path measured ~2x the fill rate
 *     of the default one on this box (18-19 fps → 44-45 fps at 640x360, 50
 *     fullscreen quads), so it is worth appending rather than relying on the
 *     implicit fallback.
 *
 * The shim therefore does exactly three things, and NOTHING to the 57+
 * harnesses themselves (zero repo diff in scripts/verify-*.js):
 *   1. teaches `require('playwright')` / `require('playwright-core')` where the
 *      global install lives (NODE_PATH still works and wins if set);
 *   2. wraps `chromium.launch` (and `launchPersistentContext`, unused today
 *      but cheap to cover) to drop `channel` and append the ANGLE args;
 *   3. defaults PLAYWRIGHT_BROWSERS_PATH to /opt/pw-browsers when unset.
 *
 * ESCAPE HATCHES (a GPU machine keeps the original behaviour):
 *   PW_CHANNEL=chrome        → the channel is PRESERVED (or forced) instead of
 *                              dropped; the ANGLE args are NOT appended.
 *   PW_CHANNEL=              → (empty) same as unset: drop the channel.
 *   PW_EXTRA_ARGS='--a --b'  → replaces the default arg list (space-separated).
 *   PW_SHIM_QUIET=1          → no banner on stderr.
 * So on the user's machine the whole fleet runs unmodified WITHOUT the shim,
 * and with `PW_CHANNEL=chrome node -r ./scripts/_pw-shim.js …` it runs exactly
 * as the harness author wrote it.
 */
'use strict';

const path = require('path');
const Module = require('module');

const GLOBAL_NODE_MODULES = process.env.PW_GLOBAL_MODULES || '/opt/node22/lib/node_modules';
const DEFAULT_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];

if (!process.env.PLAYWRIGHT_BROWSERS_PATH) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = '/opt/pw-browsers';
}

// (1) Module resolution. Only for the two playwright ids, and only as a
// FALLBACK: a repo-local or NODE_PATH-resolvable playwright still wins.
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  try {
    return origResolve.call(this, request, parent, isMain, options);
  } catch (err) {
    if (request === 'playwright' || request === 'playwright-core' || request.startsWith('playwright/')) {
      return origResolve.call(
        this,
        path.join(GLOBAL_NODE_MODULES, request),
        parent,
        isMain,
        options
      );
    }
    throw err;
  }
};

// (2) Launch wrapping. Require playwright ONCE here so every later
// `require('playwright')` in the harness gets this same, already-wrapped
// module object out of the CJS cache.
let pw = null;
try {
  pw = require('playwright');
} catch (err) {
  process.stderr.write(`[pw-shim] could not load playwright: ${err.message}\n`);
}

function shapeOptions(opts) {
  const o = { ...(opts || {}) };
  const chan = process.env.PW_CHANNEL;
  if (chan) {
    o.channel = chan; // explicit opt-in: run the real Chrome channel
    return o;
  }
  delete o.channel; // the whole point: bundled chromium, not Google Chrome
  const extra = process.env.PW_EXTRA_ARGS
    ? process.env.PW_EXTRA_ARGS.split(/\s+/).filter(Boolean)
    : DEFAULT_ARGS;
  const args = Array.isArray(o.args) ? o.args.slice() : [];
  for (const a of extra) if (!args.includes(a)) args.push(a);
  o.args = args;
  return o;
}

if (pw && pw.chromium) {
  for (const method of ['launch', 'launchPersistentContext']) {
    const orig = pw.chromium[method];
    if (typeof orig !== 'function') continue;
    pw.chromium[method] = function (...args) {
      // launch(options) | launchPersistentContext(userDataDir, options)
      const i = method === 'launch' ? 0 : 1;
      args[i] = shapeOptions(args[i]);
      return orig.apply(this, args);
    };
  }
  if (!process.env.PW_SHIM_QUIET) {
    process.stderr.write(
      `[pw-shim] chromium.launch wrapped (channel=${process.env.PW_CHANNEL || '<dropped>'}, extraArgs=${
        process.env.PW_EXTRA_ARGS || DEFAULT_ARGS.join(' ')
      })\n`
    );
  }
}

module.exports = { shapeOptions };
