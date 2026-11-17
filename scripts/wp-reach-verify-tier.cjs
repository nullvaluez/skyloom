/** WORLD PASS W0 proof: the reader's latched tier test in the real page (FLY_WORLD_PASS.md, "Contracts").
 * Boots the live app once per arm and reads (a) the latched state the reader publishes at
 * window.__flyStats.worldPass and (b) the `worldPass` field of the build requests the engines actually
 * post to vector-tile.worker.js (Worker.prototype.postMessage is wrapped before boot).
 *
 *   node scripts/world-pass-tier-proof.cjs --url=http://localhost:3320 --out=<dir> [--arms=off,ultra,high,medium,phone,all,diag]
 *
 * Arms: off = Ultra, no flags; ultra / high / medium = that saved quality with ?flags=WORLD_TRUTH;
 * phone = an emulated iPhone (coarse pointer, touch) with a saved High and ?flags=WORLD_TRUTH.
 * all = Ultra with all five World Pass flags; every posted request must carry all five streams on.
 * diag = Ultra with ?flags=WORLD_PASS_DIAG: all flags off, and both engines publish stats.wpStages.
 * The ultra arm then steps the store's qualityTier to 'low' (what the frame governor writes) and checks
 * that the requests posted after the step still carry the latched answer.
 * Same three-slot GPU lock as scripts/look-pass-capture.cjs. Exit 1 on any failed expectation.
 */
const { chromium, devices } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const args = Object.fromEntries(process.argv.slice(2).map((s) => { const [k, ...v] = s.replace(/^--/, '').split('='); return [k, v.join('=') || true]; }));
const url = typeof args.url === 'string' ? args.url : 'http://localhost:3320';
const out = path.resolve(typeof args.out === 'string' ? args.out : '.graphics-review/world-pass/w0/tier-proof');
fs.mkdirSync(out, { recursive: true });
const ARMS = {
  off: { quality: 'ultra', flags: '', expect: { on: false, key: 'wp1-0' } },
  ultra: { quality: 'ultra', flags: 'WORLD_REACH', expect: { on: true, tier: 'ultra' }, governorStep: true },
  high: { quality: 'high', flags: 'WORLD_REACH', expect: { on: true, tier: 'high' } },
  medium: { quality: 'medium', flags: 'WORLD_REACH', expect: { on: false, key: 'wp1-0' } },
  phone: { quality: 'high', flags: 'WORLD_REACH', device: 'iPhone 13', expect: { on: false, key: 'wp1-0' } },
  // W0-C: every stream on at Ultra; every posted request must carry all five on.
  all: { quality: 'ultra', flags: 'WORLD_TRUTH,WORLD_ARRIVAL,WORLD_REACH,WORLD_LOOK,WORLD_GROUND', expect: { on: true, tier: 'ultra', all: true } },
  // W0-C: the opt-in stage counters (?flags=WORLD_PASS_DIAG): no flag on, and
  // both engines publish stats.wpStages summed over their resident tiles.
  diag: { quality: 'ultra', flags: 'WORLD_PASS_DIAG', expect: { on: false, key: 'wp1-0', stages: true } },
};
const arms = (typeof args.arms === 'string' ? args.arms.split(',') : Object.keys(ARMS)).filter((a) => ARMS[a]);
const report = { tool: 'world-pass-tier-proof', url, date: new Date().toISOString(), arms: {}, failures: [] };
const save = () => fs.writeFileSync(path.join(out, 'tier-proof.json'), JSON.stringify(report, null, 2));

let home;
try { home = path.resolve(execSync('git rev-parse --path-format=absolute --git-common-dir', { encoding: 'utf8' }).trim(), '..'); } catch { home = path.resolve(__dirname, '..'); }
const lockDir = path.join(home, '.graphics-review', 'look-pass', '.locks');
fs.mkdirSync(lockDir, { recursive: true });
let heldSlot = null;
async function acquireSlot() {
  const t0 = Date.now();
  for (;;) {
    for (let i = 0; i < 3; i++) {
      const p = path.join(lockDir, `slot-${i}`);
      try { fs.mkdirSync(p); fs.writeFileSync(path.join(p, 'owner.txt'), `wp-reach-verify-tier pid ${process.pid} ${new Date().toISOString()}`); heldSlot = p; return; }
      catch { try { if (Date.now() - fs.statSync(p).mtimeMs > 25 * 60 * 1000) fs.rmSync(p, { recursive: true, force: true }); } catch {} }
    }
    if (Date.now() - t0 > 40 * 60 * 1000) throw Error('No GPU capture slot within 40 minutes');
    await new Promise((r) => setTimeout(r, 4000));
  }
}
const releaseSlot = () => { if (heldSlot) { try { fs.rmSync(heldSlot, { recursive: true, force: true }); } catch {} heldSlot = null; } };
process.on('exit', releaseSlot);

