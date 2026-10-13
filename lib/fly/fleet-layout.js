// Derived airframe layout: where the fuselage, wing, engines, gear and lights
// of a family (lib/fly/fleet-types.js) sit, in model metres (nose -Z, +Y up,
// X toward the right wing). Pure maths, no three imports: the geometry
// builder, the light set, contrail emitters, tyre smoke and parked scenery
// all read the SAME numbers, so a lamp or an exhaust can never drift off the
// mesh it belongs to.

const DEG = Math.PI / 180;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Superellipse ramp: 0 at u = 0, 1 at u = 1, blunt (p, q control the shoulder). */
const ramp = (u, p, q) => Math.pow(Math.max(0, 1 - Math.pow(1 - clamp(u, 0, 1), p)), q);

// Cockpit glazing in nose-relative units: stations as a fraction of the nose
// length, heights as a fraction of the fuselage half-height (fleet-material
// paints the panes; the numbers are the side-view outline of the windscreen).
const COCKPITS = {
  airbus: { s0: 0.36, s1: 0.86, yb: 0.2, yt: 0.6, ytr: 0.66, posts: [0.52, 0.7] },
  a350: { s0: 0.34, s1: 0.84, yb: 0.2, yt: 0.6, ytr: 0.66, posts: [0.52, 0.7] },
  a300: { s0: 0.36, s1: 0.86, yb: 0.22, yt: 0.6, ytr: 0.66, posts: [0.52, 0.7] },
  a380: { s0: 0.3, s1: 0.66, yb: -0.02, yt: 0.24, ytr: 0.28, posts: [0.43, 0.55] },
  boeing: { s0: 0.42, s1: 0.86, yb: 0.3, yt: 0.66, ytr: 0.7, posts: [0.56, 0.72] },
  b777: { s0: 0.4, s1: 0.84, yb: 0.28, yt: 0.62, ytr: 0.66, posts: [0.56, 0.72] },
  b787: { s0: 0.38, s1: 0.8, yb: 0.27, yt: 0.6, ytr: 0.62, posts: [0.6, 0.6] },
  b747: { s0: 0.36, s1: 0.68, yb: 0.92, yt: 1.18, ytr: 1.22, posts: [0.48, 0.58] },
  md80: { s0: 0.42, s1: 0.86, yb: 0.28, yt: 0.66, ytr: 0.7, posts: [0.56, 0.72] },
  md11: { s0: 0.38, s1: 0.84, yb: 0.26, yt: 0.62, ytr: 0.66, posts: [0.54, 0.7] },
  regional: { s0: 0.42, s1: 0.86, yb: 0.2, yt: 0.62, ytr: 0.66, posts: [0.58, 0.74] },
  turboprop: { s0: 0.44, s1: 0.88, yb: 0.24, yt: 0.7, ytr: 0.74, posts: [0.6, 0.76] },
  bizjet: { s0: 0.44, s1: 0.86, yb: 0.2, yt: 0.66, ytr: 0.7, posts: [0.62, 0.62] },
  c130: { s0: 0.5, s1: 0.94, yb: 0.32, yt: 0.78, ytr: 0.8, posts: [0.64, 0.8] },
  c17: { s0: 0.44, s1: 0.86, yb: 0.3, yt: 0.66, ytr: 0.7, posts: [0.58, 0.72] },
  ga: { s0: 1.02, s1: 1.42, yb: 0.12, yt: 0.86, ytr: 0.9, posts: [1.2, 1.2] },
  heli: { s0: 0, s1: 0, yb: 0, yt: 0, ytr: 0, posts: [0, 0] },
};

/** Winglet description for the variant bits of an airframe. */
export function tipFor(f, variant) {
  const tips = f.tips;
  if (!tips) return { type: 'none', h: 0, cant: 0, bit: 0 };
  for (const key of Object.keys(tips)) {
    const bit = Number(key);
    if (bit === 0 || variant & bit) return { ...tips[key], bit };
  }
  const first = Object.keys(tips)[0];
  return { ...tips[first], bit: Number(first) };
}

