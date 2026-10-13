// Live-traffic airframe families: the dimensional contract every fleet layer
// reads (geometry, lights, contrails, smoke, parked scenery).
//
// Units are metres. Frame: nose -Z, +Y up, X to the right wing; the fuselage
// runs from z = -length/2 (nose tip) to +length/2 (tail tip) with y = 0 on the
// constant-section centreline. A STATION is a distance aft of the nose tip
// (z = station - length/2). Dimensions describe a representative member;
// per-code rows below stretch the fuselage (plugs) or scale the airframe so an
// A321 or a CRJ-200 is drawn at its own length from one family mesh.
//
// Policy: neutral paint only (fleet-material.js); nothing here names or
// implies an airline. Sources are public type dimensions (manufacturer
// airport-planning data); smaller details are proportioned by eye.
//
// The ORDER of FLEET_FAMILIES is a contract: indices 0-18 are the original
// families (scripts/verify-living-earth.mjs pins the helicopter at 15);
// new families append.

/** Far-LOD silhouette classes (one shared mesh each, non-uniform scale). */
export const FAR_CLASS = Object.freeze({ TWIN: 0, QUAD: 1, REAR: 2, HIGH_PROP: 3, GA: 4, HELI: 5, HIGH_JET: 6 });
/** The family each far class is generated from (an index into FLEET_FAMILIES). */
export const FAR_REP = Object.freeze(['a320', 'b747', 'crj', 'dash8', 'piston', 'helicopter', 'c130']);

/** Variant bits (per family meaning in each `variants` table). */
export const VARIANT = Object.freeze({ TIP_A: 1, TIP_B: 2, ENG_A: 4, ENG_B: 8, TAIL_A: 16, TAIL_B: 32, FREIGHTER: 128 });

// Door kinds for the procedural outlines (fleet-material.js).
const D = 0, X = 1; // passenger/service door, small exit

/**
 * Family records. Short keys keep the table readable at a glance:
 *  fus   { w, h, nose, noseTip, tail, tailTip, tailR, hump }  width/height, nose & tail-cone lengths,
 *        tip heights as a fraction of the half-height, tail tip radius
 *  wing  { mount, y, le, root, kink, kinkChord, tip, sweep, dihedral, t, tt, flex, slats, strut }
 *        le = leading-edge station at the centreline (extrapolated), chords in metres,
 *        kink = fraction of the semi-span where the trailing edge breaks
 *  tip   winglet { type, h, cant }  (types: none fence sharklet blended scimitar raked canted curved small mdwing)
 *  eng   { n, mount, d, len, x[], fwd, drop, style, y, z, blades, propD }
 *  tail  { type: conv|T, fin {h, root, tip, sweep, le}, stab {span, root, tip, sweep, dihedral, le, y}, dorsal }
 *  gear  { type, nose, main, track, wheel, noseWheel, clearance, retract, extra }
 *  win   { pitch, w, h, y, from, to, row2 {y, from, to}, doors [[station, width, kind]] }
 *  plug  { fwd, aft, split }  stations where fuselage plugs are inserted
 */