// Runs in the page before any app script: record every worker message that carries `worldPass`.
function hookWorkers() {
  window.__wpPosted = [];
  const post = Worker.prototype.postMessage;
  const find = (v, depth = 0) => {
    if (!v || typeof v !== 'object' || depth > 6) return null;
    if (v.worldPass && typeof v.worldPass === 'object' && 'key' in v.worldPass) return v;
    for (const x of Array.isArray(v) ? v : Object.values(v)) { const r = find(x, depth + 1); if (r) return r; }
    return null;
  };
  const detailOf = (v, depth = 0) => {
    if (!v || typeof v !== 'object' || depth > 6) return null;
    if (Array.isArray(v)) { for (const x of v) { if (typeof x === 'string' && /^(sat-|earth-)/.test(x)) return x; } }
    for (const x of Array.isArray(v) ? v : Object.values(v)) { if (x && typeof x === 'object') { const r = detailOf(x, depth + 1); if (r) return r; } }
    return null;
  };
  Worker.prototype.postMessage = function (msg, ...rest) {
    try {
      const opts = find(msg);
      if (opts && window.__wpPosted.length < 4000) {
        let detail = detailOf(msg);
        if (!detail && Array.isArray(msg?.argumentList)) detail = msg.argumentList.map((a) => a?.value).find((x) => typeof x === 'string') ?? null;
        window.__wpPosted.push({ t: performance.now(), detail, tier: window.__flyStore?.getState?.().qualityTier ?? null, worldPass: JSON.parse(JSON.stringify(opts.worldPass)) });
      }
    } catch {}
    return post.call(this, msg, ...rest);
  };
}