/** Engine style for the variant bits (nacelle size/shape options). */
export function engineStyle(f, variant) {
  const styles = f.eng?.styles;
  if (!styles) return null;
  for (const key of Object.keys(styles)) {
    const bit = Number(key);
    if (bit === 0 || variant & bit) return { ...styles[key], bit };
  }
  const first = Object.keys(styles)[0];
  return { ...styles[first], bit: Number(first) };
}

/**
 * Span added by a tip option beyond the structural wing tip. Integrates the
 * same centreline live-aircraft-geometry.js lofts (an arc from horizontal
 * into the cant), so the published span is honoured whichever tip it was
 * measured with.
 */
export function tipSpanAdd(tip) {
  if (!tip || tip.type === 'none' || tip.type === 'fence') return 0;
  if (tip.type === 'raked') return tip.h;
  const cant = ((tip.cant ?? 15) * Math.PI) / 180, aEnd = Math.PI / 2 - cant;
  const blend = wingletBlend(tip);
  let x = 0;
  const steps = 24;
  for (let k = 1; k <= steps; k++) x += Math.cos(aEnd * Math.min(1, Math.pow(k / steps / blend, 0.9))) * (tip.h / steps);
  return x;
}

/** Fraction of a winglet's length spent turning up out of the wing plane. */
export function wingletBlend(tip) {
  return tip.type === 'canted' || tip.type === 'small' || tip.type === 'mdwing' ? 0.16 : tip.type === 'sharklet' ? 0.3 : 0.42;
}

/**
 * Everything derived from a family record. Memoised per family (the records
 * are frozen). Positions are in the BASE geometry (no plugs); `seg` tags say
 * which fuselage section a point travels with when plugs stretch the body.
 */
const cache = new WeakMap();
export function airframeLayout(f) {
  let L = cache.get(f);
  if (L) return L;
  L = f.helicopter ? heliLayout(f) : fixedWingLayout(f);
  cache.set(f, L);
  return L;
}