const FAMILIES = [
  { id: 'a320', far: 0, cockpit: 'airbus', length: 37.57, span: 35.8, height: 11.76,
    codes: { A318: { L: 31.44 }, A319: { L: 33.84 }, A320: { L: 37.57 }, A321: { L: 44.51 }, A19N: { L: 33.84, v: 1 | 8 }, A20N: { L: 37.57, v: 1 | 8 }, A21N: { L: 44.51, v: 1 | 8 } },
    variants: { base: 2 | 4, alt: 1 | 4, altShare: 0.4 }, // ceo: fence or sharklet retrofit
    fus: { w: 3.95, h: 4.14, nose: 5.7, noseTip: -0.2, tail: 11.2, tailTip: 0.55, tailR: 0.26 },
    wing: { mount: 'low', y: -0.56, le: 12.4, root: 7.0, kink: 0.37, kinkChord: 3.9, tip: 1.55, sweep: 27, dihedral: 5.1, t: 0.15, tt: 0.105, slats: true },
    tips: { 1: { type: 'sharklet', h: 2.43, cant: 14 }, 2: { type: 'fence', h: 1.0 } },
    eng: { n: 2, mount: 'wing', x: [5.75], fwd: 2.25, drop: 0.38, clear: 0.5, styles: { 4: { d: 2.12, len: 4.45, style: 'short' }, 8: { d: 2.42, len: 5.05, style: 'short', fwd: 2.75 } } },
    tail: { type: 'conv', fin: { h: 5.9, root: 6.1, tip: 2.1, sweep: 40, le: 29.0 }, stab: { span: 12.45, root: 3.9, tip: 1.3, sweep: 33, dihedral: 6, le: 31.6, y: 0.15 }, dorsal: 0.35 },
    gear: { type: 'twin', nose: 5.1, main: 17.7, track: 7.59, wheel: 1.14, noseWheel: 0.76, clearance: 1.95 },
    win: { pitch: 0.533, w: 0.23, h: 0.33, y: 0.2, from: 6.2, to: 31.3, doors: [[4.55, 0.81, D], [14.95, 0.51, X], [15.85, 0.51, X], [32.2, 0.81, D]] },
    plug: { fwd: 11.8, aft: 21.5, split: 0.6 } },
  { id: 'b737', far: 0, cockpit: 'boeing', length: 39.47, span: 35.79, height: 12.55,
    codes: { B731: { L: 28.65, v: 4 }, B732: { L: 30.53, v: 4 }, B733: { L: 33.4, v: 4 }, B734: { L: 36.4, v: 4 }, B735: { L: 31.0, v: 4 }, B736: { L: 31.24 }, B737: { L: 33.63 }, B738: { L: 39.47 }, B739: { L: 42.11 },
      B37M: { L: 35.56, v: 2 | 8 }, B38M: { L: 39.52, v: 2 | 8 }, B39M: { L: 42.16, v: 2 | 8 }, B3XM: { L: 43.8, v: 2 | 8 } },
    variants: { base: 1 | 4, alt: 2 | 4, altShare: 0.2 }, // NG: blended, some split-scimitar retrofits
    fus: { w: 3.76, h: 4.01, nose: 5.3, noseTip: -0.32, tail: 10.6, tailTip: 0.45, tailR: 0.22 },
    wing: { mount: 'low', y: -0.6, le: 13.6, root: 7.0, kink: 0.34, kinkChord: 4.2, tip: 1.25, sweep: 28, dihedral: 6, t: 0.15, tt: 0.1, slats: true },
    tips: { 1: { type: 'blended', h: 2.44, cant: 16 }, 2: { type: 'scimitar', h: 2.44, cant: 12 } },
    eng: { n: 2, mount: 'wing', x: [4.9], fwd: 2.7, drop: -0.25, clear: 0.46, styles: { 4: { d: 2.02, len: 4.05, style: 'pouch' }, 8: { d: 2.25, len: 4.6, style: 'short', fwd: 3.05, drop: -0.35 } } },
    tail: { type: 'conv', fin: { h: 7.1, root: 6.6, tip: 1.9, sweep: 38, le: 31.3 }, stab: { span: 14.35, root: 4.0, tip: 1.3, sweep: 34, dihedral: 7, le: 33.6, y: 0.2 }, dorsal: 0.75 },
    gear: { type: 'twin', nose: 3.6, main: 19.2, track: 5.72, wheel: 1.12, noseWheel: 0.69, clearance: 1.15 },
    win: { pitch: 0.508, w: 0.25, h: 0.36, y: 0.18, from: 5.9, to: 33.6, doors: [[3.55, 0.86, D], [16.3, 0.51, X], [17.1, 0.51, X], [34.4, 0.76, D]] },
    plug: { fwd: 12.5, aft: 22.0, split: 0.55 } },
  { id: 'a330', far: 0, cockpit: 'airbus', length: 63.66, span: 60.3, height: 16.79,
    codes: { A332: { L: 58.82 }, A333: { L: 63.66 }, A338: { L: 58.82, v: 2 | 8 }, A339: { L: 63.66, v: 2 | 8 } },
    variants: { base: 1 | 4 },
    fus: { w: 5.64, h: 5.64, nose: 7.6, noseTip: -0.18, tail: 16.0, tailTip: 0.5, tailR: 0.34 },
    wing: { mount: 'low', y: -0.55, le: 22.8, root: 11.5, kink: 0.32, kinkChord: 6.6, tip: 2.7, sweep: 31.5, dihedral: 5.5, t: 0.15, tt: 0.105, slats: true, flex: 1.6 },
    tips: { 1: { type: 'canted', h: 2.75, cant: 22 }, 2: { type: 'sharklet', h: 3.7, cant: 14 } },
    eng: { n: 2, mount: 'wing', x: [9.37], fwd: 3.6, drop: 0.55, clear: 0.75, styles: { 4: { d: 3.1, len: 5.9, style: 'short' }, 8: { d: 3.55, len: 6.4, style: 'short', fwd: 4.0 } } },
    tail: { type: 'conv', fin: { h: 8.4, root: 8.5, tip: 3.0, sweep: 42, le: 49.6 }, stab: { span: 19.4, root: 6.0, tip: 2.0, sweep: 35, dihedral: 6, le: 54.0, y: 0.15 }, dorsal: 0.3 },
    gear: { type: 'bogie4', nose: 6.5, main: 32.1, track: 10.68, wheel: 1.27, noseWheel: 1.07, clearance: 2.35 },
    win: { pitch: 0.533, w: 0.23, h: 0.33, y: 0.28, from: 7.8, to: 55.0, doors: [[6.0, 1.07, D], [18.5, 1.07, D], [34.6, 0.81, D], [56.6, 1.07, D]] },
    plug: { fwd: 20.0, aft: 38.5, split: 0.5 } },
  { id: 'a350', far: 0, cockpit: 'a350', length: 66.8, span: 64.75, height: 17.05,
    codes: { A359: { L: 66.8 }, A35K: { L: 73.79 } },
    fus: { w: 5.96, h: 6.09, nose: 8.0, noseTip: -0.12, tail: 17.0, tailTip: 0.5, tailR: 0.36 },
    wing: { mount: 'low', y: -0.55, le: 24.1, root: 13.5, kink: 0.31, kinkChord: 7.8, tip: 2.4, sweep: 33, dihedral: 5, t: 0.15, tt: 0.1, slats: true, flex: 2.4 },
    tips: { 0: { type: 'curved', h: 3.6, cant: 0 } },
    eng: { n: 2, mount: 'wing', x: [10.5], fwd: 4.2, drop: 0.5, clear: 0.95, styles: { 0: { d: 3.75, len: 6.9, style: 'short' } } },
    tail: { type: 'conv', fin: { h: 9.0, root: 9.5, tip: 3.2, sweep: 41, le: 51.6 }, stab: { span: 18.9, root: 6.4, tip: 2.0, sweep: 35, dihedral: 6, le: 56.7, y: 0.15 }, dorsal: 0.3 },
    gear: { type: 'bogie4', nose: 6.0, main: 34.6, track: 10.6, wheel: 1.35, noseWheel: 1.1, clearance: 2.2 },
    win: { pitch: 0.61, w: 0.28, h: 0.43, y: 0.25, from: 7.9, to: 57.5, doors: [[6.4, 1.07, D], [19.5, 1.07, D], [37.2, 1.07, D], [58.8, 1.07, D]] },
    plug: { fwd: 21.0, aft: 40.0, split: 0.5 } },
  { id: 'b777', far: 0, cockpit: 'b777', length: 73.86, span: 64.8, height: 18.5,
    codes: { B772: { L: 63.73, v: 2 }, B77L: { L: 63.73, v: 1 }, B773: { L: 73.86, v: 2 }, B77W: { L: 73.86, v: 1 }, B778: { L: 69.79, v: 1 }, B779: { L: 76.72, v: 1 } },
    variants: { base: 1 },
    fus: { w: 6.2, h: 6.2, nose: 8.6, noseTip: -0.2, tail: 18.5, tailTip: 0.38, tailR: 0.3, blade: true },
    wing: { mount: 'low', y: -0.55, le: 26.5, root: 14.0, kink: 0.32, kinkChord: 7.8, tip: 2.6, sweep: 34, dihedral: 6, t: 0.15, tt: 0.1, slats: true, flex: 2.0 },
    tips: { 1: { type: 'raked', h: 2.2 }, 2: { type: 'none' } },
    eng: { n: 2, mount: 'wing', x: [9.65], fwd: 4.6, drop: 0.6, clear: 0.85, styles: { 0: { d: 4.0, len: 7.3, style: 'short' } } },
    tail: { type: 'conv', fin: { h: 9.4, root: 10.5, tip: 3.4, sweep: 40, le: 57.0 }, stab: { span: 21.5, root: 7.1, tip: 2.3, sweep: 37, dihedral: 7, le: 62.4, y: 0.15 }, dorsal: 0.3 },
    gear: { type: 'bogie6', nose: 7.0, main: 38.2, track: 10.97, wheel: 1.32, noseWheel: 1.12, clearance: 2.4 },
    win: { pitch: 0.508, w: 0.25, h: 0.38, y: 0.25, from: 8.6, to: 63.5, doors: [[6.9, 1.07, D], [20.0, 1.07, D], [37.6, 1.07, D], [52.2, 1.07, D], [65.3, 1.07, D]] },
    plug: { fwd: 22.0, aft: 44.0, split: 0.5 } },
  { id: 'b787', far: 0, cockpit: 'b787', length: 62.81, span: 60.12, height: 17.02,
    codes: { B788: { L: 56.72 }, B789: { L: 62.81 }, B78X: { L: 68.28 } },
    fus: { w: 5.77, h: 5.97, nose: 8.0, noseTip: -0.2, tail: 15.5, tailTip: 0.5, tailR: 0.3 },
    wing: { mount: 'low', y: -0.55, le: 22.85, root: 12.0, kink: 0.32, kinkChord: 6.8, tip: 2.2, sweep: 34, dihedral: 6, t: 0.14, tt: 0.095, slats: true, flex: 3.0 },
    tips: { 0: { type: 'raked', h: 2.4 } },
    eng: { n: 2, mount: 'wing', x: [9.9], fwd: 4.0, drop: 0.55, clear: 0.8, styles: { 0: { d: 3.55, len: 6.6, style: 'chevron' } } },
    tail: { type: 'conv', fin: { h: 8.7, root: 9.0, tip: 3.0, sweep: 42, le: 48.5 }, stab: { span: 19.5, root: 6.0, tip: 2.0, sweep: 36, dihedral: 6, le: 53.0, y: 0.15 }, dorsal: 0.25 },
    gear: { type: 'bogie4', nose: 5.6, main: 31.4, track: 9.8, wheel: 1.32, noseWheel: 1.0, clearance: 2.15 },
    win: { pitch: 0.61, w: 0.27, h: 0.47, y: 0.25, from: 7.3, to: 53.8, doors: [[5.9, 1.07, D], [18.0, 1.07, D], [33.7, 1.07, D], [55.2, 1.07, D]] },
    plug: { fwd: 19.0, aft: 37.0, split: 0.5 } },
  { id: 'b747', far: 1, cockpit: 'b747', length: 70.66, span: 64.44, height: 19.41,
    codes: { B741: { L: 70.6, v: 2 | 4 }, B742: { L: 70.6, v: 2 | 4 }, B743: { L: 70.6, v: 2 | 4 }, B744: { L: 70.66 }, B748: { L: 76.25, v: 2 | 8 }, B74S: { L: 56.31, v: 2 | 4 }, B74R: { L: 70.6, v: 2 | 4 } },
    variants: { base: 1 | 4 },
    fus: { w: 6.5, h: 6.9, nose: 9.0, noseTip: -0.3, tail: 17.0, tailTip: 0.5, tailR: 0.34, hump: { to: 27.5, h: 2.0, fair: 7.0 } },
    wing: { mount: 'low', y: -0.55, le: 21.0, root: 16.5, kink: 0.32, kinkChord: 10.0, tip: 4.0, sweep: 40, dihedral: 7, t: 0.14, tt: 0.08, slats: true, flex: 2.2 },
    tips: { 1: { type: 'canted', h: 1.8, cant: 29 }, 2: { type: 'raked', h: 2.0 } },
    eng: { n: 4, mount: 'wing', x: [12.4, 21.2], fwd: [3.6, 2.6], drop: 0.55, styles: { 4: { d: 2.85, len: 5.6, style: 'short' }, 8: { d: 3.25, len: 6.4, style: 'chevron' } } },
    tail: { type: 'conv', fin: { h: 10.4, root: 11.5, tip: 3.6, sweep: 45, le: 54.0 }, stab: { span: 22.17, root: 7.5, tip: 2.5, sweep: 38, dihedral: 7, le: 60.5, y: 0.15 }, dorsal: 0.3 },
    gear: { type: 'b747', nose: 8.0, main: 34.5, track: 3.84, wing: { main: 32.3, track: 11.0 }, wheel: 1.25, noseWheel: 1.17, clearance: 2.7 },
    win: { pitch: 0.508, w: 0.25, h: 0.36, y: 0.2, from: 9.5, to: 63.0, row2: { y: 1.12, from: 10.5, to: 25.5 }, doors: [[7.6, 1.07, D], [17.0, 1.07, D], [31.5, 1.07, D], [44.0, 1.07, D], [58.0, 1.07, D]] },
    plug: { fwd: 30.0, aft: 42.0, split: 0.5 } },
  { id: 'a380', far: 1, cockpit: 'a380', length: 72.72, span: 79.75, height: 24.09,
    codes: { A388: { L: 72.72 } },
    fus: { w: 7.14, h: 8.41, nose: 9.6, noseTip: -0.28, tail: 17.5, tailTip: 0.45, tailR: 0.4 },
    wing: { mount: 'low', y: -0.6, le: 23.4, root: 21.0, kink: 0.31, kinkChord: 12.0, tip: 4.0, sweep: 36, dihedral: 5.6, t: 0.14, tt: 0.085, slats: true, flex: 2.2 },
    tips: { 0: { type: 'fence', h: 2.1 } },
    eng: { n: 4, mount: 'wing', x: [15.0, 25.7], fwd: [4.4, 3.2], drop: 0.6, styles: { 0: { d: 3.55, len: 6.4, style: 'short' } } },
    tail: { type: 'conv', fin: { h: 12.8, root: 13.0, tip: 4.5, sweep: 42, le: 55.0 }, stab: { span: 30.37, root: 9.0, tip: 3.0, sweep: 36, dihedral: 6, le: 60.0, y: 0.1 }, dorsal: 0.25 },
    gear: { type: 'a380', nose: 7.0, main: 38.0, track: 6.0, wing: { main: 35.5, track: 14.3 }, wheel: 1.4, noseWheel: 1.27, clearance: 2.6 },
    win: { pitch: 0.533, w: 0.25, h: 0.38, y: -0.18, from: 9.0, to: 63.0, row2: { y: 0.6, from: 10.0, to: 62.0 }, doors: [[7.5, 1.07, D], [19.0, 1.07, D], [33.0, 1.07, D], [47.0, 1.07, D], [61.0, 1.07, D]] } },
  { id: 'crj', far: 2, cockpit: 'regional', length: 36.2, span: 24.85, height: 7.51,
    codes: { CRJ1: { L: 26.77 }, CRJ2: { L: 26.77 }, CRJ7: { L: 32.51 }, CRJ9: { L: 36.2 }, CRJX: { L: 39.1 } },
    fus: { w: 2.69, h: 2.69, nose: 4.4, noseTip: -0.32, tail: 7.2, tailTip: 0.4, tailR: 0.2 },
    wing: { mount: 'low', y: -0.55, le: 15.6, root: 4.8, kink: 0.33, kinkChord: 3.1, tip: 1.0, sweep: 28, dihedral: 4, t: 0.13, tt: 0.1, slats: true },
    tips: { 0: { type: 'small', h: 1.3, cant: 30 } },
    eng: { n: 2, mount: 'rear', x: [2.45], y: 0.45, z: 26.0, styles: { 0: { d: 1.5, len: 3.9, style: 'long' } } },
    tail: { type: 'T', fin: { h: 4.3, root: 4.9, tip: 2.9, sweep: 45, le: 28.0 }, stab: { span: 8.6, root: 2.4, tip: 1.2, sweep: 32, dihedral: -2 } },
    gear: { type: 'twin', nose: 3.0, main: 20.3, track: 4.0, wheel: 0.88, noseWheel: 0.6, clearance: 0.9 },
    win: { pitch: 0.508, w: 0.24, h: 0.33, y: 0.02, from: 5.2, to: 27.0, doors: [[3.0, 0.8, D], [13.6, 0.5, X], [27.8, 0.6, D]] },
    plug: { fwd: 12.0, aft: 22.0, split: 0.55 } },
  { id: 'ejet', far: 0, cockpit: 'regional', length: 36.24, span: 28.72, height: 10.57,
    codes: { E170: { L: 29.9 }, E75L: { L: 31.68 }, E75S: { L: 31.68 }, E175: { L: 31.68 }, E190: { L: 36.24 }, E195: { L: 38.65 }, E290: { L: 36.25, v: 2 | 8 }, E295: { L: 41.5, v: 2 | 8 } },
    variants: { base: 1 | 4 },
    fus: { w: 3.01, h: 3.35, nose: 4.6, noseTip: -0.25, tail: 8.2, tailTip: 0.5, tailR: 0.22 },
    wing: { mount: 'low', y: -0.6, le: 13.5, root: 5.8, kink: 0.35, kinkChord: 3.6, tip: 1.3, sweep: 27, dihedral: 5, t: 0.14, tt: 0.1, slats: true },
    tips: { 1: { type: 'canted', h: 1.6, cant: 20 }, 2: { type: 'raked', h: 1.6 } },
    eng: { n: 2, mount: 'wing', x: [5.0], fwd: 2.0, drop: 0.25, clear: 0.5, styles: { 4: { d: 1.75, len: 3.8, style: 'long' }, 8: { d: 2.1, len: 4.3, style: 'short', fwd: 2.3 } } },
    tail: { type: 'conv', fin: { h: 5.9, root: 4.9, tip: 2.0, sweep: 42, le: 28.2 }, stab: { span: 12.0, root: 2.9, tip: 1.0, sweep: 33, dihedral: 6, le: 31.6, y: 0.2 }, dorsal: 0.6 },
    gear: { type: 'twin', nose: 3.8, main: 18.1, track: 5.94, wheel: 0.98, noseWheel: 0.64, clearance: 1.25 },
    win: { pitch: 0.508, w: 0.24, h: 0.34, y: 0.22, from: 5.3, to: 29.7, doors: [[3.4, 0.8, D], [15.3, 0.5, X], [31.0, 0.8, D]] },
    plug: { fwd: 12.0, aft: 21.0, split: 0.5 } },
  { id: 'atr', far: 3, cockpit: 'turboprop', length: 27.17, span: 27.05, height: 7.65,
    codes: { AT43: { L: 22.67 }, AT44: { L: 22.67 }, AT45: { L: 22.67 }, AT46: { L: 22.67 }, AT72: { L: 27.17 }, AT73: { L: 27.17 }, AT75: { L: 27.17 }, AT76: { L: 27.17 } },
    fus: { w: 2.57, h: 2.6, nose: 3.4, noseTip: -0.35, tail: 7.6, tailTip: 0.6, tailR: 0.24 },
    wing: { mount: 'high', y: 1.12, le: 11.4, root: 2.8, tip: 1.5, sweep: 3, dihedral: 2, t: 0.16, tt: 0.13 },
    eng: { n: 2, mount: 'wing-prop', x: [4.05], fwd: 2.3, styles: { 0: { d: 1.2, len: 5.6, style: 'tprop', blades: 6, propD: 3.93 } } },
    tail: { type: 'T', fin: { h: 4.0, root: 4.6, tip: 2.0, sweep: 35, le: 21.2 }, stab: { span: 7.31, root: 1.9, tip: 1.1, sweep: 10, dihedral: 0 }, dorsal: 1.0 },
    gear: { type: 'sponson', nose: 2.2, main: 12.8, track: 4.1, wheel: 0.82, noseWheel: 0.46, clearance: 0.7 },
    win: { pitch: 0.76, w: 0.27, h: 0.38, y: 0.05, from: 4.5, to: 20.0, doors: [[3.0, 0.75, D], [21.5, 0.72, D]] },
    plug: { fwd: 9.0, aft: 15.0, split: 0.5 } },
  { id: 'dash8', far: 3, cockpit: 'turboprop', length: 32.83, span: 28.42, height: 8.36,
    codes: { DH8A: { L: 22.25 }, DH8B: { L: 22.25 }, DH8C: { L: 25.68 }, DH8D: { L: 32.83 } },
    fus: { w: 2.69, h: 2.69, nose: 3.9, noseTip: -0.3, tail: 7.6, tailTip: 0.5, tailR: 0.24 },
    wing: { mount: 'high', y: 1.12, le: 13.2, root: 2.9, tip: 1.4, sweep: 2, dihedral: 2.5, t: 0.16, tt: 0.13 },
    eng: { n: 2, mount: 'wing-prop', x: [4.0], fwd: 2.6, styles: { 0: { d: 1.3, len: 7.6, style: 'tprop', blades: 6, propD: 4.11 } } },
    tail: { type: 'T', fin: { h: 4.6, root: 4.8, tip: 2.5, sweep: 32, le: 25.2 }, stab: { span: 9.0, root: 2.2, tip: 1.1, sweep: 8, dihedral: 0 }, dorsal: 0.8 },
    gear: { type: 'nacelle', nose: 2.8, main: 15.6, track: 8.0, wheel: 0.92, noseWheel: 0.6, clearance: 1.35 },
    win: { pitch: 0.66, w: 0.26, h: 0.38, y: 0.05, from: 4.3, to: 25.0, doors: [[2.8, 0.8, D], [26.0, 0.8, D]] },
    plug: { fwd: 10.0, aft: 17.0, split: 0.5 } },
  { id: 'business', far: 2, cockpit: 'bizjet', length: 20.92, span: 21.0, height: 6.1, scaled: true,
    codes: { C25A: { L: 14.53 }, C25B: { L: 15.59 }, C25C: { L: 16.26 }, C56X: { L: 15.79 }, C560: { L: 14.9 }, C680: { L: 19.37 }, C68A: { L: 18.97 }, C700: { L: 22.3 }, C750: { L: 22.04 }, C510: { L: 12.37 }, C525: { L: 12.98 },
      GLF4: { L: 26.92 }, GLF5: { L: 29.4 }, GLF6: { L: 30.41 }, G280: { L: 20.3 }, GLEX: { L: 30.3 }, GL5T: { L: 29.5 }, GL7T: { L: 33.8 }, GL6T: { L: 30.3 }, CL30: { L: 20.92 }, CL35: { L: 20.92 }, CL60: { L: 20.85 },
      FA7X: { L: 23.38 }, FA8X: { L: 24.46 }, F2TH: { L: 20.21 }, F900: { L: 20.21 }, FA50: { L: 18.52 }, E55P: { L: 15.64 }, E50P: { L: 12.82 }, E545: { L: 20.74 }, E550: { L: 20.74 }, E35L: { L: 26.33 },
      LJ35: { L: 14.83 }, LJ45: { L: 17.68 }, LJ60: { L: 17.88 }, LJ75: { L: 17.68 }, PC24: { L: 16.85 }, H25B: { L: 15.6 }, BE40: { L: 14.75 }, HDJT: { L: 12.99 }, SF50: { L: 9.42 }, PRM1: { L: 13.6 } },
    fus: { w: 2.39, h: 2.39, nose: 3.7, noseTip: -0.25, tail: 5.2, tailTip: 0.42, tailR: 0.14 },
    wing: { mount: 'low', y: -0.45, le: 8.9, root: 4.2, tip: 1.2, sweep: 31, dihedral: 3.5, t: 0.13, tt: 0.1 },
    tips: { 0: { type: 'canted', h: 1.3, cant: 15 } },
    eng: { n: 2, mount: 'rear', x: [2.1], y: 0.4, z: 14.0, styles: { 0: { d: 1.3, len: 3.25, style: 'long' } } },
    tail: { type: 'T', fin: { h: 3.1, root: 3.6, tip: 2.0, sweep: 45, le: 15.0 }, stab: { span: 7.2, root: 1.8, tip: 0.9, sweep: 32, dihedral: 0 } },
    gear: { type: 'twin', nose: 2.2, main: 11.8, track: 3.4, wheel: 0.66, noseWheel: 0.45, clearance: 0.85 },
    win: { pitch: 1.05, w: 0.38, h: 0.46, y: 0.1, from: 4.6, to: 11.5, oval: true, doors: [[2.6, 0.72, D]] } },
  { id: 'piston', far: 4, cockpit: 'ga', length: 8.28, span: 11.0, height: 2.72, scaled: true, palette: 'ga',
    codes: { C150: { L: 7.34 }, C152: { L: 7.34 }, C170: { L: 7.61 }, C172: { L: 8.28 }, C177: { L: 8.44 }, C182: { L: 8.84 }, C206: { L: 8.61 }, C207: { L: 9.7 }, C208: { L: 11.46 }, C210: { L: 8.59 }, P210: { L: 8.59 }, PA18: { L: 6.88 }, PA20: { L: 6.3 }, BE35: { L: 8.38 }, M7: { L: 7.0 }, C180: { L: 7.81 }, C185: { L: 7.85 }, CH7A: { L: 6.94 }, CH7B: { L: 6.94 }, A210: { L: 6.1 } },
    fus: { w: 1.12, h: 1.46, nose: 1.9, noseTip: 0.0, tail: 4.3, tailTip: 0.25, tailR: 0.06 },
    wing: { mount: 'high', y: 1.04, le: 2.15, root: 1.62, tip: 1.13, sweep: 0, dihedral: 1.7, t: 0.13, tt: 0.12, strut: true },
    eng: { n: 1, mount: 'nose', styles: { 0: { d: 1.0, len: 1.4, style: 'piston', blades: 2, propD: 1.9 } } },
    tail: { type: 'conv', fin: { h: 1.15, root: 1.6, tip: 0.8, sweep: 35, le: 6.55 }, stab: { span: 3.4, root: 1.1, tip: 0.8, sweep: 5, dihedral: 0, le: 7.0, y: 0.15 } },
    gear: { type: 'fixed', nose: 1.05, main: 3.35, track: 2.3, wheel: 0.5, noseWheel: 0.4, clearance: 0.5 },
    win: { pitch: 0.95, w: 0.66, h: 0.48, y: 0.42, from: 2.55, to: 3.6, oval: true, doors: [] } },
  { id: 'twin', far: 4, cockpit: 'ga', length: 14.22, span: 17.65, height: 4.37, scaled: true, palette: 'ga',
    codes: { BE20: { L: 13.34 }, BE30: { L: 14.22 }, BE9L: { L: 10.82 }, BE9T: { L: 10.82 }, BE10: { L: 12.17 }, B350: { L: 14.22 }, B190: { L: 17.63 }, E120: { L: 20.0 }, JS32: { L: 14.37 }, JS41: { L: 19.25 }, SW4: { L: 18.09 }, SF34: { L: 19.73 },
      BE58: { L: 9.09, v: 32 }, BE55: { L: 8.53, v: 32 }, BE60: { L: 10.3, v: 32 }, C310: { L: 9.74, v: 32 }, C340: { L: 10.46, v: 32 }, C402: { L: 11.09, v: 32 }, C414: { L: 11.09, v: 32 }, C421: { L: 11.09, v: 32 }, PA31: { L: 9.94, v: 32 }, PA34: { L: 8.72, v: 32 }, PA44: { L: 8.41, v: 32 }, PA23: { L: 8.98, v: 32 }, DA42: { L: 8.56, v: 32 }, P68: { L: 9.43, v: 32 } },
    variants: { base: 16 },
    fus: { w: 1.6, h: 1.75, nose: 2.7, noseTip: -0.2, tail: 4.6, tailTip: 0.42, tailR: 0.1 },
    wing: { mount: 'low', y: -0.55, le: 5.3, root: 2.3, tip: 0.95, sweep: 4, dihedral: 6, t: 0.15, tt: 0.12 },
    eng: { n: 2, mount: 'wing-prop', x: [2.6], fwd: 1.55, styles: { 0: { d: 0.78, len: 3.6, style: 'tprop', blades: 4, propD: 2.5 } } },
    tail: { type: 'T', alt: 'conv', fin: { h: 2.5, root: 2.4, tip: 1.4, sweep: 35, le: 11.1 }, stab: { span: 5.6, root: 1.4, tip: 0.8, sweep: 15, dihedral: 0, le: 12.2, y: 0.2 }, dorsal: 0.5 },
    gear: { type: 'nacelle', nose: 2.4, main: 6.6, track: 5.2, wheel: 0.56, noseWheel: 0.4, clearance: 0.62 },
    win: { pitch: 0.78, w: 0.42, h: 0.42, y: 0.12, from: 4.6, to: 9.4, oval: true, doors: [[10.3, 0.7, D]] } },
  { id: 'helicopter', far: 5, cockpit: 'heli', length: 12.7, span: 10.67, height: 3.56, scaled: true, helicopter: true, palette: 'heli',
    codes: { R22: { L: 8.76 }, R44: { L: 11.66 }, R66: { L: 11.6 }, B06: { L: 11.82 }, B407: { L: 12.7 }, B412: { L: 17.1 }, B429: { L: 12.7 }, B505: { L: 11.4 }, EC20: { L: 9.7 }, EC30: { L: 12.64 }, EC35: { L: 12.16 }, EC45: { L: 13.03 }, H145: { L: 13.64 }, H135: { L: 12.26 }, H160: { L: 13.86 },
      AS50: { L: 12.94 }, AS55: { L: 12.94 }, AS65: { L: 13.68 }, S76: { L: 16.0 }, S92: { L: 20.88 }, A109: { L: 13.04 }, A119: { L: 13.0 }, A139: { L: 16.66 }, A169: { L: 14.6 }, H60: { L: 19.76 }, UH60: { L: 19.76 }, EC55: { L: 14.6 }, MD52: { L: 9.78 }, MD60: { L: 11.84 } },
    fus: { w: 1.6, h: 1.9 },
    eng: { n: 0 } },
  { id: 'lowwing-piston', far: 4, cockpit: 'ga', length: 7.25, span: 10.67, height: 2.22, scaled: true, palette: 'ga',
    codes: { PA28: { L: 7.25 }, P28A: { L: 7.25 }, P28B: { L: 7.25 }, P28R: { L: 7.5 }, P28T: { L: 7.5 }, PA32: { L: 8.44 }, P32R: { L: 8.44 }, PA24: { L: 7.59 }, PA46: { L: 8.81 }, SR20: { L: 7.92 }, SR22: { L: 7.92 }, S22T: { L: 7.92 }, BE36: { L: 8.38 }, BE33: { L: 7.77 }, DA40: { L: 8.06 }, DA20: { L: 7.16 }, DA50: { L: 9.2 }, M20P: { L: 7.52 }, M20T: { L: 8.15 }, RV7: { L: 6.2 }, RV8: { L: 6.3 }, RV10: { L: 7.47 }, RV6: { L: 6.1 }, RV14: { L: 6.6 }, AA5: { L: 6.7 }, COL4: { L: 7.7 }, G115: { L: 7.0 } },
    fus: { w: 1.08, h: 1.32, nose: 1.8, noseTip: 0.05, tail: 3.5, tailTip: 0.25, tailR: 0.06 },
    wing: { mount: 'low', y: -0.62, le: 2.0, root: 1.6, tip: 1.05, sweep: 1, dihedral: 6, t: 0.15, tt: 0.12 },
    eng: { n: 1, mount: 'nose', styles: { 0: { d: 1.0, len: 1.3, style: 'piston', blades: 2, propD: 1.88 } } },
    tail: { type: 'conv', fin: { h: 1.0, root: 1.4, tip: 0.7, sweep: 35, le: 5.65 }, stab: { span: 3.9, root: 0.95, tip: 0.8, sweep: 3, dihedral: 0, le: 6.15, y: 0.15 } },
    gear: { type: 'fixed', nose: 1.0, main: 2.9, track: 3.05, wheel: 0.5, noseWheel: 0.4, clearance: 0.42, pants: true },
    win: { pitch: 0.9, w: 0.6, h: 0.42, y: 0.45, from: 2.35, to: 3.3, oval: true, doors: [] } },
  { id: 'single-turboprop', far: 4, cockpit: 'ga', length: 14.4, span: 16.28, height: 4.26, scaled: true, palette: 'ga',
    codes: { PC12: { L: 14.4 }, TBM7: { L: 10.64, v: 32 }, TBM8: { L: 10.74, v: 32 }, TBM9: { L: 10.74, v: 32 }, TBM: { L: 10.64, v: 32 }, P46T: { L: 8.81, v: 32 }, PC6T: { L: 11.0, v: 32 }, KODI: { L: 10.4, v: 32 }, EPIC: { L: 10.8, v: 32 }, M600: { L: 9.0, v: 32 } },
    variants: { base: 16 },
    fus: { w: 1.6, h: 1.78, nose: 3.4, noseTip: -0.05, tail: 4.8, tailTip: 0.42, tailR: 0.08 },
    wing: { mount: 'low', y: -0.6, le: 5.0, root: 2.35, tip: 1.05, sweep: 2, dihedral: 5, t: 0.15, tt: 0.12 },
    eng: { n: 1, mount: 'nose', styles: { 0: { d: 1.15, len: 2.6, style: 'tprop-nose', blades: 4, propD: 2.67 } } },
    tail: { type: 'T', alt: 'conv', fin: { h: 2.15, root: 2.5, tip: 1.4, sweep: 38, le: 11.3 }, stab: { span: 5.2, root: 1.4, tip: 0.8, sweep: 12, dihedral: 0, le: 12.4, y: 0.2 }, dorsal: 0.5 },
    gear: { type: 'single', nose: 2.6, main: 6.1, track: 4.5, wheel: 0.6, noseWheel: 0.45, clearance: 0.75 },
    win: { pitch: 0.82, w: 0.42, h: 0.46, y: 0.12, from: 5.3, to: 9.4, doors: [[10.4, 1.1, D]] } },
  { id: 'twin-utility', far: 3, cockpit: 'ga', length: 15.77, span: 19.81, height: 5.94, scaled: true, palette: 'ga',
    codes: { DHC6: { L: 15.77 }, BN2P: { L: 10.86 }, BN2T: { L: 10.86 }, D228: { L: 16.56 }, C212: { L: 16.15 }, DHC2: { L: 9.22 }, DHC3: { L: 12.8 }, C408: { L: 16.8 }, L410: { L: 14.42 }, AN28: { L: 13.1 }, SC7: { L: 12.21 } },
    fus: { w: 1.6, h: 1.9, nose: 2.9, noseTip: -0.15, tail: 5.2, tailTip: 0.35, tailR: 0.1 },
    wing: { mount: 'high', y: 1.06, le: 5.4, root: 1.98, tip: 1.98, sweep: 0, dihedral: 2, t: 0.16, tt: 0.16, strut: true },
    eng: { n: 2, mount: 'wing-prop', x: [2.98], fwd: 1.7, styles: { 0: { d: 0.82, len: 3.3, style: 'tprop', blades: 3, propD: 2.59 } } },
    tail: { type: 'conv', fin: { h: 2.9, root: 2.6, tip: 1.5, sweep: 20, le: 12.6 }, stab: { span: 6.3, root: 1.5, tip: 1.3, sweep: 3, dihedral: 0, le: 13.6, y: 0.4 }, dorsal: 0.4 },
    gear: { type: 'fixed', nose: 2.7, main: 7.1, track: 3.7, wheel: 0.8, noseWheel: 0.55, clearance: 0.95 },
    win: { pitch: 0.82, w: 0.42, h: 0.42, y: 0.15, from: 4.3, to: 10.6, doors: [[11.4, 1.3, D]] } },
  // --- Appended families (observation lounge pass) ---------------------------
  { id: 'b757', far: 0, cockpit: 'boeing', length: 47.32, span: 38.05, height: 13.56, spanTip: 2,
    codes: { B752: { L: 47.32 }, B753: { L: 54.47 } },
    variants: { base: 2 | 4, alt: 1 | 4, altShare: 0.55 }, // many airframes carry blended winglets
    fus: { w: 3.76, h: 4.01, nose: 5.6, noseTip: -0.32, tail: 11.0, tailTip: 0.45, tailR: 0.22 },
    wing: { mount: 'low', y: -0.6, le: 16.1, root: 8.6, kink: 0.32, kinkChord: 5.0, tip: 1.7, sweep: 27.5, dihedral: 5, t: 0.14, tt: 0.1, slats: true },
    tips: { 1: { type: 'blended', h: 2.6, cant: 16 }, 2: { type: 'none' } },
    eng: { n: 2, mount: 'wing', x: [7.32], fwd: 3.2, drop: 0.45, styles: { 0: { d: 2.55, len: 5.4, style: 'long' } } },
    tail: { type: 'conv', fin: { h: 7.3, root: 6.9, tip: 2.3, sweep: 40, le: 38.0 }, stab: { span: 15.21, root: 4.5, tip: 1.4, sweep: 35, dihedral: 7, le: 41.2, y: 0.2 }, dorsal: 0.55 },
    gear: { type: 'bogie4', nose: 4.5, main: 22.8, track: 7.32, wheel: 1.15, noseWheel: 0.9, clearance: 2.1 },
    win: { pitch: 0.508, w: 0.25, h: 0.36, y: 0.18, from: 5.5, to: 41.5, doors: [[3.9, 0.86, D], [12.5, 0.86, D], [24.0, 0.51, X], [42.0, 0.86, D]] },
    plug: { fwd: 14.0, aft: 27.0, split: 0.5 } },
  { id: 'b767', far: 0, cockpit: 'boeing', length: 54.94, span: 47.57, height: 15.85, spanTip: 2,
    codes: { B762: { L: 48.51 }, B763: { L: 54.94 }, B764: { L: 61.37 } },
    variants: { base: 2 | 4, alt: 1 | 4, altShare: 0.45 },
    fus: { w: 5.03, h: 5.41, nose: 7.0, noseTip: -0.22, tail: 14.0, tailTip: 0.5, tailR: 0.3 },
    wing: { mount: 'low', y: -0.55, le: 20.2, root: 11.4, kink: 0.32, kinkChord: 6.8, tip: 2.4, sweep: 33.5, dihedral: 6, t: 0.15, tt: 0.1, slats: true, flex: 1.6 },
    tips: { 1: { type: 'blended', h: 3.4, cant: 16 }, 2: { type: 'none' } },
    eng: { n: 2, mount: 'wing', x: [7.85], fwd: 3.5, drop: 0.5, styles: { 0: { d: 3.0, len: 5.7, style: 'short' } } },
    tail: { type: 'conv', fin: { h: 8.3, root: 8.6, tip: 2.8, sweep: 42, le: 42.0 }, stab: { span: 18.62, root: 5.6, tip: 1.8, sweep: 35, dihedral: 7, le: 46.0, y: 0.15 }, dorsal: 0.3 },
    gear: { type: 'bogie4', nose: 5.5, main: 28.3, track: 9.3, wheel: 1.17, noseWheel: 0.94, clearance: 2.2 },
    win: { pitch: 0.508, w: 0.25, h: 0.36, y: 0.24, from: 6.4, to: 47.0, doors: [[5.0, 1.07, D], [17.5, 1.07, D], [28.5, 0.6, X], [48.6, 1.07, D]] },
    plug: { fwd: 17.0, aft: 31.0, split: 0.5 } },
  { id: 'a300', far: 0, cockpit: 'a300', length: 54.08, span: 44.84, height: 16.53,
    codes: { A306: { L: 54.08 }, A30B: { L: 53.62 }, A310: { L: 46.66 }, A3ST: { L: 56.15 } },
    fus: { w: 5.64, h: 5.64, nose: 7.3, noseTip: -0.2, tail: 14.5, tailTip: 0.5, tailR: 0.32 },
    wing: { mount: 'low', y: -0.55, le: 19.3, root: 10.5, kink: 0.31, kinkChord: 6.4, tip: 2.2, sweep: 31, dihedral: 5, t: 0.15, tt: 0.105, slats: true, flex: 1.2 },
    tips: { 0: { type: 'fence', h: 1.1 } },
    eng: { n: 2, mount: 'wing', x: [7.9], fwd: 3.3, drop: 0.5, styles: { 0: { d: 2.9, len: 5.6, style: 'short' } } },
    tail: { type: 'conv', fin: { h: 8.5, root: 8.2, tip: 2.8, sweep: 42, le: 41.0 }, stab: { span: 16.26, root: 5.2, tip: 1.7, sweep: 35, dihedral: 6, le: 45.2, y: 0.15 }, dorsal: 0.3 },
    gear: { type: 'bogie4', nose: 6.0, main: 24.6, track: 9.6, wheel: 1.25, noseWheel: 1.0, clearance: 2.4 },
    win: { pitch: 0.533, w: 0.23, h: 0.33, y: 0.28, from: 7.4, to: 46.0, doors: [[5.9, 1.07, D], [16.9, 1.07, D], [28.0, 0.6, X], [47.6, 1.07, D]] },
    plug: { fwd: 17.0, aft: 30.0, split: 0.5 } },
  { id: 'erj', far: 2, cockpit: 'regional', length: 29.87, span: 20.04, height: 6.76,
    codes: { E135: { L: 26.33 }, E140: { L: 28.45 }, E145: { L: 29.87 }, E45X: { L: 29.87 } },
    fus: { w: 2.28, h: 2.28, nose: 4.3, noseTip: -0.36, tail: 6.2, tailTip: 0.4, tailR: 0.15 },
    wing: { mount: 'low', y: -0.5, le: 12.1, root: 4.2, kink: 0.32, kinkChord: 3.0, tip: 1.0, sweep: 24, dihedral: 5, t: 0.13, tt: 0.1 },
    tips: { 0: { type: 'small', h: 0.9, cant: 12 } },
    eng: { n: 2, mount: 'rear', x: [2.2], y: 0.3, z: 20.4, styles: { 0: { d: 1.4, len: 3.9, style: 'long' } } },
    tail: { type: 'T', fin: { h: 3.4, root: 4.1, tip: 2.2, sweep: 40, le: 22.8 }, stab: { span: 7.55, root: 2.1, tip: 1.0, sweep: 30, dihedral: 0 } },
    gear: { type: 'twin', nose: 2.9, main: 17.3, track: 4.1, wheel: 0.76, noseWheel: 0.55, clearance: 0.95 },
    win: { pitch: 0.53, w: 0.22, h: 0.32, y: 0.05, from: 4.6, to: 22.0, doors: [[2.7, 0.7, D], [11.6, 0.5, X]] },
    plug: { fwd: 9.5, aft: 18.0, split: 0.5 } },
  { id: 'md80', far: 2, cockpit: 'md80', length: 45.06, span: 32.87, height: 9.05,
    codes: { MD81: { L: 45.06 }, MD82: { L: 45.06 }, MD83: { L: 45.06 }, MD87: { L: 39.75 }, MD88: { L: 45.06 }, MD90: { L: 46.5, v: 8 }, B712: { L: 37.81, v: 8 }, DC93: { L: 36.37 }, DC95: { L: 40.72 } },
    variants: { base: 4 },
    fus: { w: 3.35, h: 3.61, nose: 4.8, noseTip: -0.3, tail: 8.2, tailTip: 0.55, tailR: 0.2 },
    wing: { mount: 'low', y: -0.55, le: 18.2, root: 7.2, kink: 0.26, kinkChord: 4.6, tip: 1.2, sweep: 26.5, dihedral: 3, t: 0.13, tt: 0.1, slats: true },
    eng: { n: 2, mount: 'rear', x: [3.0], y: 0.35, z: 33.2, styles: { 4: { d: 1.75, len: 6.2, style: 'long' }, 8: { d: 2.0, len: 5.2, style: 'long' } } },
    tail: { type: 'T', fin: { h: 4.6, root: 5.2, tip: 3.0, sweep: 45, le: 35.8 }, stab: { span: 12.24, root: 3.3, tip: 1.5, sweep: 30, dihedral: 0 } },
    gear: { type: 'twin', nose: 3.0, main: 25.0, track: 5.08, wheel: 1.0, noseWheel: 0.67, clearance: 1.0 },
    win: { pitch: 0.508, w: 0.24, h: 0.32, y: 0.12, from: 4.8, to: 37.0, doors: [[3.6, 0.86, D], [19.2, 0.51, X], [20.0, 0.51, X]] },
    plug: { fwd: 14.0, aft: 28.0, split: 0.55 } },
  { id: 'a220', far: 0, cockpit: 'airbus', length: 38.71, span: 35.1, height: 11.5,
    codes: { BCS1: { L: 35.0 }, BCS3: { L: 38.71 } },
    fus: { w: 3.7, h: 3.7, nose: 5.1, noseTip: -0.22, tail: 9.8, tailTip: 0.5, tailR: 0.2 },
    wing: { mount: 'low', y: -0.55, le: 14.1, root: 6.4, kink: 0.31, kinkChord: 3.9, tip: 1.3, sweep: 27.5, dihedral: 5, t: 0.14, tt: 0.1, slats: true },
    tips: { 0: { type: 'raked', h: 1.2 } },
    eng: { n: 2, mount: 'wing', x: [5.45], fwd: 2.6, drop: 0.3, clear: 0.55, styles: { 0: { d: 2.25, len: 4.6, style: 'short' } } },
    tail: { type: 'conv', fin: { h: 6.0, root: 5.6, tip: 2.2, sweep: 40, le: 30.0 }, stab: { span: 11.4, root: 3.4, tip: 1.2, sweep: 33, dihedral: 6, le: 33.6, y: 0.2 }, dorsal: 0.5 },
    gear: { type: 'twin', nose: 4.3, main: 20.0, track: 6.6, wheel: 1.1, noseWheel: 0.72, clearance: 1.4 },
    win: { pitch: 0.61, w: 0.28, h: 0.43, y: 0.15, from: 5.5, to: 31.8, doors: [[4.0, 0.83, D], [16.9, 0.6, X], [33.0, 0.76, D]] },
    plug: { fwd: 13.0, aft: 23.0, split: 0.5 } },
  { id: 'c130', far: 6, cockpit: 'c130', length: 29.79, span: 40.41, height: 11.84, palette: 'military',
    codes: { C130: { L: 29.79 }, C30J: { L: 29.79, v: 8 }, L100: { L: 34.37 }, A400: { L: 29.79, s: 1.51, v: 8 } },
    variants: { base: 4 },
    fus: { w: 4.3, h: 4.4, nose: 4.6, noseTip: -0.15, tail: 10.8, tailTip: 0.78, tailR: 0.42 },
    wing: { mount: 'high', y: 1.08, le: 11.0, root: 4.9, tip: 2.7, sweep: 1.5, dihedral: 2.5, t: 0.17, tt: 0.13 },
    eng: { n: 4, mount: 'wing-prop', x: [5.2, 10.1], fwd: 3.0, styles: { 4: { d: 1.35, len: 6.0, style: 'tprop', blades: 4, propD: 4.11 }, 8: { d: 1.35, len: 6.0, style: 'tprop', blades: 6, propD: 4.11 } } },
    tail: { type: 'conv', fin: { h: 6.3, root: 6.2, tip: 2.6, sweep: 30, le: 22.0 }, stab: { span: 16.05, root: 4.3, tip: 2.0, sweep: 10, dihedral: 0, le: 25.3, y: 0.62 }, dorsal: 0.9 },
    gear: { type: 'tandem', nose: 3.3, main: 14.0, track: 4.35, wheel: 1.0, noseWheel: 0.9, clearance: 1.0 },
    win: null },
  { id: 'k35r', far: 1, cockpit: 'boeing', length: 41.53, span: 39.88, height: 12.7, palette: 'military',
    codes: { K35R: { L: 41.53 }, K35E: { L: 41.53 }, C135: { L: 41.53 }, R135: { L: 41.53 }, E6: { L: 46.61 }, B703: { L: 46.61 }, B701: { L: 44.22 }, B720: { L: 41.25 } },
    fus: { w: 3.76, h: 4.1, nose: 5.6, noseTip: -0.25, tail: 10.0, tailTip: 0.4, tailR: 0.2, boom: true },
    wing: { mount: 'low', y: -0.55, le: 12.6, root: 9.0, kink: 0.3, kinkChord: 5.6, tip: 2.2, sweep: 37, dihedral: 7, t: 0.13, tt: 0.09 },
    eng: { n: 4, mount: 'wing', x: [7.4, 13.2], fwd: [2.5, 1.9], drop: 0.6, styles: { 0: { d: 1.85, len: 3.9, style: 'long' } } },
    tail: { type: 'conv', fin: { h: 7.0, root: 6.5, tip: 2.2, sweep: 40, le: 31.0 }, stab: { span: 13.95, root: 4.0, tip: 1.5, sweep: 35, dihedral: 7, le: 34.5, y: 0.2 }, dorsal: 0.4 },
    gear: { type: 'bogie4', nose: 5.0, main: 20.2, track: 6.73, wheel: 1.1, noseWheel: 0.9, clearance: 1.6 },
    win: null,
    plug: { fwd: 12.0, aft: 26.0, split: 0.5 } },
  { id: 'c17', far: 6, cockpit: 'c17', length: 53.04, span: 51.75, height: 16.79, palette: 'military',
    codes: { C17: { L: 53.04 } },
    fus: { w: 6.85, h: 6.4, nose: 7.2, noseTip: -0.15, tail: 17.0, tailTip: 0.7, tailR: 0.5 },
    wing: { mount: 'high', y: 1.04, le: 17.2, root: 11.0, tip: 3.3, sweep: 28, dihedral: -3, t: 0.14, tt: 0.1, slats: true },
    tips: { 0: { type: 'canted', h: 2.9, cant: 15 } },
    eng: { n: 4, mount: 'wing', x: [8.6, 15.2], fwd: [3.2, 2.4], drop: 0.6, styles: { 0: { d: 2.5, len: 5.6, style: 'long' } } },
    tail: { type: 'T', fin: { h: 8.0, root: 9.2, tip: 5.0, sweep: 40, le: 38.0 }, stab: { span: 19.81, root: 5.0, tip: 2.8, sweep: 30, dihedral: 0 } },
    gear: { type: 'tandem', nose: 6.5, main: 26.0, track: 10.27, wheel: 1.25, noseWheel: 1.0, clearance: 1.5 },
    win: null },
  { id: 'md11', far: 0, cockpit: 'md11', length: 61.6, span: 51.97, height: 17.6,
    codes: { MD11: { L: 61.6 }, DC10: { L: 55.5, v: 2 }, MD10: { L: 55.5, v: 2 } },
    variants: { base: 1 },
    fus: { w: 6.02, h: 6.02, nose: 7.6, noseTip: -0.22, tail: 12.0, tailTip: 0.3, tailR: 0.5 },
    wing: { mount: 'low', y: -0.55, le: 21.7, root: 13.5, kink: 0.3, kinkChord: 7.4, tip: 2.6, sweep: 37, dihedral: 5, t: 0.14, tt: 0.1, slats: true, flex: 1.6 },
    tips: { 1: { type: 'mdwing', h: 2.3, cant: 8 }, 2: { type: 'none' } },
    eng: { n: 3, mount: 'wing', x: [10.6], fwd: 3.6, drop: 0.55, styles: { 0: { d: 3.0, len: 6.0, style: 'short' } }, tail: { d: 2.9, len: 7.0, z: 49.5, y: 4.6 } },
    tail: { type: 'conv', fin: { h: 7.0, root: 6.0, tip: 2.5, sweep: 45, le: 53.0, base: 5.6 }, stab: { span: 18.03, root: 5.0, tip: 1.7, sweep: 37, dihedral: 6, le: 51.0, y: 0.1 } },
    gear: { type: 'md11', nose: 6.0, main: 31.0, track: 10.57, center: 34.0, wheel: 1.32, noseWheel: 1.0, clearance: 2.4 },
    win: { pitch: 0.508, w: 0.25, h: 0.36, y: 0.25, from: 7.3, to: 50.0, doors: [[5.9, 1.07, D], [17.5, 1.07, D], [32.5, 1.07, D], [45.0, 1.07, D]] },
    plug: { fwd: 20.0, aft: 38.0, split: 0.5 } },
];

