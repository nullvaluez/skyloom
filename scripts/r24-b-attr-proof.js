/**
 * R24 B WORLD — "no geometry attribute has an undefined array".
 *
 * WHY THIS EXISTS. Pass-2b's toy row failed gate 13 with a REPEATED uncaught
 * `Cannot read properties of undefined (reading 'byteLength')`. That message is
 * produced in exactly one place: three's `WebGLAttributes` reads
 * `attribute.array.byteLength` when it first uploads a buffer, so SOMETHING put
 * an object with no `.array` where a BufferAttribute belongs. It is invisible
 * to every structural gate — the scene graph, the counts and the draw list all
 * look right — and it only throws when a GL context tries to upload. This gate
 * finds it WITHOUT a GL context, by censusing the attributes directly after a
 * headless streaming run.
 *
 * THE TRAP IT CATCHES, in general form: `BufferGeometry.setIndex(x)` wraps `x`
 * in a BufferAttribute ONLY when `Array.isArray(x)` is true. That is false for
 * a TYPED array, so `setIndex(new Uint32Array(...))` assigns the raw typed
 * array as `geometry.index` — an object with no `.array`, no `.count`, and a
 * guaranteed throw at upload. A plain `[]` works; the typed array does not.
 *
 * Run:  node scripts/r24-b-attr-proof.js                 (this worktree)
 *       node scripts/r24-b-attr-proof.js --root=/tmp/int (any extracted tree)
 *       …plus --off / --nopace to A/B a flag.
 */
const path = require('path');
const fs = require('fs');
const { registerHooks } = require('node:module');
const { pathToFileURL, fileURLToPath } = require('node:url');

const ROOT_ARG = process.argv.find((a) => a.startsWith('--root='));
const ROOT = ROOT_ARG ? ROOT_ARG.slice(7) : path.resolve(__dirname, '..');
const STUB = 'file:///r24-b-attr-comlink.mjs';

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
          'export const expose = (api) => { globalThis.__r24AttrApi = api; };\n' +
          'export const transfer = (v) => v;\n',
      };
    return next(url, ctx);
  },
});

const { encodeTile, scene, installFetchStub } = require(path.join(ROOT, 'scripts/r24-b-fixture.js'));

(async () => {
  const bytes = { dense: encodeTile(scene('dense')), suburb: encodeTile(scene('suburb')) };
  const restore = installFetchStub((z, x, y) => ((x + y) % 3 === 0 ? bytes.dense : bytes.suburb));
  await import(pathToFileURL(path.join(ROOT, 'lib/fly/toy-world/vector-tile.worker.js')).href);
  const C = await import(pathToFileURL(path.join(ROOT, 'lib/fly/fly-constants.js')).href);
  const { ToyWorldEngine } = await import(
    pathToFileURL(path.join(ROOT, 'lib/fly/toy-world/toy-world-engine.js')).href
  );
  const api = globalThis.__r24AttrApi;
  await api.init();

  if (process.argv.includes('--off') && C.FLASH_GUARD) C.FLASH_GUARD.enabled = false;
  if (process.argv.includes('--nopace') && C.FINALIZE_PACE) C.FINALIZE_PACE.enabled = false;
  console.log(
    `root ${ROOT}\nFLASH_GUARD ${C.FLASH_GUARD?.enabled} · FINALIZE_PACE ${C.FINALIZE_PACE?.enabled}` +
      ` · BEND_LEAD ${C.BEND_LEAD?.enabled}\n`
  );

  const engine = new ToyWorldEngine({
    getElevationAt: () => 100,
    groundAt: () => ({ elev: 100, tileZ: 14 }),
  });
  engine.setWorker(api);
  let t = 0;
  let threw = null;
  for (let f = 0; f < 400; f++) {
    t += 1 / 30;
    try {
      engine.update(t, 60 * t, 300 * Math.sin(t * 0.05), 300);
    } catch (e) {
      threw = e.message;
      break;
    }
    if (f % 5 === 0) await new Promise((r) => setImmediate(r));
  }

  const bad = [];
  let meshes = 0;
  const nameOf = (o) =>
    o.material === engine.materials.land
      ? 'LAND'
      : o.material === engine.materials.water
        ? 'WATER'
        : o.material === engine.materials.building
          ? 'BUILDING'
          : 'other';
  engine.object.traverse((o) => {
    if (!o.isMesh) return;
    meshes += 1;
    const g = o.geometry;
    const ix = typeof g.getIndex === 'function' ? g.getIndex() : g.index;
    // A raw typed array assigned as `geometry.index` has neither.
    if (ix && (ix.array === undefined || ix.count === undefined))
      bad.push(`${nameOf(o)} INDEX is not a BufferAttribute (verts=${g.getAttribute('position')?.count})`);
    for (const [k, a] of Object.entries(g.attributes || {}))
      if (a && a.array === undefined) bad.push(`${nameOf(o)} attribute '${k}' has no array`);
  });

  const st = engine.stats;
  console.log(`meshes ${meshes} · chunks ${st.chunks} ready ${st.ready} degenerateDropped ${st.degenerateDropped}`);
  if (threw) console.log(`THREW during update: ${threw}`);
  const ok = bad.length === 0 && !threw;
  console.log(
    `${ok ? 'PASS' : 'FAIL'} every geometry index/attribute is a real BufferAttribute with an array` +
      (bad.length ? ` — ${bad.length} bad:\n  ` + [...new Set(bad)].slice(0, 6).join('\n  ') : '')
  );
  restore();
  console.log(`\nVERIFY: ${ok ? 'PASS' : 'FAIL'}`);
  process.exit(ok ? 0 : 1);
})();
