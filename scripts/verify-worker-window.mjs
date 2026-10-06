/**
 * TRUE EARTH — verify-worker-window: every web worker must load (and build a
 * tile) with NO `window`, under the compile Next.js actually ships.
 *
 * THE DEFECT (found by the CONDITIONS browser smoke, 2026-10-06). Next.js
 * compiles `typeof window` to "object" in every client bundle, web workers
 * included, so a bare `typeof window === 'undefined'` guard disappears from
 * worker code. TRUE_AREAS imported lib/fly/true-areas.js into the vector-tile
 * worker; its module-scope pinned() then read `window.__flyTrueAreasOverride`
 * unguarded and all six workers threw "window is not defined" at load: no
 * buildings, roads, skyline or vegetation. Every node gate was green, because
 * node does not apply that transform.
 *
 * THE INSTRUMENT. A load hook applies the same rewrite (`typeof window` →
 * "object") to every first-party module, with no window global, and then:
 *  (1) imports the vector-tile worker (comlink stubbed, as verify-true-areas);
 *  (2) imports the aircraft-processor worker;
 *  (3) with FLY_TILE_FIXTURE=1, builds real fixture tiles in the worker for
 *      every satellite detail and the toy ring, so function-scope guards on
 *      the build paths are exercised too;
 *  (4) the instrument itself: the same hook on a module that guards a bare
 *      `typeof window` must throw (else (1)–(3) prove nothing).
 *
 * Run: FLY_TILE_FIXTURE=1 node scripts/verify-worker-window.mjs
 */
import { registerHooks } from 'node:module';
import { existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT_URL = pathToFileURL(ROOT + path.sep).href;
const COMLINK_STUB = 'file:///worker-window-comlink-stub.mjs';
const require = createRequire(import.meta.url);

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

const SCRATCH = mkdtempSync(path.join(os.tmpdir(), 'worker-window-'));
const SCRATCH_URL = pathToFileURL(SCRATCH + path.sep).href;
const nextCompile = (src) => src.replace(/typeof\s+window\b/g, '"object"');

registerHooks({
  resolve(spec, ctx, next) {
    if (spec === 'comlink') return { url: COMLINK_STUB, shortCircuit: true };
    if (/^\.{1,2}\//.test(spec) && !/\.[a-z]+$/i.test(spec) && ctx.parentURL?.startsWith('file:')) {
      for (const ext of ['.js', '.mjs', '/index.js']) {
        try {
          if (existsSync(fileURLToPath(new URL(spec + ext, ctx.parentURL)))) return next(spec + ext, ctx);
        } catch {
          /* not this candidate */
        }
      }
    }
    if (spec.startsWith('@/')) return next(pathToFileURL(path.join(ROOT, spec.slice(2))).href + (/\.[a-z]+$/i.test(spec) ? '' : '.js'), ctx);
    return next(spec, ctx);
  },
  load(url, ctx, next) {
    if (url === COMLINK_STUB) {
      return {
        format: 'module',
        shortCircuit: true,
        source:
          'export const expose = (api) => { (globalThis.__workerApis ??= []).push(api); };\n' +
          'export const transfer = (v) => v;\nexport const wrap = () => ({});\n',
      };
    }
    const out = next(url, ctx);
    // App source only (ESM): lib, components, hooks, stores. scripts/ holds
    // CommonJS harness helpers that must load untouched.
    const first = /^(lib|components|hooks|stores)\//.test(url.startsWith(ROOT_URL) ? url.slice(ROOT_URL.length) : '') || url.startsWith(SCRATCH_URL);
    if (first && /\.(m?js|jsx)$/.test(url) && out.source != null) {
      const text = typeof out.source === 'string' ? out.source : Buffer.from(out.source).toString('utf8');
      return { ...out, format: out.format || 'module', source: nextCompile(text) };
    }
    return out;
  },
});

if (typeof globalThis.window !== 'undefined') delete globalThis.window;

// (4) the instrument: a bare guard must break under the rewrite.
{
  const probe = path.join(SCRATCH, 'guard-probe.mjs');
  writeFileSync(probe, "export const v = typeof window === 'undefined' ? 'safe' : window.__x;\n");
  let threw = false;
  try {
    await import(pathToFileURL(probe).href);
  } catch (e) {
    threw = /window is not defined/.test(String(e?.message));
  }
  check('(4) the instrument: a bare `typeof window` guard throws under the Next.js rewrite', threw);
}

async function load(rel) {
  try {
    await import(pathToFileURL(path.join(ROOT, rel)).href);
    return null;
  } catch (e) {
    return e;
  }
}

const vtErr = await load('lib/fly/toy-world/vector-tile.worker.js');
const vtApi = globalThis.__workerApis?.find((a) => typeof a?.buildTile === 'function');
check('(1) the vector-tile worker loads with no window', !vtErr && !!vtApi, vtErr ? String(vtErr.stack || vtErr).split('\n').slice(0, 3).join(' | ') : '');

const acErr = await load('lib/workers/aircraft-processor.worker.js');
check('(2) the aircraft-processor worker loads with no window', !acErr, acErr ? String(acErr.stack || acErr).split('\n').slice(0, 3).join(' | ') : '');

if (process.env.FLY_TILE_FIXTURE && vtApi) {
  const fx = await require('./_fixture').installNodeFetchFixture();
  const errors = [];
  try {
    await vtApi.init();
    const Z = 14;
    const lonToX = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);
    const latToY = (lat, z) => {
      const r = (lat * Math.PI) / 180;
      return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
    };
    const tiles = [
      { lat: 40.2083, lon: -83.0701 },
      { lat: 40.758, lon: -73.985 },
    ];
    const details = ['sat-buildings', 'sat-skyline', 'sat-roads', 'sat-veg', 'full'];
    let built = 0;
    for (const t of tiles) {
      for (const detail of details) {
        try {
          const r = await vtApi.buildTile(Z, lonToX(t.lon, Z), latToY(t.lat, Z), detail, { visuals: true });
          if (r) built++;
        } catch (e) {
          errors.push(`${detail}: ${String(e?.message || e).slice(0, 160)}`);
        }
      }
    }
    check('(3) fixture tiles build in the worker for every satellite detail and the toy ring', errors.length === 0 && built > 0, errors.length ? errors.join(' ; ') : `${built} builds`);
  } finally {
    fx.restore();
  }
} else {
  console.log('SKIP  (3) set FLY_TILE_FIXTURE=1 to build fixture tiles in the worker');
}

rmSync(SCRATCH, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
