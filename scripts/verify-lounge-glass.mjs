// LOUNGE MOBILE — the GLASS stream's node gate (FLY_LOUNGE_MOBILE.md; real
// modules and real hook sources, deterministic: no DOM, no GPU, no network,
// a virtual clock).
//
//  1. The binocular figure (lib/fly/lounge/glass-layout.mjs binocularFigure):
//     portrait is ONE lens sized from the WIDTH on a tall screen, centred on
//     the optical axis, clear of both readout bands under any safe-area
//     insets (it shrinks on a short screen instead of running under them);
//     landscape is the twin lenses sized from the HEIGHT, the side columns
//     kept clear of the notch; a desktop gets no phone figure.
//  2. The focus wheel's scale: the log mapping (wheelPx / wheelMag inverse
//     and monotone, clamped to 2x..25x, the presets about 80 px apart),
//     detentNear's reach and detentsCrossed's order, the tick list.
//  3. The portrait band budget (MOBILE_GLASS.bino.portrait): the top band
//     holds the tape, the identity and the tallest of figures / a two-line
//     notice / the hint (portraitTopNeed <= topBandPx); the bottom row holds
//     Lower, the wheel and the side toggles — with and without the Readouts
//     switch and motion look — every round >= 44 px and the wheel above its
//     floor from a 320 px phone up.
//  4. The two Back chains (hooks/use-overlay-back.js, the flight HUD's;
//     components/fly/hud/lounge/use-lounge-back.js, the lounge's and the
//     airport browser's) together, on a history that behaves like a
//     browser's (pushState is synchronous, back() is a queued traversal that
//     resolves its delta when it runs, popstate reaches the capture listeners
//     first, a React commit lands in a microtask between listeners): the
//     Atlas's "Watch an airport" pill -> pick an airport keeps the lounge
//     (the blocker: it used to drop the player on the title), the browser's
//     X keeps the Atlas, Back with the browser over the Atlas closes the
//     browser, the title's browser, the lounge's Back order, inspect over the
//     lounge, and no orphan sentinel is ever left behind.
//     LOUNGE_GLASS_SRC=<a tree> loads the two hooks from another checkout
//     (the RED run: b0c82e0 fails section 4).
//  5. The CSS contracts a browser cannot miss but a refactor could: the
//     floats' mirror of the walk stick's zone equals the stick's own
//     (lounge-touch.css) and MOBILE_TOUCH.stick.zone; every phone surface
//     that used to blur the live canvas is solid; reduced motion follows the
//     game's own setting (data-reduced) as well as the OS.
//
// Run: node --no-warnings scripts/verify-lounge-glass.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { binocularFigure, detentNear, detentsCrossed, portraitControls, portraitTopNeed, wheelMag, wheelPx, wheelTicks } from '../lib/fly/lounge/glass-layout.mjs';
import { MOBILE_GLASS, MOBILE_TOUCH, VIEW } from '../lib/fly/observation-config.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0;
let failed = 0;
const check = (name, fn) => {
  try {
    fn();
    passed++;
    console.log(`PASS ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name} — ${e.message}`);
  }
};
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

