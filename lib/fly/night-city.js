/**
 * ROUND 23 (B "CITY-LIGHT") — the NIGHT_CITY_R23 arm.
 *
 * Three states, exactly the R22 DEPTH_PASS (`__flyDepthArm`) idiom, and for the
 * same reason: the block ships `enabled: false`, so the whole existing harness
 * fleet sees the R19 world with no fleet pin at all — there is nothing to pin
 * OFF. What a gate (or an A/B capture) needs is the opposite lever, a way to
 * turn it ON for one page:
 *
 *   1. `window.__flyNightCityArm === 1` — force ON  (A/B legs, verify gates)
 *   2. `window.__flyNightCityArm === 0` — force OFF (the paired control leg)
 *   3. otherwise — the shipped constant (false until Fable flips it)
 *
 * Both overrides are `window`-only and dev-reachable only: a user machine
 * defines neither, so "built but off" keeps meaning exactly that.
 *
 * WHEN IT IS READ. The road and building night terms choose their SHADER
 * SOURCE off this (armed ⇒ the '-r23' program, disarmed ⇒ the R19 program
 * verbatim), and a material's source is fixed at apply time — so flipping the
 * arm mid-session does NOT re-write a compiled program. An A/B that must move
 * the source re-boots; an A/B that only moves a knob writes uniforms through
 * `window.__flyNightCity` and lands on the very next frame. That split is
 * deliberate: it is what makes flag-off byte-identity structural (the disarmed
 * tree never compiles a single R23 instruction) instead of arithmetic.
 */
import { NIGHT_CITY_R23, SAT_BUILDINGS, SAT_ROADS, SUBURB_NIGHT } from './fly-constants';
import {
  getNightCityRoads,
  getNightCityWindows,
  setNightCityRoadGain,
  setNightCityRoads,
  setNightCityWindows,
} from './toy-world/world-bend';

/**
 * Master arm, plus an optional sub-block gate ('roads' | 'windows' | 'tier').
 * A sub-block is only ever consulted once the master is on, so one boolean
 * still reverts the entire round-23 B surface.
 */
export function nightCityOn(sub) {
  let on = NIGHT_CITY_R23.enabled === true;
  if (typeof window !== 'undefined') {
    const arm = window.__flyNightCityArm;
    if (arm === 1) on = true;
    else if (arm === 0) on = false;
  }
  if (!on) return false;
  if (!sub) return true;
  return NIGHT_CITY_R23[sub]?.enabled === true;
}

/**
 * The SWEPT BASELINE — the R16/R19 values this round's knobs shadow, in one
 * place. It is not a copy: every number is READ from the block that owns it, so
 * the control leg of an A/B cannot silently drift from the history it claims to
 * restore. (`lamp` is the one exception — R16 baked those two as GLSL literals,
 * so they are named here with a comment pointing at their source line.)
 */
export const NIGHT_CITY_SWEPT = {
  roads: {
    intensity: SAT_ROADS.night.intensity, // R16 sweep: 2.4
    streetGain: SUBURB_NIGHT.streetGain, // R19 (C): { c5: 0.24, c6: 0.34 }
    stream: {
      boost: SAT_ROADS.night.streamBoost,
      dashLenM: SAT_ROADS.night.dashLenM,
      dashDuty: SAT_ROADS.night.dashDuty,
      dashSpeed: SAT_ROADS.night.dashSpeed,
    },
    lamp: { gain: 1.6, sharp: 260 }, // world-bend STREET_DOT_GAIN / _SHARP (R16)
    traffic: { boost: 0, lanes: 0 }, // the R23 term contributing literally nothing
  },
  windows: { phase: 0, gain: { min: 1, max: 1 }, darkFrac: 0, darkGain: 0, tintJitter: 0 },
};

/**
 * DEV/HARNESS HANDLE (`window.__flyNightCity`) — the A/B lever for every knob
 * this round moves. All of them are live uniforms, so a leg is one
 * page.evaluate and lands on the next frame; only the ARM itself needs a reboot
 * (it picks the shader source).
 *
 *   __flyNightCity.swept()   → the R16/R19 swept baseline (the control leg)
 *   __flyNightCity.r23()     → the NIGHT_CITY_R23 values as shipped
 *   __flyNightCity.set({ roads, windows }) → an arbitrary partial leg
 *   __flyNightCity.read()    → what the GPU is actually running
 *
 * Installed only under NODE_ENV=development and only by a mounted satellite
 * layer, so it cannot exist on a production build.
 */
export function installNightCityDevHandle() {
  if (typeof window === 'undefined') return;
  const cells = { cols: SAT_BUILDINGS.facade.cols, rows: SAT_BUILDINGS.facade.rows };
  const applyRoads = (r) => {
    setNightCityRoadGain(
      r.intensity,
      r.streetGain.c5,
      r.streetGain.c6,
      r.stream?.boost
    );
    setNightCityRoads(r);
  };
  window.__flyNightCity = {
    armed: nightCityOn(),
    swept() {
      applyRoads({ ...NIGHT_CITY_SWEPT.roads, traffic: { ...NIGHT_CITY_SWEPT.roads.traffic, dashLenM: NIGHT_CITY_R23.roads.traffic.dashLenM, dashDuty: NIGHT_CITY_R23.roads.traffic.dashDuty, speed: NIGHT_CITY_R23.roads.traffic.speed } });
      setNightCityWindows(NIGHT_CITY_SWEPT.windows, cells);
      return this.read();
    },
    r23() {
      applyRoads(NIGHT_CITY_R23.roads);
      setNightCityWindows(NIGHT_CITY_R23.windows, cells);
      return this.read();
    },
    set(patch) {
      if (patch?.roads) applyRoads({ ...NIGHT_CITY_R23.roads, ...patch.roads });
      if (patch?.windows) setNightCityWindows({ ...NIGHT_CITY_R23.windows, ...patch.windows }, cells);
      return this.read();
    },
    read: () => ({ roads: getNightCityRoads(), windows: getNightCityWindows() }),
  };
}
