/**
 * R22 C CLUTTER — W3 determinism triage (diagnostic, not a gate).
 *
 * Answers three W3 findings with evidence rather than argument:
 *   (1) mover set-hash moves across 4 s under 'freeze' — WHICH matrix element?
 *   (2) poles not bit-identical cross-boot — same question, same instrument.
 *   (3) 12/242 parked cars "inside a collision column" — which FRAME was the
 *       census taken in, and does the leak survive a correct-frame read?
 *
 *   FLY_URL=http://localhost:3222 node scripts/r22-c-w3diag.js
 */
const { chromium } = require('playwright');
const { bootFly } = require('./_boot');

const BOOT_OPTS = process.env.FLY_URL ? { url: process.env.FLY_URL } : {};
const P_LEWIS = [40.2083, -83.0701, 400]; // = verify-clutter's P_LEWIS

const POOLS = ['parkedMesh', 'moverMesh', 'poleMesh'];

/** Copy every pool's matrix + the frame data the census needs. */
const SNAP = () => {
  const out = {};
  for (const k of ['parkedMesh', 'moverMesh', 'poleMesh']) {
    const m = window.__satClutter?.[k];
    if (!m) {
      out[k] = null;
      continue;
    }
    out[k] = {
      count: m.count,
      mat: Array.from(m.instanceMatrix.array.slice(0, m.count * 16)),
      pos: [m.position.x, m.position.y, m.position.z],
    };
  }
  out.stream = window.__flyStats?.satClutter?.stream ?? null;
  out.cols = window.__flyStats?.satClutter?.realCols ?? null;
  out.liveCols = window.__satBuildings?.stats?.columns ?? null;
  return out;
};

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
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
    await new Promise((r) => setTimeout(r, 4000));
    f.pos.y = (f.groundElev ?? 0) + altM;
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
  }, P_LEWIS);

  // Settle on the predicate verify-clutter uses, then give the ground stack two
  // more cadences so nothing is mid-birth when the first snapshot is taken.
  await page.waitForFunction(
    () => {
      const c = window.__flyStats?.clutter ?? null;
      const sb = window.__satBuildings?.stats ?? null;
      if (!c || !sb) return false;
      return (sb.chunks ? sb.ready / sb.chunks : 0) >= 0.95;
    },
    undefined,
    { timeout: 120000 }
  );
  await page.waitForTimeout(6000);

  await page.evaluate((fn) => {
    window.__diagA = eval(`(${fn})`)();
  }, SNAP.toString());
  await page.waitForTimeout(4000);

  const delta = await page.evaluate((fn) => {
    const B = eval(`(${fn})`)();
    const A = window.__diagA;
    const res = { stream: { a: A.stream, b: B.stream }, cols: { a: A.cols, b: B.cols } };
    for (const k of ['parkedMesh', 'moverMesh', 'poleMesh']) {
      const a = A[k];
      const b = B[k];
      if (!a || !b) {
        res[k] = null;
        continue;
      }
      const n = Math.min(a.count, b.count);
      const elem = new Array(16).fill(0);
      let moved = 0;
      let maxAbs = 0;
      for (let i = 0; i < n; i++) {
        let any = false;
        for (let j = 0; j < 16; j++) {
          const d = Math.abs(a.mat[i * 16 + j] - b.mat[i * 16 + j]);
          if (d > 1e-4) {
            elem[j] += 1;
            any = true;
            if (d > maxAbs) maxAbs = d;
          }
        }
        if (any) moved += 1;
      }
      res[k] = {
        countA: a.count,
        countB: b.count,
        moved,
        maxAbsDelta: +maxAbs.toFixed(4),
        perElement: elem.map((v, j) => (v ? `${j}:${v}` : null)).filter(Boolean),
        poolOriginMoved: a.pos.join(',') !== b.pos.join(','),
      };
    }
    return res;
  }, SNAP.toString());
  console.log('--- (1)(2) 4-SECOND DELTA UNDER FREEZE ---');
  console.log(JSON.stringify(delta, null, 1));

  // ---- (3) the anti-dup census, in BOTH frames ----------------------------
  const census = await page.evaluate(() => {
    const m = window.__satClutter?.parkedMesh;
    const sb = window.__satBuildings;
    if (!m || !sb?.queryColumns) return { err: 'no handles' };
    const a = m.instanceMatrix.array;
    const ox = m.position.x;
    const oz = m.position.z;
    let bucketHitAbs = 0; // queryColumns(x,z,0).length > 0 — E's gate-14 read
    let bucketHitRebased = 0; // …the same read in the WRONG frame
    let containedAbs = 0; // …and the exact cylinder-containment test
    let nearestGap = Infinity; // closest approach of any car to a column edge
    const badAbs = [];
    for (let i = 0; i < m.count; i++) {
      const lx = a[i * 16 + 12];
      const lz = a[i * 16 + 14];
      // ABSOLUTE = the frame queryColumns speaks. The instance translation is
      // RELATIVE to the mesh's pool origin (float32 precision — SatVegLayer's
      // rule), so a raw read is short by the origin, which near Ohio is ~9.2e6.
      const wx = lx + ox;
      const wz = lz + oz;
      const cols = sb.queryColumns(wx, wz, 0) ?? [];
      if (cols.length) bucketHitAbs += 1;
      if ((sb.queryColumns(lx, lz, 0) ?? []).length) bucketHitRebased += 1;
      let hit = false;
      for (const c of cols) {
        const d = Math.hypot(wx - c.x, wz - c.z) - c.r;
        if (d < nearestGap) nearestGap = d;
        if (d < 0) hit = true;
      }
      if (hit) {
        containedAbs += 1;
        if (badAbs.length < 5) badAbs.push([Math.round(wx), Math.round(wz)]);
      }
    }
    return {
      placed: m.count,
      poolOrigin: [Math.round(ox), Math.round(oz)],
      gate14_bucketHit_absolute: bucketHitAbs,
      gate14_bucketHit_rebased: bucketHitRebased,
      EXACT_containedInColumn: containedAbs,
      nearestGapM: +nearestGap.toFixed(2),
      ownerCensus: window.__flyStats?.clutter?.parked?.insideColumns,
      badAbs,
      liveColumns: sb.stats?.columns ?? null,
      colsAtLastPlacement: window.__flyStats?.satClutter?.realCols ?? null,
      contractAnchorsType: typeof window.__flyStats?.clutter?.parked?.anchors,
      contractAnchorsValue: window.__flyStats?.clutter?.parked?.anchors,
    };
  });
  console.log('--- (3) ANTI-DUP CENSUS ---');
  console.log(JSON.stringify(census, null, 1));

  await browser.close();
})();