// --- 1. the binocular figure ---------------------------------------------------
console.log('\n[1] the binocular figure');
const B = MOBILE_GLASS.bino;
const PHONES = [
  { name: 'iPhone 13 Safari tab', w: 390, h: 664, insets: { top: 0, bottom: 0, left: 0, right: 0 } },
  { name: 'iPhone 13 home-screen', w: 390, h: 844, insets: { top: 47, bottom: 34, left: 0, right: 0 } },
  { name: 'iPhone 13 tab, insets emulated', w: 390, h: 664, insets: { top: 47, bottom: 34, left: 0, right: 0 } },
  { name: 'iPhone SE', w: 375, h: 553, insets: { top: 0, bottom: 0, left: 0, right: 0 } },
  { name: 'Pro Max home-screen', w: 430, h: 932, insets: { top: 59, bottom: 34, left: 0, right: 0 } },
  { name: '320 px phone', w: 320, h: 480, insets: { top: 20, bottom: 0, left: 0, right: 0 } },
  { name: 'iPad mini upright', w: 768, h: 1024, insets: { top: 24, bottom: 20, left: 0, right: 0 } },
];
for (const p of PHONES) {
  check(`portrait ${p.name} (${p.w}x${p.h}): one lens on the optical axis, clear of both bands under the insets`, () => {
    const f = binocularFigure('portrait', p.w, p.h, p.insets);
    assert.equal(f.mode, 'portrait');
    assert.equal(f.lenses.length, 1);
    assert.ok(near(f.cx, p.w / 2) && near(f.cy, p.h / 2), 'centred on the screen (the optical axis)');
    assert.ok(f.R <= (p.w * B.portrait.diameterFrac) / 2 + 1e-9, 'never wider than the width allows');
    assert.ok(f.top >= p.insets.top + B.portrait.topBandPx - 1e-9 || f.R === 40, `top band ${f.top} < inset ${p.insets.top} + ${B.portrait.topBandPx}`);
    assert.ok(p.h - f.bottom >= p.insets.bottom + B.portrait.bottomBandPx - 1e-9 || f.R === 40, `bottom band ${p.h - f.bottom}`);
  });
}
check('portrait: on a tall screen the lens is sized from the WIDTH (the full width on an iPhone 13, tab or home-screen)', () => {
  assert.equal(binocularFigure('portrait', 390, 664).R, 195);
  assert.equal(binocularFigure('portrait', 390, 844, PHONES[1].insets).R, 195);
  assert.equal(binocularFigure('portrait', 430, 932, PHONES[4].insets).R, 215);
});
check('portrait: a short screen shrinks the lens to keep the bands (never the other way round)', () => {
  const f = binocularFigure('portrait', 390, 664, PHONES[2].insets);
  assert.ok(f.R < 195 && near(f.top, 47 + B.portrait.topBandPx), JSON.stringify(f));
});
for (const [w, h, insets] of [[750, 342, { top: 0, bottom: 21, left: 47, right: 47 }], [844, 390, { top: 0, bottom: 21, left: 47, right: 47 }], [667, 375, { top: 0, bottom: 0, left: 0, right: 0 }], [932, 430, { top: 0, bottom: 21, left: 59, right: 59 }]]) {
  check(`landscape ${w}x${h}: twin lenses from the height, inside it, the side columns clear of the notch`, () => {
    const f = binocularFigure('landscape', w, h, insets);
    assert.equal(f.lenses.length, 2);
    assert.ok(f.R <= h * B.landscape.radiusFrac + 1e-9, 'sized from the height');
    assert.ok(f.top >= 0 && f.bottom <= h, 'inside the height');
    const side = Math.max(insets.left, insets.right) + B.landscape.sideMinPx;
    assert.ok(f.left >= side - 1e-6 && w - f.right >= side - 1e-6, `columns ${f.left} / ${w - f.right} < ${side}`);
    assert.ok(near(f.lenses[1].cx - f.lenses[0].cx, 2 * f.sep), 'symmetric about the axis');
  });
}
check('desktop: no phone figure (the desktop mask keeps its own code)', () => {
  assert.equal(binocularFigure('desktop', 1920, 1080), null);
  assert.equal(binocularFigure(undefined, 1280, 800), null);
});

