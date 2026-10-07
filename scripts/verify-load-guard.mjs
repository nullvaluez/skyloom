/**
 * TRUE EARTH — verify-load-guard: LOAD_GUARD (lib/fly/load-guard.js and its
 * readers: lib/fly/world-readiness.js, lib/fly/earth-surface-engine.js,
 * lib/fly/terrain-engine.js + the vendored three-tile patch R26-1,
 * components/fly/hud/WarpFlash.jsx, components/fly/hud/BootScreen.jsx).
 *
 * THE DEFECTS
 *  - OpenFreeMap 404s open-ocean vector tiles; such a slot is 'no-data'
 *    forever, and the readiness rings counted only 'ready' as done, so an ocean
 *    arrival held until the player found the 45 s "reduced detail" prompt.
 *  - three-tile: an update that changed nothing never advanced `_loadedEpoch`,
 *    so the tile re-entered `_updateModel` on every walk forever and the loader
 *    never went quiet: terrain never read "sharp" (FLY_ROUND24.md §4.2).
 *  - neither Enhanced hold had a time limit.
 *
 * THE CONTRACT
 *  (1) flag explicitly off: every helper is off; a no-data chunk still blocks
 *      the ring exactly as before;
 *  (2) flag on: a no-data chunk counts as done; caps are 20 s boot / 15 s warp;
 *  (3) the vendored patch: with settleNoop OFF an unchanged update leaves the
 *      epoch unsettled (upstream, the defect); ON it settles; a CHANGED update
 *      behaves identically either way (settles + one 'tile-loaded' event);
 *  (4) the wiring: terrain-engine arms settleNoop from the guard; the earth
 *      near ring counts no-data under the guard; both holds use holdCapMs and
 *      report reason 'time-cap'.
 *
 * Run: node scripts/verify-load-guard.mjs
 */
import { register } from 'node:module';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const legArg = process.argv.find((a) => a.startsWith('--leg='));

if (legArg) {
  // A CHILD LEG: resolve the pin the way the app does (once, at import).
  globalThis.window = { __flyLoadGuardOverride: { enabled: legArg === '--leg=on' } };
  register('./_node-resolve.mjs', import.meta.url);
  const guard = await import('../lib/fly/load-guard.js');
  const { localRingReadiness } = await import('../lib/fly/world-readiness.js');
  const WORLD = 40075016.68557849;
  const zoom = 14;
  const span = WORLD / 2 ** zoom;
  const flight = { pos: { x: 1000, z: -2000 }, latDeg: 0 };
  const chunks = new Map();
  for (let x = -40; x <= 40; x++) {
    for (let y = -40; y <= 40; y++) {
      const tx = Math.floor((flight.pos.x + WORLD / 2) / span) + x;
      const ty = Math.floor((flight.pos.z + WORLD / 2) / span) + y;
      chunks.set(`${zoom}/${tx}/${ty}`, { state: 'ready' });
    }
  }
  const allReady = localRingReadiness({ chunks }, flight);
  const under = `${zoom}/${Math.floor((flight.pos.x + WORLD / 2) / span)}/${Math.floor((flight.pos.z + WORLD / 2) / span)}`;
  chunks.set(under, { state: 'empty', reason: 'no-data' });
  const withNoData = localRingReadiness({ chunks }, flight);
  chunks.set(under, { state: 'error' });
  const withError = localRingReadiness({ chunks }, flight);
  console.log(
    JSON.stringify({
      noData: guard.noDataCountsReady(),
      settle: guard.settleNoopOn(),
      boot: guard.holdCapMs('boot'),
      warp: guard.holdCapMs('warp'),
      allReady: allReady.ready,
      total: allReady.total,
      withNoData: withNoData.ready,
      withError: withError.ready,
    }),
  );
  process.exit(0);
}

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}
const leg = (name) =>
  JSON.parse(
    execFileSync(process.execPath, [fileURLToPath(import.meta.url), `--leg=${name}`], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .trim()
      .split('\n')
      .pop(),
  );

// (1) and (2)
const off = leg('off');
const on = leg('on');
check(
  '(1) flag explicitly off: helpers off, a no-data chunk still blocks the ring',
  !off.noData && !off.settle && off.boot === null && off.warp === null && off.allReady && !off.withNoData && !off.withError && off.total > 0,
  JSON.stringify(off),
);
check(
  '(2) flag on: a no-data chunk counts as done (an error still blocks); caps 20 s / 15 s',
  on.noData && on.settle && on.boot === 20000 && on.warp === 15000 && on.allReady && on.withNoData && !on.withError,
  JSON.stringify(on),
);

// (3) the vendored patch, driven through the real Tile.prototype._updateModel
register('./_node-resolve.mjs', import.meta.url);
{
  const vendor = await import('../lib/fly/vendor/three-tile/index.js');
  const { Tile, setFlyPatch, flyGetPatch } = vendor;
  const run = async (settleNoop, changed) => {
    setFlyPatch({ settleNoop });
    const events = [];
    const root = { _epoch: 7, dispatchEvent: (e) => events.push(e.type) };
    const tile = Object.create(Tile.prototype);
    Object.defineProperty(tile, 'model', { value: { maxHeight: 12 }, configurable: true });
    tile._root = root;
    tile.parent = {};
    tile._loadedEpoch = 6;
    tile._loadState = 'loaded';
    await Tile.prototype._updateModel.call(tile, { update: async () => changed });
    return { epoch: tile._loadedEpoch, needs: tile._loadedEpoch < root._epoch && tile._loadState !== 'empty', events, state: tile._loadState };
  };
  const before = flyGetPatch().settleNoop;
  const upstreamNoop = await run(false, false);
  const patchedNoop = await run(true, false);
  const upstreamChanged = await run(false, true);
  const patchedChanged = await run(true, true);
  setFlyPatch({ settleNoop: before });
  check(
    '(3) three-tile R26-1: off = the defect (unchanged update never settles); on = settles; a changed update is identical',
    before === false &&
      upstreamNoop.needs === true && upstreamNoop.epoch === 6 &&
      patchedNoop.needs === false && patchedNoop.epoch === 7 && patchedNoop.events.length === 0 &&
      JSON.stringify(upstreamChanged) === JSON.stringify(patchedChanged) &&
      upstreamChanged.epoch === 7 && upstreamChanged.events.join() === 'tile-loaded',
    `upstream unchanged ${JSON.stringify(upstreamNoop)}; patched unchanged ${JSON.stringify(patchedNoop)}; changed ${JSON.stringify(patchedChanged)}`,
  );
}

// (4) the wiring
{
  const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
  const terrain = read('lib/fly/terrain-engine.js');
  const earth = read('lib/fly/earth-surface-engine.js');
  const warp = read('components/fly/hud/WarpFlash.jsx');
  const boot = read('components/fly/hud/BootScreen.jsx');
  const ok =
    terrain.includes('settleNoop: settleNoopOn(),') &&
    earth.includes("const noDataDone=noDataCountsReady();") &&
    earth.includes("if(slot.state==='ready'||noDataDone&&slot.state==='no-data')near.done++;") &&
    warp.includes("const capMs=holdCapMs('warp');") &&
    warp.includes("capped?'time-cap'") &&
    boot.includes("holdCapMs('boot')") &&
    boot.includes("'time-cap'");
  check('(4) wiring: terrain arms R26-1, the near ring counts no-data, both holds are capped', ok);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
