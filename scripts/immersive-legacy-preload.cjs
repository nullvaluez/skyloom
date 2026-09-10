/* Run an existing regression against the immersive ship configuration without
 * changing that regression's assertions. Use node -r ./scripts/immersive-legacy-preload.cjs.
 * The ordinary _boot defaults and main regression files remain unchanged.
 */
const boot = require('./_boot');
const originalBoot = boot.bootFly;
boot.bootFly = async function bootImmersive(page, options = {}) {
  await page.addInitScript(() => {
    const keys = ['__flyGovPin', '__flyTerraPin', '__flySettlePin', '__flyClutterPin',
      '__flyDepthPin', '__flyAerialOverride', '__flySatShadowOverride'];
    window.__immersivePinAttempts = {};
    for (const key of keys) Object.defineProperty(window, key, {
      configurable: true, get: () => undefined,
      set: value => { window.__immersivePinAttempts[key] = value; },
    });
  });
  const url = new URL(options.url || process.env.FLY_URL || 'http://localhost:3022');
  url.searchParams.set('graphics', 'immersive');
  url.searchParams.set('graphicsReview', '1');
  const result = await originalBoot(page, { ...options, url: url.href });
  // FlyCanvas publishes __flyGl only in development. The production composer
  // already owns the same renderer; expose that actual object to the inherited
  // read-only census. Without this, its buffer check silently counts 0 frames.
  await page.evaluate(() => {
    window.__flyGl ??= window.__flyComposer?.getRenderer?.();
    if (!window.__flyGl?.isWebGLRenderer) throw Error('Production renderer unavailable');
  });
  if (process.env.IMMERSIVE_PACE_STEPS === '1') {
    await page.waitForFunction(() => window.__tearWatch?.frames > 0, null, { timeout: 10000 });
  }
  const controls = await page.evaluate(() => ({ attempted: window.__immersivePinAttempts,
    actual: Object.fromEntries(Object.keys(window.__immersivePinAttempts).map(k => [k, window[k] ?? null])),
    clouds: window.__fly.immersiveClouds?.active, depth: window.__flyComposer.passes.map(p => p.name),
  }));
  console.log('IMMERSIVE LIVE CONTROLS', JSON.stringify(controls));
  if (!controls.clouds || Object.values(controls.actual).some(value => value !== null)) {
    throw Error('Immersive regression did not release the inherited pins');
  }
  if (process.env.IMMERSIVE_PACE_STEPS === '1') {
    // A healthy fixed-resolution flight does not exercise resize mechanics.
    // After the existing pacing harness resets its window, request two real
    // governor steps. The existing resize, frame-time and program gates remain
    // unchanged. These are deliberate inputs, not observed spontaneous steps.
    page.on('console', message => {
      if (message.text().startsWith('IMMERSIVE PACING')) console.log(message.text());
    });
    await page.evaluate(() => {
      const frame = window.__flyStats?.frame;
      if (!frame?.reset || !window.__flyGov?.force) throw Error('Pacing controls unavailable');
      // Observe actual canvas setters as well as method calls. The inherited
      // monitor can wrap OUTSIDE installResizeGuard after production boot, so
      // its method census includes calls that the guard correctly suppresses.
      // Keep its verdict unchanged; retain a separate attribution trace.
      const gl = window.__flyGl;
      const trace = window.__immersivePaceTrace = { writes: [], calls: [] };
      for (const prop of ['width', 'height']) {
        const d = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, prop);
        Object.defineProperty(HTMLCanvasElement.prototype, prop, {
          ...d,
          set(value) {
            if (this === gl.domElement) trace.writes.push({ prop, value,
              inRaf: !!window.__tearWatch?.inRaf, at: performance.now() });
            return d.set.call(this, value);
          },
        });
      }
      for (const method of ['setPixelRatio', 'setSize']) {
        const original = gl[method];
        gl[method] = function (...args) {
          const row = { method, args, inRaf: !!window.__tearWatch?.inRaf,
            writesBefore: trace.writes.length, guardBefore: { ...window.__flyStats?.stepGuard } };
          const value = original.apply(this, args);
          row.writesAfter = trace.writes.length;
          row.guardAfter = { ...window.__flyStats?.stepGuard };
          trace.calls.push(row);
          return value;
        };
      }
      const reset = frame.reset.bind(frame);
      const sample = frame.sample.bind(frame);
      frame.sample = (...args) => {
        const value = sample(...args);
        if (window.__immersivePaceStarted && !(window.__tearWatch?.frames > 0)) {
          throw Error('Buffer agreement has no observed frames; cannot certify pacing');
        }
        if (window.__immersivePaceStarted) console.log('IMMERSIVE PACING EVIDENCE ' + JSON.stringify({
          ...trace, steps: window.__immersivePaceSteps, frames: window.__tearWatch.frames,
          mismatches: window.__tearWatch.mismatch,
        }));
        return value;
      };
      frame.reset = (...args) => {
        reset(...args);
        window.__immersivePaceStarted = true;
        trace.writes.length = 0;
        trace.calls.length = 0;
        for (const timer of window.__immersivePaceTimers || []) clearTimeout(timer);
        window.__immersivePaceSteps = [];
        window.__immersivePaceTimers = [[15000, -1], [45000, 1]].map(([delay, direction]) =>
          setTimeout(() => {
            const accepted = window.__flyGov.force(direction);
            window.__immersivePaceSteps.push({ at: performance.now(), direction, accepted });
            console.log('IMMERSIVE PACING INPUT', direction);
          }, delay));
      };
    });
    console.log('PACING INPUTS: real governor force(-1) at 15s and force(1) at 45s after the measurement reset');
  }
  return result;
};