function fixedWingLayout(f) {
  const len = f.length, hw = f.fus.w / 2, hh = f.fus.h / 2, z0 = -len / 2;
  const noseEnd = f.fus.nose, tailStart = len - f.fus.tail;
  const plug = f.plug ?? { fwd: noseEnd + 0.01, aft: tailStart - 0.01, split: 0.5 };
  const seg = (station) => (station < plug.fwd ? -1 : station > plug.aft ? 1 : 0);
  const hump = f.fus.hump;

  // Fuselage cross-section at a station: centre height, half-width and the
  // top/bottom half-heights (an ellipse with independent halves), plus a
  // top narrowing used by the 747's upper deck.
  function section(s) {
    if (s <= 0) return { cy: (f.fus.noseTip ?? 0) * hh, a: 0, ht: 0, hb: 0, narrow: 0 };
    if (s >= len) return { cy: (f.fus.tailTip ?? 0.4) * hh, a: f.fus.tailR * (f.fus.blade ? 0.25 : 1), ht: f.fus.tailR, hb: f.fus.tailR, narrow: 0 };
    let cy = 0, a = hw, ht = hh, hb = hh, narrow = 0;
    if (s < noseEnd) {
      const u = s / noseEnd;
      cy = (f.fus.noseTip ?? 0) * hh * Math.pow(1 - u, 1.6);
      a = hw * ramp(u, 2.2, 0.5);
      ht = hh * ramp(u, 1.85, 0.56);
      hb = hh * ramp(u, 2.6, 0.5);
    } else if (s > tailStart) {
      const u = (s - tailStart) / f.fus.tail;
      const tipY = (f.fus.tailTip ?? 0.4) * hh, r = f.fus.tailR;
      const top = hh - (hh - (tipY + r)) * Math.pow(u, 2.1);
      const bot = -hh + (tipY - r + hh) * Math.pow(u, 1.12);
      cy = (top + bot) / 2;
      ht = hb = (top - bot) / 2;
      const tipW = f.fus.blade ? r * 0.25 : r;
      a = hw - (hw - tipW) * Math.pow(u, 1.35);
    }
    if (hump) {
      const k = smooth(0.8, 0.62 * noseEnd + 4, s) * (1 - smooth(hump.to, hump.to + hump.fair, s));
      const top = cy + ht + hump.h * k;
      ht = top - cy;
      narrow = 0.3 * k;
    }
    return { cy, a, ht, hb, narrow };
  }

  // Wing planform (right wing; the left mirrors in x).
  const w = f.wing;
  const tan = Math.tan(w.sweep * DEG), dih = Math.tan(w.dihedral * DEG);
  const rootX = hw * (w.mount === 'high' ? 0.25 : 0.7);
  const wingY = w.y * hh;
  // Structural semi-span: the published span less the addition of the tip it
  // was published with (the first listed option unless `spanTip` says).
  const tipKeys = Object.keys(f.tips ?? {}).map(Number);
  const tip0 = tipFor(f, f.spanTip ?? tipKeys[0] ?? 0);
  const semi = f.span / 2 - tipSpanAdd(tip0);
  function wingAt(x) {
    const ax = Math.abs(x);
    const t = clamp(ax / semi, 0, 1);
    let chord;
    if (w.kink) {
      const kc = w.kinkChord;
      chord = t < w.kink ? w.root + (kc - w.root) * (t / w.kink) : kc + (w.tip - kc) * ((t - w.kink) / (1 - w.kink));
    } else chord = w.root + (w.tip - w.root) * t;
    const le = z0 + w.le + ax * tan;
    const y = wingY + ax * dih;
    const thick = (w.t + (w.tt - w.t) * t) * chord;
    return { le, chord, y, thick, t };
  }

  // Ground contact height (gear extended) first: nacelles keep a floor
  // clearance above it whatever the wing geometry says.
  const g = f.gear;
  const groundOffset = g.clearance + hh;
  const groundY = -groundOffset;

  // Engines.
  const engines = [];
  const style = (v) => engineStyle(f, v);
  const eng = f.eng ?? { n: 0 };
  const styleBits = Object.keys(eng.styles ?? {}).map(Number);
  for (const bit of styleBits.length ? styleBits : [0]) {
    const st = { ...eng, ...(eng.styles?.[bit] ?? {}) };
    const variant = bit;
    if (eng.mount === 'wing' || eng.mount === 'wing-prop') {
      eng.x.forEach((xs, k) => {
        const at = wingAt(xs);
        const fwd = Array.isArray(st.fwd) ? st.fwd[k] : st.fwd;
        const drop = st.drop ?? 0.4;
        const prop = eng.mount === 'wing-prop';
        let y, zc;
        if (prop) {
          // Turboprop nacelle slung under a high wing / over a low wing's leading edge.
          y = f.wing.mount === 'high' ? at.y - at.thick * 0.2 - st.d * 0.3 : at.y + at.thick * 0.35;
          zc = at.le - fwd + st.len / 2;
        } else {
          const floor = groundY + (st.clear ?? eng.clear ?? 0.55) + (st.d / 2) * (st.style === 'pouch' ? 0.8 : 1);
          y = Math.max(at.y - at.thick * 0.5 - drop - st.d / 2, floor);
          zc = at.le - fwd + st.len / 2;
        }
        for (const side of [-1, 1]) engines.push({ x: side * xs, y, z: zc, d: st.d, len: st.len, style: st.style, mount: eng.mount, side, variant, rank: k, blades: st.blades ?? 0, propD: st.propD ?? 0, wingY: at.y, wingLE: at.le, wingThick: at.thick, wingChord: at.chord });
      });
    } else if (eng.mount === 'rear') {
      const xs = eng.x[0], zc = z0 + eng.z + st.len / 2;
      for (const side of [-1, 1]) engines.push({ x: side * xs, y: (eng.y ?? 0.4) * hh, z: zc, d: st.d, len: st.len, style: st.style, mount: 'rear', side, variant, rank: 0 });
    } else if (eng.mount === 'nose') {
      engines.push({ x: 0, y: (f.fus.noseTip ?? 0) * hh * 0.3, z: z0 + st.len * 0.35, d: st.d, len: st.len, style: st.style, mount: 'nose', side: 0, variant, rank: 0, blades: st.blades ?? 2, propD: st.propD ?? 1.9 });
    }
    if (eng.tail) {
      const t = eng.tail;
      engines.push({ x: 0, y: t.y, z: z0 + t.z + t.len / 2, d: t.d, len: t.len, style: 'tail', mount: 'tail', side: 0, variant, rank: 9 });
    }
  }

  // Gear legs: kind 'nose' | 'main' | 'body' | 'center'; ground contact at
  // y = -groundOffset with the gear extended.
  const legs = [];
  const mainZ = z0 + g.main, noseZ = z0 + g.nose;
  legs.push({ kind: 'nose', x: 0, z: noseZ, side: 0, wheels: g.type === 'fixed' || g.type === 'single' ? 1 : 2, wheelD: g.noseWheel, top: section(g.nose).cy - section(g.nose).hb * 0.55, axle: groundY + g.noseWheel / 2, retract: g.type === 'fixed' ? 'fixed' : 'forward', seg: seg(g.nose) });
  const mainType = g.type;
  const trackHalf = g.track / 2;
  const mainWheels = { twin: 2, single: 1, fixed: 1, bogie4: 4, bogie6: 6, b747: 4, a380: 4, md11: 4, sponson: 2, tandem: 2, nacelle: 2 }[mainType] ?? 2;
  for (const side of [-1, 1]) {
    const x = side * trackHalf;
    const at = wingAt(x);
    // Wing-mounted legs hang from the wing box; fuselage-mounted (sponsons,
    // fixed GA gear) from the body side.
    const top = mainType === 'sponson' || mainType === 'tandem' ? -hh * 0.55 : mainType === 'fixed' ? -hh * 0.7 : mainType === 'nacelle' ? at.y - at.thick * 0.5 : Math.min(at.y, -hh * 0.2);
    legs.push({ kind: 'main', x, z: mainZ, side, wheels: mainWheels, wheelD: g.wheel, top, axle: groundY + g.wheel / 2, retract: mainType === 'sponson' || mainType === 'tandem' ? 'up' : mainType === 'nacelle' ? 'aft' : mainType === 'fixed' ? 'fixed' : 'inboard', seg: 0, pants: !!g.pants });
  }
  if (g.wing) {
    // 747 / A380: the listed `main`/`track` are the BODY gear; `wing` adds the outer pair.
    legs.forEach((l) => { if (l.kind === 'main') { l.kind = 'body'; l.retract = 'forward'; l.wheels = mainType === 'a380' ? 6 : 4; l.top = -hh * 0.5; } });
    for (const side of [-1, 1]) {
      const x = side * g.wing.track / 2, at = wingAt(x);
      legs.push({ kind: 'main', x, z: z0 + g.wing.main, side, wheels: 4, wheelD: g.wheel, top: Math.min(at.y, -hh * 0.2), axle: groundY + g.wheel / 2, retract: 'inboard', seg: 0 });
    }
  }
  if (g.center) legs.push({ kind: 'center', x: 0, z: z0 + g.center, side: 0, wheels: 2, wheelD: g.wheel, top: -hh * 0.6, axle: groundY + g.wheel / 2, retract: 'forward', seg: seg(g.center) });

  // Tail surfaces.
  const t = f.tail;
  const finBase = section(t.fin.le);
  const finRootY = t.fin.base ?? finBase.cy + finBase.ht * 0.92;
  const fin = { le: z0 + t.fin.le, rootY: finRootY, h: t.fin.h, root: t.fin.root, tip: t.fin.tip, sweep: Math.tan(t.fin.sweep * DEG) };
  fin.tipLE = fin.le + fin.h * fin.sweep;
  fin.topY = finRootY + fin.h;
  let stab;
  if (t.type === 'T') {
    stab = { span: t.stab.span, root: t.stab.root, tip: t.stab.tip, sweep: Math.tan(t.stab.sweep * DEG), dihedral: Math.tan((t.stab.dihedral ?? 0) * DEG), le: fin.tipLE + Math.max(0, fin.tip - t.stab.root) * 0.5 - 0.1, y: fin.topY - 0.05 };
  } else {
    const s = section(t.stab.le);
    stab = { span: t.stab.span, root: t.stab.root, tip: t.stab.tip, sweep: Math.tan(t.stab.sweep * DEG), dihedral: Math.tan((t.stab.dihedral ?? 0) * DEG), le: z0 + t.stab.le, y: s.cy + (t.stab.y ?? 0.15) * (s.ht + s.hb) * 0.5 };
  }

  // Light anchors (model metres + section tag). `beam` = forward-ish unit dir.
  const tipAt = wingAt(semi);
  const tipZ = tipAt.le + tipAt.chord * 0.55;
  const anchors = {
    navL: { x: -semi - 0.05, y: tipAt.y, z: tipAt.le + 0.25, seg: 0 },
    navR: { x: semi + 0.05, y: tipAt.y, z: tipAt.le + 0.25, seg: 0 },
    strobeL: { x: -semi - 0.05, y: tipAt.y, z: tipZ, seg: 0 },
    strobeR: { x: semi + 0.05, y: tipAt.y, z: tipZ, seg: 0 },
    tail: { x: 0, y: section(len - 0.05).cy, z: len / 2 + 0.05, seg: 1 },
    beaconTop: { x: 0, y: section(len * 0.42).cy + section(len * 0.42).ht + 0.12, z: z0 + len * 0.42, seg: seg(len * 0.42) },
    beaconBottom: { x: 0, y: section(len * 0.5).cy - section(len * 0.5).hb - 0.12, z: z0 + len * 0.5, seg: seg(len * 0.5) },
    // Landing lights: wing roots on jets (Boeing/Airbus inboard LE), the
    // nose gear on GA/regional; taxi + turn-off lamps on the nose gear leg
    // and wing roots.
    landing: [],
    taxi: { x: 0, y: groundY + g.noseWheel + 0.35, z: noseZ - 0.15, seg: seg(g.nose) },
    turnoff: [],
    logo: { x: 0, y: stab.y + 0.25, z: fin.le + fin.root * 0.6, seg: 1 },
  };
  const rootLE = wingAt(rootX + 0.6);
  for (const side of [-1, 1]) {
    if (f.cockpit === 'ga' || f.wing.mount === 'high') {
      const at = wingAt(Math.min(semi * 0.45, rootX + 2.5));
      anchors.landing.push({ x: side * Math.min(semi * 0.45, rootX + 2.5), y: at.y - at.thick * 0.2, z: at.le + 0.05, seg: 0 });
    } else {
      anchors.landing.push({ x: side * (rootX + 0.9), y: rootLE.y - rootLE.thick * 0.35, z: rootLE.le + 0.15, seg: 0 });
    }
    anchors.turnoff.push({ x: side * (rootX + 0.35), y: rootLE.y - rootLE.thick * 0.2, z: rootLE.le + 0.3, seg: 0, yaw: side * 0.5 });
  }
  const mainLegs = legs.filter((l) => l.kind === 'main' || l.kind === 'body');
  return {
    family: f, len, hw, hh, z0, noseEnd, tailStart, plug, seg, section, semi, rootX, wingAt, tipFor: (v) => tipFor(f, v), style,
    engines, legs, groundOffset, groundY, fin, stab, anchors, cockpit: COCKPITS[f.cockpit] ?? COCKPITS.boeing,
    mainContacts: mainLegs.map((l) => ({ x: l.x, y: groundY, z: l.z })),
  };
}

