/**
 * F REWIND — sat-veg drift diagnosis.
 *
 * Written after the W2 merge, when verify-neon-cover's frozen SAT_ROLL began
 * failing on exactly the two sat-veg scenes. Two questions:
 *
 * Question 1: which typed array(s) in the sat-veg bundle differ from F's
 *   frozen baseline, and are the differing ones NEW arrays (C's flags) or
 *   CHANGED existing ones (a real leak)?
 * Question 2: does a sat-veg build depend on whether the SAME worker built a
 *   toy tile first? (the "leak across sequential builds" hypothesis)
 *
 * Prints per-ARRAY hashes so the diff is bytes, not vibes.
 *
 * VERDICT on main (414a392): the bundle now carries `satVegCls` and
 * `satTint.{pos,col,idx,cls}` — arrays that did not exist when F froze the
 * baseline, emitted under C's SAT_GROUND_LIFE / SAT_TINT. Nothing shared
 * CHANGED, toy-build influence NONE, repeat determinism byte-identical. The
 * hash HAD to move; the leak hypothesis is dead. verify-neon-cover gate (4)
 * was rewritten as 4a/4b off this run.
 *
 * Usage: node scripts/r19-f-satdiff.js <label>
 */
const { chromium } = require('playwright');
const { bootFly } = require('./_boot');

const SAT = [
  ['sat-veg-manhattan', 14, 4824, 6157, 'sat-veg'],
  ['sat-veg-powell', 14, 4411, 6193, 'sat-veg'],
];
const TOY = [
  ['manhattan-full', 14, 4824, 6157, 'full'],
  ['powell-full', 14, 4411, 6193, 'full'],
];

(async () => {
  const label = process.argv[2] || 'run';
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1024, height: 640 } });
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await bootFly(page);
  await page.waitForFunction(() => !!window.__toyWorld?.worker, null, { timeout: 60000 });
  await page.waitForFunction(() => (window.__toyWorld?.chunks?.size ?? 0) > 0, null, {
    timeout: 60000,
  });

  const out = await page.evaluate(
    async ({ sat, toy }) => {
      const fnv = (bytes) => {
        let h = 0x811c9dc5;
        for (let i = 0; i < bytes.length; i++) {
          h ^= bytes[i];
          h = Math.imul(h, 0x01000193) >>> 0;
        }
        return h.toString(16).padStart(8, '0');
      };
      const parts = async (z, x, y, detail) => {
        const b = await window.__toyWorld.worker.buildTile(z, x, y, detail);
        const p = {};
        const walk = (obj, pre) => {
          for (const k of Object.keys(obj).sort()) {
            if (k === 'tessMs' || k === 'v') continue;
            const val = obj[k];
            if (val == null) continue;
            if (ArrayBuffer.isView(val))
              p[pre + k] = `${val.length}:${fnv(
                new Uint8Array(val.buffer, val.byteOffset, val.byteLength)
              )}`;
            else if (typeof val === 'object') walk(val, pre + k + '.');
            else p[pre + k] = String(val);
          }
        };
        walk(b, '');
        return p;
      };
      const res = { pre: {}, post: {}, repeat: {} };
      // (1) sat-veg FIRST, before this script builds any toy tile
      for (const [n, z, x, y, d] of sat) res.pre[n] = await parts(z, x, y, d);
      // (2) build toy tiles on the SAME worker (the flagged path)
      for (const [, z, x, y, d] of toy) await parts(z, x, y, d);
      // (3) sat-veg again, after toy builds
      for (const [n, z, x, y, d] of sat) res.post[n] = await parts(z, x, y, d);
      // (4) and once more, back-to-back, for pure determinism
      for (const [n, z, x, y, d] of sat) res.repeat[n] = await parts(z, x, y, d);
      return res;
    },
    { sat: SAT, toy: TOY }
  );

  for (const [name] of SAT) {
    const pre = out.pre[name];
    const post = out.post[name];
    const rep = out.repeat[name];
    const keys = [...new Set([...Object.keys(pre), ...Object.keys(post)])].sort();
    const drift = keys.filter((k) => pre[k] !== post[k]);
    const rdrift = keys.filter((k) => post[k] !== rep[k]);
    console.log(`\n=== ${label} ${name} ===`);
    console.log(`  arrays: ${keys.join(', ')}`);
    console.log(
      `  toy-build influence: ${drift.length ? 'DRIFT ' + drift.join(',') : 'NONE (identical pre/post toy build)'}`
    );
    console.log(
      `  repeat determinism : ${rdrift.length ? 'DRIFT ' + rdrift.join(',') : 'NONE (byte-identical)'}`
    );
    for (const k of keys) console.log(`    ${k.padEnd(18)} ${pre[k] ?? '(absent)'}`);
  }
  await browser.close();
})();
