/** WORLD PASS B r2b: what the building engine's finalize queue is doing while a ring fills (diagnostic).
 * One page per arm: warp to --pose (the page's first warp), then every 500 ms for --sec s: drawn tiles,
 * queue, pending finalize (and how far each pending tile's steps got), the frame-share counters, the
 * step cost estimates, and the skyline engine's pending groups.
 *   node scripts/wp-arrival-r2b-diag.cjs --url=http://localhost:3322 --arms=ALL --pose=paris --out=<dir>
 */
const fs = require('node:fs');
const path = require('node:path');
const L = require('./wp-arrival-r2-lib.cjs');
const { args } = L;
const url = args.url || 'http://localhost:3322';
const out = path.resolve(String(args.out));
fs.mkdirSync(out, { recursive: true });
const ALL = 'WORLD_TRUTH,WORLD_ARRIVAL,WORLD_REACH,WORLD_LOOK';
const arms = String(args.arms || 'ALL').split(',').map((a) => (a === 'ALL' ? ALL : a === 'off' ? '' : a));
const SEC = Number(args.sec || 90), pose = args.lat ? { lat: Number(args.lat), lon: Number(args.lon), altM: Number(args.alt || 300), headingDeg: Number(args.brg || 0) } : L.POSES[String(args.pose || 'paris')];
const report = { tool: 'wp-arrival-r2b-diag', url, pose, date: new Date().toISOString(), runs: [] };
(async () => {
  for (const flags of arms) {
    console.log('SLOT after', await L.acquireSlot(`wp-arrival-r2b-diag ${flags}`), 'ms');
    const browser = await L.launch();
    const run = { flags: flags || 'off', errors: [], samples: [] };
    try {
      const { page } = await L.boot(browser, { url, flags, firstPose: pose, errors: run.errors });
      await L.sleep(3000);
      await L.warp(page, pose);
      const t0 = Date.now();
      while (Date.now() - t0 < SEC * 1000) {
        await L.sleep(500);
        const s = await page.evaluate(() => {
          const b = window.__fly.satBuildings, k = window.__fly.satSkyline, st = b.stats ?? {};
          let ready = 0; const states = {};
          for (const c of b.chunks.values()) { if (c.mesh) ready++; states[c.state] = (states[c.state] ?? 0) + 1; }
          const pend = b.pendingFinalize.map((p) => (p.ready ? (p.pf ? (p.pf.geo ? 'G' : p.pf.partition ? 'P' : p.pf.rec?.done ? 'R' : p.pf.fg ? 'F' : p.pf.walked ? 'W' : 'w') : 'r') : '-')).join('');
          return { ready, states, pend, queue: b.queue.length, building: b.building, share: { g: st.wholeGranted, r: st.wholeRefused, y: st.slicesYielded },
            est: Object.fromEntries(Object.entries(b._stepEst ?? {}).map(([k2, v]) => [k2, +v.toFixed(1)])), fresh: b._sliceFresh, finFrame: st.finalizeFrameMsMax,
            skyPend: k?.pendingFinalize?.length ?? null, skyReady: k ? [...k.chunks.values()].filter((c) => c.mesh || c.state === 'ready').length : null, ft: st.firstTileSec, full: st.fullRingSec };
        });
        s.t = +((Date.now() - t0) / 1000).toFixed(1);
        run.samples.push(s);
        if (run.samples.length % 4 === 0) console.log(JSON.stringify(s));
      }
    } catch (e) { run.errors.push('fatal ' + String(e?.message ?? e).slice(0, 300)); console.error(e); }
    finally { await browser.close(); L.releaseSlot(); report.runs.push(run); fs.writeFileSync(path.join(out, 'diag.json'), JSON.stringify(report, null, 1)); }
  }
  console.log('DONE');
})();
