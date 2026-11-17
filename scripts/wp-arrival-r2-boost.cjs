/** WORLD PASS B r2 (item 5): the city behind the aircraft at boost, and the orbit camera looking back.
 * Per arm (one page each, interleaved with --pairs): warp to Midtown (300 m, heading --brg), wait
 * for a full building ring, then fly straight at --v m/s for --sec s. Every 250 ms: the drawn
 * tiles and every tile death with its distance from the aircraft and its bearing (cos < 0 =
 * behind). At --lookAt s after the boost starts, the right mouse button orbits the camera to
 * look back (a real drag) and frames are captured.
 *   node scripts/wp-arrival-r2-boost.cjs --url=http://localhost:3322 --arms=off,WORLD_ARRIVAL,ALL --out=<dir>
 */
const fs = require('node:fs');
const path = require('node:path');
const L = require('./wp-arrival-r2-lib.cjs');
const { args } = L;
const url = args.url || 'http://localhost:3322';
const out = path.resolve(String(args.out));
fs.mkdirSync(out, { recursive: true });
const ALL = 'WORLD_TRUTH,WORLD_ARRIVAL,WORLD_REACH,WORLD_LOOK';
const arms = String(args.arms || 'off,WORLD_ARRIVAL,ALL').split(',').map((a) => (a === 'ALL' ? ALL : a === 'off' ? '' : a));
const pairs = Number(args.pairs || 1);
const V = Number(args.v || 750), SEC = Number(args.sec || 10), LOOK = String(args.lookAt || '4,8').split(',').map(Number);
const place = { lat: Number(args.lat || 40.7549), lon: Number(args.lon || -73.984), altM: Number(args.alt || 300), headingDeg: Number(args.brg || 220) };
const report = { tool: 'wp-arrival-r2-boost', url, v: V, sec: SEC, place, date: new Date().toISOString(), runs: [] };
const save = () => fs.writeFileSync(path.join(out, 'boost.json'), JSON.stringify(report, null, 1));

function instrument() {
  const R = 6378137, WORLD = 2 * Math.PI * R, half = WORLD / 2;
  const r = window.__fly, b = r.satBuildings;
  // r2b: the engine's own ring radius (world units, the same units the engine
  // keeps tiles by) next to the true-metre centre distance the verifier used.
  const ringW = b._coverage?.ringM ?? 4400;
  const P = (window.__bp = { t0: performance.now(), samples: [], deaths: [], alive: new Map(), ringW });
  const geo = (z, x, y) => { const span = WORLD / 2 ** z, minX = -half + x * span, minZ = -(half - y * span); return { span, minX, minZ, cx: minX + span / 2, cz: minZ + span / 2 }; };
  const rel = (key) => {
    const [z, x, y] = key.split('/').map(Number); const g = geo(z, x, y); const f = r.flight;
    const dx = g.cx - f.pos.x, dz = g.cz - f.pos.z, d = Math.hypot(dx, dz); const k = Math.cos(2 * Math.atan(Math.exp(-f.pos.z / R)) - Math.PI / 2);
    const nx = Math.max(g.minX - f.pos.x, 0, f.pos.x - (g.minX + g.span)), nz = Math.max(g.minZ - f.pos.z, 0, f.pos.z - (g.minZ + g.span));
    const dNearW = Math.hypot(nx, nz);
    return { dTrueM: Math.round(d * k), dNearW: Math.round(dNearW), inRing: dNearW <= ringW, cos: d > 0 ? +((dx * Math.sin(f.heading) - dz * Math.cos(f.heading)) / d).toFixed(2) : 1 };
  };
  // r2b: rank of a tile among the tiles touching the aircraft's ring, nearest centre first (the
  // engine's ring holds maxChunks of them, 16 at Ultra / High): < maxChunks = the aircraft's own ring.
  const maxChunks = b._coverage?.maxChunks ?? 16;
  const ringRank = (key) => {
    const f = r.flight, z = 14, span = WORLD / 2 ** z, list = [];
    for (let ty = Math.floor((f.pos.z - ringW + half) / span); ty <= Math.floor((f.pos.z + ringW + half) / span); ty++)
      for (let tx = Math.floor((f.pos.x - ringW + half) / span); tx <= Math.floor((f.pos.x + ringW + half) / span); tx++) { const k2 = `${z}/${tx}/${ty}`, q = rel(k2); if (q.inRing) { const g = geo(z, tx, ty); list.push([Math.hypot(g.cx - f.pos.x, g.cz - f.pos.z), k2]); } }
    list.sort((a, b2) => a[0] - b2[0]);
    const i = list.findIndex((e) => e[1] === key);
    return i < 0 ? null : i;
  };
  P.timer = setInterval(() => {
    const t = +((performance.now() - P.t0) / 1000).toFixed(2), seen = new Set();
    let ready = 0, behind = 0;
    for (const [key, c] of b.chunks) { if (!c.mesh) continue; ready++; seen.add(key); if (!P.alive.has(key)) P.alive.set(key, t); if (rel(key).cos < -0.3) behind++; }
    for (const [key] of P.alive) if (!seen.has(key)) { const q = rel(key); P.deaths.push({ key, t, ...q, ringRank: q.inRing ? ringRank(key) : null, ownRing: q.inRing && ringRank(key) < maxChunks }); P.alive.delete(key); }
    // holes: z14 tiles touching the aircraft's ring (nearest point within ringW) with nothing drawn
    // (a tile the worker reported empty, water or no data, is not a hole)
    const f = r.flight, z = 14, span = WORLD / 2 ** z;
    let disk = 0, holesAhead = 0, holesBehind = 0;
    for (let ty = Math.floor((f.pos.z - ringW + half) / span); ty <= Math.floor((f.pos.z + ringW + half) / span); ty++)
      for (let tx = Math.floor((f.pos.x - ringW + half) / span); tx <= Math.floor((f.pos.x + ringW + half) / span); tx++) {
        const key = `${z}/${tx}/${ty}`, q = rel(key); if (!q.inRing) continue; disk++;
        const c = b.chunks.get(key); if (c?.mesh || c?.state === 'empty') continue;
        if (q.cos < 0) holesBehind++; else holesAhead++;
      }
    P.samples.push({ t, ready, behind, disk, holesAhead, holesBehind, behindKept: b.stats?.behindKept ?? null, leadDeferred: b.stats?.leadDeferred ?? null, geomMiB: +((b.stats?.geomBytes ?? 0) / 1048576).toFixed(1) });
  }, 250);
}

