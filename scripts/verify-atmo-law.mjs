/**
 * R24 D ATMOS — verify-atmo-law (node gate, no browser, no dev server).
 *
 * The whole point of AERIAL_LAW is that ONE function is evaluated in two
 * places: per material at medium/low (world-bend's fade / content / air /
 * anchor variants) and as the depth post pass at high. If those two ever
 * drift, the 14 -> 16 km seam this round exists to delete simply moves to the
 * tier boundary, and no pixel gate would catch it because no pose exercises
 * both tiers at once.
 *
 * So this gate does not compare two implementations by eye. It PARSES the
 * GLSL text that ships in the shaders (ATMO_GLSL_VERTEX / ATMO_GLSL_FRAGMENT,
 * imported from lib/fly/atmo-law.js, i.e. the exact string injected into
 * every program) and EVALUATES it with a small interpreter over the subset
 * the law is written in, then asserts the result equals the JS mirror
 * (atmoTransJS / atmoInscatterJS / atmoApplyJS / atmoExtinctJS / atmoPackJS)
 * at thousands of sample points across the flyable envelope.
 *
 * It also asserts the LAW's structural properties, the strength-0 identity
 * that every byte-identity claim rests on, and prints the RED table: the
 * pre-R24 two-fog stack's mix-vs-distance curve, whose 14-16 km plateau is
 * the defect.
 *
 * Run:  node scripts/verify-atmo-law.mjs
 */
import fs from 'node:fs';
import {
  ATMO_GLSL_DECL,
  ATMO_GLSL_VERTEX,
  ATMO_GLSL_FRAGMENT,
  atmoUniforms,
  atmoPackJS,
  atmoTransJS,
  atmoInscatterJS,
  atmoApplyJS,
  atmoExtinctJS,
  srgbToLinear,
  setAtmoLaw,
} from '../lib/fly/atmo-law.js';

// --------------------------------------------------------------------------
// A GLSL expression interpreter, restricted to the subset the law uses:
// float/vec3 declarations, return, + - * /, unary -, parentheses, the ternary,
// the four comparisons, member access (.x/.y/.z/.r/.g/.b), and the builtins
// exp sqrt abs min max mix clamp dot length vec3 float. Anything outside that
// subset throws -- which is itself a gate: the law may not grow constructs
// this mirror cannot follow.
// --------------------------------------------------------------------------
function tokenize(src) {
  const out = [];
  const re = /\s+|\/\/[^\n]*|\/\*[\s\S]*?\*\/|[0-9]+\.[0-9]*(?:e-?[0-9]+)?|[0-9]*\.[0-9]+(?:e-?[0-9]+)?|[0-9]+(?:e-?[0-9]+)?|[A-Za-z_][A-Za-z_0-9]*|<=|>=|==|!=|[-+*/(),;{}?:.<>=]/g;
  let m;
  let last = 0;
  while ((m = re.exec(src))) {
    if (m.index !== last) throw new Error(`unlexable at ${last}: ${src.slice(last, m.index + 5)}`);
    last = re.lastIndex;
    const t = m[0];
    if (/^\s/.test(t) || t.startsWith('//') || t.startsWith('/*')) continue;
    out.push(t);
  }
  if (last !== src.length) throw new Error(`unlexable tail: ${src.slice(last)}`);
  return out;
}

const F = (v) => ({ t: 'f', v });
const V = (v) => ({ t: 'v3', v });
const comps = { x: 0, y: 1, z: 2, r: 0, g: 1, b: 2 };

function bin(op, a, b) {
  const f = { '+': (x, y) => x + y, '-': (x, y) => x - y, '*': (x, y) => x * y, '/': (x, y) => x / y }[op];
  if (a.t === 'f' && b.t === 'f') return F(f(a.v, b.v));
  const av = a.t === 'v3' ? a.v : [a.v, a.v, a.v];
  const bv = b.t === 'v3' ? b.v : [b.v, b.v, b.v];
  return V([f(av[0], bv[0]), f(av[1], bv[1]), f(av[2], bv[2])]);
}
const map1 = (a, f) => (a.t === 'f' ? F(f(a.v)) : V(a.v.map(f)));
function map2(a, b, f) {
  if (a.t === 'f' && b.t === 'f') return F(f(a.v, b.v));
  const av = a.t === 'v3' ? a.v : [a.v, a.v, a.v];
  const bv = b.t === 'v3' ? b.v : [b.v, b.v, b.v];
  return V([f(av[0], bv[0]), f(av[1], bv[1]), f(av[2], bv[2])]);
}

