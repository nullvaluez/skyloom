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
const place = { lat: 40.7549, lon: -73.984, altM: 300, headingDeg: Number(args.brg || 220) };
const report = { tool: 'wp-arrival-r2-boost', url, v: V, sec: SEC, place, date: new Date().toISOString(), runs: [] };
const save = () => fs.writeFileSync(path.join(out, 'boost.json'), JSON.stringify(report, null, 1));

function instrument() {
  const R = 6378137, WORLD = 2 * Math.PI * R, half = WORLD / 2;
  const r = window.__fly, b = r.satBuildings;
  const P = (window.__bp = { t0: performance.now(), samples: [], deaths: [], alive: new Map() });
  const rel = (key) => { const [z, x, y] = key.split('/').map(Number); const span = WORLD / 2 ** z; const cx = -half + x * span + span / 2, cz = -(half - y * span) + span / 2; const f = r.flight; const dx = cx - f.pos.x, dz = cz - f.pos.z, d = Math.hypot(dx, dz); const k = Math.cos(2 * Math.atan(Math.exp(-f.pos.z / R)) - Math.PI / 2); return { dTrueM: Math.round(d * k), cos: d > 0 ? +((dx * Math.sin(f.heading) - dz * Math.cos(f.heading)) / d).toFixed(2) : 1 }; };
  P.timer = setInterval(() => {
    const t = +((performance.now() - P.t0) / 1000).toFixed(2), seen = new Set();
    let ready = 0, behind = 0;
    for (const [key, c] of b.chunks) { if (!c.mesh) continue; ready++; seen.add(key); if (!P.alive.has(key)) P.alive.set(key, t); if (rel(key).cos < -0.3) behind++; }
    for (const [key] of P.alive) if (!seen.has(key)) { P.deaths.push({ key, t, ...rel(key) }); P.alive.delete(key); }
    P.samples.push({ t, ready, behind, behindKept: b.stats?.behindKept ?? null, geomMiB: +((b.stats?.geomBytes ?? 0) / 1048576).toFixed(1) });
  }, 250);
}

(async () => {
  for (let k = 0; k < pairs; k++) for (const flags of arms) {
    console.log('SLOT after', await L.acquireSlot(`wp-arrival-r2-boost ${flags}`), 'ms');
    const browser = await L.launch();
    const run = { pair: k, flags: flags || 'off', errors: [] };
    const tag = `${k}-${flags ? (flags.includes('TRUTH') ? 'all4' : 'arrival') : 'off'}`;
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
        await page.mouse.move(800, 450);
        await page.mouse.down({ button: 'right' });
        await page.mouse.move(800 + Number(args.dragPx || 900), 470, { steps: 12 });
        await L.sleep(500);
        await page.screenshot({ path: path.join(out, `lookback-${tag}-t${at}.png`) });
        await page.mouse.up({ button: 'right' });
      }
      await L.sleep(Math.max(0, SEC * 1000 - (Date.now() - tb)));
      const d = await page.evaluate(() => { const P = window.__bp; clearInterval(P.timer); return { samples: P.samples, deaths: P.deaths, look: window.__fly.chaseCam?._look ?? null }; });
      Object.assign(run, d);
      // deaths of tiles behind the aircraft while still within the ring radius (true metres)
      const ringM = Number(args.ringM || 4400);
      run.behindDeathsInRing = d.deaths.filter((x) => x.cos < 0 && x.dTrueM <= ringM).length;
      run.deathsBehind = d.deaths.filter((x) => x.cos < 0).length;
      console.log(tag, JSON.stringify({ deaths: d.deaths.length, behind: run.deathsBehind, behindInRing: run.behindDeathsInRing, lastSample: d.samples.at(-1), look: d.look }));
    } catch (e) { run.errors.push('fatal ' + String(e?.message ?? e).slice(0, 300)); console.error(e); }
    finally { await browser.close(); L.releaseSlot(); report.runs.push(run); save(); }
  }
  console.log('DONE', out);
})();