// --- 2. the focus wheel ----------------------------------------------------------
console.log('\n[2] the focus wheel');
const W = MOBILE_GLASS.wheel;
check('wheelPx / wheelMag: inverse, monotone, clamped to the wheel range', () => {
  let last = -Infinity;
  for (let m = W.minMag; m <= W.maxMag; m += 0.25) {
    const px = wheelPx(m);
    assert.ok(px > last, 'monotone');
    last = px;
    assert.ok(near(wheelMag(px), m, 1e-9), `round trip at ${m}`);
  }
  assert.equal(wheelMag(wheelPx(W.maxMag) + 500), W.maxMag);
  assert.equal(wheelMag(wheelPx(W.minMag) - 500), W.minMag);
  assert.equal(wheelPx(1), wheelPx(W.minMag));
  assert.equal(wheelPx(99), wheelPx(W.maxMag));
});
check('wheel: a log scale (equal ratios, equal distances) with the presets about 80 px apart', () => {
  assert.ok(near(wheelPx(14) - wheelPx(7), wheelPx(20) - wheelPx(10), 1e-9));
  const [a, b, c] = VIEW.optics.steps.map(wheelPx);
  assert.ok(b - a > 60 && b - a < 100 && c - b > 60 && c - b < 100, `${b - a} / ${c - b}`);
});
check('detentNear: the nearest preset within reach, else null', () => {
  const p12 = wheelPx(12);
  assert.equal(detentNear(p12 + W.snapPx - 0.5, VIEW.optics.steps, W.snapPx), 12);
  assert.equal(detentNear(p12 - W.snapPx + 0.5, VIEW.optics.steps, W.snapPx), 12);
  assert.equal(detentNear(p12 + W.snapPx + 1, VIEW.optics.steps, W.snapPx), null);
  assert.equal(detentNear(p12 + 2, VIEW.optics.steps, W.magnetPx), 12);
});
check('detentsCrossed: the presets passed, in the order the finger passes them', () => {
  assert.deepEqual(detentsCrossed(wheelPx(5), wheelPx(25), VIEW.optics.steps), [7, 12, 20]);
  assert.deepEqual(detentsCrossed(wheelPx(25), wheelPx(5), VIEW.optics.steps), [20, 12, 7]);
  assert.deepEqual(detentsCrossed(wheelPx(8), wheelPx(11), VIEW.optics.steps), []);
  assert.deepEqual(detentsCrossed(wheelPx(11), wheelPx(12), VIEW.optics.steps), [12]);
});
check('wheelTicks: sorted, the presets flagged, nothing outside the range', () => {
  const t = wheelTicks(VIEW.optics.steps);
  assert.ok(t.every((x, i) => i === 0 || x.px > t[i - 1].px));
  assert.deepEqual(t.filter((x) => x.preset).map((x) => x.mag), [...VIEW.optics.steps]);
  assert.ok(t.every((x) => x.mag >= W.minMag && x.mag <= W.maxMag));
});

// --- 3. the portrait band budget ---------------------------------------------------
console.log('\n[3] the portrait band budget');
const P = B.portrait;
check('top band: the tape, the identity and the tallest of figures / a two-line notice fit topBandPx (the toggles are not up there)', () => {
  const t = P.top;
  assert.ok(t.noticePx >= 2 * 12.5 * 1.35 - 0.5, 'a two-line notice at the CSS line height');
  assert.ok(portraitTopNeed() <= P.topBandPx, `need ${portraitTopNeed()} > ${P.topBandPx}`);
  assert.equal(portraitTopNeed(), t.padPx + t.tapePx + t.gapPx + t.identPx + t.gapPx + Math.max(t.figuresPx, t.noticePx));
});
check('top band: the same figure whatever the toggles (the lens never jumps as Readouts or Motion come and go)', () => {
  // binocularFigure takes no controls argument: the bands are budgeted for the worst case.
  assert.equal(binocularFigure.length, 3);
});
for (const w of [320, 360, 375, 390, 430]) {
  for (const [label, opts] of [['no toggle', {}], ['Readouts', { readouts: true }], ['Motion', { motion: true }], ['Readouts + Motion', { readouts: true, motion: true }]]) {
    check(`bottom row at ${w} px, ${label}: rounds >= 44 px, the wheel >= its floor, all inside the width`, () => {
      const c = portraitControls(w, undefined, opts);
      const C = P.controls;
      assert.ok(c.round >= 44, `round ${c.round}`);
      assert.ok(c.wheel >= C.minWheelPx, `wheel ${c.wheel} < ${C.minWheelPx}`);
      assert.ok(near(2 * C.padPx + c.rounds * (c.round + C.gapPx) + c.wheel, w), 'fills the width exactly');
      assert.equal(c.side, (opts.readouts ? 1 : 0) + (opts.motion ? 1 : 0));
    });
  }
}
check('bottom row: with both toggles the rounds go compact and the wheel keeps about 190 px at 390', () => {
  const both = portraitControls(390, undefined, { readouts: true, motion: true });
  assert.equal(both.round, P.controls.compactRoundPx);
  assert.ok(both.wheel >= 185, `wheel ${both.wheel}`);
  assert.equal(portraitControls(390, undefined, { motion: true }).round, P.controls.roundPx);
});
check('bottom band: the controls row (a round plus its padding) fits bottomBandPx above the map credit', () => {
  // .bp-bottom pads 6 above and 10 below the row; bottomBandPx also covers a
  // two-line map credit (about 26 px) under it.
  assert.ok(P.controls.roundPx + 16 + 26 <= P.bottomBandPx, `${P.controls.roundPx + 16 + 26} > ${P.bottomBandPx}`);
});

