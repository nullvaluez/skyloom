/** WORLD PASS B r2: frame pacing while the city ring fills, one fresh page per run.
 * Per run: boot, a COLD warp (the page's first) to --cold, then a WARM warp to --warm. For each
 * warp, from the warp until the building ring is full (or --sec): the longest frame (rAF
 * interval), frames over 33 ms and over 100 ms, the building engine's worst finalize work in a
 * frame (finalizeFrameMsMax, slices included) and its per-phase maxima, the first detailed tile
 * and the full ring (s from the warp), and the honest ground under the aircraft (s from the warp,
 * first sample at tileZ >= 14). Arms are interleaved: --arms=off,WORLD_ARRIVAL,ALL --pairs=3 runs
 * off, B, all, off, B, all, ... With --profile, a CPU profile of each warp and the functions that
 * ran in the longest busy stretch (consecutive non-idle samples).
 *   node scripts/wp-arrival-r2-pacing.cjs --url=http://localhost:3322 --out=<dir> [--cold=nyc-low] [--warm=paris]
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
const pairs = Number(args.pairs || 3);
const SEC = Number(args.sec || 45);
const cold = String(args.cold || 'nyc-low'), warm = String(args.warm || 'paris');
const report = { tool: 'wp-arrival-r2-pacing', url, cold, warm, sec: SEC, date: new Date().toISOString(), runs: [] };
const save = () => fs.writeFileSync(path.join(out, 'pacing.json'), JSON.stringify(report, null, 1));

function busiest(profile) {
  // The longest run of consecutive samples that are not (idle) / (program) / (garbage collector excluded).
  const nodes = new Map(profile.nodes.map((n) => [n.id, n]));
  const parent = new Map();
  for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  const name = (id) => { const n = nodes.get(id); return `${n.callFrame.functionName || '(anon)'} ${String(n.callFrame.url).split('/').pop()}:${n.callFrame.lineNumber + 1}`; };
  const idle = (id) => /^\((idle|program)\)/.test(nodes.get(id).callFrame.functionName);
  const runs = [];
  let cur = { len: 0, us: 0, from: 0 };
  const S = profile.samples, D = profile.timeDeltas;
  for (let i = 0; i < S.length; i++) {
    if (idle(S[i])) { if (cur.len) runs.push(cur); cur = { len: 0, us: 0, from: i + 1 }; continue; }
    cur.len++; cur.us += D[i] ?? 0;
  }
  if (cur.len) runs.push(cur);
  runs.sort((a, b) => b.us - a.us);
  const one = (best) => stretch(best, S, D, name, parent);
  const out = one(runs[0] ?? { len: 0, us: 0, from: 0 });
  out.next = runs.slice(1, 4).map(one).map((s) => ({ ms: s.ms, self: s.self.slice(0, 6), inclusive: s.inclusive.slice(0, 14) }));
  return out;
}

function stretch(best, S, D, name, parent) {
  const self = new Map(), incl = new Map();
  for (let i = best.from; i < best.from + best.len; i++) {
    const id = S[i], dt = D[i] ?? 0;
    self.set(name(id), (self.get(name(id)) ?? 0) + dt);
    const seen = new Set();
    for (let p = id; p !== undefined; p = parent.get(p)) { const k = name(p); if (seen.has(k)) continue; seen.add(k); incl.set(k, (incl.get(k) ?? 0) + dt); }
  }
  const top = (m, k) => [...m].sort((a, b) => b[1] - a[1]).slice(0, k).map(([f, us]) => [f, +(us / 1000).toFixed(1)]);
  return { ms: +(best.us / 1000).toFixed(1), self: top(self, 12), inclusive: top(incl, 25) };
}

async function watch(page, client, pose, label) {
  if (client) { await client.send('Profiler.enable'); await client.send('Profiler.setSamplingInterval', { interval: 500 }); await client.send('Profiler.start'); }
  await page.evaluate(() => {
    const W = (window.__pace = { frames: [], last: performance.now(), t0: performance.now(), ground: null, progN: window.__flyStats?.census?.programs?.afterReveal?.length ?? 0 });
    const tick = () => { const t = performance.now(); W.frames.push(t - W.last); W.last = t; if (!W.stop) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    W.timer = setInterval(() => {
      if (W.ground != null) return;
      const r = window.__fly, g = r.engine.worldToGeo(r.flight.pos), s = r.engine.getGroundAt(g.x, g.y);
      if (s && s.tileZ >= 14) W.ground = (performance.now() - W.t0) / 1000;
    }, 100);
  });
  await L.warp(page, pose);
  await page.evaluate(() => { window.__pace.t0 = performance.now(); window.__pace.frames.length = 0; window.__pace.last = performance.now(); });
  const t0 = Date.now();
  while (Date.now() - t0 < SEC * 1000) {
    await L.sleep(1000);
    const full = await page.evaluate(() => window.__fly.satBuildings?.stats?.fullRingSec);
    if (full != null && Date.now() - t0 > 8000) { await L.sleep(2000); break; }
  }
  const m = await page.evaluate(() => {
    const W = window.__pace; W.stop = true; clearInterval(W.timer);
    const f = W.frames, s = window.__fly.satBuildings?.stats ?? {}, eng = window.__fly.satBuildings;
    const over = (ms) => f.filter((x) => x > ms).length;
    const sorted = [...f].sort((a, b) => b - a);
    return { frames: f.length, longestMs: +(sorted[0] ?? 0).toFixed(1), top5: sorted.slice(0, 5).map((x) => +x.toFixed(1)), over33: over(33.4), over50: over(50), over100: over(100),
      firstTileSec: s.firstTileSec ?? null, fullRingSec: s.fullRingSec ?? null, groundSec: W.ground, finalizeFrameMsMax: s.finalizeFrameMsMax ?? null, finalizeMsMax: s.finalizeMsMax ?? null,
      finPh: eng?._wp?.finPh ? Object.fromEntries(Object.entries(eng._wp.finPh).map(([k, v]) => [k, +v.toFixed(1)])) : null,
      timeouts: s.buildTimeouts ?? null, workersReplaced: s.workersReplaced ?? null, ready: s.ready ?? null,
      finWorst: eng?._wp?.frameWorst ? Object.fromEntries(Object.entries(eng._wp.frameWorst).map(([k, v]) => [k, +(+v).toFixed(1)])) : null, partitionFallbacks: s.partitionFallbacks ?? null,
      programs: (window.__flyStats?.census?.programs?.afterReveal ?? []).slice(W.progN ?? 0).sort((a, b) => b.ms - a.ms).slice(0, 6) };
  });
  if (client) { const { profile } = await client.send('Profiler.stop'); m.busiest = busiest(profile); }
  console.log(label, JSON.stringify({ ...m, busiest: m.busiest ? { ms: m.busiest.ms, inclusive: m.busiest.inclusive.slice(0, 8) } : undefined }));
  return m;
}

(async () => {
  for (let k = 0; k < pairs; k++) {
    for (const flags of arms) {
      console.log('SLOT after', await L.acquireSlot(`wp-arrival-r2-pacing ${flags}`), 'ms');
      const browser = await L.launch();
      const run = { pair: k, flags: flags || 'off', errors: [] };
      try {
        const { page } = await L.boot(browser, { url, flags, firstPose: L.POSES[cold], errors: run.errors });
        const client = args.profile ? await page.context().newCDPSession(page) : null;
        await L.sleep(5000);
        run.cold = await watch(page, client, L.POSES[cold], `${k} ${flags || 'off'} cold ${cold}`);
        run.warm = await watch(page, client, L.POSES[warm], `${k} ${flags || 'off'} warm ${warm}`);
      } catch (e) { run.errors.push('fatal ' + String(e?.message ?? e).slice(0, 300)); console.error(e); }
      finally { await browser.close(); L.releaseSlot(); report.runs.push(run); save(); }
    }
  }
  console.log('DONE', out);
})();
