// External lights of live traffic, through GlowPoints (one instanced draw,
// sky-overlay pass, view-space sprites with a pixel floor and energy falloff).
//
// Per aircraft (positions from fleet-layout.js anchors, transformed by the
// same instance matrix the airframe uses, so a lamp never leaves its mesh):
//   nav       red left tip, green right tip, white tail (steady, sectored)
//   beacon    red rotating beacons top and bottom (anti-collision, always on
//             while the transponder is live; off for parked scenery)
//   strobe    white double-flash at the wing tips and tail (airborne and on
//             the runway)
//   landing   wing-root / nose beams: blinding head-on, dim from the side,
//             visible in daylight (the classic spotter cue on final)
//   taxi      nose-gear beam on the ground; runway turn-off lamps angled out
// Daylight keeps the strong lamps and dims the small ones: overlays get no
// exposure, so the radiance is multiplied by the frame's exposure here.
import { Matrix3, Vector3 } from 'three';
import { GLOW_MODE, GlowPoints } from './glow-points';
import { FLEET_VIEW } from './observation-config';

const _p = new Vector3();
const _d = new Vector3();
const _n = new Matrix3();
const RED = [1, 0.07, 0.04], GREEN = [0.1, 1, 0.38], WHITE = [1, 0.97, 0.93], LAMP = [1, 0.93, 0.8], BEACON = [1, 0.1, 0.06];

/** Stable 0..1 phase per hex so fleets never flash in unison. */
function phaseOf(hex) {
  let h = 2166136261;
  const s = String(hex ?? '');
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return (h % 997) / 997;
}

export class AircraftLights {
  constructor({ capacity = FLEET_VIEW.lights.capacity } = {}) {
    this.glow = new GlowPoints({ capacity, name: 'aircraft-lights', dynamic: true, energyPow: 0.72, energyFloor: 0, core: 11, halo: 0.6, cloudFloor: 0.25, pullM: 0.6 });
    this.n = 0;
    this.night = 0;
    this.stats = { lights: 0, aircraft: 0 };
  }
  get mesh() {
    return this.glow.mesh;
  }
  /** Start a frame. night 0..1 (1 = full night). */
  begin(night = 0) {
    this.n = 0;
    this.night = night;
    this.stats.aircraft = 0;
  }
  _put(x, y, z, c, intensity, opts) {
    if (this.n >= this.glow.capacity || intensity <= 0) return;
    this.glow.set(this.n++, x, y, z, c[0], c[1], c[2], intensity, opts);
  }
  /** Transform a model-space anchor (with plug shift and wing bend) through the instance matrix. */
  _anchor(a, matrix, spec, state, flexTip) {
    let z = a.z;
    if (spec) z += a.seg < 0 ? -spec.plugF : a.seg > 0 ? spec.plugA : 0;
    _p.set(a.x, a.y + (flexTip && Math.abs(a.x) > 2 ? flexTip * (state?.load ?? 1) : 0), z).applyMatrix4(matrix);
    return _p;
  }
  _dir(x, y, z) {
    return _d.set(x, y, z).applyMatrix3(_n).normalize();
  }

