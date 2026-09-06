/**
 * Round 24 (A PACE) — read A's SHIPPED flag state out of fly-constants.js.
 *
 * WHY A READER AND NOT AN IMPORT. `lib/fly/fly-constants.js` is ESM inside a
 * CommonJS package, so node cannot import it directly; and copying it to a
 * shim would test a copy, not the file that ships. This extracts the exact
 * object literal by brace matching and evaluates it, so what the gate asserts
 * is the literal a reviewer reads.
 *
 * WHY GATES ASSERT IT AT ALL. Every one of A's gates drives its feature by
 * setting the switch itself — which is right, because the property being
 * tested is "off = the R21 arithmetic, on = the fix", not "the flag happens to
 * be false today". But that makes every gate blind to the SHIP STATE: a flag
 * silently reverted to false would leave all of them green while the fix was
 * gone from the build. These two things are separate claims and both need a
 * gate, so each of A's gates now asserts BOTH: the behaviour under each state,
 * and that the state the app actually ships is the ruled one.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The literal exported as `export const <name> = { … };`, evaluated. */
export function readConst(name) {
  const txt = readFileSync(path.join(root, 'lib/fly/fly-constants.js'), 'utf8');
  const i = txt.indexOf(`export const ${name} =`);
  if (i < 0) throw new Error(`fly-constants.js has no export const ${name}`);
  const j = txt.indexOf('{', i);
  let depth = 0;
  let k = j;
  do {
    if (txt[k] === '{') depth++;
    else if (txt[k] === '}') depth--;
    k++;
  } while (depth > 0 && k < txt.length);
  return eval(`(${txt.slice(j, k)})`);
}

/**
 * The state A's close ruling put in the build. A gate compares against THIS,
 * so a silent revert of any one flag fails somewhere rather than nowhere.
 */
export const SHIP = {
  TERRA_PACE: {
    enabled: true,
    skirtFast: true,
    timerFix: true,
    mergeHysteresis: true,
    keepResident: true,
    walkWhileSaturated: true,
    bboxCache: true,
    // The DRAW half of keepResident: retention must not cost draw calls.
    // Pass 2b measured one fixed Owens pose at 152 -> 279 draws between a 45 s
    // and a 600 s sweep with identical flags. Ships ON with keepResident.
    parkOffscreen: true,
    // OFF, each with the run it waits for (see scripts/r24-a-pace.md §12):
    skirtWorker: false, // needs one real-hardware run (the LERC worker path is unreachable in the fixture)
    bendSphere: false, // needs one real-hardware run (it submits tiles that are culled today)
    parallelLoad: false, // not implemented this round
    imageBitmap: false, // not implemented this round
    preUpload: false, // not implemented this round
    lodOutsideRender: false, // not implemented this round
  },
  STEP_SAFE: { enabled: true },
  LADDER_FIX: { enabled: true },
  HUD_SYNC: { enabled: true },
  FINALIZE_PACE: { enabled: true },
  REBASE_CALM: { enabled: true },
  FRAME_STEP: { enabled: false }, // the consumer opt-in did not land (§8c)
};

/**
 * Assert one block against SHIP. Returns { ok, detail } so a gate can report
 * exactly which switch drifted rather than "the block is wrong".
 */
export function checkShip(name) {
  const want = SHIP[name];
  if (!want) throw new Error(`no ship state recorded for ${name}`);
  const got = readConst(name);
  const bad = [];
  for (const [k, v] of Object.entries(want)) {
    if (got[k] !== v) bad.push(`${k}: ships ${got[k]}, ruled ${v}`);
  }
  return {
    ok: bad.length === 0,
    detail: bad.length ? bad.join(' | ') : Object.keys(want).map((k) => `${k}=${got[k]}`).join(' '),
    got,
  };
}
