/**
 * R24 B WORLD — ENV_UNIFORM's prewarm contract, as a SOURCE gate.
 *
 * WHY A SOURCE GATE. `lib/fly/prewarm.js` statically imports
 * `@/components/fly/Effects` (JSX), so it cannot be loaded into bare node at
 * all, and the behaviour under test — "does this compile land inside the boot
 * gate, and does it touch the live scene?" — is a property of WHERE the calls
 * are, not of what a GPU returns. The repo precedent is verify-warbirds, which
 * source-parses four files to prove a cross-file invariant.
 *
 * THE DEFECT THIS GATE EXISTS FOR (found in adversarial review of r24/b at
 * 06b8f1d, confirmed by two independent verifiers). The alternate shadow-state
 * warm was written the obvious way — flip the LIVE directional's `castShadow`,
 * `await` a full compile, flip it back — which is wrong twice over:
 *   (a) it sat BEFORE `_state.done = true`, and BootScreen.jsx:146 gates the
 *       reveal on `done || now - t0 >= PREWARM.maxMs`, so it could extend the
 *       reveal up to the 3000 ms cap. "Reveal timing may not lengthen" is
 *       frozen.
 *   (b) `frameloop="always"` keeps RENDERING across that await, so production
 *       frames in the window re-key every lit material on `shadowMapEnabled`
 *       and render a shadow pass at tiers that have none — and with a slow
 *       HDRI (envWaitMs 4000 > maxMs 3000) the window can land after the
 *       reveal, where it is visible.
 *
 * RED CALIBRATION: run with `--red` to parse the defective revision instead
 * (`git show 06b8f1d:lib/fly/prewarm.js`). Gates (1) and (2) must FAIL there
 * and PASS on the working tree — a gate that cannot fail is not a gate.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RED = process.argv.includes('--red');
const src = RED
  ? execSync('git show 06b8f1d:lib/fly/prewarm.js', { cwd: ROOT, encoding: 'utf8' })
  : fs.readFileSync(path.join(ROOT, 'lib/fly/prewarm.js'), 'utf8');
// The R21 BASE revision (the W0 scaffolding commit) is the calibration source
// for gates (1) and (2): the invariant is not "some fixed number", it is
// "B ADDED NOTHING HERE", which only a diff against the base can state.
const BASE_SHA = '6116fc5';
const base = execSync(`git show ${BASE_SHA}:lib/fly/prewarm.js`, { cwd: ROOT, encoding: 'utf8' });

let fails = 0;
const gate = (n, ok, d = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ' — ' + d : ''}`);
  if (!ok) fails++;
};
console.log(`source: ${RED ? '06b8f1d (the DEFECTIVE revision)' : 'working tree'}\n`);

/**
 * Body of a named function, by brace matching. The PARAMETER LIST is skipped
 * first: every one of these functions destructures its argument, so the first
 * `{` after the name belongs to the parameters, not the body — matching on it
 * silently returns a two-line "body" and every containment test inside it
 * becomes a false negative. (That bug is why this helper is commented.)
 */
function bodyOf(needle, text = src) {
  const at = text.indexOf(needle);
  if (at < 0) return null;
  // 1. walk the parameter list to its closing paren
  let k = text.indexOf('(', at);
  if (k < 0) return null;
  let par = 0;
  for (; k < text.length; k++) {
    if (text[k] === '(') par++;
    else if (text[k] === ')') {
      par--;
      if (par === 0) break;
    }
  }
  // 2. the body opens at the next brace
  let i = text.indexOf('{', k);
  if (i < 0) return null;
  let depth = 0;
  for (let j = i; j < text.length; j++) {
    if (text[j] === '{') depth++;
    else if (text[j] === '}') {
      depth--;
      if (depth === 0) return { start: at, end: j, text: text.slice(at, j + 1) };
    }
  }
  return null;
}

const run = bodyOf('export async function runPrewarm');
gate('(0) runPrewarm parsed', !!run);

