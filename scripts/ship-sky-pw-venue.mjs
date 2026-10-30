/**
 * SHIP PASS SKY — venue shim for the cloud container (FLY_SHIP_PASS.md 3.8).
 *
 * `verify-cloud-silhouette-gpu.mjs` and `verify-cloud-reconstruction-gpu.mjs`
 * launch Playwright with `channel: 'chrome'`, and the container has no Chrome
 * (only the bundled Chromium, aliased under /opt/pw-browsers). Preloaded with
 * `--import`, this module rewrites that one launch option so the gate runs
 * unchanged on the bundled Chromium with SwiftShader WebGL2 (correct pixels,
 * no GPU timing). The gates themselves are not edited; on a machine with
 * Chrome, run them without the shim.
 *
 *   node --import ./scripts/ship-sky-pw-venue.mjs scripts/verify-cloud-silhouette-gpu.mjs
 *   node --import ./scripts/ship-sky-pw-venue.mjs scripts/verify-cloud-reconstruction-gpu.mjs
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const launch = chromium.launch.bind(chromium);

chromium.launch = (opts = {}) => {
  const { channel, ...rest } = opts;
  if (!channel) return launch(opts);
  const args = [...(rest.args || []).filter((a) => a !== '--enable-gpu'), '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
  console.log(`[ship-sky-pw-venue] channel '${channel}' -> bundled Chromium (SwiftShader WebGL2)`);
  return launch({ ...rest, args });
};
