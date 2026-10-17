/* Focused rendered motion diagnosis. Uses real held-key walking; no eye writes.
 * Captured frames and optional forced quality transitions are diagnostic only,
 * never substituted for the normal performance/soak gate.
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const { installLoungeWebGLProbe } = require('./lounge-webgl-probe.cjs');
const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i < 0 ? fallback : process.argv[i + 1]; };
const costMode = arg('mode', '') === 'cost';
const drawMode = arg('mode', '') === 'draws';
const airport = arg('airport', 'KCMH');
const out = path.resolve(arg('out', `.graphics-review/living-observatory/motion-${Date.now()}`));
fs.mkdirSync(out, { recursive: true });
const report = { at: new Date().toISOString(), purpose: 'Motion/depth and shader diagnostics; screenshot work affects frame timing', source: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), errors: [], consoleErrors: [], routes: [], frames: [], transitions: [], sunUtc: Date.UTC(2026, 9, 17, 19, 43) };
if (arg('night', '0') === '1') report.sunUtc = Date.UTC(2026, 9, 18, 3, 0);
if (arg('utc', '') !== '') report.sunUtc = Date.UTC(2026, 9, 17, Number(arg('utc', '0')));
report.airport = airport;
const save = () => fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
(async () => {
  let browser, page, walk, space;
  const state = () => page.evaluate(() => {
    const r = window.__fly, w = r.airportWatch;
    let scene = r.engine.object; while (scene.parent) scene = scene.parent;
    const gl = scene.__r3f.root.getState().gl;
    return { at: performance.now(), eye: { ...w.eyeLocal }, floorId: w.walk.floorId, posture: w.posture, yaw: w.yaw, pitch: w.pitch, tier: window.__flyStore.getState().qualityTier, csm: r.cinemaShadows, room: r.loungeStats, roomWarm: r.loungeRoom?.programWarm, terrainWarm: r.criticalTerrain, prewarm: r.prewarm, shadowEnabled: gl.shadowMap.enabled, programs: gl.info.programs.length, frame: window.__flyStats.frame.sample() };
  });
  const mark = (value) => page.evaluate((value) => window.__loungeWebGL.mark(value), value);
  const screenshot = async (name) => { if (costMode || drawMode) return; const file = name + '.png'; await page.screenshot({ path: path.join(out, file), timeout: 120000 }); report.frames.push({ file, ...(await state()) }); save(); };
  const walkTo = async (target, name) => {
    const start = await state();
    const points = walk.findPath(space, { ...start.eye, floorId: start.floorId }, target);
    if (!points) throw new Error('No real walking route: ' + name);
    await page.getByTestId('lounge-surface').focus();
    await page.evaluate((points) => {
      const w = window.__fly.airportWatch, d = window.__motionRoute = { done: false, i: 1, points };
      const tick = () => {
        while (d.i < points.length && Math.hypot(points[d.i].x - w.eyeLocal.x, points[d.i].z - w.eyeLocal.z) < .085) d.i++;
        if (d.i === points.length) { d.done = true; w.setMoveKeys(0, 0, false); return; }
        w.yaw = Math.atan2(-(points[d.i].x - w.eyeLocal.x), -(points[d.i].z - w.eyeLocal.z)); w.pitch = -.06;
        d.raf = requestAnimationFrame(tick);
      }; tick();
    }, points);
    await mark(name);
    try { await page.keyboard.down('w'); await page.waitForFunction(() => window.__motionRoute.done, undefined, { timeout: 120000 }); }
    finally { await page.keyboard.up('w'); await page.evaluate(() => { cancelAnimationFrame(window.__motionRoute.raf); window.__fly.airportWatch.setMoveKeys(0, 0, false); }); }
    report.routes.push({ name, start, target, points, end: await state() }); save();
  };
  const movingFrames = async (name, yaw, pitch, duration) => {
    await page.evaluate(({ yaw, pitch }) => { const w = window.__fly.airportWatch; w.yaw = yaw; w.pitch = pitch; }, { yaw, pitch });
    await page.getByTestId('lounge-surface').focus();
    await mark(name); await page.waitForTimeout(500); await screenshot(name + '-00-still');
    const start = Date.now(); let n = 1;
    try {
      await page.keyboard.down('w');
      while (Date.now() - start < duration) { await page.waitForTimeout(180); await screenshot(name + '-' + String(n++).padStart(2, '0')); }
    } finally { await page.keyboard.up('w'); }
    await page.waitForTimeout(300); await screenshot(name + '-99-still');
  };
  const tiers = async () => {
    report.controlledQualityTransitions = true;
    for (const tier of ['high', 'medium', 'low', 'high']) {
      await mark('forced-tier-' + tier);
      await page.evaluate((tier) => { window.__flyGovPin = 'hold'; window.__flyStore.setState({ qualityTier: tier }); }, tier);
      await page.waitForTimeout(2000); report.transitions.push({ requested: tier, ...(await state()) });
      await screenshot('forced-tier-' + tier + '-' + report.transitions.length);
    }
  };
  const fabricPair = async (name, pitch) => {
    await page.evaluate((pitch) => { window.__fly.airportWatch.yaw = -Math.PI / 2; window.__fly.airportWatch.pitch = pitch; }, pitch);
    for (const value of [0, 1, 0]) {
      await page.evaluate((value) => {
        const r = window.__fly; let scene = r.engine.object; while (scene.parent) scene = scene.parent;
        const gl = scene.__r3f.root.getState().gl;
        let uniform; scene.traverse((object) => { if (object.name === 'lounge:fabric') uniform = gl.properties.get(object.material).uniforms?.uLoungeFabricFilter; });
        if (!uniform) throw Error('Missing live fabric A/B uniform'); uniform.value = value;
      }, value);
      await page.waitForTimeout(400);
      await screenshot(`${name}-filter${value}-${report.frames.length}`);
    }
  };
  const woodControls = async (mapped, reeds, color = 1, key = 1, smooth = 0) => {
    await page.evaluate(({ mapped, reeds, color, key, smooth }) => { const d = window.__woodDiag; d.map.value = mapped; d.reeds.value = reeds; d.color.value = color; d.key.value = key; d.smooth.value = smooth; }, { mapped, reeds, color, key, smooth });
    await page.waitForTimeout(200);
  };
  const woodPair = async (name, yaw, pitch) => {
    await page.evaluate(({ yaw, pitch }) => { const w = window.__fly.airportWatch; w.yaw = yaw; w.pitch = pitch; }, { yaw, pitch });
    for (const [mapped, reeds] of [[1, 1], [0, 1], [1, 0], [0, 0], [1, 1]]) {
      await woodControls(mapped, reeds);
      await screenshot(`${name}-map${mapped}-reeds${reeds}-${report.frames.length}`);
    }
  };
  const denseWoodMotion = async (name, mapped, reeds, color = 1) => {
    await walkTo({ x: -5.2, z: 10.7, floorId: 'upper' }, name + '-start');
    await page.evaluate(() => { const w = window.__fly.airportWatch; w.yaw = -Math.PI / 2; w.pitch = -.22; });
    if (arg('mode', '').startsWith('wood')) await woodControls(mapped, reeds, color);
    await page.getByTestId('lounge-surface').focus();
    const startState = await state();
    const session = await page.context().newCDPSession(page), frames = [];
    // Capture the composed browser surface. Canvas readback from a later RAF
    // is black when preserveDrawingBuffer=false; those earlier failed images
    // remain in their original evidence directories and are not motion proof.
    const onFrame = frame => {
      frames.push({ png: frame.data, metadata: frame.metadata });
      session.send('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(() => {});
    };
    session.on('Page.screencastFrame', onFrame);
    try {
      await session.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
      await page.keyboard.down('w');
      const until = Date.now() + 2300;
      while (Date.now() < until) await page.waitForTimeout(50);
    } finally { await page.keyboard.up('w'); await session.send('Page.stopScreencast'); await session.detach(); }
    if (frames.length < 4) throw Error(`Insufficient compositor motion frames: ${frames.length}`);
    report.denseSequences ??= [];
    report.denseSequences.push({ name, source: 'CDP Page.screencastFrame', start: startState, end: await state(), frames: frames.length });
    report.denseMotion ??= [];
    for (let i = 0; i < frames.length; i++) {
      const { png, ...pose } = frames[i], file = `${name}-${String(i).padStart(2, '0')}.png`;
      fs.writeFileSync(path.join(out, file), Buffer.from(png, 'base64'));
      report.denseMotion.push({ file, mapped, reeds, color, ...pose });
    }
    save();
  };
  try {
    const { roomBlockers } = await import('../lib/fly/lounge/room-build.js');
    walk = await import('../lib/fly/lounge/room-walk.mjs'); space = walk.buildWalkSpace(roomBlockers('pier'), { variant: 'pier' });
    browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist', '--disable-gpu-shader-disk-cache', '--mute-audio'] });
    page = await browser.newPage({ viewport: costMode || drawMode ? { width: 1920, height: 1080 } : { width: 1680, height: 1260 } });
    page.on('pageerror', (e) => { report.errors.push(e.stack || e.message); save(); });
    page.on('console', (m) => { if (m.type() === 'error') report.consoleErrors.push(m.text()); });
    await page.addInitScript(installLoungeWebGLProbe);
    await page.addInitScript((sun) => { window.__flyVisualsOverride = 'enhanced'; window.__flySunOverride = sun; localStorage.setItem('fly-map-style-2', 'satellite'); localStorage.setItem('fly-sound-on', '0'); localStorage.setItem('fly-controls-seen', '1'); }, report.sunUtc);
    if (arg('mode', '').startsWith('wood')) await page.addInitScript(() => { window.__flyGovPin = 'hold'; });
    report.url = `http://localhost:${arg('port', '3353')}/?graphicsReview=1&flags=LOUNGE_PIER,LOUNGE_INSTRUMENTS,LOUNGE_WALK`;
    const response = await page.goto(report.url, { waitUntil: 'domcontentloaded', timeout: 120000 });
    report.servedHtmlBuild = (await response.text()).match(/\\"b\\":\\"([^"\\]+)\\"/)?.[1] ?? null;
    await page.waitForFunction(() => window.__fly?.airportWatch, undefined, { timeout: 120000 });
    await mark(airport + '-enter'); await page.evaluate(id => window.__fly.airportWatch.enter(id), airport);
    await page.waitForFunction(() => window.__fly.airportWatch.validated && !window.__fly.worldLoading && window.__flyBoot?.pct === 100, undefined, { timeout: 180000 });
    await page.getByTestId('warp-hold').waitFor({ state: 'hidden', timeout: 60000 });
    await page.waitForTimeout(5000); report.initial = await state();
    if (drawMode) {
      report.purpose = 'One normal-adaptive rear-seat compositor frame draw-group census. No screenshots, tier pinning, performance acceptance claim or source changes.';
      await page.evaluate(() => window.__fly.airportWatch.sit('back'));
      await page.waitForFunction(() => { const w = window.__fly.airportWatch; return w.seatId === 'back' && w.posture === 'seated'; }, undefined, { timeout: 90000 });
      await page.evaluate(() => window.__fly.airportWatch.resetLook());
      await page.waitForTimeout(3000);
      report.drawCensus = await page.evaluate(() => new Promise((resolve, reject) => {
        const composer = window.__flyComposer, renderer = composer?.getRenderer?.() ?? composer?.renderer;
        if (!composer || !renderer?.renderBufferDirect) { reject(Error('Live render entry points unavailable')); return; }
        const originalDirect = renderer.renderBufferDirect, originalRender = composer.render;
        const rows = [], w = window.__fly.airportWatch;
        let collecting = false, timer;
        const restore = () => { clearTimeout(timer); renderer.renderBufferDirect = originalDirect; composer.render = originalRender; };
        renderer.renderBufferDirect = function (camera, scene, geometry, material, object, group) {
          const before = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
          const result = originalDirect.call(this, camera, scene, geometry, material, object, group);
          if (collecting) {
            const ancestry = []; let p = object;
            for (let i = 0; p && i < 5; i++, p = p.parent) ancestry.push(p.name || p.type);
            rows.push({ object: object.name || object.type, objectId: object.uuid, ancestry, material: material.name || material.type, materialType: material.type,
              camera: camera.name || camera.type, cameraType: camera.type, cameraId: camera.uuid, calls: renderer.info.render.calls - before.calls,
              triangles: renderer.info.render.triangles - before.triangles, batched: !!object.isBatchedMesh, instanced: !!object.isInstancedMesh });
          }
          return result;
        };
        composer.render = function (...args) {
          collecting = true;
          try {
            const result = originalRender.apply(this, args);
            resolve({ at: performance.now(), scope: 'One whole-composer invocation; excludes pre-composer cube captures and browser presentation', rows,
              governor: window.__flyGov?.state?.(), eye: { ...w.eyeLocal }, yaw: w.yaw, pitch: w.pitch,
              shadow: { ...window.__fly.cinemaShadows }, priorWholeFrame: { ...window.__flyStats?.diag }, probe: { ...window.__fly.loungeStats?.probe } });
            return result;
          } catch (error) { reject(error); throw error; }
          finally { collecting = false; restore(); }
        };
        timer = setTimeout(() => { restore(); reject(Error('No compositor frame for draw census')); }, 5000);
      }));
      report.complete = true; return;
    }
    if (costMode) {
      report.purpose = 'Bounded normal-adaptive CPU profile / composer dispatch / whole-composer GPU elapsed diagnostic. No screenshots, tier pin, or application source changes.';
      report.costCaveats = [
        'GPU queries enclose composer.render only: main scene, shadows and postprocessing. They exclude pre-composer simulation, observation refresh, cube captures and browser presentation.',
        'Synchronous composer CPU wall time is submission duration and can include driver stalls; it is not total JavaScript frame time. GPU elapsed can include command-feed idle time.',
        'One nonblocking timer query every sixth composer call, at most one pending query. No gl.finish or unavailable QUERY_RESULT read. Instrumentation overhead remains part of this diagnostic.',
        'Normal governor remains active. Different effective profiles cannot be treated as a matched high-quality floor comparison.',
        'CDP sampling Profiler is enabled for this same bounded window to expose pre-composer work. Its overhead is not subtracted; these are diagnostic timings, not acceptance measurements.',
      ];
      await page.evaluate(() => {
        const r = window.__fly, w = r.airportWatch;
        w.clearSelection(); w.binoculars(false);
        const composer = window.__flyComposer;
        const renderer = composer?.getRenderer?.() ?? composer?.renderer;
        if (!composer || !renderer) throw Error('Live composer/renderer unavailable');
        const gl = renderer.getContext(), ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
        if (!ext) throw Error('Native GPU elapsed query unavailable');
        const original = composer.render;
        const d = window.__costProbe = { start: performance.now(), phase: 'lower-front', cpu: [], gpu: [], states: [], frames: [], pending: null, calls: 0, disjoint: 0, rejected: 0, conflicts: 0, contextLost: false, composerChanged: false, raf: null };
        const discard = () => { if (d.pending) { gl.deleteQuery(d.pending.query); d.pending = null; d.rejected++; } };
        const lost = () => { d.contextLost = true; discard(); };
        renderer.domElement.addEventListener('webglcontextlost', lost);
        const pose = () => ({ eye: { ...w.eyeLocal }, floorId: w.walk?.floorId, posture: w.posture, seat: w.seatId, yaw: w.yaw, pitch: w.pitch, binocular: w.binocular });
        composer.render = function (...args) {
          const at = performance.now(); let query = null;
          d.calls++;
          if (!gl.isContextLost() && !d.pending && d.calls % 6 === 0) {
            if (gl.getParameter(ext.GPU_DISJOINT_EXT)) d.disjoint++;
            else if (gl.getQuery(ext.TIME_ELAPSED_EXT, gl.CURRENT_QUERY)) d.conflicts++;
            else { query = gl.createQuery(); if (query) gl.beginQuery(ext.TIME_ELAPSED_EXT, query); }
          }
          try { return original.apply(this, args); }
          finally {
            const end = performance.now();
            d.cpu.push({ at, ms: end - at, phase: d.phase, rung: window.__flyGov?.state?.().rung ?? null });
            if (query) {
              if (gl.isContextLost()) { gl.deleteQuery(query); d.rejected++; }
              else { gl.endQuery(ext.TIME_ELAPSED_EXT); d.pending = { query, at, phase: d.phase, rung: window.__flyGov?.state?.().rung ?? null, pose: pose() }; }
            }
          }
        };
        let lastFrame = -1, lastState = -Infinity;
        const tick = () => {
          const at = performance.now();
          if (window.__flyComposer !== composer) d.composerChanged = true;
          if (gl.isContextLost() || gl.getParameter(ext.GPU_DISJOINT_EXT)) { d.disjoint++; discard(); }
          else if (d.pending && gl.getQueryParameter(d.pending.query, gl.QUERY_RESULT_AVAILABLE)) {
            const { query, ...sample } = d.pending;
            d.gpu.push({ ...sample, ms: gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6 });
            gl.deleteQuery(query); d.pending = null;
          }
          const frame = window.__flyStats?.frame;
          if (frame && frame.count !== lastFrame) { lastFrame = frame.count; d.frames.push({ at, ms: frame.lastDt, phase: d.phase }); }
          if (at - lastState >= 1000) {
            lastState = at;
            const shadow = r.cinemaShadows ?? {}, diag = window.__flyStats?.diag ?? {};
            d.states.push({ at, phase: d.phase, pose: pose(), governor: window.__flyGov?.state?.(), drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight], cinemaProfile: r.cinemaProfile ? { ...r.cinemaProfile } : null, shadow: { cascades: shadow.cascades, size: shadow.size, scanMs: shadow.scanMs, scanObjects: shadow.scanObjects, materials: shadow.materials }, calls: diag.calls, triangles: diag.triangles, programs: renderer.info.programs.length, probe: r.loungeStats?.probe ? { ...r.loungeStats.probe } : null, traffic: r.traffic?.items?.length, frame: frame?.sample?.() });
          }
          d.raf = requestAnimationFrame(tick);
        };
        d.stop = () => { cancelAnimationFrame(d.raf); composer.render = original; renderer.domElement.removeEventListener('webglcontextlost', lost); discard(); d.end = performance.now(); };
        d.raf = requestAnimationFrame(tick);
      });
      const costSession = await page.context().newCDPSession(page);
      await costSession.send('Performance.enable');
      await costSession.send('Profiler.enable');
      await costSession.send('Profiler.start');
      const profileMarker = async (phase) => {
        const metrics = await costSession.send('Performance.getMetrics');
        report.cpuPhases ??= [];
        report.cpuPhases.push({ phase, cdpTimestamp: metrics.metrics.find(x => x.name === 'Timestamp')?.value ?? null, performanceNow: await page.evaluate(() => performance.now()) });
      };
      await profileMarker('start');
      const begin = Date.now();
      const costPhase = async (phase, seat) => {
        await profileMarker(phase);
        await page.evaluate(({ phase, seat }) => { window.__costProbe.phase = phase; window.__fly.airportWatch.sit(seat); }, { phase, seat });
        await page.waitForFunction(id => { const w = window.__fly.airportWatch; return w.seatId === id && w.posture === 'seated'; }, seat, { timeout: Math.max(1, 90000 - (Date.now() - begin)) });
        await page.evaluate(phase => { window.__costProbe.phase = phase; }, phase + '-settled');
        await profileMarker(phase + '-settled');
        await page.waitForTimeout(Math.max(0, Math.min(20000, 90000 - (Date.now() - begin))));
      };
      try {
        await costPhase('lower-front', 'window');
        await costPhase('upper-front', 'upper-front');
        if (Date.now() - begin < 70000) await costPhase('lower-front-return', 'window');
        if (Date.now() - begin < 90000) await page.waitForTimeout(90000 - (Date.now() - begin));
      } finally {
        report.cost = await page.evaluate(() => {
          const d = window.__costProbe; d.stop();
          const { stop: _stop, pending: _pending, raf: _raf, ...result } = d; return result;
        });
        await profileMarker('end');
        const { profile } = await costSession.send('Profiler.stop');
        fs.writeFileSync(path.join(out, 'cpu-profile.json'), JSON.stringify(profile));
        await costSession.detach();
      }
      report.complete = true; return;
    }
    if (arg('mode', '') === 'recovery') {
      report.recovery = [];
      const acknowledge = async () => {
        await page.getByRole('button', { name: 'Resume flight', exact: true }).click({ timeout: 10000 });
        await page.getByRole('alertdialog', { name: 'Graphics recovery' }).waitFor({ state: 'hidden', timeout: 10000 });
      };
      const lose = async (name, acknowledgeNow = true) => {
        await mark(name);
        await page.evaluate(() => {
          let scene = window.__fly.engine.object; while (scene.parent) scene = scene.parent;
          const gl = scene.__r3f.root.getState().gl;
          window.__recoverExtension = gl.getContext().getExtension('WEBGL_lose_context');
          if (!window.__recoverExtension) throw Error('Native WEBGL_lose_context unavailable');
          window.__recoverPhase = window.__flyStore.getState().phase;
          window.__recoverExtension.loseContext();
        });
        await page.waitForFunction(() => window.__fly.contextLost === true);
        report.recovery.push({ phase: name + '-lost', ...(await state()) }); save();
        await page.waitForTimeout(300);
        await page.evaluate(() => window.__recoverExtension.restoreContext());
        await page.waitForFunction(() => window.__fly.contextLost === false, undefined, { timeout: 30000 });
        if (acknowledgeNow) await acknowledge();
      };
      const ready = async () => {
        await page.waitForFunction(() => {
          const r = window.__fly;
          return r.loungeRoom?.programWarm?.status === 'ready' && r.loungeRoom.programWarm.textureStatus === 'ready'
            && (!r.prewarm?.worldProfiles?.required || r.prewarm.worldProfiles.status === 'ready');
        }, undefined, { timeout: 180000 });
        await page.getByTestId('warp-hold').waitFor({ state: 'hidden', timeout: 60000 });
      };
      await lose('mounted-context'); await ready();
      report.recovery.push({ phase: 'mounted-restored-ready', ...(await state()) }); await screenshot('mounted-restored');
      await page.evaluate(() => window.__fly.airportWatch.leave());
      await page.waitForFunction(() => !window.__fly.loungeRoom);
      await lose('unmounted-context');
      await page.evaluate(() => window.__fly.airportWatch.enter('KCMH'));
      await ready();
      report.recovery.push({ phase: 'unmounted-restored-reentered-ready', ...(await state()) }); await screenshot('unmounted-restored-reentered');
      await lose('interrupted-context', false);
      await page.waitForFunction(() => {
        const r = window.__fly;
        if (r.loungeRoom?.programWarm?.status !== 'compiling') return false;
        // Capture and interrupt in one browser turn; a second evaluate can
        // arrive after a cached driver has already completed its work.
        window.__interruptedWarm = { at: performance.now(), roomWarm: JSON.parse(JSON.stringify(r.loungeRoom.programWarm)) };
        r.airportWatch.leave(); return true;
      }, undefined, { timeout: 30000 });
      report.recovery.push({ phase: 'pending-before-leave', ...(await page.evaluate(() => window.__interruptedWarm)) });
      await page.waitForFunction(() => !window.__fly.loungeRoom);
      await acknowledge();
      await page.waitForTimeout(5000);
      await page.evaluate(() => window.__fly.airportWatch.enter('KCMH'));
      await ready();
      report.recovery.push({ phase: 'interrupted-reentered-ready', ...(await state()) }); await screenshot('interrupted-reentered');
      report.complete = true; return;
    }
    if (arg('dim', '0') === '1') {
      await page.getByTestId('observatory-lighting').click();
      report.nightWatchOverride = true;
      await page.waitForTimeout(800);
    }
    if (arg('fabric-filter', '') !== '') {
      report.fabricFilterOverride = Number(arg('fabric-filter', '0'));
      await page.evaluate(value => {
        let scene = window.__fly.engine.object; while (scene.parent) scene = scene.parent;
        const gl = scene.__r3f.root.getState().gl;
        let uniform; scene.traverse(object => { if (object.name === 'lounge:fabric') uniform = gl.properties.get(object.material).uniforms?.uLoungeFabricFilter; });
        if (!uniform) throw Error('Missing fabric filter uniform'); uniform.value = value;
      }, report.fabricFilterOverride);
    }
    if (arg('mode', 'motion') === 'tiers') {
      await page.evaluate(() => { const w = window.__fly.airportWatch; w.yaw = Math.PI; w.pitch = -.08; });
      await tiers(); report.complete = true; return;
    }
    if (arg('mode', '').startsWith('wood')) {
      report.woodDiagnostic = 'Runtime-only, recorded controls isolate mapped height, procedural relief, albedo modulation and analytical key light. Geometry and shadow kernel stay unchanged. Legacy floor/reed A/B modes require their exact pre-fix shader anchors. Dense frames include compositor capture cost.';
      await page.evaluate((mode) => {
        let scene = window.__fly.engine.object; while (scene.parent) scene = scene.parent;
        let material; scene.traverse(object => { if (object.name === 'lounge:wood') material = object.material; });
        if (!material) throw Error('Missing wood material');
        const previous = material.onBeforeCompile, key = material.customProgramCacheKey;
        const controls = window.__woodDiag = { map: { value: 1 }, reeds: { value: 1 }, color: { value: 1 }, key: { value: 1 }, smooth: { value: 0 }, floor: { value: 0 } };
        material.onBeforeCompile = (shader, renderer) => {
          previous.call(material, shader, renderer);
          const pattern = /float h = \( lgHeight - 0\.5 \) \* ([^;]+) \+ lgBumpH;/;
          if (!pattern.test(shader.fragmentShader)) { controls.invalid = 'Wood relief diagnostic anchor absent'; throw Error(controls.invalid); }
          const required = ['diffuseColor.rgb *= lgTex.rgb;', 'if ( uLoungeLight.z > 0.0 &&'];
          if (mode === 'wood-color' || mode === 'wood-floor') required.push('lgBumpH += profile * 0.006 * k;');
          if (mode === 'wood-floor') required.push('if ( ( fixture.y - LG_UPPER_FLOOR ) * ( lgP.y - LG_UPPER_FLOOR ) < 0.0 ) {');
          for (const anchor of required) {
            if (!shader.fragmentShader.includes(anchor)) { controls.invalid = `Legacy ${mode} diagnostic anchor absent; refusing an ineffective A/B: ${anchor}`; throw Error(controls.invalid); }
          }
          shader.uniforms.uDiagMapped = controls.map; shader.uniforms.uDiagReeds = controls.reeds;
          shader.uniforms.uDiagColor = controls.color; shader.uniforms.uDiagKey = controls.key; shader.uniforms.uDiagSmooth = controls.smooth; shader.uniforms.uDiagFloor = controls.floor;
          shader.fragmentShader = 'uniform float uDiagMapped;\nuniform float uDiagReeds;\nuniform float uDiagColor;\nuniform float uDiagKey;\nuniform float uDiagSmooth;\nuniform float uDiagFloor;\n' + shader.fragmentShader
            .replace(pattern, 'float h = ( lgHeight - 0.5 ) * $1 * uDiagMapped + lgBumpH * uDiagReeds;')
            .replace('diffuseColor.rgb *= lgTex.rgb;', 'diffuseColor.rgb *= mix(vec3(1.0), lgTex.rgb, uDiagColor);')
            .replace('if ( uLoungeLight.z > 0.0 &&', 'if ( uDiagKey > 0.0 && uLoungeLight.z > 0.0 &&')
            .replace('lgBumpH += profile * 0.006 * k;', 'float dfw=max(w,0.0001); float dr=0.5-0.5*cos(ph*6.2831853)*sin(3.14159265*dfw)/(3.14159265*dfw); lgBumpH += mix(profile,dr,uDiagSmooth) * 0.006 * k;')
            .replace('if ( ( fixture.y - LG_UPPER_FLOOR ) * ( lgP.y - LG_UPPER_FLOOR ) < 0.0 ) {', 'if ( ( fixture.y - LG_UPPER_FLOOR ) * ( lgP.y - LG_UPPER_FLOOR ) < 0.0 && (uDiagFloor < 0.5 || (abs(fixture.y - LG_UPPER_FLOOR) > 0.001 && abs(lgP.y - LG_UPPER_FLOOR) > 0.001)) ) {');
          controls.applied = true;
        };
        material.customProgramCacheKey = () => key.call(material) + '|review-wood-relief-ab-v1';
        material.needsUpdate = true;
      }, arg('mode', ''));
      await page.waitForFunction(() => window.__woodDiag.applied || window.__woodDiag.invalid, undefined, { timeout: 10000 });
      report.woodPatchValidity = await page.evaluate(() => ({ applied: window.__woodDiag.applied ?? false, invalid: window.__woodDiag.invalid ?? null }));
      if (report.woodPatchValidity.invalid || !report.woodPatchValidity.applied) throw Error(report.woodPatchValidity.invalid || 'Wood A/B patch did not compile');
      await page.waitForTimeout(1200);
    }
    await page.evaluate(() => { const w = window.__fly.airportWatch; w.clearSelection(); w.stand(); });
    await page.waitForFunction(() => window.__fly.airportWatch.posture === 'standing');
    await walkTo({ x: 0, z: 2.8, floorId: 'lower' }, 'lower-aisle');
    await walkTo({ x: -10, z: 2.8, floorId: 'lower' }, 'stair-approach');
    if (arg('mode', '') === 'dense') {
      await walkTo({ x: -10, z: 11.9, floorId: 'upper' }, 'upper-landing');
      await denseWoodMotion('compositor-upper-walk', null, null, null);
      await screenshot('compositor-upper-end');
      report.complete = true; return;
    }
    if (arg('mode', '').startsWith('wood')) {
      await walkTo({ x: -10, z: 10.0, floorId: 'stairs' }, 'stair-wood-pose');
      if (arg('mode', '') === 'wood-floor') {
        await walkTo({ x: -10, z: 11.9, floorId: 'upper' }, 'upper-landing');
        await walkTo({ x: -5.2, z: 10.7, floorId: 'upper' }, 'upper-floor-pose');
        await page.evaluate(() => { const w = window.__fly.airportWatch; w.yaw = -Math.PI / 2; w.pitch = -.22; });
        for (const floor of [0, 1, 0]) {
          await page.evaluate(value => { window.__woodDiag.floor.value = value; }, floor);
          await woodControls(1, 1, 1, 1, 1); await screenshot(`floor-tolerance-${floor}-${report.frames.length}`);
        }
        await page.evaluate(() => { window.__woodDiag.floor.value = 0; });
        await denseWoodMotion('dense-floor-original', 1, 1, 1);
        await page.evaluate(() => { window.__woodDiag.floor.value = 1; });
        await denseWoodMotion('dense-floor-tolerance', 1, 1, 1);
        report.complete = true; return;
      }
      if (arg('mode', '') === 'wood-color') {
        await page.evaluate(() => { const w = window.__fly.airportWatch; w.yaw = Math.PI; w.pitch = -.30; });
        for (const smooth of [0, 1, 0]) { await woodControls(1, 1, 1, 1, smooth); await screenshot(`reed-filter-${smooth}-${report.frames.length}`); }
        await walkTo({ x: -10, z: 11.9, floorId: 'upper' }, 'upper-landing');
        await walkTo({ x: -5.2, z: 10.7, floorId: 'upper' }, 'upper-wood-pose');
        await page.evaluate(() => { const w = window.__fly.airportWatch; w.yaw = -Math.PI / 2; w.pitch = -.22; });
        for (const [color, key] of [[1, 1], [0, 1], [0, 0], [1, 1]]) {
          await woodControls(0, 0, color, key); await screenshot(`floor-color${color}-key${key}-${report.frames.length}`);
        }
        await denseWoodMotion('dense-no-color', 0, 0, 0);
        report.complete = true; return;
      }
      await woodPair('stair-wood', Math.PI, -.30);
      await walkTo({ x: -10, z: 11.9, floorId: 'upper' }, 'upper-landing');
      await walkTo({ x: -5.2, z: 10.7, floorId: 'upper' }, 'upper-wood-pose');
      await woodPair('upper-wood', -Math.PI / 2, -.22);
      await denseWoodMotion('dense-original', 1, 1);
      await denseWoodMotion('dense-no-relief', 0, 0);
      report.complete = true; return;
    }
    if (arg('mode', 'motion') === 'fabric') {
      await walkTo({ x: -10, z: 11.9, floorId: 'upper' }, 'upper-landing');
      await walkTo({ x: -5.19655, z: 10.70156, floorId: 'upper' }, 'rug-matched-pose');
      await fabricPair('rug-wide', -.22);
      await walkTo({ x: -3.4464, z: 10.70156, floorId: 'upper' }, 'rug-close-pose');
      await fabricPair('rug-close', -.62);
      report.complete = true; return;
    }
    await movingFrames('stair-ascent', Math.PI, -.30, 6500);
    await walkTo({ x: -10, z: 11.9, floorId: 'upper' }, 'upper-landing');
    await walkTo({ x: -6, z: 10.7, floorId: 'upper' }, 'upper-start');
    await movingFrames('upper-walk', -Math.PI / 2, -.22, 4500);
    if (arg('dense', '0') === '1') await denseWoodMotion('compositor-upper-walk', null, null, null);
    if (arg('tiers', '0') === '1') await tiers();
    await walkTo({ x: -10, z: 11.9, floorId: 'upper' }, 'descent-approach');
    await movingFrames('stair-descent', 0, -.46, 6500);
    report.complete = true;
  } catch (e) { report.failure = e.stack || String(e); process.exitCode = 1; if (page) await screenshot('failure').catch(() => {}); }
  finally { if (page) report.webgl = await page.evaluate(() => window.__loungeWebGL.snapshot()).catch(() => null); save(); await browser?.close(); }
})();
