#!/usr/bin/env node
/**
 * verify-step-guard — Round 24 (A PACE), recon A3 / FL-05. THE SECOND WRITER.
 *
 *   node scripts/verify-step-guard.mjs [--report]
 *
 * THE DEFECT THIS PINS. STEP_SAFE's claim is that the -99 rig is the ONLY
 * writer that reaches the canvas, so a DPR step cannot reallocate the drawing
 * buffer between frames. Pass 2b measured that claim false with the rig ON:
 * 6 forced steps produced 12 DPR applications, 6 inside the frame and 6
 * OUTSIDE it, each outside one carrying the SAME value 46-117 ms later, and
 * 12 of 30 canvas.width/height writes outside a rAF.
 *
 * The second writer is r3f itself. `FlyCanvas` keeps the DPR in React state
 * and the rig's `setDpr` is that React setter, so the rig's call schedules a
 * render; r3f's `Canvas` layout effect then runs `await root.configure({dpr})`
 * — an AWAIT, so the store write lands a task later — and r3f's zustand
 * subscriber (@react-three/fiber 9.6.1) unconditionally re-applies
 * `gl.setPixelRatio` + `gl.setSize` outside any animation frame. It cannot be
 * pre-empted: `configure` is async and the subscriber lives in `createRoot`'s
 * closure.
 *
 * THE FIX, and what this gate asserts. `installResizeGuard` wraps the two
 * renderer methods so a request for the state the renderer is ALREADY in does
 * not reach the canvas — and ONLY that case. What must be provable in node is
 * the whole decision table, because the browser gate can only see the
 * consequence:
 *
 *   1. a redundant call writes nothing            (the fix)
 *   2. a REAL step still resizes                  (the fix cannot swallow work)
 *   3. a real container resize still resizes      (same, on the other axis)
 *   4. a skip still sets the viewport             (the one side effect three's
 *                                                  setSize has that a bare
 *                                                  `return` would drop)
 *   5. xr.isPresenting / a non-null `output` always delegate
 *   6. flag OFF installs nothing at all
 *   7. the uninstaller is owner-checked (StrictMode)
 *
 * The renderer here is a FAKE, and deliberately so: it reimplements three
 * r185's `setPixelRatio`/`setSize` verbatim from
 * node_modules/three/build/three.module.js (assign `_pixelRatio`, delegate to
 * setSize; write `canvas.width/height`, optional style, `output.setSize`,
 * `setViewport`) and COUNTS the canvas assignments. A guard that is correct
 * against that fake is correct against three, and gate 0 re-checks the fake
 * against three's real source text so this cannot rot silently.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPORT = process.argv.includes('--report');
const out = path.join(root, 'scripts/r24-out');
mkdirSync(out, { recursive: true });

// step-safe.js is ESM in a CommonJS package and imports the constants; copy it
// with that import inlined, reading the live global so each arm can force the
// flag state it is testing rather than observing whatever shipped.
const src = readFileSync(path.join(root, 'lib/fly/step-safe.js'), 'utf8');
const shim = path.join(out, `.sg-${process.pid}.mjs`);
writeFileSync(
  shim,
  src.replace(
    "import { STEP_SAFE } from './fly-constants';",
    // Getters, not a snapshot: `resolveStepSafe` memoises nothing, but a plain
    // `const STEP_SAFE = globalThis.__sgCfg` would freeze the arm's config at
    // import and the flag-OFF row would silently test the flag-ON build.
    'const STEP_SAFE = { get enabled() { return globalThis.__sgCfg.enabled; },' +
      ' get valveMs() { return globalThis.__sgCfg.valveMs; } };'
  )
);
globalThis.__sgCfg = { enabled: true, valveMs: 400 };
const ss = await import(pathToFileURL(shim).href);
rmSync(shim, { force: true });

let pass = 0;
let fail = 0;
const rows = [];
const gate = (name, ok, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

console.log('verify-step-guard — the rig is the ONLY writer that reaches the canvas (A3 / FL-05)\n');

/** three r185's WebGLRenderer resize surface, with the canvas writes counted. */
function makeRenderer({ w = 1280, h = 720, dpr = 1 } = {}) {
  const canvas = { width: 0, height: 0, style: {} };
  const r = {
    domElement: canvas,
    xr: { isPresenting: false },
    output: null,
    writes: 0,
    viewports: [],
    _w: w,
    _h: h,
    _pr: dpr,
    getPixelRatio() {
      return this._pr;
    },
    getSize(t) {
      return t.set(this._w, this._h);
    },
    setViewport(x, y, vw, vh) {
      this.viewports.push([x, y, vw, vh]);
    },
    setPixelRatio(value) {
      if (value === undefined) return;
      this._pr = value;
      this.setSize(this._w, this._h, false);
    },
    setSize(width, height, updateStyle = true) {
      if (this.xr.isPresenting) return;
      this._w = width;
      this._h = height;
      // The two assignments that reallocate and CLEAR the drawing buffer.
      // Counted on EVERY assignment, not only when the number changes:
      // assigning width or height resets the bitmap per the HTML spec, and a
      // counter that ignored the unchanged case would score the defect zero
      // and this gate could never go red. (It did, on the first run.)
      canvas.width = Math.floor(width * this._pr);
      this.writes++;
      canvas.height = Math.floor(height * this._pr);
      this.writes++;
      if (updateStyle === true) {
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
      }
      if (this.output !== null) this.output.setSize(canvas.width, canvas.height);
      this.setViewport(0, 0, width, height);
    },
  };
  // Settle it the way a mounted canvas already is.
  r.setSize(w, h, true);
  return r;
}
// The fake counts an assignment as a write whether or not the value changed,
// which is what a reallocation is. Normalise the bookkeeping above to that.
const countWrites = (r, fn) => {
  const before = r.writes;
  fn();
  return r.writes - before;
};

