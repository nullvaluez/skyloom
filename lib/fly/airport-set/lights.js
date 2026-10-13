// Every light of the airport set seen at a distance, in ONE GlowPoints draw
// (lib/fly/glow-points.js: sky-overlay pass, view-space quads, min-px floor):
// flood mast luminaires, obstruction lights (tower, hangars, terminal, masts,
// windsocks), bridge cab lamps, VDGS boards, and the beacons, headlights and
// tail lights of parked and moving ground vehicles.
//
// The GlowPoints mesh lives inside the set group, so positions are room-local
// metres (its modelMatrix carries heading and the Mercator scale). Beam
// directions are SCENE directions (glow-points contract), converted here.
import { GlowPoints, GLOW_MODE } from '../glow-points.js';
import { GSE_KIT } from './gse.js';

const WHITE = [1.0, 0.9, 0.76];
const RED = [1.0, 0.05, 0.02];
const AMBER = [1.0, 0.55, 0.08];
const HEAD = [1.0, 0.96, 0.9];
const TAIL = [1.0, 0.08, 0.04];

/** Intensity multiplier for a light category at a night weight (0 day .. 1 night). */
function categoryGain(cat, night) {
  switch (cat) {
    case 'flood': return night;
    case 'obstruction': return Math.min(1, night * 1.4);
    case 'beacon': return 0.7 + 0.3 * night;
    case 'head': return 0.12 + 0.88 * night;
    case 'tail': return 0.08 + 0.92 * night;
    case 'cab': return night;
    case 'display': return 0.55 + 0.45 * night;
    default: return 1;
  }
}

export class SetLights {
  /**
   * @param plan    planAirportSet() result
   * @param frame   { k, heading } of the set group (scene direction conversion)
   * @param fixtures { towerTop, cab: [...] } anchors measured by the builders
   */
  constructor(plan, frame, fixtures = {}) {
    this.k = frame.k;
    this.c = Math.cos(frame.heading);
    this.s = Math.sin(frame.heading);
    this.glow = new GlowPoints({ capacity: 640, name: 'airport-set-lights', dynamic: true, energyPow: 1, energyFloor: 0.0, core: 10, halo: 0.6, cloudFloor: 0.35, pullM: 1.2 });
    this.lights = []; // { cat, base, i }
    this.n = 0;
    this.night = -1;
    this.movers = []; // { part, anchors: [{ i, local, kind }] }
    this._authorStatic(plan, fixtures);
  }

  /** Room-local direction -> scene direction (glow-points beam contract). */
  dir(dx, dy, dz) {
    const x = dx * this.c + dz * this.s, z = -dx * this.s + dz * this.c;
    return [x * this.k, dy, z * this.k];
  }

  /** Author light i. `tag`: 'ground' follows the ground field, 'fx:x,z' a far fixture's lift. */
  add(cat, x, y, z, rgb, base, opts = {}, tag = null) {
    const i = this.n++;
    if (i >= this.glow.capacity) return -1;
    this.glow.set(i, x, y, z, rgb[0], rgb[1], rgb[2], 0, opts);
    this.lights.push({ cat, base, i, x, y, z, tag });
    return i;
  }

  /** Re-seat ground-tagged lights on a ground field. */
  drape(ground) {
    for (const l of this.lights) if (l.tag === 'ground') this.glow.move(l.i, l.x, l.y + ground.at(l.x, l.z), l.z);
    this.glow.touch(true, false, false);
  }

  /** Lift the lights of the far fixture standing at (x, z) by dy metres. */
  shiftFixture(x, z, dy) {
    const tag = `fx:${x},${z}`;
    for (const l of this.lights) if (l.tag === tag) this.glow.move(l.i, l.x, l.y + dy, l.z);
    this.glow.touch(true, false, false);
  }

