/**
 * R24 C LIGHT — ONE_SUN (recon L3) node-level RED/GREEN proof.
 *
 * L3's claim is "up to four sun directions per frame". That is an arithmetic
 * claim about vectors the tree computes from constants, so it is provable here
 * with no GPU and no tiles: re-evaluate each consumer's OWN formula, verbatim
 * from its call site, at three real solar states, and report the pairwise
 * angular disagreement in degrees.
 *
 *   key   FlyScene.jsx :1806-1827 (JSX position) and the -50 rig branch
 *   hill  world-bend setHillDir  <- FlyScene :886 (clamped el, true az)
 *   dome  SkyDome uSunDir        <- :463 (TRUE el, true az)
 *   moon  sun-model moonDirFromSun (anti-solar, fixed elevation)
 *   water = key by construction (one directional in the whole rig)
 *
 * Run: node scripts/r24-c-one-sun-proof.mjs
 */
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../lib/fly/fly-constants.js', import.meta.url), 'utf8');
const num = (re, d) => { const m = re.exec(SRC); return m ? +m[1] : d; };

const MIN_EL_HILL = num(/minElRad:\s*([0-9.]+),\s*\/\/[^\n]*graze|minElRad:\s*([0-9.]+)/, 0.15);
const HILL_MIN = num(/HILLSHADE[\s\S]*?minElRad:\s*([0-9.]+)/, 0.15);
const HILL_MAX = num(/HILLSHADE[\s\S]*?maxElRad:\s*([0-9.]+)/, 0.9);
const SAT_MIN = num(/SAT_SHADOWS[\s\S]*?minElRad:\s*([0-9.]+)/, 0.15);
const MOON_EL = num(/moonElRad:\s*([0-9.]+)/, 0.35);
const SUN_DIR = (() => {
  const m = /sunDirection:\s*\[([^\]]+)\]/.exec(SRC);
  return m ? m[1].split(',').map((v) => +v.trim()) : [0.555, 0.742, 0.377];
})();
const ONE = (() => {
  const i = SRC.indexOf('export const ONE_SUN = ');
  const b = SRC.slice(i, i + 3000);
  return {
    fadeStartDeg: +/fadeStartDeg:\s*(-?[0-9.]+)/.exec(b)[1],
    fadeFullDeg: +/fadeFullDeg:\s*(-?[0-9.]+)/.exec(b)[1],
    dayDeg: +/dayDeg:\s*([0-9.]+)/.exec(b)[1],
    dayK: +/dayK:\s*([0-9.]+)/.exec(b)[1],
    lowDeg: +/lowDeg:\s*([0-9.]+)/.exec(b)[1],
  };
})();

const DEG = Math.PI / 180;
const basis = (az, el) => {
  const ce = Math.cos(el);
  return [-Math.sin(az) * ce, Math.sin(el), Math.cos(az) * ce];
};
const norm = (v) => { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); };
const angle = (a, b) => {
  const d = Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  return (Math.acos(d) * 180) / Math.PI;
};
const azOf = (v) => (Math.atan2(-v[0], v[2]) * 180) / Math.PI;
const elOf = (v) => (Math.asin(Math.min(1, Math.max(-1, v[1] / (Math.hypot(...v) || 1)))) * 180) / Math.PI;
const smooth = (t) => { t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); };

// Solar states: (az = hour angle rad, sinEl). Chosen to hit the three regimes.
const STATES = [
  { name: 'NOON  (summer, el +68°)', az: 0.05, trueElDeg: 68 },
  { name: 'DUSK  (el +2°)', az: 2.6, trueElDeg: 2 },
  { name: 'NIGHT (el −14°)', az: 3.0, trueElDeg: -14 },
];