// ------------------------------------------------------- 0. the fake is honest
const three = readFileSync(path.join(root, 'node_modules/three/build/three.module.js'), 'utf8');
const setSizeSrc = three.slice(three.indexOf('this.setSize = function ( width, height'), three.indexOf('this.getDrawingBufferSize'));
const setPrSrc = three.slice(three.indexOf('this.setPixelRatio = function ( value )'), three.indexOf('this.getSize = function'));
const facts = {
  'setPixelRatio delegates to setSize': /this\.setSize\( _width, _height, false \)/.test(setPrSrc),
  'setPixelRatio early-returns on undefined': /if \( value === undefined \) return;/.test(setPrSrc),
  'setSize refuses while xr is presenting': /if \( xr\.isPresenting \)/.test(setSizeSrc),
  'setSize assigns canvas.width/height': /canvas\.width = Math\.floor\( width \* _pixelRatio \);/.test(setSizeSrc),
  'setSize updates style when asked': /canvas\.style\.width = width \+ 'px';/.test(setSizeSrc),
  'setSize forwards to output when set': /output\.setSize\( canvas\.width, canvas\.height \)/.test(setSizeSrc),
  'setSize ends by setting the viewport': /this\.setViewport\( 0, 0, width, height \)/.test(setSizeSrc),
};
const wrong = Object.entries(facts).filter(([, ok]) => !ok).map(([k]) => k);
gate('0 the fake renderer still matches three r185’s real resize surface', wrong.length === 0, wrong.join(' · '));

// ------------------------------------------- 1-2. the defect, and the fix
// A REDUNDANT application: exactly what r3f's subscriber issues after the rig
// has already applied the same numbers inside the frame.
const bare = makeRenderer({ dpr: 1.25 });
const bareWrites = countWrites(bare, () => {
  bare.setPixelRatio(1.25);
  bare.setSize(1280, 720, true);
});
rows.push(`  unguarded redundant catch-up: ${bareWrites} canvas writes`);
gate('1 RED: unguarded, r3f’s catch-up rewrites the canvas even though nothing changed',
  bareWrites > 0, `${bareWrites} writes (this is the defect)`);

const g = makeRenderer({ dpr: 1.25 });
const un = ss.installResizeGuard(g);
const guardedWrites = countWrites(g, () => {
  g.setPixelRatio(1.25);
  g.setSize(1280, 720, true);
});
rows.push(`  guarded redundant catch-up:   ${guardedWrites} canvas writes`);
gate('2 GREEN: guarded, a redundant application writes NOTHING to the canvas',
  guardedWrites === 0, `${guardedWrites} writes`);

// ---------------------------------------- 3-4. it must not swallow real work
const stepW = countWrites(g, () => g.setPixelRatio(1.5));
gate('3 a REAL dpr step still resizes (the guard cannot swallow the rig’s own work)',
  stepW > 0 && g.domElement.width === Math.floor(1280 * 1.5),
  `${stepW} writes, canvas ${g.domElement.width}x${g.domElement.height}`);

