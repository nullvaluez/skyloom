/**
 * TRUE EARTH Phase 1b — verify-true-areas: TRUE_AREAS (lib/fly/true-areas.js,
 * the satellite building and skyline builders in
 * lib/fly/toy-world/vector-tile.worker.js, and the two engines that request
 * them).
 *
 * THE DEFECT. Footprints are measured in Mercator square units (k² × true m²)
 * while every area threshold was tuned near 40°N, so the same suburb keeps
 * fewer houses near the equator (the 120 floor eats them) and loses its big
 * buildings at high latitude (the 60,000 ceiling flattens them).
 *
 * THE INSTRUMENT. The REAL worker, in-process, on the OFFLINE fixture (as
 * verify-seam's node leg). One real suburban tile (Powell OH, 40.2°N) is
 * RELOCATED: its exact .pbf bytes are served for a tile row at another
 * latitude, so the builder sees the same footprints with that latitude's k.
 *
 * THE CONTRACT
 *  (1) areaNormK: exactly 1 when off and at the reference latitude; (kRef/k)²
 *      otherwise;
 *  (2) flag off: the request carries nothing new and the output is
 *      byte-identical to a request without the option;
 *  (3) at the tile's own latitude, on and off agree within 2%;
 *  (4) flag off, the defect: the builder is blind to latitude — the same
 *      Mercator footprints keep exactly the same buildings at the equator,
 *      at 40°N and at 60°N, although they are true 170 m² houses at the
 *      equator and true 42 m² sheds at 60°N;
 *  (5) flag on: the count follows TRUE size — strictly more kept at the
 *      equator than at 40°N, strictly fewer at 60°N;
 *  (6) the skyline builder takes the same normalisation (its per-polygon
 *      hatch candidates follow true size the same way);
 *  (7) the two engines add the option only when the flag is on.
 *
 * Run: FLY_TILE_FIXTURE=1 node scripts/verify-true-areas.cjs
 */
const path = require('path');
const fs = require('fs');
const { registerHooks } = require('node:module');
const { pathToFileURL, fileURLToPath } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const COMLINK_STUB = 'file:///true-areas-comlink-stub.mjs';

registerHooks({
  resolve(spec, ctx, next) {
    if (spec === 'comlink') return { url: COMLINK_STUB, shortCircuit: true };
    if (/^\.{1,2}\//.test(spec) && !/\.[a-z]+$/i.test(spec) && ctx.parentURL?.startsWith('file:')) {
      for (const ext of ['.js', '.mjs', '/index.js']) {
        try {
          if (fs.existsSync(fileURLToPath(new URL(spec + ext, ctx.parentURL)))) return next(spec + ext, ctx);
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
        source: 'export const expose = (api) => { globalThis.__trueAreasApi = api; };\nexport const transfer = (v) => v;\n',
      };
    return next(url, ctx);
  },
});

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}
const lonToX = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);
const latToY = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
};
const kAt = (lat) => 1 / Math.cos((lat * Math.PI) / 180);
const near = (a, b, tol) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