// Cargo operators fly windowless freighters of many of these types: the
// windows are configuration, not livery, and the call-sign prefix is public
// data. Paint stays neutral either way.
export const FREIGHTER_OPERATORS = new Set(['FDX', 'UPS', 'GTI', 'ABX', 'ATN', 'CKS', 'CLX', 'GEC', 'BOX', 'PAC', 'NCA', 'ABW', 'MPH', 'CAO', 'CKK', 'AJT', 'SOO', 'WGN', 'NPT', 'TAY', 'DHK', 'BCS']);

function finish(f, index) {
  const out = { ...f, index, codes: Object.keys(f.codes), codeRows: f.codes };
  out.radius = (f.fus.w + f.fus.h) / 4;
  out.engines = f.eng?.n ?? 0;
  out.prop = /wing-prop|nose/.test(f.eng?.mount ?? '') && !f.helicopter;
  out.rearEngines = f.eng?.mount === 'rear';
  out.highWing = f.wing?.mount === 'high';
  out.tTail = f.tail?.type === 'T';
  out.sweep = Math.tan(((f.wing?.sweep ?? 0) * Math.PI) / 180);
  out.winglets = !!f.tips && Object.values(f.tips).some((t) => t.type !== 'none' && t.type !== 'raked');
  out.doubleDeck = f.id === 'a380';
  out.hump = !!f.fus.hump;
  out.variants = { base: 0, ...(f.variants ?? {}) };
  out.palette = f.palette ?? 'civil';
  return Object.freeze(out);
}

