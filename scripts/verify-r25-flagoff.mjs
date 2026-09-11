#!/usr/bin/env node
/**
 * R25 (E CERT) — verify-r25-flagoff. A NODE gate: no browser, no dev server,
 * no tiles, no GPU. It proves the ONE property every R25 feature is required
 * to have and that no pixel gate can prove cheaply — that with all six blocks
 * off, this tree is the Codex overhaul tip (`f0cd81e`) in every respect a
 * shader compiler, a program cache or a scene graph can observe.
 *
 * It is the `verify-c-flagoff.mjs` idiom (R24 C), re-aimed at R25's six
 * owners. A pixel A/B can only show that two frames matched at the poses
 * someone thought to sample; a STRUCTURAL proof shows the alternate branch is
 * unreachable. Five checks:
 *
 *   (1) `r25On()` returns false for all six blocks with no window pin set —
 *       EXECUTED, not parsed: the accessor is imported and called, so a typo
 *       in the block table or a stray default is caught here and not in a
 *       browser three hours later.
 *   (1b) ...and the pin mechanism ACTUALLY ARMS. A gate that only ever proves
 *       "false" would be equally green against an accessor hard-wired to
 *       return false, which would make every armed leg in this round
 *       unrunnable. So each block is armed through its documented
 *       `window.__fly<Name>Override` pin and must read true.
 *   (2) no `customProgramCacheKey` anywhere in lib/ or components/ can emit an
 *       R25 token. The token list is the world-bend registry's own R25
 *       inventory stub, so this gate and the registry cannot drift apart.
 *   (3) `hillKey` — the FINAL TILE key, which is where FIVE owners across two
 *       rounds meet — carries exactly R24's four tokens 'e' 'f' 'a' 'l' while
 *       R25's owner predicates are false, and the all-false key is the bare
 *       R19 string. EXECUTED against the real module.
 *   (4) FlyCanvas mounts no R25 rig with the flags off: every R25 rig element
 *       in the JSX is guarded by an `r25On(...) && <Rig …>` conjunction.
 *   (5) every R25 GLSL injection sits behind a predicate that reads `r25On`.
 *
 * ON THIS TREE (E's, before any owner merges) checks (2), (4) and (5) are
 * VACUOUS — there are no R25 keys, no R25 rigs and no R25 GLSL yet — and the
 * gate SAYS SO on every such row rather than printing a green that means
 * "nothing to check". They become load-bearing the moment an owner merges,
 * which is precisely when they are needed. A vacuous row is reported as
 * `ok (vacuous)` and counted separately in the verdict line.
 *
 * Run: node scripts/verify-r25-flagoff.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { register } from 'node:module';
import { fileURLToPath } from 'node:url';

register('./_alias-loader.mjs', import.meta.url);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
/**
 * COMMENTS ARE NOT CODE, and on this tree that distinction is the whole gate.
 * The world-bend registry header RESERVES every R25 key by name, and
 * FlyCanvas / GroundBubbleRig name their block in prose — so a naive substring
 * sweep indicts the scaffolding's own documentation and reports three reds that
 * are the gate reading its own reference material. Block comments and
 * whole-line `//` / ` *` lines are removed; an in-line `//` is NOT, because
 * cutting at one would also cut a `https://…` out of a string literal and
 * could hide a real token.
 */