// --- 4. the two Back chains ---------------------------------------------------------
console.log('\n[4] the Back chains (flight HUD + lounge / airport browser)');
const SRC = process.env.LOUNGE_GLASS_SRC ? path.resolve(process.env.LOUNGE_GLASS_SRC) : ROOT;
const hookSource = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/export function /g, 'function ');
const SOURCES = hookSource('hooks/use-overlay-back.js') + '\n' + hookSource('components/fly/hud/lounge/use-lounge-back.js');

function world() {
  // --- the clock, the task queue and the microtasks ---
  let now = 0, seq = 0;
  const tasks = [];
  const micro = [];
  const setTimeout_ = (fn, ms = 0) => {
    const t = { at: now + Math.max(0, ms || 0), seq: seq++, fn };
    tasks.push(t);
    return t;
  };
  const clearTimeout_ = (t) => {
    const i = tasks.indexOf(t);
    if (i >= 0) tasks.splice(i, 1);
  };
  const flushMicro = () => {
    for (let n = 0; micro.length && n < 100; n++) micro.shift()();
  };
  // --- the history: synchronous pushState, back() resolved when it runs ---
  const entries = [{ __NA: true, app: 'preserved' }];
  let index = 0;
  const capture = [], bubble = [];
  let popEvents = 0;
  const history = {
    get state() { return entries[index]; },
    pushState(value) {
      entries.splice(index + 1);
      entries.push(value);
      index++;
    },
    back() {
      setTimeout_(() => {
        if (index === 0) return; // nothing to go back to: no popstate
        index--;
        popEvents++;
        const e = { type: 'popstate', state: entries[index] };
        for (const l of [...capture]) if (capture.includes(l)) { l(e); flushMicro(); }
        for (const l of [...bubble]) if (bubble.includes(l)) { l(e); flushMicro(); }
      });
    },
  };
  const window = {
    history,
    addEventListener: (type, fn, cap) => (cap ? capture : bubble).push(fn),
    removeEventListener: (type, fn, cap) => {
      const list = cap ? capture : bubble;
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    },
  };
  // --- the store (zustand-like: subscribe(selector, listener) fires synchronously) ---
  const store = {
    phase: 'flying', cameraMode: 'chase', inspectHex: null, atlasOpen: false, logbookOpen: false, hangarOpen: false,
    creditsOpen: false, screen: 'flight', settingsOpen: false, adventureOpen: false, airportBrowserOpen: false, airportWatch: null,
  };
  const subs = new Set();
  const set = (patch) => {
    Object.assign(store, patch);
    for (const s of [...subs]) {
      const v = s.select(store);
      if (!Object.is(v, s.value)) { s.value = v; s.fn(v); }
    }
    micro.push(reconcile); // React's commit for the store change
  };
  for (const [setter, field] of [['setInspectHex', 'inspectHex'], ['setAtlasOpen', 'atlasOpen'], ['setLogbookOpen', 'logbookOpen'], ['setCameraMode', 'cameraMode'], ['setPhase', 'phase'], ['setSettingsOpen', 'settingsOpen']]) store[setter] = (v) => set({ [field]: v });
  store.setHangarOpen = (v) => set({ hangarOpen: v });
  store.setScreen = (v) => set({ screen: v });
  store.closeCredits = () => set({ creditsOpen: false });
  const useFlyStore = {
    getState: () => store,
    setState: (patch) => set(patch),
    subscribe: (select, fn) => {
      const s = { select, fn, value: select(store) };
      subs.add(s);
      return () => subs.delete(s);
    },
  };
  // --- hooks: one component instance at a time ---
  let current = null;
  const useRef = (initial) => {
    const i = current.refCursor++;
    return (current.refs[i] ??= { current: initial });
  };
  const useEffect = (fn, deps) => {
    const i = current.cursor++;
    const prev = current.effects[i];
    if (!prev || !deps || deps.some((d, j) => !Object.is(d, prev.deps[j]))) current.effects[i] = { fn, deps, cleanup: prev?.cleanup, dirty: true };
    else prev.fn = fn;
  };
  const api = vm.runInNewContext(`${SOURCES}\n({ useOverlayBack, useLoungeBack })`, {
    window, useRef, useEffect, useFlyStore, FRONT_DOOR: { enabled: true, exitToTitle: true },
    setTimeout: setTimeout_, clearTimeout: clearTimeout_, Date: { now: () => now }, Math, WeakMap,
  });
  const instance = (render) => ({ render, refs: [], effects: [], cursor: 0, refCursor: 0, mounted: false });
  const renderOnly = (inst) => {
    current = inst;
    inst.cursor = 0;
    inst.refCursor = 0;
    inst.render();
    current = null;
  };
  // --- the app: TouchControls (the flight chain), LoungeHud, AirportBrowser ---
  const lounge = { sheet: null, selected: null, steps: 0 };
  const backStep = () => {
    lounge.steps++;
    if (store.airportBrowserOpen) set({ airportBrowserOpen: false });
    else if (lounge.sheet) lounge.sheet = null;
    else if (lounge.selected) lounge.selected = null;
    else set({ airportWatch: null, screen: 'title' }); // watch.exit(): origin 'title'
  };
  const closeBrowser = () => set({ airportBrowserOpen: false });
  const browserUp = () => !!store.airportBrowserOpen;
  const F = instance(() => api.useOverlayBack(true, false, () => {}, () => false));
  const LH = instance(() => api.useLoungeBack(true, backStep));
  const LB = instance(() => api.useLoungeBack(!store.airportWatch, closeBrowser, browserUp));
  const tree = [F, LH, LB];
  const want = (inst) => inst === F || (inst === LH ? !!store.airportWatch : !!store.airportBrowserOpen);
  function reconcile() {
    // React's passive effects: every destroy of the commit first, then every create, in tree order.
    const live = [];
    for (const inst of tree) {
      if (want(inst)) {
        renderOnly(inst);
        inst.mounted = true;
        live.push(inst);
      } else if (inst.mounted) {
        inst.mounted = false;
        for (const e of inst.effects) { e.cleanup?.(); e.cleanup = undefined; }
        inst.effects = [];
        inst.refs = [];
      }
    }
    for (const inst of live) for (const e of inst.effects) if (e.dirty) { e.cleanup?.(); e.cleanup = undefined; }
    for (const inst of live) for (const e of inst.effects) if (e.dirty) { e.dirty = false; e.cleanup = e.fn(); }
  }
  const drain = (ms = 6000) => {
    flushMicro();
    const until = now + ms;
    for (let n = 0; n < 500; n++) {
      if (!tasks.length) break;
      tasks.sort((a, b) => a.at - b.at || a.seq - b.seq);
      if (tasks[0].at > until) break;
      const t = tasks.shift();
      now = Math.max(now, t.at);
      t.fn();
      flushMicro();
    }
    now = Math.max(now, until);
  };
  reconcile();
  drain();
  return {
    store, set, lounge, entries, drain,
    get index() { return index; },
    get state() { return entries[index]; },
    get pops() { return popEvents; },
    userBack: () => { history.back(); drain(); },
    stack: () => entries.slice(0, index + 1).map((e) => (e.__flyLounge ? 'L' : e.__flyOverlay ? 'F' : '0')).join(''),
    enter: () => {
      // watch.enter(): the Atlas closes (its subscriber runs now), then the
      // browser closes and the lounge opens in one store write.
      set({ atlasOpen: false });
      set({ airportBrowserOpen: false, airportWatch: { id: 'KCMH' }, screen: 'flight' });
    },
  };
}

