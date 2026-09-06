/**
 * R24 B WORLD — GROUND_VIS (recon A6, T8). Pure function of the constants and
 * the slew helper: no browser, no GL, no network.
 *
 * RED. R22 measured the raw `flight.groundElev` stepping ~384 m in a SINGLE
 * frame when a finer DEM tile lands under the aircraft. Every AGL-keyed band
 * in the world reads that value, so one refinement sweeps the bend datum, the
 * building / skyline / road fades, the POI letter horizon, the micro-detail
 * and quilt ramps and the altitude atmosphere all at once.
 *
 * GATES
 *  (1) RED   — flag off, the visual value reproduces the raw 384 m step exactly.
 *  (2) GREEN — flag on, no frame moves it by more than maxStepM…
 *  (3)       — …and it still CONVERGES to the raw value (a damper that never
 *              arrives is a different bug).
 *  (4) WARP  — a warpEpoch bump SNAPS: a cut is not a ramp.
 *  (5) SEAM  — the flight model's own value is untouched by any of this.
 */
import fs from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';

// The repo imports relative modules WITHOUT extensions (Next resolves those;
// bare node does not) — verify-seam's hook, verbatim.
registerHooks({
  resolve(spec, ctx, next) {
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
});

const { GROUND_VIS } = await import('../lib/fly/fly-constants.js');
const { groundElevVis, stepGroundVis } = await import('../lib/fly/ground-vis.js');

const STEP_M = 384; // the archived R22 measurement
// Both legs are driven explicitly below, so this gate is independent of the
// shipped flag — but it must hand the module back exactly as it found it.
const SHIPPED = GROUND_VIS.enabled;
let fails = 0;
const gate = (n, ok, d = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ' — ' + d : ''}`);
  if (!ok) fails++;
};

function run(enabled, { warpAt = -1, frames = 400 } = {}) {
  const prevFlag = GROUND_VIS.enabled;
  GROUND_VIS.enabled = enabled;
  const runtime = {};
  const flight = { groundElev: 100, pos: { y: 900 } };
  let epoch = 0;
  let worst = 0;
  let converged = -1;
  stepGroundVis(runtime, flight, epoch); // seed
  // The delta a CONSUMER sees is frame-to-frame, so it is measured across the
  // frame boundary — not around the step call, which would miss the flag-off
  // case entirely (there the value moves when the raycast writes it).
  let last = groundElevVis(runtime, flight);
  for (let f = 0; f < frames; f++) {
    if (f === 20) flight.groundElev = 100 + STEP_M; // the DEM refines
    if (f === warpAt) epoch += 1;
    stepGroundVis(runtime, flight, epoch);
    const after = groundElevVis(runtime, flight);
    if (f >= 20) worst = Math.max(worst, Math.abs(after - last));
    last = after;
    if (converged < 0 && f > 20 && Math.abs(after - flight.groundElev) < 1e-6) converged = f - 20;
  }
  GROUND_VIS.enabled = prevFlag;
  return { worst, converged, raw: flight.groundElev, vis: groundElevVis(runtime, flight) };
}

const red = run(false);
gate('(1) RED flag off: the visual ground takes the raw step whole', red.worst >= STEP_M - 1e-6, `worst frame delta ${red.worst.toFixed(1)} m`);

const green = run(true);
gate('(2) GREEN no frame moves it by more than maxStepM', green.worst <= GROUND_VIS.maxStepM + 1e-6, `worst ${green.worst.toFixed(3)} m <= ${GROUND_VIS.maxStepM}`);
gate('(3) GREEN it still converges to the raw value', green.converged > 0 && green.vis === green.raw, `converged after ${green.converged} frames (~${(green.converged / 60).toFixed(2)} s at 60 Hz)`);

const warp = run(true, { warpAt: 25 });
gate('(4) WARP a warpEpoch bump SNAPS', warp.worst > GROUND_VIS.maxStepM, `snap delta ${warp.worst.toFixed(1)} m`);

// (5) the seam: nothing above ever writes flight.groundElev.
const rt = {};
const fl = { groundElev: 42, pos: { y: 500 } };
GROUND_VIS.enabled = true;
stepGroundVis(rt, fl, 0);
fl.groundElev = 900;
for (let i = 0; i < 10; i++) stepGroundVis(rt, fl, 0);
gate('(5) SEAM the flight model keeps the RAW value', fl.groundElev === 900, `flight.groundElev ${fl.groundElev} · visual ${groundElevVis(rt, fl).toFixed(1)}`);
GROUND_VIS.enabled = SHIPPED; // restore the SHIP state, never a hard-coded one

console.log(`\nVERIFY: ${fails ? 'FAIL' : 'PASS'}`);
process.exit(fails ? 1 : 0);
