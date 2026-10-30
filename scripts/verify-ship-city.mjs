/**
 * verify-ship-city: the SHIP PASS CITY stream's node gate (FLY_SHIP_PASS.md
 * 5.3: CT-1 ... CT-7). No browser, no GPU: every row is either pure logic,
 * the REAL vector-tile worker run in-process on the OFFLINE fixture (the
 * verify-true-areas technique), or a program compiled through its real
 * onBeforeCompile against three's own shader text (the verify-play-city
 * technique). Flag arms run in child processes, because every Ship Pass flag
 * is resolved once, at module load, through lib/fly/ship-pass.js.
 *
 * Rows (each PASS / FAIL; "N passed, M failed"; exit 1 on any FAIL):
 *  CT-1  the diagnosis pins: absent = the shipped band exactly; validated;
 *        a pushed fade carries its eviction / arm heights; the premix pin
 *        rides the skyline request; the acknowledgement global.
 *  CT-2  CITY_RANGE: the band per device class (policy-gated), the lite LOD
 *        switch, flag-off request identity (the same object), and the worker:
 *        flag-off output byte-identical to `main`'s worker on fixture tiles
 *        (skyline, buildings, roads), flag-on dense cores gain blocks while a
 *        non-core tile is byte-identical, the premix pin leaves Enhanced
 *        output untouched (no baked premix exists there).
 *  ...   later sections are appended by later commits (see the report).
 *
 * Run: node scripts/verify-ship-city.mjs
 * (the worker rows start the offline fixture server themselves; no network).
 */
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SELF = fileURLToPath(import.meta.url);
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

// ---------------------------------------------------------------------------
// Shared helpers
const lonToX = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);
const latToY = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
};

/** A stable digest of a worker result: typed arrays by bytes, the rest as JSON, timings dropped. */
function digest(value) {
  const h = crypto.createHash('sha256');
  const walk = (v, key) => {
    if (key === 'tessMs' || key === 'ms') return;
    if (ArrayBuffer.isView(v)) {
      h.update(`<${v.constructor.name}:${v.length}>`);
      h.update(Buffer.from(v.buffer, v.byteOffset, v.byteLength));
      return;
    }
    if (Array.isArray(v)) {
      h.update('[');
      v.forEach((x) => walk(x));
      h.update(']');
      return;
    }
    if (v && typeof v === 'object') {
      h.update('{');
      for (const k of Object.keys(v).sort()) {
        h.update(`${k}:`);
        walk(v[k], k);
      }
      h.update('}');
      return;
    }
    h.update(JSON.stringify(v ?? null));
  };
  walk(value);
  return h.digest('hex').slice(0, 16);
}

// The fixture tiles the worker rows build (z14). Midtown is the SK-1 pose's
// ground; the 3x3 around it is the densest fixture city. Columbus is a small
// city core, Powell a suburb, Owens the empty-desert lock.
const Z = 14;
const MIDTOWN = { lat: 40.7549, lon: -73.984 };
const TILES = [];
for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) TILES.push({ name: `midtown${dx},${dy}`, x: lonToX(MIDTOWN.lon, Z) + dx, y: latToY(MIDTOWN.lat, Z) + dy });
TILES.push({ name: 'columbus', x: lonToX(-82.9988, Z), y: latToY(39.9612, Z) });
TILES.push({ name: 'powell', x: lonToX(-83.0701, Z), y: latToY(40.2083, Z) });
TILES.push({ name: 'owens', x: lonToX(-118.06, Z), y: latToY(36.6, Z) });