check('Atlas -> "Watch an airport" -> KCMH: the lounge is still up 3 s later, a lounge sentinel on top (was: dropped on the title)', () => {
  const w = world();
  w.set({ atlasOpen: true }); w.drain();
  assert.equal(w.stack(), '0F', 'the Atlas pushed its sentinel');
  w.set({ airportBrowserOpen: true }); w.drain();
  assert.equal(w.stack(), '0FL', 'the browser pushed its sentinel above the Atlas');
  w.enter(); w.drain(3000);
  assert.ok(w.store.airportWatch, 'the lounge is still active');
  assert.notEqual(w.store.screen, 'title', 'not on the title');
  assert.ok(w.state.__flyLounge, 'a lounge sentinel is the current entry');
});
check('... then Back follows the lounge order (a sheet closes first), and the Atlas sentinel left under it is unwound', () => {
  const w = world();
  w.set({ atlasOpen: true }); w.drain();
  w.set({ airportBrowserOpen: true }); w.drain();
  w.enter(); w.drain(3000);
  w.lounge.sheet = 'more';
  w.userBack();
  assert.equal(w.lounge.sheet, null, 'the sheet closed');
  assert.equal(w.lounge.steps, 1, 'exactly one Back step');
  assert.ok(w.store.airportWatch, 'still in the lounge');
  assert.equal(w.stack(), '0L', 'one lounge sentinel, no orphan flight sentinel under it');
  w.lounge.selected = 'a1b2c3';
  w.userBack();
  assert.equal(w.lounge.selected, null);
  assert.ok(w.store.airportWatch && w.stack() === '0L');
  w.userBack();
  assert.equal(w.store.airportWatch, null, 'at the root Back leaves the lounge');
  assert.equal(w.stack(), '0', 'and leaves nothing behind');
});
check('Atlas -> browser -> X: the Atlas stays open, its sentinel current; one Back then closes the Atlas', () => {
  const w = world();
  w.set({ atlasOpen: true }); w.drain();
  w.set({ airportBrowserOpen: true }); w.drain();
  w.set({ airportBrowserOpen: false }); w.drain();
  assert.equal(w.store.atlasOpen, true, 'the Atlas is still open');
  assert.equal(w.stack(), '0F');
  w.userBack();
  assert.equal(w.store.atlasOpen, false, 'Back closed the Atlas');
  assert.equal(w.stack(), '0');
});
check('Atlas -> browser -> Back: the browser closes, the Atlas stays; the next Back closes the Atlas', () => {
  const w = world();
  w.set({ atlasOpen: true }); w.drain();
  w.set({ airportBrowserOpen: true }); w.drain();
  w.userBack();
  assert.equal(w.store.airportBrowserOpen, false, 'the browser closed');
  assert.equal(w.store.atlasOpen, true, 'the Atlas is still open');
  assert.equal(w.stack(), '0F');
  w.userBack();
  assert.equal(w.store.atlasOpen, false);
  assert.equal(w.stack(), '0');
});
check('title -> browser -> Back closes the browser and leaves no entry', () => {
  const w = world();
  w.set({ screen: 'title' });
  w.set({ airportBrowserOpen: true }); w.drain();
  assert.equal(w.stack(), '0L');
  w.userBack();
  assert.equal(w.store.airportBrowserOpen, false);
  assert.equal(w.stack(), '0');
});
check('title -> browser -> KCMH: the lounge adopts the browser\'s sentinel (one entry); Back clears the selection, then leaves', () => {
  const w = world();
  w.set({ screen: 'title' });
  w.set({ airportBrowserOpen: true }); w.drain();
  w.enter(); w.drain(3000);
  assert.ok(w.store.airportWatch);
  assert.equal(w.stack(), '0L');
  w.lounge.selected = 'a1b2c3';
  w.userBack();
  assert.ok(w.store.airportWatch && w.lounge.selected === null && w.stack() === '0L');
  w.userBack();
  assert.equal(w.store.airportWatch, null);
  assert.equal(w.stack(), '0');
});
check('inspect over the lounge: Back closes inspect only; closing it from code leaves the lounge as it was', () => {
  const w = world();
  w.set({ airportBrowserOpen: true }); w.drain();
  w.enter(); w.drain(3000);
  w.lounge.selected = 'a1b2c3';
  w.set({ inspectHex: 'a1b2c3' }); w.drain();
  assert.equal(w.stack(), '0LF');
  w.userBack();
  assert.equal(w.store.inspectHex, null, 'inspect closed');
  assert.equal(w.lounge.selected, 'a1b2c3', 'the lounge took no step');
  assert.equal(w.stack(), '0L');
  w.set({ inspectHex: 'a1b2c3' }); w.drain();
  w.set({ inspectHex: null }); w.drain();
  assert.equal(w.lounge.selected, 'a1b2c3');
  assert.equal(w.lounge.steps, 0);
  assert.equal(w.stack(), '0L');
});
check('the airport browser over the lounge: the lounge\'s Back closes it first, one entry throughout', () => {
  const w = world();
  w.set({ airportBrowserOpen: true }); w.drain();
  w.enter(); w.drain(3000);
  w.set({ airportBrowserOpen: true }); w.drain();
  assert.equal(w.stack(), '0L', 'the browser over the lounge pushes nothing of its own');
  w.userBack();
  assert.equal(w.store.airportBrowserOpen, false);
  assert.ok(w.store.airportWatch);
  assert.equal(w.stack(), '0L');
});
check('leaving the lounge from its button (no Back) unwinds its sentinel and the Atlas\'s orphan under it', () => {
  const w = world();
  w.set({ atlasOpen: true }); w.drain();
  w.set({ airportBrowserOpen: true }); w.drain();
  w.enter(); w.drain(3000);
  w.set({ airportWatch: null, screen: 'title' }); w.drain();
  assert.equal(w.stack(), '0');
});