// --- (1) NOTHING NEW COMPILES INSIDE THE BOOT GATE -------------------------
// The reveal waits on `_state.done`. R21 ships exactly two compile sites
// before it (the material warm and the post-chain warm); anything B adds must
// be AFTER it. The alternate shadow warm is identified by its own call.
const countCompilesBeforeDone = (body) => {
  if (!body) return -1;
  const doneAt = body.text.indexOf('_state.done = true');
  if (doneAt < 0) return -1;
  return [...body.text.matchAll(/compileAsync\(/g)].filter((m) => m.index < doneAt).length;
};
if (run) {
  const doneAt = run.text.indexOf('_state.done = true');
  const before = countCompilesBeforeDone(run);
  const baseBefore = countCompilesBeforeDone(bodyOf('export async function runPrewarm', base));
  gate(
    '(1) BOOT GATE — B adds NO compile before `_state.done` (vs the R21 base)',
    doneAt > 0 && before === baseBefore,
    `${before} compileAsync call sites before \`_state.done = true\`; R21 base @${BASE_SHA} has ${baseBefore}`
  );
  const queueAt = run.text.indexOf('queueAltShadowWarm(');
  gate(
    '(1b) the alternate shadow warm is QUEUED strictly after `_state.done`',
    queueAt > doneAt,
    queueAt < 0 ? 'not queued at all' : `queue at +${queueAt - doneAt} chars after done`
  );
}

// --- (2) THE LIVE SCENE IS NEVER MUTATED -----------------------------------
// Every `castShadow` ASSIGNMENT in this file must be on a clone inside
// queueAltShadowWarm. A write to a light three is rendering is the (b) defect.
const RX = /(\w+(?:\.\w+)*)\.castShadow\s*=(?!=)/g;
const assigns = [...src.matchAll(RX)];
const q = bodyOf('function queueAltShadowWarm');
// Outside the clone builder, the set of receivers must be EXACTLY what R21
// already had — R21 writes `o.castShadow` on a WARM-SCENE mesh it just built,
// which is fine; what must never appear is a write to anything reachable from
// the live scene while the renderer is running.
const outside = assigns
  .filter((m) => !q || m.index < q.start || m.index > q.end)
  .map((m) => m[1])
  .sort();
const baseOutside = [...base.matchAll(RX)].map((m) => m[1]).sort();
const insideNonClone = q
  ? assigns.filter((m) => m.index >= q.start && m.index <= q.end && m[1] !== 'c')
  : [];
gate(
  '(2) NO LIVE-SCENE MUTATION — outside the clone builder, castShadow writes are R21\'s exactly',
  JSON.stringify(outside) === JSON.stringify(baseOutside) && insideNonClone.length === 0,
  `outside [${outside.join(', ')}] vs R21 base [${baseOutside.join(', ')}]` +
    `; ${insideNonClone.length} non-clone write(s) inside queueAltShadowWarm`
);

// --- (3) THE STAND-IN CARRIES WHAT THE PROGRAM KEY READS -------------------
// `environment` (envMapCubeUVHeight) and `fog` are both folded into the key;
// a stand-in missing either mints a THIRD program instead of the shadow twin.
gate(
  '(3) the stand-in target carries the live environment AND fog',
  /target\.environment\s*=\s*scene\.environment/.test(src) &&
    /target\.fog\s*=\s*scene\.fog/.test(src),
  'both are in three\'s program cache key'
);

// --- (4) THE IDLE POLICY ---------------------------------------------------
const pump = bodyOf('export function pumpRequeue');
gate(
  '(4) the drain skips any frame slower than ENV_UNIFORM.idleFrameMs',
  !!pump && /lastFrameMs\s*>\s*ENV_UNIFORM\.idleFrameMs\)\s*return 0/.test(pump.text),
  'never piles onto a frame that is already long'
);
gate(
  '(4b) the drain is budgeted per frame, not drained in bulk',
  !!pump && /n\s*<\s*ENV_UNIFORM\.idleBudget/.test(pump.text)
);

// --- (5) FLAG-OFF IS A NO-OP ----------------------------------------------
gate(
  '(5) both producers early-return when ENV_UNIFORM is off',
  !!q &&
    /!ENV_UNIFORM\.enabled/.test(q.text) &&
    /!ENV_UNIFORM\.enabled/.test(bodyOf('export function requeueForEnvironment')?.text ?? ''),
  'flag-off nothing is ever queued, so the drain is one boolean test'
);

// --- (6) shadowStates only claims 2 once the pass actually LANDED ----------
gate(
  '(6) shadowStates flips to 2 only when the queued pass completes',
  /alt-shadow'\)\s*_state\.shadowStates = 2/.test(src),
  'telemetry must not claim a warm that is still queued'
);

console.log(`\nVERIFY: ${fails ? 'FAIL' : 'PASS'}`);
process.exit(fails ? 1 : 0);