// ---------------------------------------------------------------------------
// CHILD: run one worker file in-process on the fixture; print digests as JSON.
// argv: --child=worker <workerPath> <realWorkerPath> <requestsJSON>
async function childWorker(workerPath, realWorkerPath, requestsJSON) {
  const { registerHooks } = await import('node:module');
  const COMLINK = 'file:///ship-city-comlink-stub.mjs';
  const workerURL = pathToFileURL(workerPath).href;
  const realURL = pathToFileURL(realWorkerPath).href;
  const fs = await import('node:fs');
  registerHooks({
    resolve(spec, ctx, next) {
      if (spec === 'comlink') return { url: COMLINK, shortCircuit: true };
      // A copy of main's worker lives outside the tree: resolve its imports
      // (relative and bare) as if it sat where the real one does.
      const parent = ctx.parentURL === workerURL && workerURL !== realURL ? realURL : ctx.parentURL;
      if (/^\.{1,2}\//.test(spec) && !/\.[a-z]+$/i.test(spec) && parent?.startsWith('file:')) {
        for (const ext of ['.js', '.mjs', '/index.js']) {
          try {
            if (fs.existsSync(fileURLToPath(new URL(spec + ext, parent)))) return next(spec + ext, { ...ctx, parentURL: parent });
          } catch {
            /* not this candidate */
          }
        }
      }
      return next(spec, { ...ctx, parentURL: parent });
    },
    load(url, ctx, next) {
      if (url === COMLINK) return { format: 'module', shortCircuit: true, source: 'export const expose = (api) => { globalThis.__shipCityApi = api; };\nexport const transfer = (v) => v;\n' };
      return next(url, ctx);
    },
  });
  const requests = JSON.parse(requestsJSON);
  await import(workerURL);
  const api = globalThis.__shipCityApi;
  const { installNodeFetchFixture } = (await import(pathToFileURL(path.join(ROOT, 'scripts/_fixture.js')).href)).default;
  const fx = await installNodeFetchFixture();
  await api.init();
  const out = {};
  for (const req of requests) {
    for (const t of TILES) {
      const r = await api.buildTile(Z, t.x, t.y, req.detail, req.opts);
      const key = `${req.label}|${t.name}`;
      const sky = r?.satSkyline;
      out[key] = {
        digest: digest(r),
        geo: digest({ a: r?.satSkyline ?? null, b: r?.satBuilding ?? null, c: r?.satRoads ?? null }),
        idx: sky?.idx?.length ?? r?.satBuilding?.idx?.length ?? 0,
        dense: r?.skyMeta?.dense ?? null,
        kept: r?.skyMeta?.kept ?? r?.satBuilding?.meta?.kept ?? null,
        // CT-6: the detail ring's per-chunk polygon cap and its total.
        bkept: r?.satBuilding?.meta?.kept ?? null,
        btotal: r?.satBuilding?.meta?.total ?? null,
      };
    }
  }
  fx.restore?.();
  console.log(`@@JSON${JSON.stringify(out)}`);
  process.exit(0);
}

// CHILD: pure logic under a window stub (pins set before any import).
// argv: --child=logic <windowJSON>
async function childLogic(windowJSON) {
  const { register } = await import('node:module');
  register('./_node-resolve.mjs', import.meta.url);
  globalThis.window = JSON.parse(windowJSON);
  const CR = await import(pathToFileURL(path.join(ROOT, 'lib/fly/city-range.js')).href);
  const C = await import(pathToFileURL(path.join(ROOT, 'lib/fly/fly-constants.js')).href);
  const out = { shipped: { F: C.SAT_BLDG_FADE, S: { on: C.SAT_BUILDINGS.cullAglOnM, off: C.SAT_BUILDINGS.cullAglOffM }, R: C.CITY_RANGE } };
  out.diag = CR.cityDiag();
  out.applied0 = globalThis.window.__flyCityDiagApplied === true;
  out.range = {};
  for (const cls of ['phone', 'tablet', 'igpu', 'dgpu', 'software']) {
    for (const tier of ['low', 'medium', 'high']) {
      const w = { ...globalThis.window, __flyCityDeviceClass: cls };
      const r = CR.cityRangeFor(tier, w);
      out.range[`${cls}/${tier}`] = r ? { detailed: r.detailed, band: CR.buildingBand(r, w) } : null;
    }
  }
  out.band = CR.buildingBand(null);
  const base = { visuals: true };
  const req = CR.cityRangeRequest(base, null);
  out.requestSame = req === base;
  out.request = req;
  const dg = CR.cityRangeFor('high', { ...globalThis.window, __flyCityDeviceClass: 'dgpu' });
  const reqOn = CR.cityRangeRequest(base, dg);
  out.requestOn = reqOn === base ? 'same' : reqOn;
  out.applied1 = globalThis.window.__flyCityDiagApplied === true;
  // bandFade over the shipped band vs the expression that stood in the engine.
  const F = C.SAT_BLDG_FADE;
  const legacy = (agl) => {
    const t = Math.min(1, Math.max(0, (agl - F.fadeStartAglM) / Math.max(1, F.fadeEndAglM - F.fadeStartAglM)));
    return 1 - t * t * (3 - 2 * t);
  };
  out.fadeSame = [0, 1000, 2400, 2401, 2550.5, 2700, 2999, 3000, 3100, 9000].every((a) => Object.is(CR.bandFade(CR.buildingBand(null, {}), a), legacy(a)));
  // the lite LOD switch (architecture-draw-range.js)
  const DR = await import(pathToFileURL(path.join(ROOT, 'lib/fly/architecture-draw-range.js')).href);
  out.liteDefault = DR.architectureLiteOn();
  DR.setArchitectureLite(true);
  out.liteSet = DR.architectureLiteOn();
  DR.setArchitectureLite(false);
  console.log(`@@JSON${JSON.stringify(out)}`);
  process.exit(0);
}