const resizeW = countWrites(g, () => g.setSize(1600, 900, true));
gate('4 a REAL container resize still resizes',
  resizeW > 0 && g.domElement.width === Math.floor(1600 * 1.5),
  `${resizeW} writes, canvas ${g.domElement.width}x${g.domElement.height}`);

// -------------------------------------------- 5. a skip is a semantic no-op
g.viewports.length = 0;
countWrites(g, () => {
  g.setPixelRatio(1.5);
  g.setSize(1600, 900, true);
});
gate('5 a SKIPPED call still sets the viewport — the one side effect a bare return would drop',
  g.viewports.length === 2 && g.viewports.every(([x, y, vw, vh]) => x === 0 && y === 0 && vw === 1600 && vh === 900),
  `${g.viewports.length} viewport calls: ${JSON.stringify(g.viewports)}`);

// ------------------------------- 6. style drift is a real difference, not a skip
const st = makeRenderer({ dpr: 1 });
const unSt = ss.installResizeGuard(st);
st.domElement.style.width = '999px'; // something else moved the CSS size
const styleW = countWrites(st, () => st.setSize(1280, 720, true));
gate('6 an unsettled CSS style is NOT "already satisfied" — the guard delegates',
  st.domElement.style.width === '1280px',
  `style now ${st.domElement.style.width}, ${styleW} canvas writes`);
unSt();

// ------------------------------------ 7-8. the two states that always delegate
const xr = makeRenderer({ dpr: 1 });
const unXr = ss.installResizeGuard(xr);
xr.xr.isPresenting = true;
xr.viewports.length = 0;
xr.setSize(1280, 720, true);
gate('7 xr.isPresenting always delegates — three refuses there, so never answer for it',
  xr.viewports.length === 0, `${xr.viewports.length} viewport calls (three would make 0)`);
unXr();

const op = makeRenderer({ dpr: 1 });
let outSized = 0;
op.output = { setSize: () => { outSized++; } };
const unOp = ss.installResizeGuard(op);
op.setSize(1280, 720, true);
gate('8 a non-null renderer.output always delegates — a skip would miss output.setSize',
  outSized === 1, `output.setSize called ${outSized}x`);
unOp();

// --------------------------------------------- 9-10. flag off, and ownership
globalThis.__sgCfg = { enabled: false, valveMs: 400 };
const off = makeRenderer({ dpr: 1 });
const origOff = off.setSize;
const unOff = ss.installResizeGuard(off);
const offWrites = countWrites(off, () => off.setSize(1280, 720, true));
gate('9 flag OFF installs nothing: the methods are untouched and the redundant write happens',
  off.setSize === origOff && offWrites > 0,
  `same function reference: ${off.setSize === origOff}, ${offWrites} writes`);
unOff();
globalThis.__sgCfg = { enabled: true, valveMs: 400 };

// StrictMode: mount, mount again, then run the FIRST uninstaller. It must not
// strip the guard that the live mount is relying on.
ss.resetStepSafe();
const sm = makeRenderer({ dpr: 1 });
const unA = ss.installResizeGuard(sm);
const unB = ss.installResizeGuard(sm); // same renderer: must be a no-op
unB();
const afterStrict = countWrites(sm, () => sm.setSize(1280, 720, true));
gate('10 a StrictMode double-mount cannot leave the renderer unguarded',
  afterStrict === 0 && ss.resizeGuardOwner() === sm,
  `${afterStrict} writes after the second mount’s cleanup, owner ${ss.resizeGuardOwner() === sm ? 'held' : 'LOST'}`);
unA();
gate('11 …and the real uninstaller restores the originals',
  ss.resizeGuardOwner() === null && countWrites(sm, () => sm.setSize(1280, 720, true)) > 0);

// ------------------------------------------------- 12. the rig installs it
const rig = readFileSync(path.join(root, 'components/fly/StepSafeRig.jsx'), 'utf8');
gate('12 StepSafeRig installs the guard from an effect keyed on the renderer',
  /useEffect\(\(\) => installResizeGuard\(gl\), \[gl\]\)/.test(rig));

if (REPORT) console.log('\n' + rows.join('\n'));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