  _authorStatic(plan, fx) {
    // Flood masts: eight luminaires on a fan aimed down at the apron.
    for (const m of plan.masts) {
      const yaw = m.yaw || 0, cy = Math.cos(yaw), sy = Math.sin(yaw);
      for (let k = 0; k < 8; k++) {
        const a = -Math.PI / 2 + ((k - 3.5) / 7) * 2.2;
        const lx = Math.cos(a) * 1.45, lz = Math.sin(a) * 1.45;
        const x = m.x + lx * cy + lz * sy, z = m.z - lx * sy + lz * cy;
        const out = [x - m.x, z - m.z];
        const l = Math.hypot(out[0], out[1]) || 1;
        this.add('flood', x, m.h - 0.6, z, WHITE, 2.2, { size: 0.9, minPx: 2.2, maxPx: 70, beam: this.dir(out[0] / l * 0.55, -0.83, out[1] / l * 0.55), sharp: 3 });
      }
      this.add('obstruction', m.x, m.h + 0.2, m.z, RED, 1.0, { size: 0.35, minPx: 1.6 });
    }
    // Eave floodlights over the stands.
    for (const f of plan.roofFloods || []) {
      for (const x of f.lamps) this.add('flood', x, f.y, f.z, WHITE, 1.7, { size: 0.55, minPx: 1.8, maxPx: 60, beam: this.dir(0, -0.78, -0.62), sharp: 3 });
    }
    // Tower: top obstruction (slow flash) and four cab-roof reds.
    if (plan.tower && fx.tower) {
      const t = plan.tower, f = fx.tower, y0 = fx.towerY ?? 0;
      const tag = `fx:${t.x},${t.z}`;
      this.add('obstruction', t.x, y0 + f.top, t.z, RED, 1.6, { size: 0.6, minPx: 2.0, mode: GLOW_MODE.BEACON, hz: 0.5 }, tag);
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2 + 0.4;
        this.add('obstruction', t.x + Math.cos(a) * f.rCab * 1.2, y0 + f.roofY + 0.2, t.z + Math.sin(a) * f.rCab * 1.2, RED, 0.9, { size: 0.35, minPx: 1.6 }, tag);
      }
    }
    for (const h of plan.hangars) {
      const tag = `fx:${h.x},${h.front}`;
      for (const x of [h.x - h.w / 2, h.x + h.w / 2]) this.add('obstruction', x, h.h + 0.25, h.front - 0.5, RED, 0.9, { size: 0.35, minPx: 1.6 }, tag);
      for (let x = h.x - h.w / 2 + 6; x < h.x + h.w / 2 - 3; x += 12) this.add('flood', x, h.h - 3.2 + 0.25, h.front - 0.7, WHITE, 0.9, { size: 0.45, minPx: 1.4, beam: this.dir(0, -0.8, -0.6), sharp: 4 }, tag);
    }
    // Terminal: red obstruction lights on the stair cores at the pier ends.
    const T = plan.terminal;
    for (const x of [T.x0 - 4.2, T.x1 + 4.2]) this.add('obstruction', x, T.roofY + 3.4, T.z1 - 6, RED, 0.9, { size: 0.35, minPx: 1.6 });
    // Windsocks: red top light, a white lamp washing the sock.
    for (const ws of plan.windsocks) {
      const tag = `fx:${ws.x},${ws.z}`;
      this.add('obstruction', ws.x, 7.05, ws.z, RED, 0.9, { size: 0.3, minPx: 1.4 }, tag);
      this.add('flood', ws.x, 6.2, ws.z, WHITE, 0.5, { size: 0.35, minPx: 1.2 }, tag);
    }
    // Bridge cab lamps (docked pose) and VDGS boards.
    for (const s of plan.stands) {
      for (const b of s.bridges) {
        const p = b.docked;
        this.add('cab', p.cab.x - 1.2, p.floorB + 2.95, p.cab.z, WHITE, 0.55, { size: 0.3, minPx: 1.3 });
      }
      if (s.bridges.length) this.add('display', s.x, plan.gateY + 3.1, plan.terminal.z0 - 0.6, AMBER, 0.45, { size: 0.5, minPx: 1.2 });
    }
  }

  /** Parked vehicles with their engines running: beacons only. */
  addParkedBeacon(x, y, z, phase) {
    return this.add('beacon', x, y, z, AMBER, 1.1, { size: 0.25, minPx: 1.6, mode: GLOW_MODE.BEACON, hz: 1.25, phase }, 'ground');
  }

  /** Register a moving vehicle part's lights; positions follow `update()`. */
  addMover(part, seed) {
    const L = GSE_KIT[part.type]?.lights;
    if (!L) return;
    const anchors = [];
    (L.beacon || []).forEach((p, k) => anchors.push({ i: this.add('beacon', 0, -999, 0, AMBER, 1.2, { size: 0.25, minPx: 1.6, mode: GLOW_MODE.BEACON, hz: 1.2 + 0.1 * k, phase: (seed * 0.137 + k * 0.5) % 1 }), local: p, kind: 'beacon' }));
    (L.head || []).forEach((p) => anchors.push({ i: this.add('head', 0, -999, 0, HEAD, 1.0, { size: 0.22, minPx: 1.4, beam: [0, 0, -1], sharp: 6 }), local: p, kind: 'head' }));
    (L.tail || []).forEach((p) => anchors.push({ i: this.add('tail', 0, -999, 0, TAIL, 0.6, { size: 0.16, minPx: 1.1 }), local: p, kind: 'tail' }));
    this.movers.push({ part, anchors });
  }

  commit() {
    this.glow.setCount(this.n);
  }

  /** Per-frame: move mover lights (parts carry x, z, yaw), re-dim on night change. */
  update(camera, heightPx, time, night) {
    for (const m of this.movers) {
      const { x, z, yaw } = m.part, y = m.part.y || 0;
      const c = Math.cos(yaw), s = Math.sin(yaw);
      for (const a of m.anchors) {
        if (a.i < 0) continue;
        const [lx, ly, lz] = a.local;
        this.glow.move(a.i, x + lx * c + lz * s, y + ly, z - lx * s + lz * c);
        if (a.kind === 'head') {
          const d = this.dir(-s, -0.08, -c);
          this.glow.aim(a.i, d[0], d[1], d[2], 6);
        }
      }
    }
    this.glow.touch(true, true, false);
    const q = Math.round(night * 50) / 50;
    if (q !== this.night) {
      this.night = q;
      for (const l of this.lights) this.glow.dim(l.i, l.base * categoryGain(l.cat, q));
      this.glow.touch(false, false, true);
    }
    this.glow.update(camera, heightPx, time, 1, 0);
  }

  dispose() {
    this.glow.dispose();
  }
}