const BUILTINS = {
  exp: (a) => map1(a, Math.exp),
  sqrt: (a) => map1(a, Math.sqrt),
  abs: (a) => map1(a, Math.abs),
  min: (a, b) => map2(a, b, Math.min),
  max: (a, b) => map2(a, b, Math.max),
  clamp: (a, lo, hi) => map2(map2(a, lo, Math.max), hi, Math.min),
  mix: (a, b, k) => {
    const kv = k.t === 'v3' ? k.v : [k.v, k.v, k.v];
    if (a.t === 'f' && b.t === 'f' && k.t === 'f') return F(a.v + (b.v - a.v) * k.v);
    const av = a.t === 'v3' ? a.v : [a.v, a.v, a.v];
    const bv = b.t === 'v3' ? b.v : [b.v, b.v, b.v];
    return V([0, 1, 2].map((i) => av[i] + (bv[i] - av[i]) * kv[i]));
  },
  dot: (a, b) => F(a.v[0] * b.v[0] + a.v[1] * b.v[1] + a.v[2] * b.v[2]),
  length: (a) => F(Math.hypot(a.v[0], a.v[1], a.v[2])),
  vec3: (...as) => (as.length === 1 ? V([as[0].v, as[0].v, as[0].v]) : V(as.map((a) => a.v))),
  float: (a) => F(a.v),
};

class Parser {
  constructor(toks) {
    this.t = toks;
    this.i = 0;
  }
  peek(k = 0) { return this.t[this.i + k]; }
  next() { return this.t[this.i++]; }
  expect(s) {
    const g = this.next();
    if (g !== s) throw new Error(`expected '${s}' got '${g}' at ${this.i}`);
    return g;
  }
  // funcdefs
  parseFunctions() {
    const fns = {};
    while (this.i < this.t.length) {
      const ret = this.next();
      if (ret !== 'float' && ret !== 'vec3') throw new Error(`bad return type ${ret}`);
      const name = this.next();
      this.expect('(');
      const params = [];
      while (this.peek() !== ')') {
        const pt = this.next();
        if (pt !== 'float' && pt !== 'vec3') throw new Error(`bad param type ${pt}`);
        params.push({ type: pt, name: this.next() });
        if (this.peek() === ',') this.next();
      }
      this.expect(')');
      this.expect('{');
      const body = [];
      while (this.peek() !== '}') body.push(this.stmt());
      this.expect('}');
      fns[name] = { params, body, ret };
    }
    return fns;
  }
  stmt() {
    const h = this.peek();
    if (h === 'float' || h === 'vec3') {
      const type = this.next();
      const name = this.next();
      this.expect('=');
      const e = this.expr();
      this.expect(';');
      return { k: 'decl', type, name, e };
    }
    if (h === 'return') {
      this.next();
      const e = this.expr();
      this.expect(';');
      return { k: 'ret', e };
    }
    throw new Error(`unsupported statement '${h}'`);
  }
  expr() {
    const c = this.cmp();
    if (this.peek() === '?') {
      this.next();
      const a = this.expr();
      this.expect(':');
      const b = this.expr();
      return { k: 'tern', c, a, b };
    }
    return c;
  }
  cmp() {
    let a = this.add();
    while (['<', '>', '<=', '>='].includes(this.peek())) {
      const op = this.next();
      a = { k: 'cmp', op, a, b: this.add() };
    }
    return a;
  }
  add() {
    let a = this.mul();
    while (this.peek() === '+' || this.peek() === '-') {
      const op = this.next();
      a = { k: 'bin', op, a, b: this.mul() };
    }
    return a;
  }
  mul() {
    let a = this.unary();
    while (this.peek() === '*' || this.peek() === '/') {
      const op = this.next();
      a = { k: 'bin', op, a, b: this.unary() };
    }
    return a;
  }
  unary() {
    if (this.peek() === '-') { this.next(); return { k: 'neg', a: this.unary() }; }
    return this.postfix();
  }
  postfix() {
    let a = this.primary();
    while (this.peek() === '.') {
      this.next();
      a = { k: 'member', a, m: this.next() };
    }
    return a;
  }
  primary() {
    const h = this.next();
    if (h === '(') { const e = this.expr(); this.expect(')'); return e; }
    if (/^[0-9.]/.test(h)) return { k: 'num', v: parseFloat(h) };
    if (this.peek() === '(') {
      this.next();
      const args = [];
      while (this.peek() !== ')') { args.push(this.expr()); if (this.peek() === ',') this.next(); }
      this.expect(')');
      return { k: 'call', name: h, args };
    }
    return { k: 'id', name: h };
  }
}