// R25 W2 (Fable, merge 3/6 arbitration): the first version dropped only
// lines that BEGIN with a comment, so a trailing `code // see MOBILE_FAN_R25`
// was scanned as code and (4b) read D's TouchFan.jsx as a raw constant read —
// the R20 §7 lesson ("grep-gates read comments too") in its own gate. Trailing
// line comments now go as well, except a `//` preceded by `:` or a quote
// (URLs and string literals), which is not a comment.
const stripComments = (t) =>
  t
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*)/.test(l))
    .map((l) => l.replace(/(^|[^:'"`\\])\/\/.*$/, '$1'))
    .join('\n');
const readCode = (p) => stripComments(read(p));

const fails = [];
let n = 0;
let vacuous = 0;
const gate = (name, ok, detail = '') => {
  n++;
  if (!ok) fails.push(name);
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
/** A row that is structurally green only because the thing it guards does not exist yet. */
const gateVacuous = (name, ok, why) => {
  n++;
  vacuous++;
  if (!ok) fails.push(name);
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}  — VACUOUS ON THIS TREE: ${why}`);
};

console.log('\nR25 E CERT — verify-r25-flagoff (node; no browser, no GPU)\n');

// ---------------------------------------------------------------------------
// The six blocks, and the R25 tokens no flag-off key may contain. Both lists
// are the plan's, and (2b) below re-derives the token list from the world-bend
// registry header so the two cannot drift.
const BLOCKS = ['GroundBubble', 'GroundDetail', 'NightGround', 'LightBubble', 'MobileFan', 'Feel'];
const R25_KEY_TOKENS = [
  'night-ground',            // covers 'night-ground-splat-v1', '-blur-v1', '|night-ground-v1'
  'immersive-surface-v2',    // B NIGHT's architecture-material bump
  'clutter-night-ground',    // B NIGHT's SatClutterLayer onBeforeCompile
  'anchor-scrub-r25',        // A GROUND's conditional sway key
];
const R24_HILL_TOKENS = ['e', 'f', 'a', 'l'];

// ---------------------------------------------------------------------------
console.log('[1] the accessor, EXECUTED');
const pins = await import('../lib/fly/r25-pins.js');
const off = BLOCKS.map((b) => [b, pins.r25On(b)]);
gate(
  '(1) r25On() is false for all six R25 blocks with no window pin set',
  off.every(([, v]) => v === false),
  off.map(([b, v]) => `${b}=${v}`).join(' ')
);
// Sub-switches must be false too: `r25On(name, sub)` short-circuits on the
// block's own `enabled`, so a sub-switch pre-seeded true is harmless — but
// only while that short-circuit holds, and this asserts it does.
const subs = [
  ['GroundDetail', 'overlay'], ['GroundDetail', 'scrub'], ['GroundDetail', 'hedges'],
  ['GroundDetail', 'tint'], ['GroundDetail', 'z19'],
  ['NightGround', 'roadResweep'], ['NightGround', 'windows'], ['NightGround', 'halo'],
  ['LightBubble', 'shadow'], ['LightBubble', 'ao'], ['LightBubble', 'moon'],
  ['LightBubble', 'hemi'], ['LightBubble', 'grade'],
  ['Feel', 'groundRush'], ['Feel', 'dof'], ['Feel', 'chase'], ['Feel', 'audio'],
  ['Feel', 'proximity'],
];
const liveSubs = subs.filter(([b, s]) => pins.r25On(b, s));
gate(
  '(1a) every PRE-SEEDED sub-switch is unreachable while its block is off',
  liveSubs.length === 0,
  liveSubs.length ? liveSubs.map(([b, s]) => `${b}.${s}`).join(' ') : `${subs.length} sub-switches checked`
);

// (1b) THE ARM. Without this the file would be equally green against an
// accessor that can never return true — which would silently disarm every
// armed leg in the round. `globalThis.window` is stood up here exactly the way
// a harness sets the pin before Fly mode mounts.
const hadWindow = typeof globalThis.window !== 'undefined';
if (!hadWindow) globalThis.window = {};
const armed = [];
for (const b of BLOCKS) {
  globalThis.window[`__fly${b}Override`] = { enabled: true };
  armed.push([b, pins.r25On(b)]);
  delete globalThis.window[`__fly${b}Override`];
}
if (!hadWindow) delete globalThis.window;
gate(
  '(1b) each block ARMS through its documented window.__fly<Name>Override pin',
  armed.every(([, v]) => v === true),
  armed.map(([b, v]) => `${b}=${v}`).join(' ')
);
gate(
  '(1c) ...and is false again once the pin is removed (no latching)',
  BLOCKS.every((b) => pins.r25On(b) === false),
  'all six back to false'
);

// ---------------------------------------------------------------------------
console.log('\n[2] no R25 token can reach a program cache key');
/** Every .js/.jsx under lib/ and components/, minus the vendored bundle. */
function walk(dir, out = []) {
  for (const e of readdirSync(path.join(ROOT, dir))) {
    const rel = `${dir}/${e}`;
    if (rel.includes('/vendor/')) continue;
    const st = statSync(path.join(ROOT, rel));
    if (st.isDirectory()) walk(rel, out);
    else if (/\.(js|jsx|mjs)$/.test(e) && !/\.built\.js$/.test(e)) out.push(rel);
  }
  return out;
}
const SRC = [...walk('lib'), ...walk('components')];
// Every `customProgramCacheKey` assignment, with the expression that follows
// it up to the end of the statement — that is what the compiler will see.
const keyExprs = [];
for (const f of SRC) {
  const t = readCode(f);
  const re = /customProgramCacheKey\s*=\s*([\s\S]{0,400}?);\n/g;
  let m;
  while ((m = re.exec(t))) keyExprs.push({ file: f, expr: m[1] });
}
gate(
  '(2a) the sweep found the key expressions it is supposed to judge',
  keyExprs.length >= 8,
  `${keyExprs.length} customProgramCacheKey assignments across ${SRC.length} files`
);
const offenders = keyExprs.filter((k) => R25_KEY_TOKENS.some((tok) => k.expr.includes(tok)));
const anyR25KeyText = SRC.some((f) => R25_KEY_TOKENS.some((tok) => readCode(f).includes(tok)));
const row2b = () =>
  anyR25KeyText
    ? gate(
        '(2b) no customProgramCacheKey expression contains an R25 token with the flags off',
        offenders.length === 0,
        offenders.length ? offenders.map((o) => `${o.file}: ${o.expr.slice(0, 60)}`).join(' | ') : 'clean'
      )
    : gateVacuous(
        '(2b) no customProgramCacheKey expression contains an R25 token with the flags off',
        offenders.length === 0,
        `none of [${R25_KEY_TOKENS.join(', ')}] appears anywhere in lib/ or components/ yet`
      );
row2b();
// The token list and the registry's R25 inventory stub must be the same list.
// A key added to the tree and to the registry but not here would pass (2b) by
// not being looked for, which is the failure mode this closes.
const wb = read('lib/fly/toy-world/world-bend.js');
const registryHeader = wb.slice(0, wb.indexOf('*/'));
const missingFromRegistry = R25_KEY_TOKENS.filter((t) => !registryHeader.includes(t));
gate(
  "(2c) every token this gate looks for is RESERVED in the world-bend registry header",
  missingFromRegistry.length === 0,
  missingFromRegistry.length ? `not reserved: ${missingFromRegistry.join(', ')}` : R25_KEY_TOKENS.join(', ')
);

// ---------------------------------------------------------------------------
console.log('\n[3] the FINAL TILE key — where five owners meet');
const { applyHillshade, r24VariantKey } = await import('../lib/fly/toy-world/world-bend.js');
const CONSTS = await import('../lib/fly/fly-constants.js');
const hillTokenNames = [...wb.matchAll(/\[\s*[^,\]]+,\s*'([a-z])'\s*\],?\s*\/\/\s*[A-F]\b/g)].map((m) => m[1]);
// Read hillKey's own token list out of the source, in order.
const hillBody = wb.slice(wb.indexOf('function hillKey('), wb.indexOf('function hillKey(') + 700);
const tokensInHillKey = [...hillBody.matchAll(/,\s*'([a-z])'\]/g)].map((m) => m[1]);
gate(
  `(3a) hillKey carries exactly R24's four tokens while every R25 predicate is false`,
  tokensInHillKey.join('') === R24_HILL_TOKENS.join(''),
  `[${tokensInHillKey.join(' ')}] (R25 adds 'd' then 'n', in that order, when A and B merge)`
);
gate(
  '(3b) the all-false key is the bare R19 string (the revert contract, executed)',
  r24VariantKey('world-bend-fade-hill-r19', [[false, 'e'], [false, 'f'], [false, 'a'], [false, 'l'], [false, 'd'], [false, 'n']]) ===
    'world-bend-fade-hill-r19',
  'world-bend-fade-hill-r19'
);
// And the live key, compiled through the REAL patch against a stub material,
// must contain no R25 token. This is the one row that reads what the compiler
// would actually be handed.
const stub = {
  userData: {},
  defines: {},
  onBeforeCompile: null,
  needsUpdate: false,
  customProgramCacheKey: null,
};
let liveKey = null;
try {
  applyHillshade(stub, {});
  liveKey = typeof stub.customProgramCacheKey === 'function' ? stub.customProgramCacheKey() : null;
} catch (e) {
  liveKey = `THREW: ${e.message}`;
}
gate(
  '(3c) the LIVE hill key compiled off the real module carries no R25 token',
  typeof liveKey === 'string' && !/[dn](?=[a-z]*24$)/.test(liveKey.replace('world-bend-fade-hill-r19', '')),
  `${liveKey} (ONE_SUN=${CONSTS.ONE_SUN?.enabled} TERRAIN_LIGHT=${CONSTS.TERRAIN_LIGHT?.enabled} AERIAL_LAW=${CONSTS.AERIAL_LAW?.enabled})`
);

// ---------------------------------------------------------------------------
console.log('\n[4] no R25 rig mounts with the flags off');
const canvas = read('components/fly/FlyCanvas.jsx');
// Every R25 rig the plan names, and the guard it must carry. A rig that is not
// in the tree yet is reported as its owner's row, absent — never as a pass.
const RIGS = [
  ['GroundBubbleRig', 'GroundBubble', 'Fable W0 (shared substrate)'],
  ['NightGroundRig', 'NightGround', 'B NIGHT'],
  ['LightBubbleRig', 'LightBubble', 'C LIGHT'],
];
for (const [rig, block, owner] of RIGS) {
  const mounted = canvas.includes(`<${rig}`);
  if (!mounted) {
    gateVacuous(`(4) ${rig} is guarded by r25On('${block}')`, true, `${rig} is not mounted yet (${owner})`);
    continue;
  }
  // The guard must be a conjunction in the SAME JSX expression, i.e. the
  // element cannot be reached at all with the flag off. `{COND && <Rig/>}`.
  const guarded = new RegExp(`r25On\\(\\s*'${block}'[^)]*\\)\\s*&&\\s*<${rig}`).test(canvas);
  gate(`(4) ${rig} is guarded by r25On('${block}') in the same JSX expression (${owner})`, guarded);
}
// ...and nothing else may reach for an R25 block outside the accessor.
const rawConstReads = SRC.filter((f) =>
  /\b(GROUND_DETAIL_R25|NIGHT_GROUND_R25|LIGHT_BUBBLE_R25|MOBILE_FAN_R25|FEEL_R25|GROUND_BUBBLE)\b/.test(readCode(f)) &&
  !f.endsWith('fly-constants.js') && !f.endsWith('r25-pins.js')
);
gate(
  '(4b) every R25 block is read through r25-pins.js, never off the constant',
  rawConstReads.length === 0,
  rawConstReads.length
    ? `${rawConstReads.join(', ')} — a direct constant read cannot be armed by a pin, so the user's A/B is dead`
    : 'no direct constant reads'
);

// ---------------------------------------------------------------------------
console.log('\n[5] every R25 GLSL injection is predicate-gated');
// The owner files that may inject shader text this round, with the predicate
// each must read. Absent files are reported as absent.
const GLSL_SITES = [
  ['lib/fly/toy-world/world-bend.js', /r25On\(\s*'GroundDetail'/, "A GROUND's 'd' block"],
  ['lib/fly/toy-world/world-bend.js', /r25On\(\s*'NightGround'/, "B NIGHT's 'n' block"],
  ['lib/fly/satellite-architecture-material.js', /r25On\(\s*'NightGround'/, 'B NIGHT: |immersive-surface-v2'],
  ['lib/fly/cinematic-ground.js', /r25On\(\s*'NightGround'/, 'B NIGHT: |night-ground-v1 (canopy + homes)'],
  ['components/fly/SatClutterLayer.jsx', /r25On\(\s*'NightGround'/, "B NIGHT: 'clutter-night-ground-v1'"],
  ['components/fly/SkyDome.jsx', /r25On\(\s*'NightGround'/, "B NIGHT: the halo term"],
];
for (const [file, predicate, what] of GLSL_SITES) {
  let text = '';
  try {
    text = readCode(file);
  } catch {
    gate(`(5) ${what}: ${file} is present`, false, 'file missing');
    continue;
  }
  const hasR25Text = R25_KEY_TOKENS.some((t) => text.includes(t)) || /uNG[A-Z]|uGroundDetail/.test(text);
  if (!hasR25Text) {
    gateVacuous(`(5) ${what} reads r25On`, true, `${file} carries no R25 shader text yet`);
    continue;
  }
  gate(`(5) ${what} reads r25On before injecting`, predicate.test(text), file);
}

// ---------------------------------------------------------------------------
const solid = n - vacuous;
console.log(
  `\n${n - fails.length}/${n} passed` +
    (vacuous ? `  (${vacuous} VACUOUS on this tree, ${solid} load-bearing)` : '')
);
if (vacuous) {
  console.log(
    'A vacuous row asserts a property of code that does not exist yet. It is\n' +
      'not evidence — it is a hook that becomes evidence at the merge that\n' +
      'creates the code. Re-run this gate after EVERY W2 merge, and read the\n' +
      'vacuous count down to zero as the round closes.'
  );
}
if (fails.length) console.log(`FAILED: ${fails.join(' | ')}`);
process.exit(fails.length ? 1 : 0);