// --- 5. CSS contracts ------------------------------------------------------------------
console.log('\n[5] CSS contracts');
const css = fs.readFileSync(path.join(ROOT, 'components/fly/hud/lounge/lounge-mobile.css'), 'utf8');
const touchCss = fs.readFileSync(path.join(ROOT, 'components/fly/hud/lounge/lounge-touch.css'), 'utf8');
const rule = (text, selector) => {
  const i = text.indexOf(selector + ' {');
  assert.ok(i >= 0, `no rule ${selector}`);
  return text.slice(i, text.indexOf('}', i));
};
check('the floats\' mirror of the stick zone equals the stick\'s own (lounge-touch.css) and MOBILE_TOUCH.stick.zone', () => {
  const Z = MOBILE_TOUCH.stick.zone;
  const zw = `min(${Z.widthFrac * 100}vw, ${Z.maxWidthPx}px)`, zh = `min(${Z.heightFrac * 100}vh, ${Z.maxHeightPx}px)`;
  const stick = rule(touchCss, '.lounge-stick-zone');
  assert.ok(stick.includes(`width: ${zw}`) && stick.includes(`height: ${zh}`), 'lounge-touch.css .lounge-stick-zone');
  assert.ok(css.includes(`--lounge-zone-w: ${zw};`) && css.includes(`--lounge-zone-h: ${zh};`), 'lounge-mobile.css --lounge-zone-w / -h');
});
check('portrait floats rise clear of the stick (seated: the 120 px base; standing: the whole zone); the coach sits under the header', () => {
  assert.ok(css.includes(`--lounge-float-up: calc(var(--lounge-stick-bottom) + ${MOBILE_TOUCH.stick.ringPx + 8}px);`), 'seated: ring + 8');
  assert.ok(css.includes('--lounge-float-up: calc(var(--lounge-stick-bottom) + var(--lounge-zone-h) + 8px);'), 'standing: the zone + 8');
  assert.match(rule(css, ".lounge[data-layout='phone-portrait'] .lounge-coach"), /top: calc\(var\(--lounge-head-bottom\) \+ 8px\)/);
});
check('every phone surface over the live canvas is solid (no backdrop blur): the place prompts and the lower thirds too', () => {
  for (const sel of [".lounge[data-layout^='phone'] :is(.lounge-sit, .lounge-decor-prompt, .observatory-prompt, .observatory-nearby)", ".lounge[data-layout^='phone'] .dir-lower"]) {
    const r = rule(css, sel);
    assert.ok(/backdrop-filter: none/.test(r) && /-webkit-backdrop-filter: none/.test(r) && /background: var\(--lounge-solid\)/.test(r), sel);
  }
});
check('reduced motion: the game\'s own setting (data-reduced) stops the phone HUD\'s CSS motion as the OS setting does', () => {
  const r = rule(css, '.lounge[data-layout][data-reduced] *');
  assert.ok(/transition: none !important/.test(r) && /animation: none !important/.test(r));
});

console.log(`\nVERIFY lounge-glass: ${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