function makeInterp(glslSrc, uniformEnv) {
  const fns = new Parser(tokenize(glslSrc)).parseFunctions();
  function evalNode(n, scope) {
    switch (n.k) {
      case 'num': return F(n.v);
      case 'id': {
        if (n.name in scope) return scope[n.name];
        if (n.name in uniformEnv) return uniformEnv[n.name];
        throw new Error(`unknown identifier '${n.name}'`);
      }
      case 'member': {
        const a = evalNode(n.a, scope);
        if (a.t !== 'v3') throw new Error('member on non-vec3');
        if (!(n.m in comps)) throw new Error(`bad swizzle .${n.m}`);
        return F(a.v[comps[n.m]]);
      }
      case 'neg': { const a = evalNode(n.a, scope); return map1(a, (x) => -x); }
      case 'bin': return bin(n.op, evalNode(n.a, scope), evalNode(n.b, scope));
      case 'cmp': {
        const a = evalNode(n.a, scope).v, b = evalNode(n.b, scope).v;
        const r = { '<': a < b, '>': a > b, '<=': a <= b, '>=': a >= b }[n.op];
        return { t: 'bool', v: r };
      }
      case 'tern': return evalNode(n.c, scope).v ? evalNode(n.a, scope) : evalNode(n.b, scope);
      case 'call': {
        const args = n.args.map((a) => evalNode(a, scope));
        if (n.name in BUILTINS) return BUILTINS[n.name](...args);
        if (n.name in fns) return callFn(n.name, args);
        throw new Error(`unknown function '${n.name}'`);
      }
      default: throw new Error(`bad node ${n.k}`);
    }
  }
  function callFn(name, args) {
    const fn = fns[name];
    const scope = {};
    fn.params.forEach((p, i) => { scope[p.name] = args[i]; });
    for (const s of fn.body) {
      if (s.k === 'decl') scope[s.name] = evalNode(s.e, scope);
      else return evalNode(s.e, scope);
    }
    throw new Error(`${name} fell through without a return`);
  }
  return { fns, call: callFn };
}

