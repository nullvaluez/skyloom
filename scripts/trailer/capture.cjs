#!/usr/bin/env node
/**
 * Trailer capture driver — deterministic, in-engine, 1920x1080.
 *
 *   node scripts/trailer/capture.cjs <shot.cjs> [--preview=N] [--out=DIR] [--from=i] [--to=j]
 *
 * A shot module exports (see scripts/trailer/shots/*.cjs):
 *   id, fps(30), frames, runIn(45), clock (epoch ms the fake clock starts at),
 *   sunUtc (epoch ms for __flySunOverride), weather, aircraft, quality,
 *   start {lat, lon, altM, headingDeg}, settle {maxSec, needBuildings},
 *   traffic(fakeNowSec) -> adsb 'ac' array (optional), inspect {hex: {info, route, photo}},
 *   page: function run in the page after TR is installed; must set window.__shot.
 *
 * Time: Playwright's fake clock (performance.now/Date/rAF/timers) is installed
 * before navigation, runs naturally while the world streams, then is PAUSED
 * and advanced one integer-ms step per frame with fastForward — exactly one
 * r3f frame per step (control report §2.4/2.5). The frame is copied to a 2D
 * canvas inside the same rAF task (priority 101, after the composer).
 */
const fs = require('fs');
const path = require('path');
const { launch } = require('./launch.cjs');

const REPO = path.resolve(__dirname, '../..');
const args = Object.fromEntries(process.argv.slice(3).map((a) => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? '1'] : [a, '1']; }));
const shotFile = path.resolve(process.argv[2]);
const shot = require(shotFile);
// Draft-time overrides (read at start; lets a running queue pick up changes):
// { "streamSecMax": n, "runInMax": n, "quality": "high", "settleVP": "480x270" }
try {
  const ov = JSON.parse(fs.readFileSync(process.env.TRAILER_OVERRIDES || '/tmp/claude-0/shots/overrides.json', 'utf8'));
  if (ov.streamSecMax && shot.settle) shot.settle = { ...shot.settle, streamSec: Math.min(shot.settle.streamSec || 120, ov.streamSecMax) };
  if (ov.runInMax != null && (shot.runIn ?? 45) > ov.runInMax) shot.runIn = ov.runInMax;
  if (ov.quality) shot.quality = ov.quality;
  if (ov.settleVP) process.env.TRAILER_SETTLE_VP = ov.settleVP;
  // final pass: capture only the frames the edit uses ({ "frames": { "<id>": n } })
  if (ov.frames && ov.frames[shot.id]) shot.frames = Math.min(shot.frames, ov.frames[shot.id]);
} catch {}
const FPS = shot.fps || 30;
const OUT = args.out || path.join(process.env.TRAILER_SHOTS || '/tmp/claude-0/shots', shot.id + (args.preview ? '-preview' : ''));
const PREVIEW = args.preview ? Number(args.preview) : 0; // grab every Nth frame only
const APP = process.env.TRAILER_APP || 'http://localhost:3100';
const WORLD = process.env.TRAILER_WORLD_URL || 'http://127.0.0.1:3301';
const SYNTH = process.env.TRAILER_WORLD === 'fixture';
fs.mkdirSync(OUT, { recursive: true });
if (!args.from && !args.keep) for (const f of fs.readdirSync(OUT)) if (/\.(jpg|png)$/.test(f) || f === 'DONE') fs.unlinkSync(path.join(OUT, f));
const LOG = path.join(OUT, 'capture.log');
if (fs.existsSync(LOG)) fs.renameSync(LOG, LOG + '.prev');
fs.writeFileSync(LOG, '');
const t00 = Date.now();
const log = (...a) => { const s = `[${((Date.now() - t00) / 1000).toFixed(1)}s] ` + a.join(' '); fs.appendFileSync(LOG, s + '\n'); if (!process.env.QUIET) console.log(s); };
const withTO = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout: ' + what)), ms))]);

