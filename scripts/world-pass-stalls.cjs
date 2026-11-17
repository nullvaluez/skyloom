/** Serialized, real-GPU World Pass boot/stall measurements.
 *
 * node scripts/world-pass-stalls.cjs --url=http://localhost:3330 --mode=dev \
 *   --out=.graphics-review/world-performance/before-dev --quality=high
 * node scripts/world-pass-stalls.cjs --url=http://localhost:3331 --mode=production \
 *   --review --out=.graphics-review/world-performance/before-prod --quality=ultra
 *
 * Default matrix: nyc-low,paris-mid × on,off × fresh,warm × pages 1,2.
 * --poses=nyc-low --arms=on --phases=fresh --pages=1 narrows a diagnostic run.
 * --profile records a CPU profile in a separate run (timings are marked profiled).
 * --exceptions adds CDP exception details and non-pausing worker target logging
 * for diagnostic retakes. Window/worker ErrorEvent locations are always recorded.
 * --plain omits flight/scene/quality pins and the warp, to check the actual front door.
 * --review explicitly adds graphicsReview=1. Production requires it for the
 * fixed-pose runtime handles; --plain can measure the literal production URL.
 * navigator.webdriver defaults to false at every quality, matching the player
 * shader-diagnostic and default-tier policy. --automation explicitly sets it
 * true for a diagnostic reproduction; do not label those timings player production.
 * Plain runs use / or /?flags=<five negatives>. Fixed-pose runs also use
 * the documented scene pins and --review query for runtime telemetry.
 * HTTP, Cache API and shader caches survive page 2 and the
 * warm browser restart. A fresh phase requires a nonexistent profile directory.
 * --profile-root=<dir> can reuse the profile from an earlier warm-only run.
 * Screenshots occur after the timing window. Only one page renders at a time.
 */
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const args = Object.fromEntries(process.argv.slice(2).map((s) => {
  const [key, ...value] = s.replace(/^--/, '').split('=');
  return [key, value.length ? value.join('=') : true];
}));
const list = (key, fallback) => String(args[key] ?? fallback).split(',').filter(Boolean);
const repo = path.resolve(__dirname, '..');
const poses = JSON.parse(fs.readFileSync(path.join(__dirname, 'world-pass-poses.json'), 'utf8'));
const poseNames = list('poses', 'nyc-low,paris-mid');
const arms = list('arms', 'on,off');
const phases = list('phases', 'fresh,warm');
const pages = list('pages', '1,2').map(Number);
const seconds = Number(args.seconds ?? 90);
const quality = String(args.quality ?? 'high');
const mode = String(args.mode ?? 'dev');
if (typeof args.out !== 'string') throw Error('--out=<directory> is required');
if (mode === 'production' && !args.plain && !args.review) throw Error('Production hides runtime handles on /. Use --review for fixed-pose telemetry, or --plain for the literal front door.');
if (!['default', 'high', 'ultra'].includes(quality)) throw Error('Invalid --quality');
if (!['dev', 'production'].includes(mode)) throw Error('Invalid --mode');
if (!(seconds > 0) || !Number.isFinite(seconds)) throw Error('Invalid --seconds');
if (poseNames.some((p) => !poses[p])) throw Error('Unknown --poses name');
if (arms.some((a) => !['on', 'off'].includes(a))) throw Error('Invalid --arms');
if (phases.some((p) => !['fresh', 'warm'].includes(p))) throw Error('Invalid --phases');
if (pages.some((p) => p !== 1 && p !== 2) || !pages.length) throw Error('Invalid --pages');
if (phases.includes('fresh') && phases.includes('warm') && phases[0] !== 'fresh') throw Error('fresh must precede warm');
const baseUrl = new URL(String(args.url ?? 'http://localhost:3330'));
if (baseUrl.search || baseUrl.pathname !== '/') throw Error('--url must be the origin, without a query or path');
const out = path.resolve(args.out);
const profileRoot = path.resolve(String(args['profile-root'] ?? path.join(out, 'profiles')));
const minusAll = '-WORLD_TRUTH,-WORLD_ARRIVAL,-WORLD_REACH,-WORLD_LOOK,-WORLD_GROUND';
fs.mkdirSync(out, { recursive: true });
fs.mkdirSync(profileRoot, { recursive: true });
let gitHead = null;
try { gitHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(); } catch {}
const report = {
  tool: 'world-pass-stalls', version: 7, started: new Date().toISOString(), mode, gitHead,
  serverRef: typeof args['server-ref'] === 'string' ? args['server-ref'] : null,
  url: baseUrl.origin, quality, seconds, poses: poseNames, arms, phases, pages,
  profiled: !!args.profile, exceptions: !!args.exceptions, plain: !!args.plain, review: !!args.review, automation: !!args.automation,
  viewport: { width: 1600, height: 900 },
  venue: 'Headed installed Chrome, ANGLE D3D11, live providers, exclusive capture lock',
  pins: [...(args.plain ? [] : ['governor hold', 'Enhanced satellite', 'title bypass', 'sound off', 'tutorial done', 'fixed afternoon sun', 'baseline weather', 'arrival counters', 'fixed pose after runtime exists']),
    `navigator.webdriver=${!!args.automation} (${args.automation ? 'explicit automated diagnostics' : 'player shader and tier policy'})`],
  cache: 'Each pose/arm has an isolated persistent Chrome profile; page 2 follows page 1 after its close; warm restarts Chrome with that same profile. No request routing.',
  rows: [], failures: [],
};
const save = () => fs.writeFileSync(path.join(out, 'stalls.json'), JSON.stringify(report, null, 2));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let mainRepo = repo;
try { mainRepo = path.resolve(execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: repo, encoding: 'utf8' }).trim(), '..'); } catch {}
const lockDir = path.join(mainRepo, '.graphics-review', 'look-pass', '.locks');
const token = `world-pass-stalls ${process.pid} ${Date.now()}`;
let held = [];
function releaseLocks() {
  for (const dir of held.splice(0)) {
    try {
      if (fs.readFileSync(path.join(dir, 'owner.txt'), 'utf8') !== token) continue;
      fs.unlinkSync(path.join(dir, 'owner.txt'));
      fs.rmdirSync(dir);
    } catch {}
  }
}
async function acquireLocks() {
  fs.mkdirSync(lockDir, { recursive: true });
  const start = Date.now();
  for (;;) {
    for (let slot = 0; slot < 3; slot++) {
      const dir = path.join(lockDir, `slot-${slot}`);
      try {
        fs.mkdirSync(dir);
        held.push(dir);
        fs.writeFileSync(path.join(dir, 'owner.txt'), token);
      } catch { break; }
    }
    if (held.length === 3) return;
    releaseLocks();
    if (Date.now() - start > Number(args.lockTimeout ?? 120000)) throw Error('Exclusive GPU slots unavailable; no existing lock was removed');
    await sleep(1000);
  }
}
process.on('exit', releaseLocks);
process.on('SIGINT', () => { releaseLocks(); process.exit(130); });
process.on('SIGTERM', () => { releaseLocks(); process.exit(143); });