// --------------------------------------------------------------------------
// Gates
// --------------------------------------------------------------------------
let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}${detail ? '  ' + detail : ''}`); }
  else { fail++; console.log(`  FAIL  ${name}  ${detail}`); }
};

const u = atmoUniforms;
const uniformEnv = {
  get uAtmoEye() { return V([u.uAtmoEye.value.x, u.uAtmoEye.value.y, u.uAtmoEye.value.z]); },
  get uAtmoSunDir() { return V([u.uAtmoSunDir.value.x, u.uAtmoSunDir.value.y, u.uAtmoSunDir.value.z]); },
  get uAtmoGroundY() { return F(u.uAtmoGroundY.value); },
  get uAtmoBeta() { return V([u.uAtmoBeta.value.x, u.uAtmoBeta.value.y, u.uAtmoBeta.value.z]); },
  get uAtmoScaleH() { return F(u.uAtmoScaleH.value); },
  get uAtmoEyeH() { return F(u.uAtmoEyeH.value); },
  get uAtmoInscatter() { return V([u.uAtmoInscatter.value.r, u.uAtmoInscatter.value.g, u.uAtmoInscatter.value.b]); },
  get uAtmoSunTint() { return V([u.uAtmoSunTint.value.r, u.uAtmoSunTint.value.g, u.uAtmoSunTint.value.b]); },
  get uAtmoMie() { return V([u.uAtmoMie.value.x, u.uAtmoMie.value.y, u.uAtmoMie.value.z]); },
  get uAtmoStrength() { return F(u.uAtmoStrength.value); },
};

console.log('\nR24 D ATMOS — verify-atmo-law\n');
console.log('[1] GLSL text parses in the declared subset');
let interp;
try {
  interp = makeInterp(ATMO_GLSL_VERTEX + ATMO_GLSL_FRAGMENT, uniformEnv);
  ok('law parses', true, `functions: ${Object.keys(interp.fns).join(', ')}`);
} catch (e) {
  ok('law parses', false, String(e));
  process.exit(1);
}
ok('all five law functions present',
  ['atmoPack', 'atmoTrans', 'atmoInscatter', 'atmoApply', 'atmoExtinct'].every((k) => k in interp.fns),
  Object.keys(interp.fns).join(','));

// A representative live state (satellite, low flight, warm afternoon rim).
const RIM = [0xc6 / 255, 0xd7 / 255, 0xe8 / 255];
const TINT = [0xff / 255, 0xd0 / 255, 0x9a / 255];
setAtmoLaw({
  eye: [1234.5, 812.0, -987.25],
  sunDir: [0.4472135955, 0.7453559925, 0.4939115685],
  groundY: 265.0,
  beta: [5.4e-5, 6.45e-5, 7.9e-5],
  scaleH: 1500,
  eyeH: 547.0,
  rimSRGB: RIM,
  sunTintSRGB: TINT,
  mieK: 0.35,
  mieG: 0.76,
  strength: 1,
});

console.log('\n[2] GLSL text === JS mirror across the flyable envelope');
const relerr = (a, b) => Math.abs(a - b) / Math.max(1e-9, Math.abs(a) + Math.abs(b));
let worstT = 0, worstI = 0, worstA = 0, worstE = 0, worstP = 0, n = 0;
for (let di = 0; di < 16; di++) {
  const d = [0, 1, 10, 100, 500, 800, 2000, 5000, 9000, 14000, 16000, 20000, 40000, 60000, 90000, 130000][di];
  for (let hi = 0; hi < 8; hi++) {
    const h = [-400, 0, 30, 120, 800, 1600, 4000, 9000][hi];
    const gT = interp.call('atmoTrans', [F(d), F(h)]).v;
    const jT = atmoTransJS(u, d, h);
    for (let c = 0; c < 3; c++) worstT = Math.max(worstT, relerr(gT[c], jT[c]));
    for (let ci = 0; ci < 8; ci++) {
      const cs = -1 + (2 * ci) / 7;
      const gI = interp.call('atmoInscatter', [F(cs)]).v;
      const jI = atmoInscatterJS(u, cs);
      for (let c = 0; c < 3; c++) worstI = Math.max(worstI, relerr(gI[c], jI[c]));
      const col = [0.21 + 0.3 * ci, 0.44, 0.62 - 0.02 * hi];
      const gA = interp.call('atmoApply', [V(col), V([d, h, cs])]).v;
      const jA = atmoApplyJS(u, col, [d, h, cs]);
      for (let c = 0; c < 3; c++) worstA = Math.max(worstA, relerr(gA[c], jA[c]));
      const gE = interp.call('atmoExtinct', [V(col), V([d, h, cs])]).v;
      const jE = atmoExtinctJS(u, col, [d, h, cs]);
      for (let c = 0; c < 3; c++) worstE = Math.max(worstE, relerr(gE[c], jE[c]));
      n += 4;
    }
  }
}
for (let i = 0; i < 64; i++) {
  const w = [1234.5 + 900 * Math.cos(i), 300 + 40 * i, -987.25 + 700 * Math.sin(i * 1.7)];
  const ty = 120 + 11 * i;
  const gP = interp.call('atmoPack', [V(w), F(ty)]).v;
  const jP = atmoPackJS(u, w, ty);
  for (let c = 0; c < 3; c++) worstP = Math.max(worstP, relerr(gP[c], jP[c]));
  n++;
}
ok('atmoTrans   GLSL == JS', worstT < 1e-12, `worst rel ${worstT.toExponential(2)}`);
ok('atmoInscatter GLSL == JS', worstI < 1e-12, `worst rel ${worstI.toExponential(2)}`);
ok('atmoApply   GLSL == JS', worstA < 1e-12, `worst rel ${worstA.toExponential(2)}`);
ok('atmoExtinct GLSL == JS', worstE < 1e-12, `worst rel ${worstE.toExponential(2)}`);
ok('atmoPack    GLSL == JS', worstP < 1e-12, `worst rel ${worstP.toExponential(2)}`);
ok('sample count', n >= 4000, `${n} evaluated points`);

console.log('\n[3] strength 0 is EXACT identity (the byte-identity contract)');
const saveK = u.uAtmoStrength.value;
u.uAtmoStrength.value = 0;
let idExact = true;
for (let i = 0; i < 200; i++) {
  const col = [Math.random(), Math.random(), Math.random()];
  const dhc = [Math.random() * 130000, Math.random() * 9000 - 400, Math.random() * 2 - 1];
  const a = interp.call('atmoApply', [V(col), V(dhc)]).v;
  const e = interp.call('atmoExtinct', [V(col), V(dhc)]).v;
  for (let c = 0; c < 3; c++) {
    if (a[c] !== col[c]) idExact = false;
    if (e[c] !== col[c]) idExact = false;
  }
}
ok('atmoApply/atmoExtinct return the input BIT-EXACTLY at strength 0', idExact);
u.uAtmoStrength.value = saveK;

console.log('\n[4] the law is a law (structural properties)');
{
  const cs = 0.2;
  let mono = true, prev = 1;
  for (let d = 0; d <= 140000; d += 500) {
    const T = interp.call('atmoTrans', [F(d), F(0)]).v;
    const lum = (T[0] + T[1] + T[2]) / 3;
    if (lum > prev + 1e-12) mono = false;
    prev = lum;
  }
  ok('transmittance is monotone non-increasing in distance (no band edges)', mono);

  const T0 = interp.call('atmoTrans', [F(0), F(0)]).v;
  ok('T(0) == 1 exactly (nothing at the eye is hazed)', T0[0] === 1 && T0[1] === 1 && T0[2] === 1);

  const Tfar = interp.call('atmoTrans', [F(120000), F(0)]).v;
  ok('extinction -> 1 by the rim band end (120 km): T < 0.02',
    Math.max(...Tfar) < 0.02, `T=[${Tfar.map((x) => x.toFixed(4)).join(', ')}]`);

  const Tv = interp.call('atmoTrans', [F(9000), F(0)]).v;
  const Tr = interp.call('atmoTrans', [F(9000), F(1200)]).v;
  ok('a ridge hazes LESS than the valley at the same range (height term alive)',
    Tr[1] > Tv[1], `valley T ${Tv[1].toFixed(4)} vs ridge T ${Tr[1].toFixed(4)}`);

  ok('blue extinguishes fastest (Rayleigh-ish tilt)', Tv[2] < Tv[1] && Tv[1] < Tv[0],
    `T=[${Tv.map((x) => x.toFixed(4)).join(', ')}]`);

  const Isun = interp.call('atmoInscatter', [F(1)]).v;
  const Iaway = interp.call('atmoInscatter', [F(-1)]).v;
  ok('the Mie lobe warms the inscatter toward the sun and not away from it',
    Isun[0] > Iaway[0] && Math.abs(Iaway[0] - srgbToLinear(RIM[0])) < 1e-3,
    `toward r ${Isun[0].toFixed(4)} vs away r ${Iaway[0].toFixed(4)} (rim ${srgbToLinear(RIM[0]).toFixed(4)})`);

  // Continuity at the OLD handoff: no derivative discontinuity anywhere.
  let worstJump = 0;
  for (let d = 500; d <= 60000; d += 250) {
    const a = interp.call('atmoTrans', [F(d - 250), F(0)]).v[1];
    const b = interp.call('atmoTrans', [F(d), F(0)]).v[1];
    const c = interp.call('atmoTrans', [F(d + 250), F(0)]).v[1];
    worstJump = Math.max(worstJump, Math.abs(a - 2 * b + c));
  }
  ok('second difference stays tiny across 0.5-60 km (one continuous law)',
    worstJump < 5e-4, `worst |d2T| ${worstJump.toExponential(2)}`);

  // The eye-height integral: looking DOWN from cruise must still haze.
  const save = u.uAtmoEyeH.value;
  u.uAtmoEyeH.value = 9000;
  const Tcruise = interp.call('atmoTrans', [F(30000), F(0)]).v[1];
  u.uAtmoEyeH.value = save;
  ok('from cruise (eye 9 km) a ground fragment 30 km out is still attenuated',
    Tcruise < 0.85, `T ${Tcruise.toFixed(4)}`);
}

// --------------------------------------------------------------------------
// [5] THE RED — the pre-R24 two-fog stack, printed as a table.
// --------------------------------------------------------------------------
console.log('\n[5] RED (pre-R24 stack, satellite/high, eye 1 km AGL, ground fragment)');
const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const postMix = (d, h) => 0.55 * smoothstep(800, 14000, d) * Math.exp(-h / 1200);
const tileMix = (d) => 0.5 * smoothstep(16000, 55000, d);
const total = (d, h) => 1 - (1 - tileMix(d)) * (1 - postMix(d, h));
const rows = [];
for (const d of [800, 4000, 8000, 12000, 13500, 14000, 15000, 16000, 17000, 20000, 30000, 45000, 55000, 60000]) {
  rows.push({ d, post: postMix(d, 0), tile: tileMix(d), total: total(d, 0) });
}
console.log('     d(m)     post    tile   TOTAL   d(TOTAL)/d(km)');
let flat = 0;
for (let i = 0; i < rows.length; i++) {
  const r = rows[i];
  const slope = i ? (r.total - rows[i - 1].total) / ((r.d - rows[i - 1].d) / 1000) : NaN;
  if (r.d >= 14000 && r.d <= 16000 && i && Math.abs(slope) < 1e-6) flat++;
  console.log(
    `  ${String(r.d).padStart(7)}  ${r.post.toFixed(4)}  ${r.tile.toFixed(4)}  ${r.total.toFixed(4)}  ` +
    (Number.isNaN(slope) ? '     —' : slope.toFixed(6))
  );
}
ok('RED: total haze is EXACTLY flat across the 14-16 km handoff', flat >= 2,
  `${flat} zero-slope samples in [14 km, 16 km]`);
{
  // The height term vanishes past 14 km in the OLD stack only through the post
  // pass; the tile band has none at all, so two fragments 1.2 km apart in
  // height at 30 km haze identically in the SCENE pass.
  const tileValley = tileMix(30000), tileRidge = tileMix(30000);
  ok('RED: the 16-55 km tile band has NO height term (valley == ridge at 30 km)',
    tileValley === tileRidge, `both ${tileValley.toFixed(4)}`);
  // The two evaluators measure different rays.
  const eyeAgl = 9000, dxz = 16000;
  const d3 = Math.hypot(dxz, eyeAgl);
  ok('RED: post (3-D from camera) and tile (XZ from bend centre) disagree by >10% at cruise',
    (d3 - dxz) / dxz > 0.1, `3-D ${d3.toFixed(0)} m vs XZ ${dxz} m (+${(((d3 - dxz) / dxz) * 100).toFixed(1)}%)`);
  // Medium/low: nothing at all inside 16 km.
  ok('RED: on medium/low the whole near+mid field (0-16 km) is unattenuated',
    tileMix(15999) === 0, 'tile band starts at 16 km; the post pass is high-tier only');
}

// --------------------------------------------------------------------------
// [6] A8 — the night ramp, as a pure function.
// --------------------------------------------------------------------------
console.log('\n[6] A8 night ramp (windows dayFrac/gamma), pure function');
const nightMul = (frac, dayFrac = 0.3, gamma = 1.5) => {
  const t = Math.min(1, Math.max(0, 1 - (frac ?? 1) / dayFrac));
  return 1 - t ** gamma;
};
ok('noon (frac 1) multiplier is EXACTLY 1 (0.55 stays bit-for-bit)', nightMul(1) === 1);
ok('frac >= dayFrac multiplier is EXACTLY 1', nightMul(0.3) === 1 && nightMul(0.5) === 1);
ok('deep night (frac 0) multiplier is EXACTLY 0', nightMul(0) === 0);
{
  let mono = true, prev = -1;
  for (let f = 0; f <= 1.0001; f += 0.01) { const m = nightMul(f); if (m < prev - 1e-12) mono = false; prev = m; }
  ok('ramp is monotone in sun.frac (no flap at the dusk crossing)', mono);
  console.log(`     frac 0.00 -> ${nightMul(0).toFixed(3)}   0.10 -> ${nightMul(0.1).toFixed(3)}   ` +
    `0.20 -> ${nightMul(0.2).toFixed(3)}   0.30 -> ${nightMul(0.3).toFixed(3)}   1.00 -> ${nightMul(1).toFixed(3)}`);
}

// --------------------------------------------------------------------------
// [7] FLAG-OFF STRUCTURAL IDENTITY — the generated text, not a token check.
//
// AERIAL_LAW injects into the FINAL TILE program, which is the one program
// BOTH styles compile, so "flag-off is byte-identical" has to be proven on the
// text three actually receives, not asserted. `AERIAL_LAW.enabled` is a
// property of a live object, so the gate flips it and compiles the patch twice
// against a stub shader — the same instrument verify-lod-fade uses.
// --------------------------------------------------------------------------
console.log('\n[7] AERIAL_LAW flag-off is byte-identical (generated text + key)');
{
  const { register } = await import('node:module');
  register('./_alias-loader.mjs', import.meta.url);
  const wb = await import('../lib/fly/toy-world/world-bend.js');
  const { AERIAL_LAW } = await import('../lib/fly/fly-constants.js');
  const STUB_V = ['#include <common>', '#include <defaultnormal_vertex>', '#include <project_vertex>'].join('\n');
  const STUB_F = ['#include <common>', '#include <clipping_planes_fragment>', '#include <map_fragment>',
    '#include <color_fragment>', '#include <fog_fragment>', '#include <dithering_fragment>'].join('\n');
  const HILL = { ambient: 0.35, lift: 0.15, micro: { scaleM: 40, amp: 0.06 }, quiltAnchor: 0.42 };
  const compile = () => {
    const m = { userData: {}, needsUpdate: false };
    wb.applyBendFade(m);
    wb.applyHillshade(m, HILL, null);
    const shader = { uniforms: {}, vertexShader: STUB_V, fragmentShader: STUB_F };
    m.onBeforeCompile(shader, null);
    return { shader, key: m.customProgramCacheKey() };
  };
  const was = AERIAL_LAW.enabled;
  AERIAL_LAW.enabled = false;
  const off = compile();
  AERIAL_LAW.enabled = true;
  const on = compile();
  AERIAL_LAW.enabled = was;

  ok('flag-off VERTEX text carries no uAtmo/atmoPack token',
    !/uAtmo|atmoPack|vAtmoDHC/.test(off.shader.vertexShader));
  ok('flag-off FRAGMENT text carries no uAtmo/atmoApply token',
    !/uAtmo|atmoApply|vAtmoDHC/.test(off.shader.fragmentShader));
  ok('flag-off leaves <dithering_fragment> untouched',
    off.shader.fragmentShader.includes('#include <dithering_fragment>') &&
    !off.shader.fragmentShader.includes('atmoApply'));
  ok('flag-off wires no uAtmo* uniform',
    !Object.keys(off.shader.uniforms).some((k) => k.startsWith('uAtmo')),
    Object.keys(off.shader.uniforms).filter((k) => k.startsWith('uAtmo')).join(',') || '(none)');
  ok("flag-off FINAL tile key carries no 'a' token", !/-[a-z]*a[a-z]*24$/.test(off.key), off.key);
  ok("flag-on FINAL tile key carries the 'a' token through the shared helper",
    on.key === 'world-bend-fade-hill-r19-a24', on.key);
  ok('flag-on wires the WHOLE shared law block by reference (one source of numbers)',
    Object.keys(on.shader.uniforms).filter((k) => k.startsWith('uAtmo')).length === 10 &&
    on.shader.uniforms.uAtmoBeta === atmoUniforms.uAtmoBeta,
    `${Object.keys(on.shader.uniforms).filter((k) => k.startsWith('uAtmo')).length} uAtmo uniforms, by reference`);
  ok('flag-on applies the law in the LAST fragment slot, before the dither',
    /if \( uAtmoStrength > 0\.0 \)[\s\S]{0,120}atmoApply\( gl_FragColor\.rgb, vAtmoDHC \);[\s\S]{0,20}#include <dithering_fragment>/.test(on.shader.fragmentShader));
  ok('flag-on does NOT touch the after-fog lines the base patch and C own',
    on.shader.fragmentShader.includes("gl_FragColor.rgb = mix( gl_FragColor.rgb, uHazeColor,") ===
    off.shader.fragmentShader.includes("gl_FragColor.rgb = mix( gl_FragColor.rgb, uHazeColor,"));
  {
    // The strong form: strip ONLY the law's additions and the two texts must
    // coincide character for character.
    const vStripped = on.shader.vertexShader
      .replace(ATMO_GLSL_DECL + ATMO_GLSL_VERTEX + 'varying vec3 vAtmoDHC;\n', '')
      .replace(/vec3 wA = [\s\S]*?vAtmoDHC = atmoPack\([^\n]*\n/, '');
    ok('flag-on VERTEX minus the law === flag-off VERTEX',
      vStripped === off.shader.vertexShader,
      vStripped === off.shader.vertexShader ? '' : 'texts diverge beyond the law');
    const fStripped = on.shader.fragmentShader
      .replace('varying vec3 vAtmoDHC;' + ATMO_GLSL_DECL + ATMO_GLSL_FRAGMENT, '')
      .replace(/if \( uAtmoStrength > 0\.0 \) \{\n\tgl_FragColor\.rgb = atmoApply\( gl_FragColor\.rgb, vAtmoDHC \);\n\}\n\t/, '');
    ok('flag-on FRAGMENT minus the law === flag-off FRAGMENT',
      fStripped === off.shader.fragmentShader,
      fStripped === off.shader.fragmentShader ? '' : 'texts diverge beyond the law');
  }
}

// --------------------------------------------------------------------------
console.log('\n[8] the post pass ships ONE program per flag state');
{
  const src = fs.readFileSync(new URL('../components/fly/AerialPerspective.jsx', import.meta.url), 'utf8');
  ok('the LAW shader calls atmoApply', /lawFragmentShader[\s\S]*atmoApply\( inputColor\.rgb/.test(src));
  ok('the LEGACY shader is still the R19 text (uMaxMix * t * hFall)',
    src.includes('mix( inputColor.rgb, uHazeColor, uMaxMix * t * hFall )'));
  ok('the variant is resolved ONCE at construction, from a module const',
    /const law = LAW\(\);\n\s*super\('AerialPerspectiveEffect', law \? lawFragmentShader : fragmentShader/.test(src),
    'production and the PREWARM twin cannot compile different programs');
  ok('both early-outs survive in the LAW shader (bit-identity at strength 0, sky skipped)',
    /uAtmoStrength <= 0\.0 \|\| d >= 0\.999999/.test(src));
  ok('the LAW shader still DETECTS reversed depth rather than assuming it',
    /lawFragmentShader[\s\S]*uReverseDepth > 0\.5 \? 1\.0 - depth : depth/.test(src));
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'}  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