function vectors(st, oneSun, tier) {
  const trueEl = st.trueElDeg * DEG;
  const sinEl = Math.sin(trueEl);
  // computeSun's clamped `el` — asin(max(0,sinEl)) then clamp to the band
  const clampedEl = Math.min(HILL_MAX, Math.max(HILL_MIN, Math.asin(Math.max(0, sinEl))));
  const shadowCasting = tier === 'high';
  const hill = basis(st.az, clampedEl);
  const dome = basis(st.az, trueEl);
  const moon = (() => {
    const a = st.az + Math.PI, ce = Math.cos(MOON_EL);
    return [-Math.sin(a) * ce, Math.sin(MOON_EL), Math.cos(a) * ce];
  })();
  let key;
  if (!oneSun) {
    // R21: the position write lives INSIDE the shadow branch.
    key = shadowCasting ? basis(st.az, Math.max(SAT_MIN, clampedEl)) : norm(SUN_DIR);
  } else {
    const elKey = shadowCasting ? Math.max(SAT_MIN, trueEl) : trueEl;
    key = basis(st.az, elKey);
    const mk = smooth((ONE.fadeStartDeg - st.trueElDeg) / (ONE.fadeStartDeg - ONE.fadeFullDeg));
    if (mk > 0) key = norm(key.map((v, i) => v + (moon[i] - v) * mk));
  }
  return { key, hill, dome, moon };
}

const hillW = (elDeg, oneSun) => {
  if (!oneSun) return 1;
  if (elDeg <= ONE.lowDeg) return 1;
  if (elDeg >= ONE.dayDeg) return ONE.dayK;
  return 1 + (ONE.dayK - 1) * smooth((elDeg - ONE.lowDeg) / (ONE.dayDeg - ONE.lowDeg));
};

console.log('\nR24 C — ONE_SUN vector-agreement proof (recon L3)');
console.log(`constants: SKY.sunDirection=[${SUN_DIR}] HILLSHADE.el=[${HILL_MIN}, ${HILL_MAX}]rad SAT_SHADOWS.minEl=${SAT_MIN}rad moonEl=${MOON_EL}rad`);
console.log(`ONE_SUN: moon ${ONE.fadeStartDeg}° → ${ONE.fadeFullDeg}° · hill ${ONE.lowDeg}°→${ONE.dayDeg}° weight 1.00→${ONE.dayK}\n`);

for (const tier of ['high', 'medium']) {
  console.log(`── tier ${tier} ${'─'.repeat(72)}`);
  const hdr = ['state', 'leg', 'key↔hill', 'key↔dome', 'hill↔dome', 'key az/el', 'hillW'];
  console.log(hdr.map((h, i) => h.padEnd(i === 0 ? 24 : 11)).join(''));
  for (const st of STATES) {
    for (const leg of ['RED', 'GREEN']) {
      const v = vectors(st, leg === 'GREEN', tier);
      const row = [
        leg === 'RED' ? st.name : '',
        leg,
        angle(v.key, v.hill).toFixed(1) + '°',
        angle(v.key, v.dome).toFixed(1) + '°',
        angle(v.hill, v.dome).toFixed(1) + '°',
        `${azOf(v.key).toFixed(0)}/${elOf(v.key).toFixed(0)}`,
        hillW(st.trueElDeg, leg === 'GREEN').toFixed(2),
      ];
      console.log(row.map((c, i) => String(c).padEnd(i === 0 ? 24 : 11)).join(''));
    }
  }
  console.log('');
}

console.log('CONTRACT the GREEN column satisfies (this is what verify-one-sun should assert):');
console.log('  1. AZIMUTH of key, hill and dome are EQUAL (to 1e-6) at every tier, except');
console.log('     where moonK > 0, at which point the key is the anti-solar moon BY DESIGN.');
console.log('  2. key elevation == TRUE solar elevation, floored at SAT_SHADOWS.minElRad');
console.log('     ONLY while the shadow camera casts (high tier).');
console.log('  3. hill elevation == clamp(true, [HILLSHADE.minElRad, maxElRad]) — a relief');
console.log('     legibility clamp, deliberately NOT a lighting fact.');
console.log('  4. at moonK == 1 the key IS moonDirFromSun(az) exactly (0.0° apart).');
console.log('  5. water reads the same directional as key — there is no second light.');
