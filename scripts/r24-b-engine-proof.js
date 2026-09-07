/**
 * R24 B WORLD — the CHUNK_FADE / HEAL_IN_PLACE / FLASH_GUARD engine leg,
 * IN NODE. No browser, no GL context, no network.
 *
 * WHY THIS WORKS HEADLESS. `SatBuildingEngine` is pure three scene-graph +
 * typed-array work: it builds `Group`/`Mesh`/`BufferGeometry` and patches
 * materials through `onBeforeCompile`, none of which touches a WebGL context
 * until something renders. So the whole streaming pipeline — worker bundle →
 * budgeted drape → finalize → heal → evict — runs in node, driven by the REAL
 * `vector-tile.worker.js` (imported in-process through verify-seam's loader
 * hooks) against the synthetic closed-ring MVT bytes of r24-b-fixture.js.
 *
 * THE INSTRUMENT — "which mechanism makes a building vanish". Every frame we
 * census each chunk mesh's EFFECTIVE ALPHA: the value of the `uSatBldgFade`
 * uniform its material actually carries (a shared material reads the module
 * uniform, a fade twin reads its own), times `visible`. A **POP** is any mesh
 * whose effective alpha changes by a full 1.0 between two consecutive frames —
 * i.e. a chunk that appears solid or vanishes outright in ONE frame. That is
 * the user's symptom stated as a number.
 *
 * A **HOLE** is a heal event that removed a resident mesh (evict + refetch)
 * rather than patching it in place.
 *
 * Run:  node scripts/r24-b-engine-proof.js            (the SHIP state)
 *       node scripts/r24-b-engine-proof.js --off      (force the flags OFF: RED)
 *       node scripts/r24-b-engine-proof.js --on       (force the flags ON)
 *
 * The default leg reads the constants AS THEY SHIP, so it asserts whatever
 * state the round closed in. `--off` is what keeps the flag-off branch under
 * test after the close flip — the leg that would otherwise silently rot.
 */
const path = require('path');
const fs = require('fs');
const { registerHooks } = require('node:module');
const { pathToFileURL, fileURLToPath } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const COMLINK_STUB = 'file:///r24-b-engine-comlink-stub.mjs';

registerHooks({
  resolve(spec, ctx, next) {
    if (spec === 'comlink') return { url: COMLINK_STUB, shortCircuit: true };
    // R24 B (post-merge): the tree now also uses the `@/` alias in modules this
    // probe loads, so the hook resolves it the same way Next does — root-relative,
    // with the extensionless probe applied to it too.
    const aliasProbe = (base) => {
      for (const ext of ['', '.js', '.mjs', '/index.js']) {
        try {
          if (fs.existsSync(base + ext) && fs.statSync(base + ext).isFile())
            return pathToFileURL(base + ext).href;
        } catch {
          /* not this candidate */
        }
      }
      return null;
    };
    if (spec.startsWith('@/')) {
      const u = aliasProbe(path.join(ROOT, spec.slice(2)));
      if (u) return { url: u, shortCircuit: true };
    }
    if (/^\.{1,2}\//.test(spec) && !/\.[a-z]+$/i.test(spec) && ctx.parentURL?.startsWith('file:')) {
      for (const ext of ['.js', '.mjs', '/index.js']) {
        try {
          if (fs.existsSync(fileURLToPath(new URL(spec + ext, ctx.parentURL))))
            return next(spec + ext, ctx);
        } catch {
          /* not this candidate */
        }
      }
    }
    return next(spec, ctx);
  },
  load(url, ctx, next) {
    if (url === COMLINK_STUB)
      return {
        format: 'module',
        shortCircuit: true,
        source:
          'export const expose = (api) => { globalThis.__r24BApi = api; };\n' +
          'export const transfer = (v) => v;\n',
      };
    return next(url, ctx);
  },
});

const { encodeTile, scene, installFetchStub } = require('./r24-b-fixture.js');

