/**
 * R22 C CLUTTER — cross-boot determinism at verify-clutter's own P-LEWIS pose,
 * with verify-clutter's own settle predicate (now that `clutter.ready/chunks`
 * and `clutter.realCols` are published, the predicate can actually see this
 * ring instead of falling through to the building ring's).
 *
 * Two INDEPENDENT browser sessions, `__flyClutterPin='freeze'`, commutative
 * set-hash excluding matrix element 13 (the draped DEM height — A TERRA's).
 *
 *   FLY_URL=http://localhost:3222 node scripts/r22-c-crossboot.js
 */
const { chromium } = require('playwright');
const { bootFly } = require('./_boot');

const BOOT_OPTS = process.env.FLY_URL ? { url: process.env.FLY_URL } : {};
const P_LEWIS = [40.2083, -83.0701, 400];

const HASH = () => {
  const mix = (acc, v) => {
    acc ^= v & 0xff;
    acc = Math.imul(acc, 0x01000193);
    acc ^= (v >>> 8) & 0xff;
    acc = Math.imul(acc, 0x01000193);
    acc ^= (v >>> 16) & 0xff;
    return Math.imul(acc, 0x01000193);
  };
  const one = (k) => {
    const m = window.__satClutter?.[k];
    if (!m || !m.count) return { n: 0, set: '0' };
    const a = m.instanceMatrix.array;
    let hs = 0;
    for (let i = 0; i < m.count; i++) {
      let e = 0x811c9dc5;
      for (let j = 0; j < 16; j++) {
        if (j === 13) continue;
        e = mix(e, Math.round(a[i * 16 + j] * 100) | 0);
      }
      hs = (hs + (e >>> 0)) >>> 0;
    }
    return { n: m.count, set: hs.toString(16) };
  };
  const raw = (k) => {
    const m = window.__satClutter?.[k];
    if (!m || !m.count) return null;
    return {
      pos: [m.position.x, m.position.z],
      mat: Array.from(m.instanceMatrix.array.slice(0, m.count * 16)),
    };
  };
  return {
    parked: one('parkedMesh'),
    movers: one('moverMesh'),
    poles: one('poleMesh'),
    raw: { parked: raw('parkedMesh'), movers: raw('moverMesh'), poles: raw('poleMesh') },
    latDeg: window.__fly?.flight?.latDeg,
    playerXZ: [window.__fly?.flight?.pos?.x, window.__fly?.flight?.pos?.z],
    chunkKeys: [...(window.__satClutter?.engine?.chunks?.keys?.() ?? [])].sort(),
    realCols: window.__flyStats?.clutter?.realCols ?? null,
    inside: window.__flyStats?.clutter?.parked?.insideColumns ?? null,
    ready: window.__flyStats?.clutter?.ready ?? null,
    chunks: window.__flyStats?.clutter?.chunks ?? null,
  };
};

