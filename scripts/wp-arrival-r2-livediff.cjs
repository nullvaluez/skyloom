/** WORLD PASS B r2 (fastQuery): every LIVE ground query, re-asked of the reference in the same call.
 * Wraps TerrainGroundQuery.prototype.sample in the page (every instance and every caller: the
 * building engine, the terrain engine's getGroundAt for REACH / GROUND / the airport set, POI
 * ground, terrain shadows), so while tiles stream during real arrivals each answer of the fast
 * path is compared with sampleReference in the same synchronous call (null / undefined,
 * Object.is on elev, tileZ, tile identity). Per place: warp, hold 45 s, drift 15 s.
 * Timing, two ways: (1) per live call (performance.now around each call; Chrome coarsens it, so
 * only means over many calls are reported); (2) a replay of the recorded live points in order,
 * in one synchronous loop at the end of each place: fast unbatched, fast in the original batch
 * grouping, reference.
 *   node scripts/wp-arrival-r2-livediff.cjs --url=http://localhost:3322 --out=<dir> [--places=sf,hk,nyc,owens] [--flags=WORLD_ARRIVAL]
 */
const fs = require('node:fs');
const path = require('node:path');
const L = require('./wp-arrival-r2-lib.cjs');
const { args } = L;
const url = args.url || 'http://localhost:3322';
const flags = typeof args.flags === 'string' ? args.flags : 'WORLD_ARRIVAL';
const out = path.resolve(String(args.out));
fs.mkdirSync(out, { recursive: true });
const PL = { sf: { lat: 37.7905, lon: -122.4235, altM: 260, headingDeg: 75 }, hk: { lat: 22.2745, lon: 114.152, altM: 360, headingDeg: 160 }, nyc: { lat: 40.748, lon: -73.994, altM: 230, headingDeg: 40 }, owens: { lat: 36.6, lon: -118.1, altM: 600, headingDeg: 0 } };
const places = String(args.places || 'sf,hk,nyc,owens').split(',');
const HOLD = Number(args.hold || 45), DRIFT = Number(args.drift || 15);
const report = { tool: 'wp-arrival-r2-livediff', url, flags, date: new Date().toISOString(), places: {}, errors: [] };
const save = () => fs.writeFileSync(path.join(out, 'livediff.json'), JSON.stringify(report, null, 1));

(async () => {
  console.log('SLOT after', await L.acquireSlot('wp-arrival-r2-livediff'), 'ms');
  const browser = await L.launch();
  try {
    const { page } = await L.boot(browser, { url, flags, firstPose: PL[places[0]], errors: report.errors });
    await page.evaluate(() => {
      const Q = window.__fly.engine._groundQuery.constructor, P = Q.prototype, orig = P.sample;
      const D = window.__ld = { n: 0, bad: 0, badEx: [], nB: 0, nU: 0, tB: 0, tU: 0, tR: 0, nullBoth: 0, undefBoth: 0, pts: [], cap: 200000, armed: Q.armed() };
      P.sample = function (lon, lat) {
        const inB = Q.inBatch();
        const t0 = performance.now();
        const a = orig.call(this, lon, lat);
        const t1 = performance.now();
        const b = this.sampleReference(lon, lat);
        const t2 = performance.now();
        D.n++; D.tR += t2 - t1;
        if (inB) { D.nB++; D.tB += t1 - t0; } else { D.nU++; D.tU += t1 - t0; }
        if (D.pts.length < D.cap * 3 && this === window.__fly.engine._groundQuery) D.pts.push(lon, lat, inB ? Q.batchSerial?.() ?? 1 : 0);
        let ok;
        if (a === undefined || b === undefined) { ok = a === b; if (ok) D.undefBoth++; }
        else if (a === null || b === null) { ok = a === b; if (ok) D.nullBoth++; }
        else ok = Object.is(a.elev, b.elev) && a.tileZ === b.tileZ && a.tile === b.tile;
        if (!ok) { D.bad++; if (D.badEx.length < 20) D.badEx.push({ lon, lat, inB, a: a && { e: a.elev, z: a.tileZ }, b: b && { e: b.elev, z: b.tileZ }, aU: a === undefined, bU: b === undefined }); }
        return a;
      };
    });
    for (const p of places) {
      await page.evaluate(() => { const D = window.__ld; Object.assign(D, { n: 0, bad: 0, badEx: [], nB: 0, nU: 0, tB: 0, tU: 0, tR: 0, nullBoth: 0, undefBoth: 0, pts: [] }); });
      await L.warp(page, PL[p]);
      await L.sleep(HOLD * 1000);
      await page.evaluate(() => { const h = window.__lookHold; window.__drift = setInterval(() => { h.x += 30 * Math.sin(h.heading); h.z -= 30 * Math.cos(h.heading); }, 250); });
      await L.sleep(DRIFT * 1000);
      await page.evaluate(() => clearInterval(window.__drift));
      const res = await page.evaluate(() => {
        const D = window.__ld, q = window.__fly.engine._groundQuery, Q = q.constructor;
        const us = (t, n) => (n ? +((t / n) * 1000).toFixed(3) : null);
        // Replay of the recorded live points (settled tree now), in order.
        const P = D.pts, n = P.length / 3;
        const t0 = performance.now(); for (let i = 0; i < n; i++) q._sampleFast(P[i * 3], P[i * 3 + 1]);
        const t1 = performance.now();
        let open = 0; for (let i = 0; i < n; i++) { const b = P[i * 3 + 2]; if (b !== open) { if (open) Q.endBatch(); if (b) Q.beginBatch(); open = b; } q._sampleFast(P[i * 3], P[i * 3 + 1]); } if (open) Q.endBatch();
        const t2 = performance.now(); for (let i = 0; i < n; i++) q.sampleReference(P[i * 3], P[i * 3 + 1]);
        const t3 = performance.now();
        const st = window.__fly.satBuildings?.stats ?? {};
        return { n: D.n, bad: D.bad, badEx: D.badEx, batched: D.nB, unbatched: D.nU, nullBoth: D.nullBoth, undefBoth: D.undefBoth,
          liveUs: { batched: us(D.tB, D.nB), unbatched: us(D.tU, D.nU), reference: us(D.tR, D.n) },
          replay: { points: n, fastUnbatchedUs: us(t1 - t0, n), fastAsBatchedLiveUs: us(t2 - t1, n), referenceUs: us(t3 - t2, n) },
          fastStats: { ...q.fastStats }, generation: Q.generation?.(), footings: st.footings, footGaps: st.footGaps, footMaxDelta: st.footMaxDelta, ready: st.ready };
      });
      report.places[p] = res; save();
      console.log(p, JSON.stringify({ n: res.n, bad: res.bad, batched: res.batched, unbatched: res.unbatched, live: res.liveUs, replay: res.replay }));
    }
  } catch (e) { report.errors.push('fatal ' + String(e?.stack ?? e).slice(0, 400)); console.error(e); }
  finally {
    save(); await browser.close(); L.releaseSlot();
    const tot = Object.values(report.places).reduce((a, r) => ({ n: a.n + r.n, bad: a.bad + r.bad }), { n: 0, bad: 0 });
    console.log(`${tot.bad === 0 && tot.n > 0 ? 'PASS' : 'FAIL'} ${tot.n} live queries, ${tot.bad} differences; errors ${report.errors.length} -> ${out}`);
  }
})();