async function runArm(browser, name) {
  const A = ARMS[name];
  const ctxOpts = A.device ? { ...devices[A.device] } : { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 };
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  const res = { quality: A.quality, flags: A.flags, device: A.device ?? 'desktop', errors: [] };
  page.on('pageerror', (e) => res.errors.push(e.message.slice(0, 300)));
  try {
    await page.addInitScript(hookWorkers);
    await page.addInitScript(({ quality }) => {
      window.__flyGovPin = 'hold'; window.__flyVisualsOverride = 'enhanced'; window.__flyTitleBypass = true; window.__flyWeatherOverride = 'baseline';
      try {
        localStorage.setItem('fly-map-style-2', 'satellite'); localStorage.setItem('fly-quality-tier', quality); localStorage.setItem('fly-controls-seen', '1');
        localStorage.setItem('fly-sound-on', '0'); localStorage.setItem('fly-visuals', 'enhanced');
        localStorage.setItem('fly-explorer-preferences-v1', JSON.stringify({ version: 1, settings: { tutorial: 'done' } }));
      } catch {}
    }, { quality: A.quality });
    await page.route('**/api/aircraft?**', (r) => r.fulfill({ json: { ac: [], now: Date.now(), total: 0, source: 'world pass proof' } }));
    await page.route('**/api/weather**', (r) => r.fulfill({ json: { found: false } }));
    await page.goto(`${url}/?graphicsReview=1${A.flags ? `&flags=${encodeURIComponent(A.flags)}` : ''}`, { waitUntil: 'domcontentloaded', timeout: 240000 });
    await page.waitForFunction(() => !!window.__flyStats?.worldPass && window.__wpPosted.length > 0, undefined, { timeout: 240000, polling: 500 });
    await page.waitForTimeout(3000);
    const snap = await page.evaluate(() => ({ state: window.__flyStats.worldPass.state, request: window.__flyStats.worldPass.request, preset: window.__flyStore?.getState?.().qualityPreset, tier: window.__flyStore?.getState?.().qualityTier, urlFlags: window.__flyUrlFlags, posted: window.__wpPosted.length, details: [...new Set(window.__wpPosted.map((p) => p.detail))], keys: [...new Set(window.__wpPosted.map((p) => p.worldPass.key))], reachOn: [...new Set(window.__wpPosted.map((p) => p.worldPass.reach.on))], allOn: [...new Set(window.__wpPosted.map((p) => ['truth', 'arrival', 'reach', 'look', 'ground'].every((k) => p.worldPass[k]?.on === true && p.worldPass.any === true)))] }));
    Object.assign(res, snap);
    await page.waitForFunction(() => (window.__satSkyline?.chunks?.size ?? 0) > 0, undefined, { timeout: 120000, polling: 1000 }).catch(() => {});
    await page.waitForTimeout(20000);
    res.sky = await page.evaluate(() => { const e = window.__satSkyline; const st = e?.stats ?? {}; return { exists: !!e, reach: e?._reach ?? null, standInMat: !!e?.material?.userData?.standIn, hasStandInStats: 'standInsResident' in st, standInsResident: st.standInsResident ?? null, chunks: e?.chunks?.size ?? null, meshNames: e ? [...new Set([...e.chunks.values()].map((c) => c.mesh?.name).filter(Boolean))] : [] }; });
    if (A.expect.on === false && (res.sky.reach || res.sky.standInMat || res.sky.hasStandInStats)) report.failures.push(name + ': stand-in path active on an off tier ' + JSON.stringify(res.sky));
    if (A.expect.on === true && name !== 'all' && !(res.sky.reach && res.sky.standInMat)) report.failures.push(name + ': stand-in path not active ' + JSON.stringify(res.sky));
    if (A.expect.stages) {
      await page.waitForFunction(() => (window.__fly?.satBuildings?.stats?.wpStages?.tiles ?? 0) > 0 && (window.__fly?.satSkyline?.stats?.wpStages?.tiles ?? 0) > 0, undefined, { timeout: 240000, polling: 1000 }).catch(() => {});
      res.stages = await page.evaluate(() => {
        const b = window.__fly?.satBuildings?.stats?.wpStages ?? null, k = window.__fly?.satSkyline?.stats?.wpStages ?? null;
        return { buildings: b, skyline: k };
      });
    }
    if (A.governorStep) {
      const n0 = await page.evaluate(() => { window.__flyStore.getState().setQualityTier('low'); return window.__wpPosted.length; });
      // Move the aircraft so the engines post fresh requests after the step.
      await page.evaluate(() => { const r = window.__fly; if (r?.warpToGeo) r.warpToGeo(40.7480, -73.9940, { altM: 300, headingRad: 0.7, name: null }); });
      await page.waitForFunction((n) => window.__wpPosted.length > n + 4, n0, { timeout: 120000, polling: 500 }).catch(() => {});
      res.afterStep = await page.evaluate((n) => { const after = window.__wpPosted.slice(n); return { tier: window.__flyStore.getState().qualityTier, posted: after.length, tiersSeen: [...new Set(after.map((p) => p.tier))], keys: [...new Set(after.map((p) => p.worldPass.key))], reachOn: [...new Set(after.map((p) => p.worldPass.reach.on))], latched: window.__flyStats.worldPass.state.key }; }, n0);
    }
  } catch (e) { res.errors.push('fatal ' + String(e.message).split('\n')[0]); }
  await ctx.close();
  // Expectations.
  const fail = (m) => report.failures.push(`${name}: ${m}`);
  const E = A.expect;
  if (!res.state) fail('no latched state');
  else {
    if (res.request?.reach?.on !== E.on) fail(`request.truth.on ${res.request?.reach?.on} != ${E.on}`);
    if (E.key && res.state.key !== E.key) fail(`key ${res.state.key} != ${E.key}`);
    if (E.tier && res.request?.tier !== E.tier) fail(`tier ${res.request?.tier} != ${E.tier}`);
    if (!(res.keys?.length === 1 && res.keys[0] === res.state.key)) fail(`posted keys ${JSON.stringify(res.keys)} != latched ${res.state.key}`);
    if (!(res.reachOn?.length === 1 && res.reachOn[0] === E.on)) fail(`posted truth.on ${JSON.stringify(res.reachOn)}`);
    if (E.stages && !(res.stages?.buildings?.ring === 'near' && res.stages.buildings.tiles > 0 && res.stages.buildings.admitted > 0 && res.stages?.skyline?.ring === 'far' && res.stages.skyline.tiles > 0)) fail(`stage counters missing: ${JSON.stringify(res.stages)?.slice(0, 300)}`);
    if (E.all && !(res.allOn?.length === 1 && res.allOn[0] === true)) fail(`posted requests do not all carry the five streams on: ${JSON.stringify(res.allOn)}`);
    if (name === 'off' && Object.entries(res.request).some(([k, v]) => v && typeof v === 'object' && Object.entries(v).some(([kk, vv]) => (kk === 'worker' ? vv !== null : vv !== false)))) fail('a field is on with no flag');
  }
  if (A.governorStep) {
    const s = res.afterStep;
    if (!s || s.posted < 1) fail('no requests posted after the governor step');
    else if (!(s.tiersSeen.includes('low') && s.keys.length === 1 && s.keys[0] === res.state?.key && s.reachOn.length === 1 && s.reachOn[0] === true)) fail(`after the step: ${JSON.stringify(s)}`);
  }
  if (res.errors.length) fail(`page errors: ${res.errors.slice(0, 3).join(' | ')}`);
  report.arms[name] = res; save();
  console.log(name, JSON.stringify({ sky: res.sky, key: res.state?.key, allowed: res.state?.allowed, preset: res.preset, mobile: res.state?.mobile, phase: res.state?.latchedPhase, posted: res.posted, details: res.details, afterStep: res.afterStep }));
}

(async () => {
  await acquireSlot();
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true, args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
  try { for (const a of arms) await runArm(browser, a); }
  catch (e) { report.failures.push('fatal ' + e.message); }
  finally { save(); await browser.close(); releaseSlot(); }
  console.log(report.failures.length ? `FAIL\n  ${report.failures.join('\n  ')}` : `PASS ${arms.length} arm(s)`);
  process.exit(report.failures.length ? 1 : 0);
})();