const EARTH_R = 6378137;
const FORCE_ON = process.argv.includes('--on');
const FORCE_OFF = process.argv.includes('--off');
// R24 B (W3): the frame-count floor is a claim about FRAME RATE, so the proof
// has to be able to run the same pipeline at three of them.
const DT_ARG = process.argv.find((a) => a.startsWith('--dt='));
const DT = DT_ARG ? Number(DT_ARG.slice(5)) : 1 / 30;
const HITCH = process.argv.includes('--hitch');
// R24 B (W3) — the heal STARVATION leg. `HEAL_IN_PLACE.budgetMs` is a per-frame
// TIME budget, so on a long frame the elapsed check trips after a handful of
// raycasts and the job barely advances. budgetMs 0 is that condition's limit
// and models it exactly: without a forward-progress floor the loop samples
// nothing and no re-drape ever completes; with one it still makes progress.
const STARVE = process.argv.includes('--healstarve');

(async () => {
  const fails = [];
  const gate = (n, ok, d = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ' — ' + d : ''}`);
    if (!ok) fails.push(n);
  };

  const bytes = { dense: encodeTile(scene('dense')), suburb: encodeTile(scene('suburb')) };
  const restore = installFetchStub((z, x, y) => ((x + y) % 3 === 0 ? bytes.dense : bytes.suburb));

  await import(pathToFileURL(path.join(ROOT, 'lib/fly/toy-world/vector-tile.worker.js')).href);
  const C = await import(pathToFileURL(path.join(ROOT, 'lib/fly/fly-constants.js')).href);
  const WB = await import(pathToFileURL(path.join(ROOT, 'lib/fly/toy-world/world-bend.js')).href);
  const { SatBuildingEngine } = await import(
    pathToFileURL(path.join(ROOT, 'lib/fly/toy-world/sat-building-engine.js')).href
  );
  const api = globalThis.__r24BApi;
  await api.init();

  // The engines read these flags at CALL time, so forcing them here after the
  // module has loaded exercises the real branch without a second process.
  if (STARVE) C.HEAL_IN_PLACE.budgetMs = 0;
  if (process.argv.includes('--nofloor')) C.HEAL_IN_PLACE.minRunsPerFrame = 0;
  if (FORCE_ON || FORCE_OFF) {
    const v = FORCE_ON;
    C.CHUNK_FADE.enabled = v;
    C.HEAL_IN_PLACE.enabled = v;
    C.FLASH_GUARD.enabled = v;
  }
  console.log(
    `\nflags: CHUNK_FADE ${C.CHUNK_FADE.enabled} · HEAL_IN_PLACE ${C.HEAL_IN_PLACE.enabled}` +
      ` · FLASH_GUARD ${C.FLASH_GUARD.enabled} · BEND_LEAD ${C.BEND_LEAD.enabled}\n`
  );

  // --- a deterministic pseudo-DEM that REFINES with time ---------------------
  // tileZ starts at demZ (coarse but accepted) and steps up twice, which is
  // exactly the condition the heal loop tests (`s.tileZ > chunk.drapeZ`).
  let demZ = C.SAT_BUILDINGS.demZ;
  const groundAt = (lon, lat) => ({
    elev: 60 * Math.sin(lon * 0.9) + 35 * Math.cos(lat * 1.7) + demZ * 3,
    tileZ: demZ,
  });

  const engine = new SatBuildingEngine({ groundAt });
  engine.setWorker(api);

  // --- the census ------------------------------------------------------------
  const alphaOf = (mesh) => {
    if (!mesh.visible) return 0;
    const u = mesh.material?.userData?.__fadeU;
    // A twin publishes its own uniform through the closure; read it back the
    // way the GPU would — from whatever object the material's patch captured.
    return u ? u.value : WB.getSatBldgFade();
  };

  let pops = 0;
  let ramps = 0;
  let prev = new Map();
  // R24 B (W3) — PARTIAL-SAMPLE CENSUS. A "partial sample" is a frame on which
  // a mesh is drawn at 0 < presence < 1, i.e. a frame on which an observer can
  // SEE that a fade is running. Birth partials (presence rising) and death
  // partials (falling) are counted separately, because a birth starts at 0 and
  // is partial on its first frame while a death starts at full presence and
  // cannot be — the asymmetry that sets CHUNK_FADE.minFrames.
  const up = new Map();
  const down = new Map();
  let minDeathPartials = Infinity;
  let deathsSeen = 0;
  let minBirthPartials = Infinity;
  let birthsSeen = 0;
  const step = (t, px, pz, agl) => {
    engine.update(t, px, pz, agl);
    const now = new Map();
    for (const o of engine.object.children) {
      if (!o.isMesh) continue;
      now.set(o.id, alphaOf(o));
    }
    for (const [id, a] of now) {
      const b = prev.has(id) ? prev.get(id) : 0;
      const d = Math.abs(a - b);
      if (d >= 0.999) pops += 1;
      else if (d > 1e-4) ramps += 1;
      if (a > 1e-6 && a < 0.999) {
        if (a >= b) up.set(id, (up.get(id) ?? 0) + 1);
        else down.set(id, (down.get(id) ?? 0) + 1);
      }
      if (!prev.has(id)) {
        birthsSeen += 1;
      }
    }
    for (const [id, b] of prev) {
      if (now.has(id)) continue;
      if (b >= 0.999) pops += 1; // vanished from full opacity in one frame
      deathsSeen += 1;
      minDeathPartials = Math.min(minDeathPartials, down.get(id) ?? 0);
      const u = up.get(id);
      if (u !== undefined) minBirthPartials = Math.min(minBirthPartials, u);
      up.delete(id);
      down.delete(id);
    }
    prev = now;
  };

  // --- a serpentine: 90 s at 1/30 s, DEM refining twice --------------------
  let t = 0;
  const FRAMES = Math.max(240, Math.round(90 / DT)); // ~90 s of world time
  for (let f = 0; f < FRAMES; f++) {
    // A HITCH TRAIN: one 500 ms frame every 40, dropped into an otherwise
    // 60 Hz run. A ramp must not be able to complete inside it.
    t += HITCH && f % 40 === 20 ? 0.5 : DT;
    const px = 120 * t; // 120 m/s
    const pz = 900 * Math.sin(t * 0.05); // a slow serpentine, ring-edge churn
    step(t, px, pz, 300);
    if (f === Math.round(FRAMES / 3)) demZ = C.SAT_BUILDINGS.demZ + 1; // first refinement
    if (f === Math.round((2 * FRAMES) / 3)) demZ = C.SAT_BUILDINGS.demZ + 2; // second
    // let the async worker builds land
    if (f % 5 === 0) await new Promise((r) => setImmediate(r));
  }

  const st = engine.stats;
  console.log(
    `chunks ${st.chunks} ready ${st.ready} evictions ${st.evictions} heals ${st.heals}` +
      ` healsInPlace ${st.healsInPlace ?? 0} healsNoop ${st.healsNoop ?? 0}` +
      ` healsQueueFull ${st.healsQueueFull ?? 0} healsAborted ${st.healsAborted ?? 0}` +
      ` healsNoRecord ${st.healsNoRecord ?? 0} healsCoalesced ${st.healsCoalesced ?? 0}` +
      ` births ${st.births ?? 0} dying ${st.dying ?? 0} twins ${st.fadeTwins ?? 0}` +
      ` fadeBudgetMiss ${st.fadeBudgetMiss ?? 0}` +
      ` degenerateDropped ${st.degenerateDropped}`
  );
  console.log(
    `single-frame POPS ${pops} · ramp steps ${ramps}` +
      ` · dt ${(DT * 1000).toFixed(1)} ms${HITCH ? ' + a 500 ms hitch every 40 frames' : ''}` +
      ` · minFrames ${C.CHUNK_FADE.minFrames}` +
      `\n  partial samples per ramp: births >= ${Number.isFinite(minBirthPartials) ? minBirthPartials : 'n/a'}` +
      ` (${birthsSeen} seen) · deaths >= ${Number.isFinite(minDeathPartials) ? minDeathPartials : 'n/a'}` +
      ` (${deathsSeen} seen)\n`
  );
  // Not in a starve leg: that leg deliberately perturbs streaming (more
  // evictions, more spent fade budget), so it cannot judge the fade floor.
  if (C.CHUNK_FADE.enabled && deathsSeen > 0 && !STARVE) {
    gate(
      `(D) FRAME FLOOR — every death is partial on >= ${C.CHUNK_FADE.minFrames - 1} samples at dt=${(DT * 1000).toFixed(0)} ms`,
      minDeathPartials >= C.CHUNK_FADE.minFrames - 1,
      `worst death showed ${minDeathPartials} partial sample(s)`
    );
  }

  const cen = engine.censusDegenerate();
  console.log(
    `resident degenerate census: meshes ${cen.meshes} tris ${cen.tris} degenerate ${cen.degenerate}` +
      ` (${(cen.frac * 100).toFixed(2)}%) coincident ${cen.coincident}`
  );

  if (C.CHUNK_FADE.enabled) {
    // Every surviving pop must be ATTRIBUTABLE to a spent fade budget — the
    // documented graceful degradation, not an unexplained residual.
    gate(
      '(A) GREEN births/deaths are RAMPS; every residual pop is a spent budget',
      ramps > 0 && pops <= (st.fadeBudgetMiss ?? 0),
      `pops ${pops} <= budgetMiss ${st.fadeBudgetMiss} · ramps ${ramps}`
    );
  } else {
    gate('(A) RED every arrival and eviction is a single-frame pop', pops > 0 && ramps === 0, `pops ${pops} ramps ${ramps}`);
  }
  if (C.HEAL_IN_PLACE.enabled) {
    // Every heal that did NOT patch in place must be attributable to a spent
    // re-drape budget — the documented degradation — never unexplained.
    // EXHAUSTIVE, not "at least": every heal lands in exactly one outcome, so
    // a hole that survives the feature is always attributable to a named one.
    const acct =
      (st.healsInPlace ?? 0) +
      (st.healsNoop ?? 0) +
      (st.healsQueueFull ?? 0) +
      (st.healsAborted ?? 0) +
      (st.healsNoRecord ?? 0) +
      (st.healsCoalesced ?? 0) +
      (st.redraping ?? 0); // …plus any job still draining when the run ended
    gate(
      '(B) GREEN every heal is accounted for — inPlace | noop | queueFull | aborted | noRecord | coalesced | in flight',
      st.heals > 0 && acct >= st.heals,
      `heals ${st.heals} = inPlace ${st.healsInPlace} + noop ${st.healsNoop} + queueFull ` +
        `${st.healsQueueFull} + aborted ${st.healsAborted} + noRecord ${st.healsNoRecord} + ` +
        `coalesced ${st.healsCoalesced} + inFlight ${st.redraping} (${acct})`
    );
  } else {
    gate('(B) RED heals exist and every one of them deleted a mesh', st.heals > 0, `heals ${st.heals}`);
  }
  if (STARVE) {
    // The honest assertion is FORWARD PROGRESS, not `healsInPlace`: whether a
    // job COMPLETES also depends on whether its chunk survives long enough,
    // and at this frame rate a moving serpentine evicts chunks faster than any
    // multi-frame re-drape can finish (that is `healsAborted`, which is a
    // correct outcome, not a hole). What the floor owns is that the loop keeps
    // sampling at all when the ms budget is already spent.
    const floor = C.HEAL_IN_PLACE.minRunsPerFrame | 0;
    gate(
      `(E) HEAL FORWARD PROGRESS — ms budget spent, floor ${floor}: the re-drape loop still samples`,
      // Without a floor the loop still gets ONE run per job entry before the
      // elapsed check trips, so the honest RED bound is "negligible", not zero.
      floor > 0 ? (st.redrapeRuns ?? 0) > 64 : (st.redrapeRuns ?? 0) <= 64,
      `redrapeRuns ${st.redrapeRuns} · healsInPlace ${st.healsInPlace} · aborted ${st.healsAborted} ` +
        `(eviction, not pacing) · queueFull ${st.healsQueueFull}`
    );
  }
  if (C.FLASH_GUARD.enabled) {
    gate('(C) GREEN no degenerate triangle is resident', cen.degenerate === 0, `${cen.degenerate}/${cen.tris}`);
  } else {
    gate('(C) RED degenerate triangles are resident on the GPU', cen.degenerate > 0, `${cen.degenerate}/${cen.tris}`);
  }

  engine.dispose();
  restore();
  console.log(`\nVERIFY: ${fails.length ? 'FAIL — ' + fails.join(', ') : 'PASS'}`);
  process.exit(fails.length ? 1 : 0);
})();