const childArg = process.argv.find((a) => a.startsWith('--child='));
if (childArg === '--child=worker') await childWorker(process.argv[3], process.argv[4], process.argv[5]);
else if (childArg === '--child=logic') await childLogic(process.argv[3]);
else await main();

// ---------------------------------------------------------------------------
function runChild(args, env = {}) {
  const r = spawnSync(process.execPath, [SELF, ...args], { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 << 20, timeout: 600000, env: { ...process.env, NODE_NO_WARNINGS: '1', ...env } });
  const line = (r.stdout || '').split('\n').find((l) => l.startsWith('@@JSON'));
  if (!line) throw new Error(`child ${args[0]} failed: ${(r.stderr || r.stdout || '').slice(-1500)}`);
  return JSON.parse(line.slice(6));
}

async function main() {
  let pass = 0;
  let fail = 0;
  const check = (name, ok, detail = '') => {
    if (ok) pass++;
    else fail++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
  };

  // ===================== CT-1 / CT-2: pure logic ===========================
  const off = runChild(['--child=logic', JSON.stringify({})]);
  {
    const { F, S } = off.shipped;
    const b = off.band;
    check(
      'CT-1 no pin, CITY_RANGE off: the band is exactly SAT_BLDG_FADE / SAT_BUILDINGS (source shipped)',
      b.source === 'shipped' && b.fadeStartM === F.fadeStartAglM && b.fadeEndM === F.fadeEndAglM && b.evictM === F.evictAglM && b.armOnM === S.on && b.liteStartM === null,
      `${b.fadeStartM}-${b.fadeEndM} m, evict ${b.evictM}, arm ${b.armOnM}`,
    );
    check('CT-1 bandFade over the shipped band is the engine\'s old expression (Object.is at 10 heights)', off.fadeSame === true);
    check('CT-1 no pin: nothing claims a pin was honoured (no __flyCityDiagApplied)', off.diag === null && !off.applied0 && !off.applied1);
    check('CT-2 flag off: cityRangeFor() is null on every class and tier', Object.values(off.range).every((r) => r === null));
    check('CT-2 flag off: the skyline request is the SAME object (verify-true-areas (7) text kept)', off.requestSame === true && off.requestOn === 'same');
    check('CT-2 the lite LOD switch is off by default and only the engine sets it', off.liteDefault === false && off.liteSet === true);
  }
  {
    const bad = runChild(['--child=logic', JSON.stringify({ __flyCityDiag: { fadeStartM: 5000, fadeEndM: 4000, skylinePremix: 2 } })]);
    check('CT-1 malformed pins are ignored (end <= start, premix not 0|1): today\'s band', bad.diag === null && bad.band.source === 'shipped');
  }
  {
    const pin = runChild(['--child=logic', JSON.stringify({ __flyCityDiag: { fadeStartM: 4500, fadeEndM: 5000, skylinePremix: 0 } })]);
    const b = pin.band;
    const margin = pin.shipped.F.evictAglM - pin.shipped.F.fadeEndAglM;
    check(
      'CT-1 a pushed fade pin moves the dissolve, keeps the shipped evict margin and arms up to the pinned end',
      b.source === 'diag' && b.fadeStartM === 4500 && b.fadeEndM === 5000 && b.evictM === 5000 + margin && b.armOnM === 5000,
      JSON.stringify(b),
    );
    check(
      'CT-1 skylinePremix: 0 adds { premix: false } to the skyline request and publishes __flyCityDiagApplied',
      pin.request?.premix === false && pin.request?.visuals === true && pin.applied1 === true,
      JSON.stringify(pin.request),
    );
  }
  const on = runChild(['--child=logic', JSON.stringify({ __flyCityRangeOverride: { enabled: true } })]);
  {
    const R = on.shipped.R;
    const d = on.range['dgpu/high'];
    check(
      'CT-2 CITY_RANGE on, desktop High/Ultra (dgpu, igpu): the long detailed band with the lite LOD',
      d?.detailed === true && d.band.source === 'range' && d.band.liteStartM === R.liteStartM && d.band.fadeStartM === R.fadeStartM && d.band.fadeEndM === R.fadeEndM && d.band.evictM === R.evictM && d.band.armOnM === R.armOnM && on.range['igpu/high']?.detailed === true,
      JSON.stringify(d?.band),
    );
    const shortRows = ['phone/high', 'phone/medium', 'tablet/high', 'igpu/medium', 'dgpu/medium', 'dgpu/low'];
    check(
      'CT-2 CITY_RANGE on, Medium and touch devices: no detailed band (the shipped band), the skyline core only',
      shortRows.every((k) => on.range[k]?.detailed === false && on.range[k].band.source === 'shipped'),
      shortRows.map((k) => `${k}:${on.range[k]?.band?.source}`).join(' '),
    );
    check('CT-2 CITY_RANGE on, software rasteriser: refused by the policy (null)', ['low', 'medium', 'high'].every((t) => on.range[`software/${t}`] === null));
    check(
      'CT-2 CITY_RANGE on: the band is ordered (lite < fade start < fade end < evict, arm in (fade end - 1, evict))',
      R.liteStartM < R.fadeStartM && R.fadeStartM < R.fadeEndM && R.fadeEndM < R.evictM && R.armOnM < R.evictM && R.armOnM >= R.fadeEndM,
    );
    check(
      'CT-2 CITY_RANGE on: the skyline request carries the dense-core rule',
      on.requestOn?.cityRange?.denseMinH === R.skyline.denseMinH && on.requestOn?.cityRange?.denseTallCount === R.skyline.denseTallCount && R.skyline.denseMinH < 35,
      JSON.stringify(on.requestOn),
    );
  }

  // ===================== CT-2: the worker on the fixture =====================
  // The worker children install the offline fixture themselves (the node
  // fetch shim in scripts/_fixture.js), so this gate needs no environment and
  // runs the same inside scripts/ship-pass-gates.mjs.
  {
    const realWorker = path.join(ROOT, 'lib/fly/toy-world/vector-tile.worker.js');
    let baseWorker = null;
    let tmp = null;
    try {
      const text = execFileSync('git', ['-C', ROOT, 'show', 'main:lib/fly/toy-world/vector-tile.worker.js'], { encoding: 'utf8', maxBuffer: 64 << 20 });
      tmp = mkdtempSync(path.join(os.tmpdir(), 'ship-city-'));
      baseWorker = path.join(tmp, 'vector-tile.worker.main.js');
      writeFileSync(baseWorker, text);
    } catch (e) {
      check('CT-2 main\'s worker is readable (git show main:…)', false, String(e.message).slice(0, 160));
    }
    const offReqs = [
      { label: 'skyline', detail: 'sat-skyline', opts: { visuals: true } },
      { label: 'buildings', detail: 'sat-buildings', opts: { visuals: true } },
      { label: 'roads', detail: 'sat-roads', opts: {} },
      { label: 'skyline-classic', detail: 'sat-skyline', opts: { visuals: false } },
    ];
    const cur = runChild(['--child=worker', realWorker, realWorker, JSON.stringify(offReqs)], { FLY_TILE_FIXTURE: '1' });
    if (baseWorker) {
      const base = runChild(['--child=worker', baseWorker, realWorker, JSON.stringify(offReqs)], { FLY_TILE_FIXTURE: '1' });
      const keys = Object.keys(base);
      const diff = keys.filter((k) => base[k].digest !== cur[k]?.digest);
      const built = keys.filter((k) => cur[k].idx > 0).length;
      check(
        'CT-2 flag off: worker output is byte-identical to main\'s worker (skyline, buildings, roads, Classic skyline; 12 fixture tiles each)',
        diff.length === 0 && built >= 20,
        diff.length ? `differs: ${diff.slice(0, 6).join(', ')}` : `${keys.length} builds, ${built} non-empty`,
      );
      rmSync(tmp, { recursive: true, force: true });
    }
    const onReqs = [
      { label: 'skyline', detail: 'sat-skyline', opts: { visuals: true } },
      { label: 'skyline-on', detail: 'sat-skyline', opts: { visuals: true, cityRange: on.requestOn.cityRange } },
      { label: 'skyline-premix0', detail: 'sat-skyline', opts: { visuals: true, premix: false } },
      { label: 'classic', detail: 'sat-skyline', opts: { visuals: false } },
      { label: 'classic-premix0', detail: 'sat-skyline', opts: { visuals: false, premix: false } },
    ];
    const w = runChild(['--child=worker', realWorker, realWorker, JSON.stringify(onReqs)], { FLY_TILE_FIXTURE: '1' });
    const cores = TILES.filter((t) => w[`skyline-on|${t.name}`].dense?.core);
    const nonCores = TILES.filter((t) => !w[`skyline-on|${t.name}`].dense?.core);
    const grow = cores.map((t) => `${t.name} ${w[`skyline|${t.name}`].idx}->${w[`skyline-on|${t.name}`].idx} (+${w[`skyline-on|${t.name}`].dense.added})`);
    const grew = cores.filter((t) => w[`skyline-on|${t.name}`].dense.added > 0);
    const capped = cores.filter((t) => w[`skyline-on|${t.name}`].dense.added === 0);
    check(
      'CT-2 CITY_RANGE on: fixture Midtown is a dense core; an under-filled core gains mapped 20-35 m blocks',
      cores.filter((t) => t.name.startsWith('midtown')).length >= 5 && grew.length >= 3 && grew.every((t) => w[`skyline-on|${t.name}`].idx > w[`skyline|${t.name}`].idx),
      `${cores.length} cores: ${grow.join('; ')}`,
    );
    check(
      'CT-2 CITY_RANGE on: a core whose cap is already full keeps today\'s towers byte for byte (extras never displace)',
      capped.every((t) => w[`skyline-on|${t.name}`].geo === w[`skyline|${t.name}`].geo),
      capped.length ? capped.map((t) => t.name).join(', ') : 'no capped core in the set',
    );
    check(
      'CT-2 CITY_RANGE on: a tile that is not a core (suburb, desert) builds byte-identical geometry',
      nonCores.length >= 2 && nonCores.some((t) => t.name === 'owens') && nonCores.every((t) => w[`skyline-on|${t.name}`].geo === w[`skyline|${t.name}`].geo),
      nonCores.map((t) => `${t.name}(tall ${w[`skyline-on|${t.name}`].dense?.tall ?? 0})`).join(', '),
    );
    check(
      'CT-1 skylinePremix: 0 is a no-op on Enhanced output (no baked premix exists there) and removes it from Classic',
      TILES.every((t) => w[`skyline-premix0|${t.name}`].digest === w[`skyline|${t.name}`].digest) &&
        TILES.some((t) => w[`classic|${t.name}`].idx > 0 && w[`classic-premix0|${t.name}`].geo !== w[`classic|${t.name}`].geo),
    );
    globalThis.__shipCityWorker = { cur, w };
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
