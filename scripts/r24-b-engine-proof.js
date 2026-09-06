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
 * Run:  node scripts/r24-b-engine-proof.js
 *       node scripts/r24-b-engine-proof.js --on     (force all three flags on)
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

  if (FORCE_ON) {
    C.CHUNK_FADE.enabled = true;
    C.HEAL_IN_PLACE.enabled = true;
    C.FLASH_GUARD.enabled = true;
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
    }
    for (const [id, b] of prev) {
      if (now.has(id)) continue;
      if (b >= 0.999) pops += 1; // vanished from full opacity in one frame
    }
    prev = now;
  };

  // --- a serpentine: 90 s at 1/30 s, DEM refining twice --------------------
  const R = C.SAT_BUILDINGS.ring.r;
  let t = 0;
  const DT = 1 / 30;
  for (let f = 0; f < 2700; f++) {
    t += DT;
    const px = 120 * t; // 120 m/s
    const pz = 900 * Math.sin(t * 0.05); // a slow serpentine, ring-edge churn
    step(t, px, pz, 300);
    if (f === 900) demZ = C.SAT_BUILDINGS.demZ + 1; // first refinement
    if (f === 1800) demZ = C.SAT_BUILDINGS.demZ + 2; // second
    // let the async worker builds land
    if (f % 5 === 0) await new Promise((r) => setImmediate(r));
  }

  const st = engine.stats;
  console.log(
    `chunks ${st.chunks} ready ${st.ready} evictions ${st.evictions} heals ${st.heals}` +
      ` healsInPlace ${st.healsInPlace ?? 0} healsNoop ${st.healsNoop ?? 0}` +
      ` births ${st.births ?? 0} dying ${st.dying ?? 0} twins ${st.fadeTwins ?? 0}` +
      ` fadeBudgetMiss ${st.fadeBudgetMiss ?? 0}` +
      ` degenerateDropped ${st.degenerateDropped}`
  );
  console.log(`single-frame POPS ${pops} · ramp steps ${ramps}\n`);

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
    gate(
      '(B) GREEN every heal patched the resident buffer (no hole)',
      st.heals > 0 && (st.healsInPlace ?? 0) + (st.healsNoop ?? 0) >= st.heals,
      `heals ${st.heals} inPlace ${st.healsInPlace} noop ${st.healsNoop}`
    );
  } else {
    gate('(B) RED heals exist and every one of them deleted a mesh', st.heals > 0, `heals ${st.heals}`);
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