// Runs before page scripts. No scene traversal or pixel reads in the frame loop.
function installMonitor({ durationMs }) {
  const m = window.__worldStallMonitor = {
    longtasks: [], raf: [], worldFrames: [], samples: [], firstRafMs: null, firstWorldFrameMs: null,
    boot100Ms: null, bootOverlaySeenMs: null, bootOverlayRemovedMs: null,
    launchRemovedMs: null, warpMs: null, fullRingObservedMs: null, durationMs, visibilityChanges: [],
  };
  const at = () => +performance.now().toFixed(3);
  // Parse errors often have no Error.stack. Preserve the browser's separate
  // filename/line/column fields before page handlers or worker fallbacks run.
  // These observers never preventDefault, pause a worker, or swallow an error.
  m.windowErrors = []; m.workerErrors = []; m.workers = [];
  const errorFields = (event) => ({ atMs: at(), message: String(event.message ?? ''),
    filename: String(event.filename ?? ''), line: event.lineno ?? null, column: event.colno ?? null,
    name: event.error?.name ?? null, stack: event.error?.stack ?? null });
  window.addEventListener('error', (event) => {
    if (m.windowErrors.length >= 100) return;
    m.windowErrors.push({ ...errorFields(event), resource: event.target?.src ?? event.target?.href ?? null });
  }, true);
  // Keep only small JavaScript Blob references until their URL is revoked.
  // Reading a worker's source happens only after its error event, not at boot.
  const workerBlobs = new Map();
  const createURL = URL.createObjectURL, revokeURL = URL.revokeObjectURL;
  URL.createObjectURL = function(blob) {
    const url = createURL.call(this, blob);
    if (blob instanceof Blob && blob.size <= 524288 && /(?:java|ecma)script/i.test(blob.type)) workerBlobs.set(url, blob);
    return url;
  };
  URL.revokeObjectURL = function(url) { workerBlobs.delete(String(url)); return revokeURL.call(this, url); };
  if (typeof Worker === 'function') {
    window.Worker = new Proxy(Worker, {
      construct(target, constructorArgs, newTarget) {
        const url = String(constructorArgs[0]), options = constructorArgs[1];
        const record = { atMs: at(), url, type: options?.type ?? 'classic', name: options?.name ?? '', index: m.workers.length };
        if (m.workers.length < 100) m.workers.push(record);
        let worker;
        try { worker = Reflect.construct(target, constructorArgs, newTarget); }
        catch (error) {
          if (m.workerErrors.length < 100) m.workerErrors.push({ ...record, stage: 'constructor', message: error.message, stack: error.stack });
          throw error;
        }
        const blob = workerBlobs.get(url);
        worker.addEventListener('error', (event) => {
          if (m.workerErrors.length >= 100) return;
          const failure = { ...errorFields(event), worker: record, stage: 'worker', blobBytes: blob?.size ?? null };
          m.workerErrors.push(failure);
          if (blob) blob.text().then((source) => {
            failure.blobSource = source.slice(0, 131072);
            failure.blobSourceTruncated = source.length > 131072;
          }, () => {});
        });
        return worker;
      },
    });
  }
  // A driver's first context may block without producing a Long Tasks API
  // entry. Measure the browser call itself on every new canvas, including
  // the benchmark and hangar. Each context is recorded once and never polled.
  m.contexts = [];
  const seenContexts = new WeakSet();
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function(type, ...options) {
    if (type !== 'webgl' && type !== 'webgl2' && type !== 'experimental-webgl') return getContext.call(this, type, ...options);
    const startMs = at();
    const gl = getContext.call(this, type, ...options);
    if (gl && !seenContexts.has(gl)) {
      seenContexts.add(gl);
      m.contexts.push({ type, startMs, durationMs: +(at() - startMs).toFixed(2),
        connected: this.isConnected, hangar: !!this.closest('[data-testid="hangar"]'),
        width: this.width, height: this.height, powerPreference: options[0]?.powerPreference });
    }
    return gl;
  };
  const visibility = () => m.visibilityChanges.push({ atMs: at(), state: document.visibilityState });
  visibility(); document.addEventListener('visibilitychange', visibility);
  // The literal production page intentionally has no runtime handles. Capture
  // its first default-framebuffer draw without adding a graphicsReview query.
  // Wrappers retire immediately after that draw and never time the steady state.
  const originals = [];
  const restoreDraws = () => { for (const [proto, name, original] of originals.splice(0)) proto[name] = original; };
  for (const type of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
    if (!type) continue;
    for (const name of ['drawArrays', 'drawElements']) {
      const proto = type.prototype, original = proto[name];
      originals.push([proto, name, original]);
      proto[name] = function(...args) {
        const result = original.apply(this, args);
        if (this.canvas?.isConnected && this.canvas.width >= 300 && this.canvas.height >= 200 && this.getParameter(this.FRAMEBUFFER_BINDING) === null) {
          m.firstAnyCanvasDrawMs ??= at();
          // The title-bypass path can briefly mount the hangar before the
          // fixed-pose warp. Its separate WebGL canvas is not a world frame.
          if (!this.canvas.closest('[data-fly-root]') || this.canvas.closest('[data-overlay="hangar"],[data-testid="hangar"]')) return result;
          m.firstPresentedDrawMs = at();
          window.__worldStallGL = this;
          restoreDraws();
        }
        return result;
      };
    }
  }
  const inWindow = (start) => start < durationMs;
  const observer = new PerformanceObserver((entries) => {
    for (const e of entries.getEntries()) if (e.duration > 200 && inWindow(e.startTime)) {
      m.longtasks.push({ startMs: +e.startTime.toFixed(3), durationMs: +e.duration.toFixed(3), name: e.name });
    }
  });
  observer.observe({ type: 'longtask', buffered: true });
  let launchSeen = false;
  const watchOverlay = () => {
    const boot = document.querySelector('[data-testid="boot-screen"]');
    const launch = document.querySelector('[data-testid="launch-screen"]');
    if (boot && m.bootOverlaySeenMs == null) m.bootOverlaySeenMs = at();
    if (!boot && m.bootOverlaySeenMs != null && m.bootOverlayRemovedMs == null) m.bootOverlayRemovedMs = at();
    if (launch) launchSeen = true;
    if (!launch && launchSeen && m.launchRemovedMs == null) m.launchRemovedMs = at();
  };
  new MutationObserver(watchOverlay).observe(document, { childList: true, subtree: true });
  let last = null, lastWorldFrame = null, lastWorldAt = null;
  const warmState = (s) => s ? Object.fromEntries(Object.entries(s).filter(([, v]) => typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string' || v == null)) : null;
  const readiness = () => {
    const r = window.__fly;
    return { terrain: warmState(r?.criticalTerrain), clouds: warmState(r?.cloudWarm),
      atmosphere: warmState(r?.physSky?.programWarm), environment: warmState(r?.cinemaIBL?.programWarm), composer: warmState(window.__flyStats?.composerWarm), gpuInfo: warmState(window.__flyStats?.gpuInfoProbe),
      worldProfiles: warmState(r?.prewarm?.worldProfiles), prewarm: warmState(r?.prewarm), arrival: warmState(r?.arrivalStats) };
  };
  const tick = (t) => {
    if (m.firstRafMs == null) m.firstRafMs = t;
    // Include a gap which begins in the window even if its end is beyond it.
    if (last != null && inWindow(last)) m.raf.push({ startMs: +last.toFixed(3), durationMs: +(t - last).toFixed(3) });
    last = t;
    if (m.boot100Ms == null && window.__flyBoot?.pct === 100) { m.boot100Ms = t; m.readinessAtBoot100 = readiness(); }
    const frame = window.__fly?.framesRendered ?? window.__flyComposer?.getRenderer?.()?.__flyMainDraw?.frames;
    if (m.firstWorldFrameMs == null && frame > 0) m.firstWorldFrameMs = t;
    if (frame > 0 && frame !== lastWorldFrame) {
      if (lastWorldAt != null && inWindow(lastWorldAt)) m.worldFrames.push({ startMs: +lastWorldAt.toFixed(3), durationMs: +(t - lastWorldAt).toFixed(3), count: frame - lastWorldFrame });
      lastWorldFrame = frame; lastWorldAt = t;
    }
    if (t <= durationMs + 1000) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  const numeric = (stats) => stats ? Object.fromEntries(Object.entries(stats).filter(([, value]) => typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string')) : null;
  const sample = () => {
    const r = window.__fly, state = window.__flyStore?.getState?.();
    const t = at();
    const veg = r?.satVeg;
    const pendingKeys = new Set(veg?.pendingSample?.map((p) => p.key) ?? []);
    const orphanSamplingKeys = [];
    for (const chunk of veg?.chunks?.values?.() ?? []) if (chunk.state === 'sampling' && !pendingKeys.has(chunk.key)) orphanSamplingKeys.push(chunk.key);
    if (m.warpMs != null && m.fullRingObservedMs == null && r?.satBuildings?.stats?.fullRingSec >= 0) m.fullRingObservedMs = t;
    if (t <= durationMs) m.samples.push({ atMs: t, visibility: document.visibilityState, focused: document.hasFocus(), boot: window.__flyBoot ?? null, framesRendered: r?.framesRendered ?? null,
      preset: state?.qualityPreset ?? null, tier: state?.qualityTier ?? null,
      buildings: numeric(r?.satBuildings?.stats), skyline: numeric(r?.satSkyline?.stats), veg: numeric(r?.satVeg?.stats),
      vegJobs: { parked: veg?._parked ?? null, pendingSample: veg?.pendingSample?.length ?? null, orphanSamplingKeys },
      readiness: readiness(),
      worldLoading: r?.worldLoading ?? null, sharp: r?.terraStats?.sharp ?? null });
    if (t <= durationMs) setTimeout(sample, 1000);
  };
  setTimeout(sample, 0);
}

function installPins({ quality, sun, automation }) {
  Object.defineProperty(navigator, 'webdriver', { configurable: true, get: () => automation });
  window.__flyGovPin = 'hold';
  window.__flyVisualsOverride = 'enhanced';
  window.__flyTitleBypass = true;
  window.__flySunOverride = sun;
  window.__flyWeatherOverride = 'baseline';
  window.__flyWorldPassCounters = true;
  try {
    localStorage.setItem('fly-map-style-2', 'satellite');
    if (quality !== 'default') localStorage.setItem('fly-quality-tier', quality);
    localStorage.setItem('fly-controls-seen', '1');
    localStorage.setItem('fly-sound-on', '0');
    localStorage.setItem('fly-visuals', 'enhanced');
    localStorage.setItem('fly-explorer-preferences-v1', JSON.stringify({ version: 1, settings: { tutorial: 'done' } }));
  } catch {}
}

function holdPose(pose) {
  const r = window.__fly, store = window.__flyStore.getState();
  r.operations.phase = 'airborne'; r.operations.profile = null; r.operations.warp(r.flight);
  store.setHangarOpen(false); store.setPhase('flying');
  const flight = r.flight, step = flight.step.bind(flight);
  flight.step = (dt, controls) => {
    step(dt, { ...controls, turn: 0, pitch: 0, boost: false });
    const h = window.__worldStallHold;
    if (h) { flight.pos.set(h.x, h.y, h.z); flight.heading = h.heading; flight.bank = 0; flight.pitch = 0.02; flight.agl = flight.pos.y - flight.groundElev; }
  };
  r.warpToGeo(pose.lat, pose.lon, { altM: pose.altM, headingRad: pose.headingDeg * Math.PI / 180, name: null });
  r.autopilot?.disengage?.();
  window.__worldStallHold = { x: flight.pos.x, y: flight.pos.y, z: flight.pos.z, heading: pose.headingDeg * Math.PI / 180 };
  r.chaseCam?.snap?.();
  window.__worldStallMonitor.warpMs = performance.now();
}

function readEnd() {
  const r = window.__fly, state = window.__flyStore?.getState?.();
  let renderer = window.__flyComposer?.getRenderer?.() ?? null;
  if (!renderer && r?.engine?.object) { let scene = r.engine.object; while (scene.parent) scene = scene.parent; renderer = scene.__r3f?.root?.getState()?.gl; }
  const gl = renderer?.getContext() ?? window.__worldStallGL;
  const ext = gl?.getExtension('WEBGL_debug_renderer_info');
  const gpu = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null;
  const numeric = (stats) => stats ? Object.fromEntries(Object.entries(stats).filter(([, value]) => typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string')) : null;
  const warmKeys = new Set(window.__flyStats?.composerWarm?.programKeys ?? []);
  const hash = value => { let h = 0x811c9dc5; for (const c of String(value ?? '')) { h ^= c.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0'); };
  return {
    monitor: window.__worldStallMonitor, endPerfMs: performance.now(), gpu,
    // Browser navigation/transfer timestamps remain available after the run.
    // They distinguish waiting for HTML or a script from a visible renderer
    // that stopped scheduling callbacks after the document already arrived.
    timeOrigin: performance.timeOrigin,
    navigation: performance.getEntriesByType('navigation')[0]?.toJSON() ?? null,
    bootScripts: performance.getEntriesByType('resource')
      .filter(entry => entry.name.startsWith(location.origin + '/_next/') && /\.js(?:\?|$)/.test(entry.name))
      .map(entry => ({ path: new URL(entry.name).pathname, startMs: entry.startTime,
        responseStartMs: entry.responseStart, responseEndMs: entry.responseEnd, transferBytes: entry.transferSize })),
    boot: window.__flyBoot ?? null, worldPass: window.__flyStats?.worldPass?.state ?? null,
    preset: state?.qualityPreset ?? window.__flyStats?.worldPass?.state?.preset ?? null, tier: state?.qualityTier ?? null, flightPhase: state?.phase ?? null,
    webdriver: navigator.webdriver,
    shaderErrorsChecked: renderer?.debug?.checkShaderErrors ?? null,
    programCensus: window.__flyStats?.census?.programs ?? null,
    composerWarm: numeric(window.__flyStats?.composerWarm), gpuInfoProbe: window.__flyStats?.gpuInfoProbe ?? null,
    auxiliaryWarm: {
      environment: numeric(r?.cinemaIBL?.programWarm),
      reflection: numeric(r?.coastalReflection?.programWarm),
      overlays: numeric(window.__flyComposer?.passes?.find(p => p.name === 'SkyOverlayPass')?.programWarm),
    },
    programCoverage: renderer?.info?.programs?.map(p => ({ key: `${p.type ?? 'program'}${p.name ? ':' + p.name : ''}#${hash(p.cacheKey)}`, composerPrepared: warmKeys.has(p.cacheKey) })) ?? null,
    buildings: numeric(r?.satBuildings?.stats), skyline: numeric(r?.satSkyline?.stats), veg: numeric(r?.satVeg?.stats),
    draws: renderer?.info?.render?.calls ?? null, triangles: renderer?.info?.render?.triangles ?? null,
    programs: renderer?.info?.programs?.length ?? null,
    heapMiB: performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null,
  };
}

const median = (values) => { if (!values.length) return null; const sorted = [...values].sort((a, b) => a - b); return sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2; };
async function measure(context, page, arm, poseName, phase, pageNumber) {
  const id = `${mode}-${quality}-${arm}-${poseName}-${phase}-page${pageNumber}`;
  const row = { id, mode, quality, arm, pose: poseName, phase, page: pageNumber, profiled: !!args.profile, exceptions: !!args.exceptions, automation: !!args.automation,
    url: `${baseUrl.origin}/${args.review || arm === 'off' ? `?${[...(args.review ? ['graphicsReview=1'] : []), ...(arm === 'off' ? [`flags=${minusAll}`] : [])].join('&')}` : ''}`, errors: [], consoleErrors: [] };
  page.on('pageerror', (e) => {
    row.errors.push(e.message.slice(0, 500));
    (row.pageErrors ??= []).push({ receivedAtUnixMs: Date.now(), name: e.name, message: e.message, stack: e.stack });
  });
  page.on('worker', (worker) => {
    const entry = { url: worker.url(), createdAtUnixMs: Date.now() };
    (row.browserWorkers ??= []).push(entry);
    worker.on('close', () => { entry.closedAtUnixMs = Date.now(); });
  });
  page.on('crash', () => row.errors.push('PAGE CRASH'));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const message = m.text().slice(0, 500), counts = (row.consoleErrorCounts ??= {});
    if (counts[message]) { counts[message]++; return; }
    if (row.consoleErrors.length < 100) {
      row.consoleErrors.push(message); counts[message] = 1;
      (row.consoleErrorLocations ??= []).push({ message, ...m.location() });
    }
  });
  await page.addInitScript(installMonitor, { durationMs: seconds * 1000 });
  if (args.plain) await page.addInitScript((automation) => Object.defineProperty(navigator, 'webdriver', { configurable: true, get: () => automation }), !!args.automation);
  if (!args.plain) await page.addInitScript(installPins, { quality, automation: !!args.automation,
    sun: Date.parse('2026-09-22T00:00:00Z') + (14 - poses[poseName].lon / 15) * 3600000 });
  let cdp;
  const wallStart = Date.now();
  try {
    if (args.profile || args.exceptions) cdp = await context.newCDPSession(page);
    if (args.exceptions) {
      row.cdpExceptions = []; row.cdpWorkerTargets = []; row.cdpErrorLog = [];
      const workerTargets = new Map();
      const recordException = (details, target) => {
        if (row.cdpExceptions.length < 100) row.cdpExceptions.push({ receivedAtUnixMs: Date.now(), target, ...details });
      };
      cdp.on('Runtime.exceptionThrown', ({ exceptionDetails }) => recordException(exceptionDetails, 'page'));
      cdp.on('Log.entryAdded', ({ entry }) => { if (entry.level === 'error' && row.cdpErrorLog.length < 100) row.cdpErrorLog.push(entry); });
      cdp.on('Target.attachedToTarget', ({ sessionId, targetInfo }) => {
        if (targetInfo.type !== 'worker') return;
        workerTargets.set(sessionId, targetInfo);
        row.cdpWorkerTargets.push({ ...targetInfo, attachedAtUnixMs: Date.now() });
        cdp.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id: 1, method: 'Runtime.enable' }) })
          .catch((error) => { (row.diagnosticWarnings ??= []).push(`Worker Runtime.enable: ${error.message}`); });
      });
      cdp.on('Target.receivedMessageFromTarget', ({ sessionId, message }) => {
        try {
          const event = JSON.parse(message);
          if (event.method === 'Runtime.exceptionThrown') recordException(event.params.exceptionDetails, workerTargets.get(sessionId) ?? sessionId);
        } catch { /* An unrelated protocol message must not interrupt the capture. */ }
      });
      await cdp.send('Runtime.enable');
      await cdp.send('Log.enable');
      // This is a second, observational CDP session. Do not pause new workers
      // or modify Playwright's own attachment; ErrorEvents cover the start race.
      await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: false,
        filter: [{ type: 'worker', exclude: false }, { exclude: true }] })
        .catch((error) => { (row.diagnosticWarnings ??= []).push(`Worker target inspection unavailable: ${error.message}`); });
    }
    if (args.profile) {
      await cdp.send('Profiler.enable');
      await cdp.send('Profiler.setSamplingInterval', { interval: 1000 });
      await cdp.send('Profiler.start');
    }
    await page.goto(row.url, { waitUntil: 'commit', timeout: 180000 });
    if (!args.plain) {
      await page.waitForFunction(() => !!window.__fly?.operations && !!window.__flyStore, undefined, { timeout: 150000, polling: 100 });
      await page.evaluate(holdPose, poses[poseName]);
    }
    // Host timers do not occupy the page main thread. Each read is once per second.
    for (;;) {
      const now = await page.evaluate(() => performance.now());
      if (now >= seconds * 1000) break;
      if (Date.now() - wallStart > (seconds + 180) * 1000) throw Error('Measurement wall-clock deadline exceeded');
      await sleep(Math.min(1000, seconds * 1000 - now));
    }
    // Let the final longtask observer notification drain before collecting.
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)));
    Object.assign(row, await page.evaluate(readEnd));
    const m = row.monitor;
    row.summary = {
      firstWorldFrameMs: m.firstPresentedDrawMs ?? null,
      firstWorldFrameSource: 'first main-canvas default-framebuffer draw',
      firstPresentedDrawMs: m.firstPresentedDrawMs ?? null,
      firstAnyCanvasDrawMs: m.firstAnyCanvasDrawMs ?? null,
      boot100Ms: m.boot100Ms, bootOverlayRemovedMs: m.bootOverlayRemovedMs,
      // A visible page may wait seconds for its very first callback. There
      // is no preceding rAF interval to include that delay automatically.
      firstRafMs: m.firstRafMs,
      worstFrameGapMs: m.firstRafMs == null ? null : Math.max(m.firstRafMs, ...m.raf.map((f) => f.durationMs)),
      worstLongTaskMs: m.longtasks.length ? Math.max(...m.longtasks.map((t) => t.durationMs)) : 0,
      postRevealWorstTaskMs: m.bootOverlayRemovedMs == null ? null : Math.max(0, ...m.longtasks.filter((t) => t.startMs + t.durationMs > m.bootOverlayRemovedMs).map((t) => t.durationMs)),
      medianFrame60to90Ms: median(m.raf.filter((f) => f.startMs >= 60000 && f.startMs + f.durationMs <= 90000).map((f) => f.durationMs)),
      worstWorldFrameGapMs: m.worldFrames.length ? Math.max(...m.worldFrames.map(f => f.durationMs)) : null,
      postRevealWorstWorldFrameGapMs: m.bootOverlayRemovedMs == null || !m.worldFrames.length ? null : Math.max(0, ...m.worldFrames.filter(f => f.startMs + f.durationMs > m.bootOverlayRemovedMs).map(f => f.durationMs)),
      medianWorldFrame60to90Ms: median(m.worldFrames.filter(f => f.startMs >= 60000 && f.startMs + f.durationMs <= 90000).map(f => f.durationMs)),
      sampledFrames60to90: m.raf.filter((f) => f.startMs >= 60000 && f.startMs + f.durationMs <= 90000).length,
      fullRingObservedNavMs: m.fullRingObservedMs,
      fullRingObservedWarpMs: m.fullRingObservedMs != null && m.warpMs != null ? m.fullRingObservedMs - m.warpMs : null,
      fullRingEngineSec: row.buildings?.fullRingSec ?? null,
    };
    if (!row.gpu || /swiftshader|llvmpipe|software|basic render/i.test(row.gpu)) row.errors.push(`Not a verified hardware renderer: ${row.gpu}`);
    if (!args.plain) {
      if (quality !== 'default' && row.preset !== quality) row.errors.push(`Requested ${quality}, observed ${row.preset}`);
      const streams = ['truth', 'arrival', 'reach', 'look', 'ground'];
      const flagsMatch = streams.every(key => row.worldPass?.flags?.[key] === (arm === 'on'));
      if (!row.worldPass?.allowed || !flagsMatch) row.errors.push('World Pass latch differs from the requested desktop flag arm');
      if (seconds >= 90 && m.fullRingObservedMs == null) row.errors.push('Full building ring was never observed within 90 seconds');
      if (seconds >= 90 && row.summary.medianWorldFrame60to90Ms == null) row.errors.push('No completed world frames in the steady measurement window');
    }
    if (row.composerWarm?.status === 'failed') row.errors.push(`Composer preparation failed: ${row.composerWarm.error}`);
    for (const [name, state] of Object.entries(row.auxiliaryWarm ?? {})) if (state?.error || state?.status === 'failed') row.errors.push(`${name} preparation failed: ${state.error}`);
    if (row.programCensus?.linkFailures > 0) row.errors.push(`${row.programCensus.linkFailures} shader links failed`);
    if (row.summary.firstWorldFrameMs == null || !m.raf.length) row.errors.push('No world frame measured');
    if (seconds >= 90 && !row.summary.sampledFrames60to90) row.errors.push('No frames in the 60–90 second window');
    if (m.visibilityChanges.some(v => v.atMs < seconds * 1000 && v.state !== 'visible')) row.errors.push('Page became hidden during timing; capture is not a foreground performance verdict');
    if (seconds >= 90 && row.summary.medianFrame60to90Ms > 200) row.errors.push('Anomalous steady cadence above 200 ms; inspect visibility and repeat before attribution');
    if (m.bootOverlayRemovedMs == null) row.errors.push('Boot overlay never removed within the measurement');
  } catch (e) {
    row.errors.push(e.message);
    // A syntax error may prevent runtime handles from ever mounting. Preserve
    // its pre-script ErrorEvents even when the ordinary readEnd path was skipped.
    if (!row.monitor) {
      try { row.monitor = await page.evaluate(() => window.__worldStallMonitor ?? null); } catch {}
    }
  }
  finally {
    if (cdp) {
      if (args.profile) {
        try { const { profile } = await cdp.send('Profiler.stop'); fs.writeFileSync(path.join(out, `${id}.cpuprofile`), JSON.stringify(profile)); row.cpuProfile = `${id}.cpuprofile`; } catch (e) { row.errors.push(`Profile: ${e.message}`); }
      }
      await cdp.detach().catch(() => {});
    }
    row.wallMs = Date.now() - wallStart;
    // Saving before screenshot preserves timing evidence even if readback fails.
    fs.writeFileSync(path.join(out, `${id}.json`), JSON.stringify(row, null, 2));
    if (!args['no-shot']) {
      try { await page.screenshot({ path: path.join(out, `${id}.png`), timeout: 15000 }); row.screenshot = `${id}.png`; } catch (e) { row.screenshotError = e.message; }
    }
    await page.close().catch(() => {});
  }
  fs.writeFileSync(path.join(out, `${id}.json`), JSON.stringify(row, null, 2));
  console.log('ROW', id, JSON.stringify({ ...row.summary, errors: row.errors, gpu: row.gpu, preset: row.preset }));
  return row;
}

