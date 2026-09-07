/**
 * R24 B WORLD — WHICH LAYERS HAVE A FADE CHANNEL AT ALL.
 *
 * The re-take fade row reads 8 of 26 HARD births and 6 of 11 HARD deaths with
 * `fadeBudgetMiss` 0 — an unexplained remainder by B's own rule. This probe
 * settles it by driving the three satellite chunk engines headless at the
 * VENUE's frame rate and applying E's EXACT presence rule per mesh, then
 * attributing every hard event to the LAYER it came from.
 *
 * E's rule (verify-fade.js `presenceOf`), reproduced verbatim in spirit:
 * read `material.userData.__fadeU.value` if present, else opacity when
 * transparent, else 1 — and "1 on a mesh's first displayed frame" is a HARD
 * birth. So any layer with no fade channel scores 100% hard by construction.
 *
 * Run: node scripts/r24-b-fadecover-proof.js  [--dt=2.84] [--off]
 */
const path = require('path');
const fs = require('fs');
const { registerHooks } = require('node:module');
const { pathToFileURL, fileURLToPath } = require('node:url');

// `--root=` points the probe at any extracted tree, which is how the RED leg
// runs against the pre-fix revision without touching a worktree:
//   git archive 9bf5f8a | tar -x -C /tmp/pre
const ROOT_ARG = process.argv.find((a) => a.startsWith('--root='));
const ROOT = ROOT_ARG ? path.resolve(ROOT_ARG.slice(7)) : path.resolve(__dirname, '..');
const STUB = 'file:///r24-b-fadecover-comlink.mjs';
registerHooks({
  resolve(spec, ctx, next) {
    if (spec === 'comlink') return { url: STUB, shortCircuit: true };
    const probe = (base) => {
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
      const u = probe(path.join(ROOT, spec.slice(2)));
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
    if (url === STUB)
      return {
        format: 'module',
        shortCircuit: true,
        source:
          'export const expose = (api) => { globalThis.__r24FcApi = api; };\n' +
          'export const transfer = (v) => v;\n',
      };
    return next(url, ctx);
  },
});

const { encodeTile, scene, installFetchStub } = require(path.join(ROOT, 'scripts/r24-b-fixture.js'));
const DT_ARG = process.argv.find((a) => a.startsWith('--dt='));
const DT = DT_ARG ? Number(DT_ARG.slice(5)) : 2.84; // the venue's measured frame

(async () => {
  const bytes = { dense: encodeTile(scene('dense')), suburb: encodeTile(scene('suburb')) };
  const restore = installFetchStub((z, x, y) => ((x + y) % 3 === 0 ? bytes.dense : bytes.suburb));
  await import(pathToFileURL(path.join(ROOT, 'lib/fly/toy-world/vector-tile.worker.js')).href);
  const C = await import(pathToFileURL(path.join(ROOT, 'lib/fly/fly-constants.js')).href);
  const { SatBuildingEngine } = await import(
    pathToFileURL(path.join(ROOT, 'lib/fly/toy-world/sat-building-engine.js')).href
  );
  const { SatSkylineEngine } = await import(
    pathToFileURL(path.join(ROOT, 'lib/fly/toy-world/sat-skyline-engine.js')).href
  );
  const { SatRoadEngine } = await import(
    pathToFileURL(path.join(ROOT, 'lib/fly/toy-world/sat-road-engine.js')).href
  );
  const api = globalThis.__r24FcApi;
  await api.init();
  if (process.argv.includes('--off')) C.CHUNK_FADE.enabled = false;

  // The water material is built through TextureLoader, which needs a DOM image
  // element. Eight lines of loader stub: it makes the MATERIAL constructible
  // headless and changes nothing about it (the texture never resolves, which is
  // irrelevant to whether its userData declares a fade channel).
  if (typeof globalThis.document === 'undefined') {
    globalThis.document = {
      createElementNS: () => ({
        addEventListener() {},
        removeEventListener() {},
        set src(_v) {},
        get src() {
          return '';
        },
      }),
    };
  }
  const groundAt = () => ({ elev: 120, tileZ: 14 });
  const sb = new SatBuildingEngine({ groundAt });
  const sky = new SatSkylineEngine({ groundAt });
  const rd = new SatRoadEngine({ groundAt });
  for (const e of [sb, sky, rd]) e.setWorker(api);
  sb.setWaterEnabled(true);

  // E's rule, verbatim in spirit.
  const presenceOf = (o) => {
    const m = o.material;
    if (!m) return 1;
    const u = m.userData?.__fadeU;
    if (u && typeof u.value === 'number') return u.value;
    if (m.transparent && typeof m.opacity === 'number') return m.opacity;
    return 1;
  };
  // Classify by the ENGINE root, and inside the building engine by the WATER
  // material — a building mesh wearing a fade TWIN is not `sb.material` either,
  // so testing against the shared material would label every fading building
  // as water. (It did, on the first run of this probe.)
  const layerOf = (o, root) => {
    if (root === 'roads') return 'sat-roads';
    if (root === 'skyline') return 'sat-skyline';
    return sb.waterMaterial && o.material === sb.waterMaterial ? 'sat-water' : 'sat-building';
  };
  const hasFadeU = (o) => !!o.material?.userData?.__fadeU;

  const prev = new Map();
  const hard = { births: {}, deaths: {} };
  const tot = { births: {}, deaths: {} };
  const withFadeU = {};
  const bump = (o, k, l) => {
    o[k][l] = (o[k][l] ?? 0) + 1;
  };
  let t = 0;
  for (let f = 0; f < 130; f++) {
    t += DT;
    const px = 90 * t;
    const pz = 700 * Math.sin(t * 0.04);
    sb.update(t, px, pz, 300);
    sky.update(t, px, pz, 300, 120);
    rd.update(t, px, pz, 300);
    const cur = new Map();
    for (const [root, eng] of [['bldg', sb], ['skyline', sky], ['roads', rd]])
      eng.object.traverse((o) => {
        if (!o.isMesh || !o.visible) return;
        cur.set(o.id, { p: presenceOf(o), l: layerOf(o, root), u: hasFadeU(o) });
      });
    for (const [id, v] of cur) {
      if (prev.has(id)) continue;
      bump(tot, 'births', v.l);
      if (v.u) withFadeU[v.l] = (withFadeU[v.l] ?? 0) + 1;
      if (v.p >= 0.999) bump(hard, 'births', v.l);
    }
    for (const [id, was] of prev) {
      if (cur.has(id)) continue;
      bump(tot, 'deaths', was.l);
      if (was.p >= 0.999) bump(hard, 'deaths', was.l);
    }
    prev.clear();
    for (const [id, v] of cur) prev.set(id, v);
    if (f % 5 === 0) await new Promise((r) => setImmediate(r));
  }

  const sbs = sb.stats;
  const layers = [...new Set([...Object.keys(tot.births), ...Object.keys(tot.deaths)])].sort();
  console.log(
    `\ndt ${(DT * 1000).toFixed(0)} ms · CHUNK_FADE ${C.CHUNK_FADE.enabled} · minFrames ${C.CHUNK_FADE.minFrames}\n`
  );
  console.log('layer           births  HARD   deaths  HARD   births wearing __fadeU');
  let unexplained = 0;
  for (const l of layers) {
    const hb = hard.births[l] ?? 0;
    const hd = hard.deaths[l] ?? 0;
    const withU = withFadeU[l] ?? 0;
    const has = withU > 0;
    console.log(
      `${l.padEnd(15)} ${String(tot.births[l] ?? 0).padStart(6)} ${String(hb).padStart(5)}   ` +
        `${String(tot.deaths[l] ?? 0).padStart(6)} ${String(hd).padStart(5)}   ` +
        `${withU} of ${tot.births[l] ?? 0}${has ? '' : '   <- NO FADE CHANNEL AT ALL'}`
    );
    if (has) unexplained += hb + hd;
  }
  console.log(
    `\nengine stats: sb ready ${sbs.ready} waterReady ${sbs.waterReady} chunks ${sbs.chunks}` +
      ` · skyline ready ${sky.stats.ready} chunks ${sky.stats.chunks} ringOn ${sky.stats.ringOn}` +
      ` · roads ready ${rd.stats.ready} chunks ${rd.stats.chunks} ringOn ${rd.stats.ringOn}`
  );
  console.log(
    `\nfadeBudgetMiss ${sbs.fadeBudgetMiss} + ${sky.stats.fadeBudgetMiss}` +
      ` · heals ${sbs.heals} inPlace ${sbs.healsInPlace} queueFull ${sbs.healsQueueFull}` +
      ` aborted ${sbs.healsAborted} coalesced ${sbs.healsCoalesced} redraping ${sbs.redraping}`
  );
  const budget = (sbs.fadeBudgetMiss ?? 0) + (sky.stats.fadeBudgetMiss ?? 0);
  const g1 = !C.CHUNK_FADE.enabled || unexplained <= budget;
  console.log(
    `\n${g1 ? 'PASS' : 'FAIL'} (1) every hard event on a FADING layer is a spent budget` +
      ` — ${unexplained} hard on fading layers vs fadeBudgetMiss ${budget}`
  );

  // --- (2) THE ATTRIBUTION GATE — the actual defect the re-take exposed ------
  // The re-take read 8 of 26 hard births and 6 of 11 hard deaths with
  // fadeBudgetMiss 0: an UNEXPLAINED remainder by B's own rule. It is not a
  // floor failure — the floor works, and the sat-building rows above show 0
  // hard at the venue's own frame rate. It is a COVERAGE gap: two layers under
  // the probed roots have no fade channel AT ALL, so every one of their births
  // reads presence 1 by construction. That is a legitimate design decision for
  // both (see each material's note) — but an undeclared one is indistinguishable
  // from a bug, which is exactly what happened. So every material a presence
  // probe can meet must EITHER carry a fade uniform OR declare that it has none.
  const mats = new Map();
  const collect = (o, label) => {
    if (o?.material && !mats.has(o.material)) mats.set(o.material, label);
  };
  collect({ material: sb.material }, 'sat-building shared');
  collect({ material: sb._ensureWaterMaterial() }, 'sat-water shared');
  collect({ material: sky.material }, 'sat-skyline shared');
  collect({ material: rd.material }, 'sat-roads shared');
  const undeclared = [];
  for (const [m, label] of mats) {
    const fades = !!m.userData?.__fadeU || label.startsWith('sat-building') || label.startsWith('sat-skyline');
    const declared = !!m.userData?.__noFade;
    if (!fades && !declared) undeclared.push(label);
  }
  const g2 = undeclared.length === 0;
  console.log(
    `${g2 ? 'PASS' : 'FAIL'} (2) every probed material either fades or DECLARES __noFade` +
      (undeclared.length ? ` — undeclared: ${undeclared.join(', ')}` : ' — no unattributable layer')
  );
  for (const [m, label] of mats) {
    const state = m.userData?.__noFade
      ? 'NO FADE (declared): ' + m.userData.__noFade
      : undeclared.includes(label)
        ? 'NO FADE, UNDECLARED — reads presence 1 forever and cannot be attributed'
        : 'fades';
    console.log(`      ${label.padEnd(22)} ${state}`);
  }
  const ok = g1 && g2;
  for (const e of [sb, sky, rd]) e.dispose();
  restore();
  console.log(`\nVERIFY: ${ok ? 'PASS' : 'FAIL'}`);
  process.exit(ok ? 0 : 1);
})();