async function boot(label) {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on('pageerror', (e) => console.log(`[${label}] PAGEERROR`, e.message));
  await page.addInitScript(() => {
    let cur = 'freeze';
    Object.defineProperty(window, '__flyClutterPin', {
      get: () => cur,
      set: () => {},
      configurable: true,
    });
  });
  await bootFly(page, { ...BOOT_OPTS, style: 'satellite' });
  await page.waitForTimeout(2000);
  await page.evaluate(async ([lat, lon, altM]) => {
    for (let i = 0; i < 120 && !window.__fly?.flight?.pos; i++)
      await new Promise((r) => setTimeout(r, 100));
    if (window.__pin) clearInterval(window.__pin);
    window.__fly.warpToGeo(lat, lon, { altM, name: null });
    const f = window.__fly.flight;
    // CAPTURE XZ SYNCHRONOUSLY, IN THE SAME TICK AS THE WARP. The first cut of
    // this harness slept 4 s (waiting for the DEM) and captured afterwards — by
    // which time the flight model had integrated the aeroplane 2.5 m downrange,
    // DIFFERENTLY in each boot. Every distance-keyed term downstream (farScale,
    // the rangeM cull) then differed by a hair, which is enough to move a
    // quantised set-hash and to include one extra anchor. That was the whole of
    // the "cross-boot nondeterminism": the instrument, not the world.
    const p = { x: f.pos.x, y: f.pos.y, z: f.pos.z };
    window.__pin = setInterval(() => {
      f.pos.x = p.x;
      f.pos.y = p.y;
      f.pos.z = p.z;
      f.heading = 20;
      f.pitch = -14;
      f.bank = 0;
      f.speed = 0;
    }, 8);
    // …then re-seat ONLY the altitude once the DEM has answered. groundElev is
    // seeded 0 at warp, so an AGL asked for at t=0 is not the AGL you get.
    await new Promise((r) => setTimeout(r, 4000));
    p.y = (f.groundElev ?? 0) + altM;
  }, P_LEWIS);

  // THE SETTLE PREDICATE, with the term that matters: realCols must STOP
  // GROWING. The building ring reporting 95% resolved is not the same fact —
  // measured on this branch, that predicate went true while queryColumns held
  // 43 columns of an index that ended at 1,844 (the R21 P5 lesson: gate on the
  // quantity the arithmetic actually reads, not on a ring-state proxy for it).
  await page.waitForFunction(
    () => {
      const c = window.__flyStats?.clutter;
      if (!c || c.ready == null || c.chunks == null) return false;
      if (c.ready < c.chunks) return false;
      const prev = window.__colsPrev;
      window.__colsPrev = c.realCols;
      return prev != null && prev === c.realCols && c.realCols > 0;
    },
    undefined,
    { timeout: 180000, polling: 2500 }
  );
  await page.waitForTimeout(4000);
  const h = await page.evaluate(HASH);
  await browser.close();
  return h;
}

(async () => {
  const a = await boot('A');
  const b = await boot('B');
  console.log('boot A', JSON.stringify(a));
  console.log('boot B', JSON.stringify(b));
  console.log('A latDeg', a.latDeg, 'playerXZ', a.playerXZ, 'chunks', a.chunkKeys?.join(' '));
  console.log('B latDeg', b.latDeg, 'playerXZ', b.playerXZ, 'chunks', b.chunkKeys?.join(' '));
  for (const k of ['parked', 'movers', 'poles']) {
    const same = a[k].n === b[k].n && a[k].set === b[k].set;
    console.log(
      `${same ? 'BIT-IDENTICAL' : 'DIFFERS      '} ${k}: A ${a[k].n}/${a[k].set}  B ${b[k].n}/${b[k].set}`
    );
    const ra = a.raw[k];
    const rb = b.raw[k];
    if (!same && ra && rb) {
      console.log(`   poolOrigin A ${ra.pos} B ${rb.pos}`);
      // Match instances by their XZ translation (order is a streaming artifact),
      // then report which ELEMENTS differ for the matched pairs, and how many
      // instances have no partner at all (a genuine membership change).
      const key = (m, i) => `${Math.round(m[i * 16 + 12] * 10)},${Math.round(m[i * 16 + 14] * 10)}`;
      const mapB = new Map();
      for (let i = 0; i < rb.mat.length / 16; i++) mapB.set(key(rb.mat, i), i);
      const elem = new Array(16).fill(0);
      let unmatched = 0;
      let worst = 0;
      let worstEl = -1;
      for (let i = 0; i < ra.mat.length / 16; i++) {
        const j = mapB.get(key(ra.mat, i));
        if (j === undefined) {
          unmatched += 1;
          continue;
        }
        for (let e = 0; e < 16; e++) {
          const d = Math.abs(ra.mat[i * 16 + e] - rb.mat[j * 16 + e]);
          if (d > 1e-3) {
            elem[e] += 1;
            if (d > worst) {
              worst = d;
              worstEl = e;
            }
          }
        }
      }
      console.log(
        `   XZ-unmatched ${unmatched}/${ra.mat.length / 16} · per-element diffs ` +
          JSON.stringify(elem.map((v, e) => (v ? `${e}:${v}` : null)).filter(Boolean)) +
          ` · worst |Δ| ${worst.toFixed(3)} at element ${worstEl}`
      );
    }
  }
})();
