/** World Pass A (TRUTH) round 2: which near-ring tiles and far-mass groups are
 * empty at a pose, per arm, keyed by tile, so a change in the empty COUNT can be
 * told apart from a change in WHICH tiles are resident. Not product code.
 *
 *   node scripts/wp-truth-tiles-live.cjs --url=http://localhost:3321 --pose=iowa-farm \
 *        --arms=control:,truth:WORLD_TRUTH,arrival:WORLD_ARRIVAL --out=<dir>
 *
 * Same boot, warp, settle and GPU slot lock as scripts/world-pass-budget.cjs.
 * Per arm: <out>/tiles-<arm>.json with, per engine (satBuildings, satSkyline),
 * every chunk key, its state ('ready' | 'empty' | ...), its empty reason, and
 * the index count of a ready chunk's meshes.
 */
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const args = Object.fromEntries(process.argv.slice(2).map((s) => { const [k, ...v] = s.replace(/^--/, '').split('='); return [k, v.join('=') || true]; }));
const POSES = Object.assign({}, JSON.parse(fs.readFileSync(path.join(__dirname, 'world-pass-poses.json'), 'utf8')));
const url = typeof args.url === 'string' ? args.url : 'http://localhost:3321';
const poseNames = String(args.pose || 'iowa-farm').split(',');
const arms = String(args.arms || 'control:').split(',').map((s) => { const i = s.indexOf(':'); return [s.slice(0, i), s.slice(i + 1).replace(/\+/g, ',')]; });
const out = path.resolve(String(args.out || '.'));
fs.mkdirSync(out, { recursive: true });

let home;
try { home = path.resolve(execSync('git rev-parse --path-format=absolute --git-common-dir', { encoding: 'utf8' }).trim(), '..'); } catch { home = path.resolve(__dirname, '..'); }
const lockDir = path.join(home, '.graphics-review', 'look-pass', '.locks');
fs.mkdirSync(lockDir, { recursive: true });
async function withSlot(fn) {
  let held = null;
  for (;;) {
    for (let i = 0; i < 3 && !held; i++) {
      const p = path.join(lockDir, `slot-${i}`);
      try { fs.mkdirSync(p); fs.writeFileSync(path.join(p, 'owner.txt'), `wp-truth-tiles-live pid ${process.pid} ${new Date().toISOString()}`); held = p; } catch {}
    }
    if (held) break;
    await new Promise((r) => setTimeout(r, 5000));
  }
  try { return await fn(); } finally { fs.rmSync(held, { recursive: true, force: true }); }
}

(async () => {
  const day = Date.parse('2026-09-22T00:00:00Z');
  const noonOf = (pose) => day + (12 - pose.lon / 15) * 3600000 + 2 * 3600000;
  for (const [arm, flags] of arms) {
    await withSlot(async () => {
      const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true, args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
      const report = { arm, flags, url, poses: {} };
      try {
        const p = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
        await p.addInitScript(({ sun }) => {
          window.__flyGovPin = 'hold'; window.__flyVisualsOverride = 'enhanced'; window.__flyTitleBypass = true; window.__flyBoostInfinite = true;
          window.__flySunOverride = sun; window.__flyWeatherOverride = 'baseline'; window.__flyWorldPassCounters = true;
          try {
            localStorage.setItem('fly-map-style-2', 'satellite'); localStorage.setItem('fly-quality-tier', 'ultra'); localStorage.setItem('fly-controls-seen', '1');
            localStorage.setItem('fly-sound-on', '0'); localStorage.setItem('fly-visuals', 'enhanced');
            localStorage.setItem('fly-explorer-preferences-v1', JSON.stringify({ version: 1, settings: { tutorial: 'done' } }));
          } catch {}
        }, { sun: noonOf(POSES[poseNames[0]]) });
        await p.route('**/api/aircraft?**', (r) => r.fulfill({ json: { ac: [], now: Date.now(), total: 0, source: 'wp truth tiles' } }));
        await p.route('**/api/weather**', (r) => r.fulfill({ json: { found: false } }));
        await p.goto(`${url}/?graphicsReview=1${flags ? `&flags=${encodeURIComponent(flags)}` : ''}`, { waitUntil: 'domcontentloaded', timeout: 240000 });
        await p.waitForFunction(() => !!window.__fly?.operations && !!window.__flyStore, undefined, { timeout: 240000 });
        await p.evaluate(() => {
          const r = window.__fly, s = window.__flyStore.getState();
          r.operations.phase = 'airborne'; r.operations.profile = null; r.operations.warp(r.flight); s.setHangarOpen(false); s.setPhase('flying');
          const f = r.flight, step = f.step.bind(f);
          f.step = (dt, c) => { const h = window.__lookHold; step(dt, { ...c, turn: 0, pitch: 0, boost: false }); if (h) { f.pos.x = h.x; f.pos.y = h.y; f.pos.z = h.z; f.heading = h.heading; f.bank = 0; f.pitch = 0.02; f.agl = f.pos.y - f.groundElev; } };
        });
        for (const name of poseNames) {
          const pose = POSES[name];
          await p.evaluate(({ pose, sun }) => {
            const r = window.__fly; window.__lookHold = null; window.__flySunOverride = sun;
            r.warpToGeo(pose.lat, pose.lon, { altM: pose.altM, headingRad: pose.headingDeg * Math.PI / 180, name: null }); r.autopilot?.disengage?.();
            const f = r.flight; window.__lookHold = { x: f.pos.x, y: f.pos.y, z: f.pos.z, heading: pose.headingDeg * Math.PI / 180 };
          }, { pose, sun: noonOf(pose) });
          await p.waitForTimeout(4000);
          const settled = await p.waitForFunction(() => {
            const r = window.__fly; if (!r || r.worldLoading || !r.terraStats?.sharp) return false;
            for (const k of ['satBuildings', 'satSkyline']) { const s = r[k]?.stats; if (s && ['queued', 'building', 'sampling', 'draping', 'births', 'dying'].some((f) => Number(s[f] || 0) !== 0)) return false; }
            return true;
          }, undefined, { timeout: 180000, polling: 1000 }).then(() => true, () => false);
          await p.waitForTimeout(3000);
          report.poses[name] = await p.evaluate(() => {
            const r = window.__fly;
            const dump = (eng) => {
              const o = {};
              if (!eng?.chunks) return o;
              for (const [key, c] of eng.chunks) {
                let idx = 0;
                const seen = new Set();
                for (const m of [c.mesh, c.group, c.object, c.twin].filter(Boolean)) m.traverse?.((n) => { if (n.geometry?.index && !seen.has(n.geometry)) { seen.add(n.geometry); idx += n.geometry.index.count; } });
                o[key] = { state: c.state, reason: c.reason ?? null, idx };
              }
              return o;
            };
            return { buildings: dump(r.satBuildings), skyline: dump(r.satSkyline) };
          });
          report.poses[name].settled = settled;
          const b = report.poses[name].buildings, s = report.poses[name].skyline;
          const n = (o) => Object.values(o).filter((c) => c.state === 'empty').length;
          console.log(arm, name, 'settled', settled, 'buildings', Object.keys(b).length, 'empty', n(b), '| skyline', Object.keys(s).length, 'empty', n(s));
        }
      } finally { await browser.close(); }
      fs.writeFileSync(path.join(out, `tiles-${arm}.json`), JSON.stringify(report, null, 1));
    });
  }
})().catch((e) => { console.error(e); process.exit(1); });