(async () => {
  if (!process.env.FLY_TILE_FIXTURE) {
    console.log('FAIL  this gate needs the offline fixture: FLY_TILE_FIXTURE=1 node scripts/verify-true-areas.cjs');
    process.exit(1);
  }
  const TA = await import(pathToFileURL(path.join(ROOT, 'lib/fly/true-areas.js')).href);
  const C = await import(pathToFileURL(path.join(ROOT, 'lib/fly/fly-constants.js')).href);

  // (1) the factor
  {
    const ref = C.TRUE_AREAS.refLatDeg;
    const ok =
      TA.areaNormK(kAt(0), false) === 1 &&
      TA.areaNormK(kAt(60), false) === 1 &&
      near(TA.areaNormK(kAt(ref), true), 1, 1e-12) &&
      near(TA.areaNormK(kAt(0), true), kAt(ref) ** 2, 1e-12) &&
      near(TA.areaNormK(kAt(60), true), (kAt(ref) / 2) ** 2, 1e-12);
    check('(1) areaNormK: 1 when off and at the reference latitude, (kRef/k)² otherwise', ok, `equator ×${TA.areaNormK(kAt(0), true).toFixed(3)}, 60°N ×${TA.areaNormK(kAt(60), true).toFixed(3)}`);
  }

  await import(pathToFileURL(path.join(ROOT, 'lib/fly/toy-world/vector-tile.worker.js')).href);
  const api = globalThis.__trueAreasApi;
  if (!api?.buildTile) {
    check('(0) worker loaded in-process', false);
    process.exit(1);
  }
  const fx = await require('./_fixture').installNodeFetchFixture();
  // Relocation: the requested tile row is answered with the SOURCE tile's bytes.
  const viaFixture = globalThis.fetch;
  let source = null;
  globalThis.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input?.url || String(input);
    if (source && /\/mvt\/\d+\/\d+\/\d+\.pbf/.test(url)) {
      return viaFixture(url.replace(/\/mvt\/\d+\/\d+\/\d+\.pbf/, `/mvt/${source.z}/${source.x}/${source.y}.pbf`), init);
    }
    return viaFixture(input, init);
  };
  await api.init();

  const Z = 14;
  const powell = { lat: 40.2083, lon: -83.0701 };
  const src = { z: Z, x: lonToX(powell.lon, Z), y: latToY(powell.lat, Z) };
  const build = async (detail, lat, opts, from = src) => {
    source = from;
    const r = await api.buildTile(Z, from.x, latToY(lat, Z), detail, opts);
    source = null;
    return r;
  };
  const metaOf = (r) => r?.satBuilding?.meta ?? null;
  const total = (r) => metaOf(r)?.total ?? -1;

  // (2) flag off: byte identity of the output with and without the option
  {
    const a = await build('sat-buildings', powell.lat, { visuals: true });
    const b = await build('sat-buildings', powell.lat, { visuals: true, trueAreas: false });
    const same = (x, y) => x && y && x.length === y.length && Buffer.compare(Buffer.from(x.buffer, x.byteOffset, x.byteLength), Buffer.from(y.buffer, y.byteOffset, y.byteLength)) === 0;
    const ok = total(a) > 20 && same(a.satBuilding.pos, b.satBuilding.pos) && same(a.satBuilding.idx, b.satBuilding.idx) && same(a.satBuilding.col, b.satBuilding.col);
    check('(2) flag off: identical output with and without the option', ok, `${total(a)} footprints, ${a?.satBuilding?.idx?.length ?? 0} indices`);
  }

  const counts = {};
  for (const [name, lat] of [['equator', 0.5], ['powell', powell.lat], ['n60', 60]]) {
    counts[name] = {
      off: total(await build('sat-buildings', lat, { visuals: true })),
      on: total(await build('sat-buildings', lat, { visuals: true, trueAreas: true })),
    };
  }
  const c = counts;
  check('(3) at the tile\'s own latitude (40.2°N) on and off agree within 2%', c.powell.off > 20 && near(c.powell.on, c.powell.off, 0.02), JSON.stringify(c.powell));
  check(
    '(4) flag off, the defect: the builder is blind to latitude (same Mercator footprints, same count everywhere)',
    c.powell.off > 20 && c.equator.off === c.powell.off && c.n60.off === c.powell.off,
    `equator ${c.equator.off} · 40°N ${c.powell.off} · 60°N ${c.n60.off}`,
  );
  check(
    '(5) flag on: the count follows true size (equator > 40°N > 60°N for the same Mercator footprints)',
    c.equator.on > c.powell.on && c.powell.on > c.n60.on,
    `equator ${c.equator.on} · 40°N ${c.powell.on} · 60°N ${c.n60.on}`,
  );

  // (6) skyline, on a dense downtown tile (Manhattan): its per-polygon area
  // hatch and mega-block cut take the same normalisation
  {
    const city = { z: Z, x: lonToX(-73.985, Z), y: latToY(40.758, Z) };
    // hatch = per-polygon AREA candidates (the only area-driven skyline pick)
    const hatch = (r) => r?.skyMeta?.hatchCand ?? -1;
    const rows = {};
    for (const [name, lat] of [['equator', 0.5], ['ref', 40.758], ['n60', 60]]) {
      rows[name] = {
        off: hatch(await build('sat-skyline', lat, { visuals: true }, city)),
        on: hatch(await build('sat-skyline', lat, { visuals: true, trueAreas: true }, city)),
      };
    }
    const r = rows;
    const ok =
      r.ref.off > 20 &&
      r.equator.off === r.ref.off && r.n60.off === r.ref.off && // blind to latitude when off
      r.ref.on === r.ref.off && // unchanged at the tuning latitude
      r.equator.on > r.ref.on && r.ref.on > r.n60.on; // follows true size when on
    check(
      '(6) skyline (a dense downtown tile): area-hatch candidates are latitude-blind off and follow true size on',
      ok,
      `off ${r.equator.off}/${r.ref.off}/${r.n60.off} · on ${r.equator.on}/${r.ref.on}/${r.n60.on} (equator/40.8°N/60°N)`,
    );
  }

  // (7) the engines add the option only when on
  {
    const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
    const bld = read('lib/fly/toy-world/sat-building-engine.js');
    const sk = read('lib/fly/toy-world/sat-skyline-engine.js');
    const ta = read('lib/fly/true-areas.js');
    const ok =
      bld.split("{ visuals: this.visuals, ...trueAreasRequest() }").length - 1 === 2 &&
      sk.split("{ visuals: this.visuals, ...trueAreasRequest() }").length - 1 === 1 &&
      /return trueAreasOn\(\) \? \{ trueAreas: true \} : null;/.test(ta);
    check('(7) the building and skyline engines add { trueAreas: true } only when the flag is on', ok);
  }

  fx.restore();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('FAIL', e.stack || e.message);
  process.exit(1);
});