function heliLayout(f) {
  const len = f.length, w = f.fus.w, h = f.fus.h;
  const skid = 1.15;
  const groundOffset = skid + h * 0.5;
  const rotorY = h * 0.5 + 0.55, rotorZ = -len * 0.08;
  return {
    family: f, len, hw: w / 2, hh: h / 2, z0: -len / 2, noseEnd: 0, tailStart: len, plug: null, seg: () => 0,
    section: () => ({ cy: 0, a: w / 2, ht: h / 2, hb: h / 2, narrow: 0 }),
    semi: f.span / 2, rootX: 0, wingAt: () => ({ le: 0, chord: 0, y: 0, thick: 0, t: 0 }), tipFor: () => ({ type: 'none' }), style: () => null,
    engines: [], legs: [], groundOffset, groundY: -groundOffset, fin: null, stab: null,
    rotor: { y: rotorY, z: rotorZ, r: f.span / 2 }, tailRotor: { x: 0.35, y: h * 0.3, z: len * 0.42, r: f.span * 0.09 },
    anchors: {
      navL: { x: -w * 0.55, y: -h * 0.1, z: -len * 0.02, seg: 0 },
      navR: { x: w * 0.55, y: -h * 0.1, z: -len * 0.02, seg: 0 },
      strobeL: null, strobeR: null,
      tail: { x: 0, y: h * 0.45, z: len * 0.45, seg: 0 },
      beaconTop: { x: 0, y: h * 0.5 + 0.35, z: len * 0.05, seg: 0 },
      beaconBottom: { x: 0, y: -h * 0.5 - 0.05, z: -len * 0.05, seg: 0 },
      landing: [{ x: 0, y: -h * 0.5, z: -len * 0.2, seg: 0 }],
      taxi: null, turnoff: [], logo: null,
    },
    cockpit: COCKPITS.heli,
    mainContacts: [{ x: -0.9, y: -groundOffset, z: 0 }, { x: 0.9, y: -groundOffset, z: 0 }],
  };
}