/** The family list, in contract order. */
export const FLEET_FAMILIES = Object.freeze(FAMILIES.map(finish));
export const FAMILY_INDEX = Object.freeze(Object.fromEntries(FLEET_FAMILIES.map((f, i) => [f.id, i])));
export const FAR_REP_INDEX = Object.freeze(FAR_REP.map((id) => FAMILY_INDEX[id]));

const BY_CODE = new Map();
for (const f of FLEET_FAMILIES) for (const code of f.codes) BY_CODE.set(code, f.index);

/** Family index for an exact ICAO type designator, or null. */
export function familyForCode(code) {
  const t = String(code ?? '').trim().toUpperCase();
  return BY_CODE.has(t) ? BY_CODE.get(t) : null;
}

/** ADS-B emitter category fallback for types we do not know by code. */
const CATEGORY_FAMILY = { A1: 'lowwing-piston', A2: 'business', A3: 'a320', A4: 'b757', A5: 'b777', A7: 'helicopter' };
export function familyForCategory(category) {
  const id = CATEGORY_FAMILY[String(category ?? '').toUpperCase()];
  return id ? FAMILY_INDEX[id] : null;
}

const hash32 = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h;
};

/** Operator key for a consistent per-fleet paint: the ICAO airline prefix of a
 *  call sign (3 letters + digit), else the airframe's own hex. */