(async () => {
  save();
  await acquireLocks();
  console.log('EXCLUSIVE GPU LOCK', mode, quality);
  try {
    for (const poseName of poseNames) for (const arm of arms) {
      const userDataDir = path.join(profileRoot, `${mode}-${quality}-${arm}-${poseName}`);
      if (phases.includes('fresh') && fs.existsSync(userDataDir)) throw Error(`Fresh profile already exists: ${userDataDir}; choose a new output/profile directory`);
      if (!phases.includes('fresh') && !fs.existsSync(userDataDir)) throw Error(`Warm profile does not exist: ${userDataDir}`);
      for (const phase of phases) {
        const context = await chromium.launchPersistentContext(userDataDir, {
          channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: false,
          viewport: report.viewport, deviceScaleFactor: 1,
          args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--disable-background-timer-throttling',
            '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
            '--disable-features=CalculateNativeWinOcclusion', '--enable-precise-memory-info', '--window-size=1640,1000'],
        });
        try {
          // Chrome may exit when its final window/tab closes. Keep one inert
          // about:blank tab so page 2 belongs to the same browser process.
          // Only the measured page contains a scene or renders WebGL.
          const keeper = context.pages()[0] ?? await context.newPage();
          for (let pageNumber = 1; pageNumber <= Math.max(...pages); pageNumber++) {
            const page = await context.newPage();
            for (const other of context.pages()) if (other !== page && other !== keeper) await other.close();
            await page.bringToFront();
            const row = await measure(context, page, arm, poseName, phase, pageNumber);
            row.selected = pages.includes(pageNumber);
            // A requested page 2 must still execute and record its page 1 primer.
            report.rows.push(row);
            if (row.errors.length) report.failures.push({ id: row.id, errors: row.errors });
            save();
          }
        } finally { await context.close(); }
      }
    }
  } finally { report.finished = new Date().toISOString(); save(); releaseLocks(); }
  if (report.failures.length) process.exitCode = 1;
  console.log('DONE', report.rows.length, 'rows;', report.failures.length, 'invalid rows');
})().catch((e) => { report.failures.push({ fatal: e.message }); save(); releaseLocks(); console.error(e); process.exitCode = 1; });