(async () => {
  for (let k = 0; k < pairs; k++) for (const flags of arms) {
    console.log('SLOT after', await L.acquireSlot(`wp-arrival-r2-boost ${flags}`), 'ms');
    const browser = await L.launch();
    const run = { pair: k, flags: flags || 'off', errors: [] };
    const tag = `${args.tag ? args.tag + '-' : ''}${k}-${flags ? (flags.includes('TRUTH') ? 'all4' : 'arrival') : 'off'}`;
    try {
      const { page } = await L.boot(browser, { url, flags, firstPose: place, errors: run.errors });
      await L.sleep(3000);
      await L.warp(page, place);
      const t0 = Date.now();
      for (;;) { await L.sleep(1000); const s = await page.evaluate(() => window.__fly.satBuildings?.stats?.fullRingSec); if ((s != null && s >= 0 && Date.now() - t0 > 8000) || Date.now() - t0 > 90000) break; }
      await L.sleep(4000);
      run.ringSec = (Date.now() - t0) / 1000;
      await page.evaluate(instrument);
      await page.evaluate((v) => { window.__lookHold.v = v; }, V);
      const tb = Date.now();
      for (const at of LOOK) {
        await L.sleep(Math.max(0, at * 1000 - (Date.now() - tb)));
        // the orbit camera (what a right-mouse drag feeds): ~180 degrees of yaw (yawRate 7 rad a screen width)
        await page.evaluate((f) => { const i = window.__fly.input; i.setLookActive(true); i.addLook(f, 0); }, Number(args.lookFrac || 0.449));
        await L.sleep(700);
        await page.screenshot({ path: path.join(out, `lookback-${tag}-t${at}.png`) });
        run.lookYaw = await page.evaluate(() => window.__fly.chaseRig?._look?.yaw ?? null);
        (run.geometry ??= {})[`t${at}`] = await L.geometry(page); // the budget tool's count (CPU) and the GPU estimate, mid-boost
        await page.evaluate(() => window.__fly.input.setLookActive(false));
      }
      await L.sleep(Math.max(0, SEC * 1000 - (Date.now() - tb)));
      const d = await page.evaluate(() => { const P = window.__bp; clearInterval(P.timer); return { samples: P.samples, deaths: P.deaths, look: window.__fly.chaseRig?._look ?? null }; });
      Object.assign(run, d);
      // deaths of tiles behind the aircraft while still within the ring radius (true metres)
      const ringM = Number(args.ringM || 4400);
      run.behindDeathsInRing = d.deaths.filter((x) => x.cos < 0 && x.dTrueM <= ringM).length;
      run.deathsBehind = d.deaths.filter((x) => x.cos < 0).length;
      // r2b: the engine's own measure: tiles that died while any of them was within the ring radius of the aircraft
      run.deathsInRingEngine = d.deaths.filter((x) => x.inRing).length;
      run.deathsBehindInRingEngine = d.deaths.filter((x) => x.inRing && x.cos < 0).length;
      run.deathsOwnRing = d.deaths.filter((x) => x.ownRing).length; // of the aircraft's own ring (its maxChunks tiles nearest it)
      const S = d.samples;
      run.holes = { aheadMax: Math.max(0, ...S.map((x) => x.holesAhead)), behindMax: Math.max(0, ...S.map((x) => x.holesBehind)),
        aheadMean: +(S.reduce((a, x) => a + x.holesAhead, 0) / Math.max(1, S.length)).toFixed(2), behindMean: +(S.reduce((a, x) => a + x.holesBehind, 0) / Math.max(1, S.length)).toFixed(2), diskMean: +(S.reduce((a, x) => a + x.disk, 0) / Math.max(1, S.length)).toFixed(1) };
      console.log(tag, JSON.stringify({ deaths: d.deaths.length, behind: run.deathsBehind, behindInRingTrue: run.behindDeathsInRing, inRingEngine: run.deathsInRingEngine, behindInRingEngine: run.deathsBehindInRingEngine, ownRing: run.deathsOwnRing, holes: run.holes, geometry: Object.fromEntries(Object.entries(run.geometry ?? {}).map(([k, v]) => [k, { cpu: v.cpuMiB.total, gpu: v.gpuMiB.total, bld: v.cpuMiB.buildings }])), lastSample: d.samples.at(-1) }));
    } catch (e) { run.errors.push('fatal ' + String(e?.message ?? e).slice(0, 300)); console.error(e); }
    finally { await browser.close(); L.releaseSlot(); report.runs.push(run); save(); }
  }
  console.log('DONE', out);
})();