export function operatorKey(meta, hex = '') {
  const cs = String(meta?.flight ?? '').trim().toUpperCase();
  const m = /^([A-Z]{3})\d/.exec(cs);
  return m ? m[1] : String(hex || meta?.hex || cs || '?');
}

/**
 * Per-airframe presentation for a family: fuselage plugs (metres added ahead
 * of / behind the wing), uniform scale (GA/bizjet/helicopter families), the
 * variant bits (winglet/engine/tail options, freighter windows) and a stable
 * paint seed. Deterministic for a given (type, call sign, hex).
 */
export function airframeSpec(familyIndex, meta, hex = '') {
  const f = FLEET_FAMILIES[familyIndex];
  const code = String(meta?.t ?? '').trim().toUpperCase();
  const row = f.codeRows[code];
  const h = hash32(String(hex || meta?.hex || code));
  let variant = row?.v ?? f.variants.base ?? 0;
  if (!row?.v && f.variants.alt && (h % 1000) / 1000 < (f.variants.altShare ?? 0)) variant = f.variants.alt;
  const op = operatorKey(meta, hex);
  if (FREIGHTER_OPERATORS.has(op) && f.win) variant |= VARIANT.FREIGHTER;
  let plugF = 0, plugA = 0, scale = row?.s ?? 1;
  if (row?.L && f.plug && !f.scaled) {
    const d = row.L - f.length;
    plugF = d * f.plug.split;
    plugA = d - plugF;
  } else if (row?.L && f.scaled) scale = row.L / f.length;
  return { family: familyIndex, variant, plugF, plugA, scale, seed: hash32(op) & 255, operator: op, length: (f.length + plugF + plugA) * scale };
}