  /**
   * One airframe. matrix: the instance matrix (rebased scene frame, Mercator
   * projected). layout: fleet-layout.js. spec: airframeSpec (null for the far
   * silhouettes: no plugs). state: the fleet state (gear/flaps/load and the
   * phase's light flags). track: the live track (hex for phases).
   */
  addAircraft(matrix, layout, spec, state, track, eff = 1) {
    const L = FLEET_VIEW.lights, a = layout.anchors, night = this.night;
    const small = (night + (1 - night) * L.dayFloor) * eff;
    const phase = phaseOf(track?.hex);
    const f = layout.family;
    // Glare size (metres): a lamp reads larger than its lens, the more so
    // for the strobes and landing lights.
    const size = Math.max(0.55, Math.min(1.2, f.length / 45));
    const flexTip = f.wing?.flex ?? 0.5 * (f.span / 35);
    _n.setFromMatrix4(matrix);
    this.stats.aircraft++;
    // Navigation lights: wide sectors, steady.
    if (a.navL) {
      const p = this._anchor(a.navL, matrix, spec, state, flexTip);
      this._put(p.x, p.y, p.z, RED, L.nav * small, { size, airborne: true, beam: this._dir(-0.8, 0, -0.6).toArray(), sharp: 1.1 });
    }
    if (a.navR) {
      const p = this._anchor(a.navR, matrix, spec, state, flexTip);
      this._put(p.x, p.y, p.z, GREEN, L.nav * small, { size, airborne: true, beam: this._dir(0.8, 0, -0.6).toArray(), sharp: 1.1 });
    }
    if (a.tail) {
      const p = this._anchor(a.tail, matrix, spec, state, 0);
      this._put(p.x, p.y, p.z, WHITE, L.nav * 0.8 * small, { size, airborne: true, beam: this._dir(0, 0, 1).toArray(), sharp: 1.4 });
    }
    // Anti-collision beacons.
    if (state?.beacon !== false) {
      for (const [k, ph] of [['beaconTop', 0], ['beaconBottom', 0.5]]) {
        if (!a[k]) continue;
        const p = this._anchor(a[k], matrix, spec, state, 0);
        this._put(p.x, p.y, p.z, BEACON, L.beacon * (night + (1 - night) * 0.35) * eff, { size: size * 1.2, airborne: true, hz: 0.75, phase: phase + ph, mode: GLOW_MODE.BEACON });
      }
    }
    // Strobes (double flash).
    if (state?.strobe) {
      for (const k of ['strobeL', 'strobeR']) {
        if (!a[k]) continue;
        const p = this._anchor(a[k], matrix, spec, state, flexTip);
        this._put(p.x, p.y, p.z, WHITE, L.strobe * eff, { size: size * 2.2, airborne: true, hz: 0.85, phase, duty: 0.035, mode: GLOW_MODE.DOUBLE });
      }
      if (a.tail) {
        const p = this._anchor(a.tail, matrix, spec, state, 0);
        this._put(p.x, p.y, p.z, WHITE, L.strobe * 0.7 * eff, { size: size * 1.8, airborne: true, hz: 0.85, phase: phase + 0.02, duty: 0.035, mode: GLOW_MODE.DOUBLE });
      }
    }
    // Landing lights: narrow forward beams, pitched a few degrees down.
    if (state?.landing) {
      const beam = this._dir(0, -0.07, -1).toArray();
      for (const l of a.landing) {
        const p = this._anchor(l, matrix, spec, state, 0);
        this._put(p.x, p.y, p.z, LAMP, L.landing * eff, { size: size * 2.4, minPx: 2.6, maxPx: 140, airborne: true, beam, sharp: 22 });
      }
    }
    // Taxi + runway turn-off lamps on the ground.
    if (state?.taxi && a.taxi) {
      const p = this._anchor(a.taxi, matrix, spec, state, 0);
      this._put(p.x, p.y, p.z, LAMP, L.taxi * eff, { size: size * 0.8, airborne: true, beam: this._dir(0, -0.12, -1).toArray(), sharp: 10 });
      for (const t of a.turnoff) {
        const q = this._anchor(t, matrix, spec, state, 0);
        this._put(q.x, q.y, q.z, LAMP, L.turnoff * eff, { size: size * 0.7, airborne: true, beam: this._dir(Math.sin(t.yaw), -0.1, -Math.cos(t.yaw)).toArray(), sharp: 6 });
      }
    }
  }

  /**
   * A contact drawn without a family layout (archetype GLBs, far glints):
   * beacon + strobe at its centre, nav lights at a nominal span.
   */
  addPoint(x, y, z, yaw, spanM, track, { strobe = true, eff = 1 } = {}) {
    const L = FLEET_VIEW.lights, night = this.night;
    const phase = phaseOf(track?.hex);
    const small = (night + (1 - night) * L.dayFloor) * eff;
    if (spanM > 0) {
      const c = Math.cos(yaw), s = Math.sin(yaw), h = spanM / 2;
      // Right wing = +x in the aircraft frame; yaw is the compass heading.
      this._put(x - c * h, y, z - s * h, RED, L.nav * small, { size: 0.4, airborne: true });
      this._put(x + c * h, y, z + s * h, GREEN, L.nav * small, { size: 0.4, airborne: true });
    }
    this._put(x, y + 0.5, z, BEACON, L.beacon * (night + (1 - night) * 0.35) * eff, { size: 0.5, airborne: true, hz: 0.75, phase, mode: GLOW_MODE.BEACON });
    if (strobe) this._put(x, y, z, WHITE, L.strobe * eff, { size: 0.5, airborne: true, hz: 0.85, phase, duty: 0.035, mode: GLOW_MODE.DOUBLE });
  }

  /** Upload and set the frame's projection, clock, exposure and air extinction. */
  end(camera, heightPx, time, exposure = 1, extinction = 0) {
    this.glow.setCount(this.n);
    this.glow.update(camera, heightPx, time, exposure, extinction);
    this.stats.lights = this.n;
  }

  dispose() {
    this.glow.dispose();
  }
}
