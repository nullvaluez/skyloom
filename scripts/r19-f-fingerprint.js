/**
 * F REWIND — worker-bundle FINGERPRINT capture.
 *
 * The byte-identity claims of this round ("NEON_COVER.enabled:false restores
 * the R18 toy pipeline exactly" and "the satellite paths never read
 * NEON_COVER") are claims about the WORKER'S OUTPUT BYTES, so they are tested
 * on the worker's output bytes — not on pixels, and not by reading the source.
 *
 * `window.__toyWorld.worker` is the live comlink proxy (ToyWorldLayer, dev
 * only). buildTile() is callable straight from the page for ANY detail level,
 * including the satellite forks — the worker does not care which layer asked.
 * Every returned typed array is FNV-1a hashed; `tessMs` (wall clock) and `v`
 * are excluded.
 *
 * Usage: node scripts/r19-f-fingerprint.js <label>
 * Prints one JSON line per scene; capture with the flag off, then on, and diff.
 */
const { chromium } = require('playwright');
const { bootFly } = require('./_boot');

const SCENES = [
  // [name, z, x, y, detail]
  ['powell-full', 14, 4411, 6193, 'full'],
  ['powell-mid', 13, 2205, 3096, 'mid'],
  ['manhattan-full', 14, 4824, 6157, 'full'],
  ['manhattan-mid', 13, 2412, 3078, 'mid'],
  ['manhattan-far', 12, 1206, 1539, 'far'],
  ['sat-buildings-manhattan', 14, 4824, 6157, 'sat-buildings'],
  ['sat-buildings-powell', 14, 4411, 6193, 'sat-buildings'],
  ['sat-veg-manhattan', 14, 4824, 6157, 'sat-veg'],
  ['sat-veg-powell', 14, 4411, 6193, 'sat-veg'],
  ['sat-roads-powell', 13, 2205, 3096, 'sat-roads'],
  ['sat-skyline-manhattan', 14, 4824, 6157, 'sat-skyline'],
];

(async () => {
  const label = process.argv[2] || 'run';
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await bootFly(page); // seeds 'toy'
  await page.waitForFunction(() => !!window.__toyWorld?.worker, null, { timeout: 60000 });
  // The worker resolves its tile-URL template in init(); building before that
  // resolves would fetch nothing. One real chunk proves init landed.
  await page.waitForFunction(() => (window.__toyWorld?.chunks?.size ?? 0) > 0, null, {
    timeout: 60000,
  });

  const results = await page.evaluate(async (scenes) => {
    const fnv = (bytes) => {
      let h = 0x811c9dc5;
      for (let i = 0; i < bytes.length; i++) {
        h ^= bytes[i];
        h = Math.imul(h, 0x01000193) >>> 0;
      }
      return h.toString(16).padStart(8, '0');
    };
    const out = [];
    for (const [name, z, x, y, detail] of scenes) {
      let bundle;
      try {
        bundle = await window.__toyWorld.worker.buildTile(z, x, y, detail);
      } catch (e) {
        out.push({ name, error: String(e?.message ?? e) });
        continue;
      }
      const parts = {};
      let total = 0;
      const walk = (obj, prefix) => {
        for (const k of Object.keys(obj).sort()) {
          if (k === 'tessMs' || k === 'v') continue;
          const val = obj[k];
          if (val == null) continue;
          if (ArrayBuffer.isView(val)) {
            const b = new Uint8Array(val.buffer, val.byteOffset, val.byteLength);
            parts[prefix + k] = `${val.length}:${fnv(b)}`;
            total += val.length;
          } else if (typeof val === 'object') {
            walk(val, prefix + k + '.');
          } else {
            parts[prefix + k] = String(val);
          }
        }
      };
      walk(bundle, '');
      // one rolled-up hash over the sorted part strings
      const flat = Object.keys(parts)
        .sort()
        .map((k) => `${k}=${parts[k]}`)
        .join('|');
      const enc = new TextEncoder().encode(flat);
      out.push({ name, roll: fnv(enc), elems: total, parts });
    }
    return out;
  }, SCENES);

  for (const r of results) {
    if (r.error) {
      console.log(`FP ${label} ${r.name} ERROR ${r.error}`);
      continue;
    }
    console.log(`FP ${label} ${r.name} roll=${r.roll} elems=${r.elems}`);
  }
  console.log(`FPJSON ${label} ${JSON.stringify(results)}`);
  await browser.close();
})();
