// LOOK PASS E (GRADE) node gate: the exposure law and key/fill terms, and the
// identities that keep Medium/phone/Low and `?flags=-LOOK_GRADE` on today's pixels.
//   node scripts/verify-look-grade.mjs
import { register } from 'node:module';
register('./_node-resolve.mjs', import.meta.url);
const { createCinemaEnvironment, evaluateCinemaEnvironment } = await import('../lib/fly/cinema-environment.js');
const { applyLookGradeEnvironment, lookGradeWeight, LOOK_GRADE_CFG, LOOK_WATER_UNIFORM } = await import('../lib/fly/look-grade.js');
const { hdrGradeGLSL } = await import('../lib/fly/hdr-grade.js');

let pass = 0, fail = 0;
const ok = (c, m, d = '') => { if (c) { pass++; console.log(`PASS  ${m}${d ? `  — ${d}` : ''}`); } else { fail++; console.log(`FAIL  ${m}${d ? `  — ${d}` : ''}`); } };
const at = (el, weather = {}) => {
  const e = evaluateCinemaEnvironment(createCinemaEnvironment(), { sinEl: Math.sin(el * Math.PI / 180), az: 1.2 }, weather);
  e.keyColor = [1, 0.78, 0.55]; // a representative physical-sky key at low sun
  return e;
};
const snap = (e) => JSON.stringify(e);

// 1. Node has no window: the live weight is 0 and the environment is untouched.
ok(lookGradeWeight() === 0, 'node (no window) weight is 0');
for (const el of [45, 7, -3, -20]) {
  const e = at(el), before = snap(e);
  applyLookGradeEnvironment(e);
  ok(snap(e) === before, `weight 0 leaves the environment byte-identical at ${el} deg`);
}
ok(LOOK_WATER_UNIFORM.value.x === 0 && LOOK_WATER_UNIFORM.value.y === 0, 'weight 0 zeroes the water uniform');

// 2. Flag off: the display grade text carries no LOOK term.
ok(!hdrGradeGLSL(true, false).includes('uLook') && !hdrGradeGLSL(false, false).includes('uLook'), 'flag-off display grade text has no uLook');
ok(hdrGradeGLSL(true, true).includes('lookGrade('), 'flag-on display grade text carries lookGrade()');
// r2: the noon chroma lift is gamut-limited (a saturated cruise zenith once
// clipped its red channel to 0 and shifted hue).
ok(hdrGradeGLSL(true, true).includes('.97*yy/max(-dn,1e-4)'), 'noon chroma lift carries the gamut guard');
// r3 (review round 2): noon whites stay white, the zenith gets value back,
// dusk walls give up chroma; all gated on the live weight.
{ const t = hdrGradeGLSL(true, true);
  ok(t.includes('float white=g*noon') && t.includes('float zl=') && t.includes('float tw=g*uLook.w'), 'cloud-white, zenith-lift and dusk-cool terms are weight-gated'); }
ok(LOOK_WATER_UNIFORM.value.z === 0 && LOOK_WATER_UNIFORM.value.w === 0, 'weight 0 zeroes the daylight water lift and near sheen');

// 3. The law, weight 1.
const stops = (el, w = {}) => { const e = at(el, w), s0 = e.exposureStops; applyLookGradeEnvironment(e, 1); return { d: e.exposureStops - s0, e }; };
const noon = stops(45), golden = stops(7), dusk = stops(-3), night = stops(-20);
ok(Math.abs(noon.d) < 0.1, 'noon exposure moves under 0.1 stop', noon.d.toFixed(3));
// r3: the golden lift was cut (0.72 -> about 0.2) once it stacked with ATMOS
// glow and cirrus; dusk still opens more than golden; night gets a small floor.
ok(golden.d > 0.1 && golden.d < 0.4, 'golden hour opens by 0.1..0.4 stop (down-sun)', golden.d.toFixed(3));
ok(dusk.d > 0.5 && dusk.d > golden.d, 'civil dusk opens by more than 0.5 stop', dusk.d.toFixed(3));
ok(night.d > 0.1 && night.d < 0.4, 'full night opens by a small floor (0.1..0.4 stop)', night.d.toFixed(3));
// r3 metering: a view into a low sun takes exposure off (the cream Rio frame);
// a view away from it keeps the lift. A new camera snaps the meter.
const cam = (dx, dz) => ({ matrixWorld: { elements: [1, 0, 0, 0, 0, 1, 0, 0, -dx, 0, -dz, 0, 0, 0, 0, 1] } });
const facing = (el, sign) => { const e = at(el), s0 = e.exposureStops; applyLookGradeEnvironment(e, 1, cam(sign * e.sunDir[0], sign * e.sunDir[2])); return e.exposureStops - s0; };
const into = facing(7, 1), away = facing(7, -1);
ok(away - into > 0.5 && into < 0, 'golden into the sun meters down; away keeps the lift', `${into.toFixed(3)} / ${away.toFixed(3)}`);
const duskInto = facing(-3, 1), duskAway = facing(-3, -1);
ok(duskAway - duskInto > 0.2, 'dusk into the afterglow meters down too', `${duskInto.toFixed(3)} / ${duskAway.toFixed(3)}`);
ok(Math.abs(facing(45, 1) - facing(45, -1)) < 1e-9, 'noon is not metered by view direction');
ok(Math.abs(golden.e.exposure - 2 ** golden.e.exposureStops) < 1e-9, 'exposure stays 2^stops');
const kc = golden.e.keyColor;
ok(kc[0] === 1 && kc[1] < 0.78 && kc[1] >= LOOK_GRADE_CFG.keyGoldGreen - 0.12 && kc[2] < 0.55, 'golden key is warmer (more chroma), gold not salmon', kc.map(v => v.toFixed(3)).join(','));
ok(golden.e.fillColor[2] > golden.e.fillColor[0] * 1.8, 'golden fill reads cool', golden.e.fillColor.map(v => v.toFixed(3)).join(','));
const noonKey = at(45).keyColor.slice(); applyLookGradeEnvironment(noon.e, 1);
ok(noon.e.keyColor.every((v, i) => Math.abs(v - noonKey[i]) < 1e-3), 'noon key colour is untouched (no brown daylight)');
const ov = stops(7, { overcastT: 1 });
ok(ov.d < golden.d, 'overcast golden opens less than clear golden', ov.d.toFixed(3));

console.log(`\nverify-look-grade: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