/**
 * A painted fuselage door (f.win.doors[i]) in model metres: station from the
 * nose, width, kind (0 door, 1 exit), sill and height relative to the
 * fuselage axis, the sill above the wheel line, and the fuselage half-width
 * at the door's mid-height (where a boarding bridge cab meets the skin).
 * The paint (fleet-material.js) and the parked fleet's bridge docking
 * (components/fly/observation/ParkedFleet.jsx) both read this, so a painted
 * door is exactly where a jet bridge docks. Cabin floor: about a metre
 * under the window line; doors are ~1.9 m tall on airliners, less on
 * regional jets and turboprops; overwing exits sit higher and are shorter.
 */
export function doorFrame(f, i = 0) {
  const d = f.win?.doors?.[i];
  if (!d || f.helicopter) return null;
  const L = airframeLayout(f);
  const [station, width, kind] = d;
  const floor = f.win.y * L.hh - clamp(f.fus.h * 0.26, 0.82, 1.12);
  const height = kind === 1 ? 1.0 : clamp(f.fus.h * 0.65, 1.45, 1.88);
  const sill = kind === 1 ? floor + 0.45 : floor;
  const sec = L.section(station);
  const mid = sill + height / 2;
  const yy = (mid - sec.cy) / Math.max(1e-3, mid < sec.cy ? sec.hb : sec.ht);
  const half = sec.a * Math.sqrt(Math.max(0, 1 - yy * yy));
  return { station, width, kind, sill, height, sillAboveGround: sill + L.groundOffset, half };
}

/** The forward passenger door (L1/R1): the first painted door of kind 0. */
export function boardingDoor(f) {
  const doors = f.win?.doors ?? [];
  const i = doors.findIndex((d) => d[2] === 0);
  return i < 0 ? null : doorFrame(f, i);
}

/**
 * Exhaust stations for contrails: one per engine of the airframe's engine
 * style, in model metres at the nozzle. Props/rotorcraft return [].
 */
export function exhaustStations(f, variant = f.variants?.base ?? 0) {
  if (f.helicopter || f.prop) return [];
  const L = airframeLayout(f);
  const bit = engineStyle(f, variant)?.bit ?? 0;
  return L.engines.filter((e) => e.variant === bit || (bit === 0 && e.variant === 0)).map((e) => [e.x, e.y, e.z + e.len / 2]);
}