(async () => {
  // ---- world fixture routing
  process.env.FLY_TILE_FIXTURE = '1';
  if (!SYNTH) process.env.FLY_FIXTURE_URL = WORLD;
  const { attachFixture, fixturePin } = require(path.join(REPO, 'scripts/_fixture.js'));

  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => log('[pageerror]', String(e).slice(0, 400)));
  page.on('console', (m) => { if (m.type() === 'error') log('[console.error]', m.text().slice(0, 300)); });
  page.on('crash', () => { log('[CRASH] page crashed — exiting for retry'); setTimeout(() => process.exit(3), 500); });

  const fx = await attachFixture(page);
  const base = fx.url;
  const pin = SYNTH ? fixturePin(base, 15) : {
    dem: { url: `${base}/dem/{z}/{x}/{y}.png`, minLevel: 0, maxLevel: shot.maxLevel || 16, attribution: 'trailer' },
    img: { url: `${base}/img/{z}/{y}/{x}`, minLevel: 0, maxLevel: shot.maxLevel || 16, attribution: 'trailer' },
  };

  // ---- fake clock
  const clockStart = shot.clock || Date.UTC(2026, 6, 18, 16, 0, 0);
  // The fake clock is installed LATE (after the world has streamed in real
  // time): measured here, a clock installed before navigation slows the boot
  // to a crawl (reveal never reached in 5 min vs ~90 s in real time).
  let paused = false, fakeNowMs = 0;
  const fakeNow = () => (paused ? fakeNowMs : Date.now());

  // ---- pins (control report §7.5) — deliberately NOT bootFly's legacy pins
  await page.addInitScript(({ pin, sun, weather, quality, aircraft, extra, budgetK }) => {
    window.__flyTileFixture = pin;
    window.__flyFinalizeBudgetK = budgetK;
    window.__flyTitleBypass = true;
    window.__flyVisualsOverride = 'enhanced';
    window.__flyGovPin = 'hold';
    window.__flyWeatherOverride = weather;
    if (sun) window.__flySunOverride = sun;
    try {
      localStorage.setItem('fly-controls-seen', '1');
      localStorage.setItem('fly-map-style-2', 'satellite');
      localStorage.setItem('fly-quality-tier', quality);
      localStorage.setItem('fly-visuals', 'enhanced');
      localStorage.setItem('fly-sound-on', '0');
      localStorage.setItem('fly-crash-mode', 'forgiving');
      localStorage.setItem('fly-reduced-motion', '0');
      localStorage.setItem('fly-aircraft', aircraft);
    } catch {}
    if (extra) { try { (0, eval)(extra); } catch (e) { console.error('extra init failed', e); } }
  }, {
    budgetK: Number(process.env.TRAILER_BUDGETK || 200),
    pin, sun: shot.sunUtc || 0, weather: shot.weather ?? 'baseline', quality: shot.quality || 'ultra',
    aircraft: shot.aircraft || 'fighter', extra: shot.initScript ? `(${shot.initScript})()` : null,
  });

  // ---- scripted traffic + inspect data (fake-clock coherent)
  const envelope = (ac) => ({ now: fakeNow() / 1000, messages: 1e6, total: ac.length, ctime: fakeNow(), ptime: 1, msg: 'No error', ac });
  await ctx.route(/\/api\/aircraft\?/, async (route) => {
    const ac = shot.traffic ? shot.traffic(fakeNow() / 1000, { paused }) : [];
    await route.fulfill({ status: 200, headers: { 'content-type': 'application/json', 'x-adsb-source': 'adsb.lol', 'access-control-allow-origin': '*' }, body: JSON.stringify(envelope(ac)) });
  });
  await ctx.route(/\/api\/aircraft\/([0-9a-f]+)\/(info|photo|route)/i, async (route) => {
    const m = route.request().url().match(/\/api\/aircraft\/([0-9a-f]+)\/(info|photo|route)/i);
    const hex = m[1].toLowerCase(), kind = m[2];
    const d = shot.inspect && shot.inspect[hex] && shot.inspect[hex][kind];
    const fallback = kind === 'photo' ? { photos: [] } : kind === 'route' ? null : { found: false };
    await route.fulfill({ status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify(d ?? fallback) });
  });
  await ctx.route(/\/api\/weather/, (route) => route.fulfill({ status: 200, headers: { 'content-type': 'application/json' }, body: '{"found":false}' }));

  // ---- boot
  log('goto', APP, 'world', SYNTH ? 'synthetic-fixture' : base);
  await page.goto(`${APP}/?graphicsReview=1`, { waitUntil: 'domcontentloaded', timeout: 180000 });
  const { enterFlight } = require(path.join(REPO, 'scripts/_skip-menus.js'));
  const s0 = shot.start;
  await enterFlight(page, { lat: s0.lat, lon: s0.lon, altM: s0.altM, headingDeg: s0.headingDeg ?? 0, headingRad: (s0.headingDeg ?? 0) * Math.PI / 180, name: null }, { timeoutMs: 300000 });
  log('entered flight');
  // TURBO (measured diagnosis, 2026-09-30): at ~1 fps the terrain quadtree
  // refines at most ~2 tiles per rendered frame (TILES.maxThreads 10, one walk
  // per render), so camTileZ sat at 4-7 against a target of 16 and every
  // building chunk looped in 'draping' (the drape refuses ground from tiles
  // below z10/z12). Raise loader concurrency, walk the tree between frames on
  // a real-time interval (native timer: keeps running during the fake-clock
  // capture, refining as loads land), and accept coarse drapes after 3 tries.
  if (process.env.TRAILER_TURBO !== '0') {
    await page.evaluate(() => {
      const tick = () => {
        try {
          const rt = window.__fly, e = rt && rt.engine;
          if (!e || !e.map) return;
          if (e.map.maxThreads < 48) { e.map.maxThreads = 48; e._steadyThreads = 48; }
          if (rt.satBuildings) rt.satBuildings._warpCoarseUntil = 1e9;
          const cam = rt.camera;
          if (!cam || window.__trNoWalk) return;
          e.map.updateMatrixWorld(true); cam.updateMatrixWorld(); e.map.update(cam);
        } catch (err) { window.__trTurboErr = String(err); }
      };
      window.__trTurbo = setInterval(tick, 150);
    });
    log('turbo on (threads 48, inter-frame walks, coarse drape)');
  }
  // Stream at a small viewport: world streaming is paced per rendered frame and
  // frame cost is fill-bound, so a quarter-size canvas settles ~4x faster.
  const SV = (process.env.TRAILER_SETTLE_VP || '960x540').split('x').map(Number);
  if (SV[0] && SV[0] !== 1920) await page.setViewportSize({ width: SV[0], height: SV[1] });

  // ---- settle: reveal (boot + warp holds), then let terrain/buildings/roads finish streaming
  const maxSettle = (shot.settle && shot.settle.maxSec) || 420;
  const minSettle = (shot.settle && shot.settle.minSec) || 20;
  const helpAfter = (shot.settle && shot.settle.helpSec) || 50;
  const tS = Date.now();
  let lastLine = '', revealedAt = null, clicks = 0;
  while (true) {
    await new Promise((r) => setTimeout(r, 3000));
    const el = (Date.now() - tS) / 1000;
    const st = await withTO(page.evaluate((clickHelp) => {
      const rt = window.__fly || {}, b = window.__flyBoot || {}, ws = window.__flyWorldStatus || {};
      const q = (o) => o ? (o.queued || 0) + (o.building || 0) + (o.sampling || 0) + (o.draping || 0) : -1;
      const btns = [...document.querySelectorAll('button')].filter((x) => /Continue with reduced|Reduced detail/.test(x.textContent));
      let clicked = 0;
      if (clickHelp) for (const x of btns) { x.click(); clicked++; }
      const ts = rt.terraStats || {};
      return {
        pct: b.pct, ready: !!ws.ready, missing: ws.missing, loading: !!rt.worldLoading, btns: btns.length, clicked,
        sharp: !!ts.sharp, camZ: ts.camTileZ, tZ: ts.targetZ, dl: ts.downloading,
        bq: q(rt.satBuildings && rt.satBuildings.stats), rq: q(rt.satRoads && rt.satRoads.stats), frames: rt.framesRendered,
        sq: q(rt.satSkyline && rt.satSkyline.stats), thr: rt.engine && rt.engine.map ? rt.engine.map.maxThreads : null, terr: window.__trTurboErr || undefined,
      };
    }, el > helpAfter), 120000, 'settle poll').catch((e) => ({ err: String(e) }));
    clicks += st.clicked || 0;
    const line = JSON.stringify({ ...st, clicked: undefined });
    if (line !== lastLine) { log('settle', line); lastLine = line; }
    const revealed = st.pct === 100 && !st.loading;
    if (revealed && revealedAt == null) { revealedAt = el; log('revealed at', el.toFixed(0) + 's', 'help clicks', clicks); }
    // the far skyline ring (5-9 km block masses) is its own engine: without it the
    // final nyc-traffic-sky started with no Lower Manhattan and dissolved it in at f156
    const streamed = st.sharp && st.bq === 0 && st.rq === 0 && !(st.sq > 0);
    if (revealed && el >= minSettle && (streamed || el - revealedAt > ((shot.settle && shot.settle.streamSec) || 120))) break;
    if (el > maxSettle) {
      log('settle timeout — forcing worldLoading=false');
      await page.evaluate(() => { if (window.__fly) window.__fly.worldLoading = false; });
      break;
    }
  }
  // ---- to capture resolution; let targets/composer resize in real time
  const CV = (args.res || process.env.TRAILER_VP || '1920x1080').split('x').map(Number);
  if (SV[0] && SV[0] !== CV[0]) {
    await page.setViewportSize({ width: CV[0], height: CV[1] });
    const f0 = await page.evaluate(() => window.__fly.framesRendered);
    await page.waitForFunction((f0) => window.__fly.framesRendered >= f0 + 4, f0, { timeout: 480000, polling: 500 }); // 120 s timed out at 1080p with four browsers busy
    log('resized to', CV.join('x'));
  }
  // ---- optional pre-rig probe (diagnostics): runs in real time before any override
  if (shot.beforeRig) {
    await page.evaluate(shot.beforeRig);
    await new Promise((r) => setTimeout(r, 4000));
    log('pre-rig probe', await page.evaluate(() => JSON.stringify(window.__nanscan || null)));
  }
  // ---- install rig
  await page.addScriptTag({ path: path.join(__dirname, 'page-lib.js') });
  if (shot.page) await page.addScriptTag({ content: `(${shot.page.toString()})(${JSON.stringify(shot.pageArgs || {})});` });
  const ok = await page.evaluate(() => !!(window.TR && window.__shot));
  if (!ok) throw new Error('rig install failed (TR or __shot missing)');
  // DOM overlay capture (UI beats): the GL frame is grabbed by readPixels as
  // usual; the DOM is screenshotted separately with the GL canvas hidden and a
  // transparent page, and composited in post (NNNNN.dom.png, RGBA).
  if (shot.dom) {
    await page.evaluate((extraCss) => {
      window.TR.r3f.getState().gl.domElement.dataset.trailerGl = '1';
      const st = document.createElement('style'); st.id = 'trailer-dom-style'; st.disabled = true;
      st.textContent = 'html,body,[data-fly-root]{background:transparent!important} canvas[data-trailer-gl]{visibility:hidden!important}';
      document.head.appendChild(st);
      const hide = document.createElement('style'); hide.id = 'trailer-dom-hide'; hide.textContent = extraCss || ''; document.head.appendChild(hide);
    }, shot.domCss || '');
  }

  // ---- install the fake clock on the live page, pause it, keep performance.now continuous
  // ORDER MATTERS (measured): the fake clock restarts performance.now() at 0,
  // so any r3f frame that runs between install and the continuity patch sees a
  // ~-minutes delta, integrates the sim backwards and poisons state with NaN
  // (every later frame black). Stop r3f's own loop FIRST, then install+patch.
  await page.evaluate(() => window.TR.armNever());
  const pre = await page.evaluate(() => ({ perf: performance.now(), date: Date.now() }));
  await page.clock.install({ time: pre.date });
  const cont = await page.evaluate((prePerf) => {
    window.__pwClock.controller.pauseAt(Date.now() + 1);
    const P = window.performance, fakeNow = P.now.bind(P);
    const off = prePerf - fakeNow();
    P.now = () => fakeNow() + off;
    return { off, now: P.now(), date: Date.now(), el: window.TR.el };
  }, pre.perf);
  log('clock installed+paused', JSON.stringify(cont));
  const LOOP = shot.stepMode === 'loop';
  if (LOOP) {
    await page.evaluate(() => window.TR.toLoop());
    // the r3f loop re-schedules itself on the (fake) rAF; nudge until one frame lands
    let n = 0;
    for (let k = 0; k < 20 && !n; k++) { n = (await page.evaluate(() => window.TR.stepLoop(16))).n; if (!n) await new Promise((r) => setTimeout(r, 300)); }
    log('loop mode armed, frame landed:', n);
    // GUARD (final pass: the 1080p atlas-ui take came back with a black world
    // behind the DOM): grab one GL frame through the priority-101 subscriber
    // and abort for a retry if the canvas is blank or the context is gone.
    const g = await page.evaluate(async () => {
      const TR = window.TR, gl = TR.r3f.getState().gl.getContext();
      TR.cap.want = true; TR.cap.got = false;
      for (let k = 0; k < 10 && !TR.cap.got; k++) await TR.stepLoop(34);
      return { got: TR.cap.got, mean: TR.cap.mean, lost: gl.isContextLost() };
    });
    log('loop GL check', JSON.stringify(g));
    if (g.lost || (g.got && g.mean < 1.5 && !shot.allowDark)) throw new Error('loop mode: GL canvas blank/lost before recording — aborting take for retry');
  }
  paused = true; fakeNowMs = cont.date;
  const runIn = shot.runIn ?? 45;
  await page.evaluate(({ runIn, fps }) => { window.TR.t0 = performance.now() + (runIn * 1000) / fps; }, { runIn, fps: FPS });
  if (shot.afterPause) await page.evaluate(shot.afterPause);

  const STRIDE = Number(args.stride || 1); // preview: advance STRIDE frames of time per render
  const total = runIn + shot.frames;
  const from = Number(args.from || 0), to = Number(args.to || shot.frames);
  const times = [];
  let written = 0;
  for (let j = 0; j < total; j += (j < runIn ? 1 : STRIDE)) {
    const i = j - runIn; // recorded frame index (negative = run-in)
    const jn = j < runIn ? j + 1 : j + STRIDE;
    const ms = Math.round((jn * 1000) / FPS) - Math.round((j * 1000) / FPS);
    const want = i >= from && i < to && (!PREVIEW || i % PREVIEW === 0);
    // run-in frames before the window and skipped preview frames are still rendered (sim continuity)
    const t1 = Date.now();
    // an action scheduled before a (draft-shortened) run-in fires on the first step
    if (shot.actions) for (const a of shot.actions) if (a.at === i || (j === 0 && a.at < i)) { log('action at', i, a.name || '', a.at !== i ? `(scheduled ${a.at})` : ''); await a.run(page, log); }
    let r;
    if (LOOP) {
      r = await withTO(page.evaluate((ms) => window.TR.stepLoop(ms), ms), 600000, 'step ' + j);
      if (want) {
        await page.screenshot({ path: path.join(OUT, `${String(i).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 95, timeout: 180000 });
        written++;
      }
    } else {
      r = await withTO(page.evaluate(({ ms, want, q, dt }) => window.TR.step(ms, want, 'image/jpeg', q, dt), { ms, want, q: Number(process.env.TRAILER_JPEGQ || 0.95), dt: shot.dt != null ? shot.dt * (jn - j) : null }), 600000, 'step ' + j);
    }
    fakeNowMs += ms;
    if (r && (r.lost || r.nan)) throw new Error(`frame ${i}: ${r.lost ? 'WebGL context lost' : 'non-finite camera'} — aborting take for retry`);
    if (j === 0) await page.evaluate(() => { window.__fly.chaseRig.snap && window.__fly.chaseRig.snap(); });
    if (r.n !== 1 && j === 0) throw new Error('first step rendered ' + r.n + ' frames');
    if (j === 0 || j === 1 || j === runIn || process.env.TRAILER_DIAG) {
      const d = await page.evaluate(() => {
        const rt = window.__fly, c = rt.camera, f = rt.flight, cv = window.TR.cap.out;
        let m = -1;
        try { const dd = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; let s = 0, n = 0; for (let i = 0; i < dd.length; i += 4 * 101) { s += dd[i] + dd[i + 1] + dd[i + 2]; n++; } m = s / n / 3; } catch (e) {}
        const r3 = (v) => [v.x, v.y, v.z].map((x) => +x.toFixed(1));
        const dbg = JSON.stringify({ d: (window.TR.dbg || []).slice(0, 1).map((x) => x.dt), clk: window.TR.clk });
        const ns = window.__nanscan ? window.__nanscan.map((x) => x.name + ':' + x.invalid).join(' ') : undefined;
        return { dbg, ns, t: +window.TR.t().toFixed(3), fpos: r3(f.pos), hdg: +f.heading.toFixed(3), spd: +f.speed.toFixed(1), cam: r3(c.position), fov: c.fov, anchor: r3(rt.origin.anchor), capMean: +m.toFixed(1), loading: rt.worldLoading, phase: window.__flyStore.getState().phase,
          pn: +performance.now().toFixed(1), lh: window.TR._lettersHidden, heat: window.TR._heatOff,
          pup: (window.TR.puppets || []).slice(0, 2).map((a) => { const k = rt.traffic && rt.traffic.tracks.get(a.hex); const p = a.pose(window.TR.t()); return k ? { hex: a.hex, yaw: +(k.yaw || 0).toFixed(3), hd: +p.heading.toFixed(3), dx: +(k.rx - p.pos.x).toFixed(1), dy: +(k.ry - p.pos.y).toFixed(1), dz: +(k.rz - p.pos.z).toFixed(1), lu: k._lastUpdate != null ? +k._lastUpdate.toFixed(3) : null, dist: k.distM != null ? +k.distM.toFixed(0) : null, ld: !!k.livingDetailed } : { hex: a.hex, none: true }; }) };
      });
      log('diag j=' + j, JSON.stringify(d));
    }
    const dt = Date.now() - t1;
    times.push(dt);
    if (r.n !== 1) log(`WARN frame ${i}: rendered ${r.n} frames`);
    if (want && !LOOP) {
      if (r.miss || !r.data) { log(`MISS frame ${i}`); continue; }
      const b64 = r.data.slice(r.data.indexOf(',') + 1);
      const buf = Buffer.from(b64, 'base64');
      if (i === from && r.mean != null && r.mean < 1.5 && !shot.allowDark) throw new Error(`frame ${i} looks black (mean ${r.mean.toFixed(2)}) — aborting take for retry`);
      fs.writeFileSync(path.join(OUT, `${String(i).padStart(5, '0')}.jpg`), buf);
      if (shot.dom) {
        await page.evaluate(() => { document.getElementById('trailer-dom-style').disabled = false; });
        await page.screenshot({ path: path.join(OUT, `${String(i).padStart(5, '0')}.dom.png`), omitBackground: true, timeout: 120000 });
        await page.evaluate(() => { document.getElementById('trailer-dom-style').disabled = true; });
      }
      written++;
    }
    if (j % 30 === 0) log(`frame ${i}/${shot.frames} ${dt}ms (avg ${(times.reduce((a, b) => a + b, 0) / times.length).toFixed(0)}ms)`);
    if (i >= to - 1) break;
  }
  log('done', written, 'frames written to', OUT);
  await browser.close();
  process.exit(0);
})().catch((e) => { log('FATAL', e.stack || e); process.exit(1); });
