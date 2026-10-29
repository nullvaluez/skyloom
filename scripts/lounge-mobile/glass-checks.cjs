// LOUNGE MOBILE — the GLASS stream's checks for scripts/verify-lounge-mobile.cjs
// (portrait binoculars, the phone HUD, sheets, overlap / overflow / 44 px
// targets, safe areas, Android Back, the airport browser on a phone). The
// GLASS stream owns this file. Each phase receives the runner's harness
// object `h` (see the runner's header for its fields) and reports through
// h.check().
//
// The layout auditor (audit()) runs in the page in every state: every visible
// interactive control of the lounge (and of the map credit and the airport
// browser) is at least 44 x 44 CSS px or on the justified list; no two
// visible chrome boxes overlap except the intended layering; nothing sits
// outside the viewport horizontally; no control sits under an emulated
// safe-area inset; and the status line and the binocular notice never wrap
// one word per line. Safe areas are emulated through CDP
// (Emulation.setSafeAreaInsetsOverride, an iPhone 13 held upright or sideways)
// for the audited states and cleared before the runner continues.
//
// Everything here is functional evidence from headless Chromium (SwiftShader,
// map hosts blocked): layout, gestures and state, never a look or fps verdict.

const PRESETS = [7, 12, 20];
const WHEEL = { pxPerLog: 150, snapPx: 18 }; // lib/fly/observation-config.js MOBILE_GLASS.wheel
const INSETS = {
  portrait: { top: 47, bottom: 34, left: 0, right: 0 },
  landscape: { top: 0, bottom: 21, left: 47, right: 47 },
};

/* ------------------------------------------------------------------ in page */
// The auditor. Returns { controls, small, overlaps, overflow, inSafe, wraps }.
function pageAudit({ insets, label }) {
  const vw = innerWidth, vh = innerHeight;
  const visible = (el) => {
    if (!el || !el.isConnected) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    for (let p = el.parentElement; p; p = p.parentElement) {
      const ps = getComputedStyle(p);
      if (ps.display === 'none' || ps.visibility === 'hidden' || Number(ps.opacity) < 0.05) return false;
    }
    return true;
  };
  const name = (el) => el.getAttribute('data-testid') || el.getAttribute('aria-label') || (el.className && String(el.className.baseVal ?? el.className).split(' ')[0]) || el.tagName.toLowerCase();
  const box = (el) => {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
  };
  // Clipped by a scrolling / overflow-hidden ancestor: judged inside it.
  const clipper = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (/(auto|scroll|hidden)/.test(cs.overflowX + cs.overflowY)) return p;
    }
    return null;
  };
  const roots = [document.querySelector('.lounge'), document.querySelector('[data-zone="attribution"]'), document.querySelector('.airport-browser')].filter(Boolean);
  const JUSTIFIED = [
    ['.lsheet-grab', 'sheet grabber: a second affordance; every sheet has a 44 px close or collapse control'],
    ['[data-zone="attribution"] a', 'map credit text links (licensing text, not a control)'],
    ['.lc-credit', 'photo credit text link'],
    ['.observatory-dot', 'map dots: every contact is also a 48 px row in the list below the map'],
    ['.lounge-surface', 'the look surface itself'],
  ];
  const controls = [];
  for (const root of roots) {
    for (const el of root.querySelectorAll('button, a[href], input, select, [role="button"], [role="tab"], [role="slider"]')) {
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      const clip = clipper(el);
      if (clip) {
        const c = clip.getBoundingClientRect();
        // Scrolled out of its container: not on screen.
        if (r.right <= c.left + 1 || r.left >= c.right - 1 || r.bottom <= c.top + 1 || r.top >= c.bottom - 1) continue;
      }
      if (r.bottom <= 0 || r.top >= vh || r.right <= 0 || r.left >= vw) continue;
      const why = JUSTIFIED.find(([sel]) => el.matches(sel));
      controls.push({ name: name(el), ...box(el), justified: why ? why[1] : null, clipped: !!clip });
    }
  }
  const small = controls.filter((c) => !c.justified && (c.w < 43.5 || c.h < 43.5));
  // Chrome boxes: the lounge's own panels and the global pieces that share
  // the screen with it. Intended layering is listed below.
  const CHROME = [
    '.lounge .lounge-header', '.lounge .lounge-dock', '.lounge .lounge-peek', '.lounge .lounge-board', '.lounge .lounge-card',
    '.lounge .lounge-menu-sheet', '.lounge .lounge-seat-menu', '.lounge .lounge-decor-card', '.lounge .lounge-decor-prompt', '.lounge .lounge-sit',
    '.lounge .observatory-panel', '.lounge .observatory-window-panel', '.lounge .observatory-prompt', '.lounge .observatory-nearby', '.lounge .observatory-direction',
    '.lounge .lounge-status', '.lounge .lounge-coach', '.lounge .dir-cue', '.lounge .dir-lower', '.lounge .lounge-bar', '.lounge .lounge-help',
    '.lounge .bp-top', '.lounge .bp-bottom', '.lounge .bp-col-left', '.lounge .bp-col-right', '.lounge .bp-float-notice', '[data-zone="attribution"] > div',
  ];
  const chrome = [];
  for (const sel of CHROME) for (const el of document.querySelectorAll(sel)) if (visible(el)) chrome.push({ sel, name: name(el), el, ...box(el) });
  const overlaps = [];
  const hit = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  for (let i = 0; i < chrome.length; i++) {
    for (let j = i + 1; j < chrome.length; j++) {
      const a = chrome[i], b = chrome[j];
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      const area = hit(a, b);
      if (area > 4) overlaps.push(`${a.sel.replace('.lounge ', '')} x ${b.sel.replace('.lounge ', '')} (${area}px²)`);
    }
  }
  // Horizontal overflow: chrome boxes and controls inside the viewport, and no page scroll.
  const overflow = [];
  for (const c of chrome) if (c.x < -1 || c.x + c.w > vw + 1 || c.y < -1 || c.y + c.h > vh + 1) overflow.push(`${c.sel} ${c.x},${c.y} ${c.w}x${c.h}`);
  for (const c of controls) if (!c.clipped && (c.x < -1 || c.x + c.w > vw + 1)) overflow.push(`${c.name} ${c.x}..${c.x + c.w}`);
  if (document.documentElement.scrollWidth > vw + 1) overflow.push(`page scrollWidth ${document.documentElement.scrollWidth}`);
  // Under an emulated safe-area inset (the home indicator, the notch).
  const inSafe = [];
  if (insets) {
    for (const c of controls) {
      if (c.clipped || (c.justified && c.name !== 'lsheet-grab')) continue;
      if (c.y < insets.top - 0.5 || c.y + c.h > vh - insets.bottom + 0.5 || c.x < insets.left - 0.5 || c.x + c.w > vw - insets.right + 0.5) inSafe.push(`${c.name} ${c.x},${c.y} ${c.w}x${c.h}`);
    }
  }
  // Text that wraps one word per line.
  const wraps = [];
  for (const el of document.querySelectorAll('.lounge-status, .bp-notice, .bp-hint, .lpk-text strong, .lounge-coach li span')) {
    if (!visible(el)) continue;
    const words = el.textContent.trim().split(/\s+/).filter(Boolean).length;
    const range = document.createRange();
    range.selectNodeContents(el);
    const tops = new Set([...range.getClientRects()].map((r) => Math.round(r.top)));
    const lines = tops.size;
    if (lines > 2 && lines > words / 3) wraps.push(`${name(el)}: ${words} words on ${lines} lines`);
  }
  return { label, vw, vh, controls: controls.length, small, overlaps, overflow, inSafe, wraps };
}

/* ------------------------------------------------------------------- driver */
function glass(h) {
  const { page } = h;
  const tid = (id) => page.getByTestId(id);
  const rect = (sel) => page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || r.width < 1) return null;
    return { x: r.left, y: r.top, w: r.width, h: r.height, r: r.right, b: r.bottom };
  }, sel);
  const shown = async (sel) => !!(await rect(sel));
  // Sheets spring in: a target is tapped once its box has stopped moving.
  const stableRect = async (sel, ms = 6000) => {
    let last = null;
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const r = await rect(sel);
      if (r && last && Math.abs(r.x - last.x) < 0.5 && Math.abs(r.y - last.y) < 0.5 && Math.abs(r.w - last.w) < 0.5) return r;
      last = r;
      await h.wait(160);
    }
    return last;
  };
  const tapEl = async (sel) => {
    const r = await stableRect(sel);
    if (!r) throw new Error(`nothing to tap: ${sel}`);
    await h.touch.tap(r.x + r.w / 2, r.y + r.h / 2);
    await h.wait(450);
    return r;
  };
  const setInsets = async (insets) => {
    try {
      await h.cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: insets || {} });
      await h.wait(400);
      return true;
    } catch (e) {
      return false;
    }
  };
  const audit = async (label, { insets = null, allowOverlap = [] } = {}) => {
    const a = await page.evaluate(pageAudit, { insets, label });
    const overlaps = a.overlaps.filter((o) => !allowOverlap.some((ok) => o.includes(ok)));
    h.check(`${h.phase} ${label}: every visible control >= 44 x 44 px (or justified)`, a.small.length === 0 && a.controls > 0, { controls: a.controls, small: a.small.slice(0, 6) });
    h.check(`${h.phase} ${label}: no visible chrome overlaps`, overlaps.length === 0, overlaps.slice(0, 6));
    h.check(`${h.phase} ${label}: nothing outside the viewport (no chrome off an edge, no page scroll)`, a.overflow.length === 0, a.overflow.slice(0, 6));
    if (insets) h.check(`${h.phase} ${label}: no control under the safe-area insets`, a.inSafe.length === 0, { insets, under: a.inSafe.slice(0, 6) });
    h.check(`${h.phase} ${label}: no text wraps one word per line`, a.wraps.length === 0, a.wraps);
    return a;
  };
  const watch = () => page.evaluate(() => {
    const w = window.__fly?.airportWatch;
    return w ? { binocular: !!w.binocular, selected: w.selected ?? null, target: w.optics?.target, mag: w.optics?.mag, amount: w.optics?.amount, posture: w.posture, seatMenu: !!w.seatMenu, active: !!w.active, tracking: !!w.tracking, motion: w.motionLook ? { supported: !!w.motionLook.supported, active: !!w.motionLook.active } : null } : null;
  });
  const section = (attr) => page.evaluate((a) => document.querySelector('.lounge')?.getAttribute(a) ?? null, attr);
  const gone = (sel, ms = 6000) => h.until((s) => {
    const el = document.querySelector(s);
    return !el || el.getBoundingClientRect().width < 1 || getComputedStyle(el).visibility === 'hidden';
  }, sel, ms);
  const appear = (sel, ms = 8000) => h.until((s) => !!document.querySelector(s)?.getBoundingClientRect().width, sel, ms);
  const back = async (layerSel) => {
    if (layerSel && !(await shown(layerSel))) return false;
    await page.evaluate(() => history.back());
    await h.wait(400);
    if (layerSel) await gone(layerSel);
    return true;
  };
  const lowerAll = async () => {
    await page.evaluate(() => {
      const w = window.__fly.airportWatch;
      w.binoculars(false);
      w.clearSelection();
      w.seatMenuOpen?.(false);
    });
    await h.wait(500);
  };
  return { tid, rect, shown, stableRect, gone, appear, tapEl, setInsets, audit, watch, section, back, lowerAll };
}

/** The mask canvas around the figure, read back: alpha at the lens centre, its rim, the bands and a corner. */
function maskSample() {
  const c = document.querySelector('[data-testid="binocular-mask"]');
  const fig = c?.dataset.figure ? JSON.parse(c.dataset.figure) : null;
  if (!c || !fig) return { fig: null };
  const k = c.width / c.clientWidth;
  const ctx = c.getContext('2d');
  const a = (x, y) => ctx.getImageData(Math.round(x * k), Math.round(y * k), 1, 1).data[3];
  const [cx, cy] = fig.lenses[0];
  const L = fig.lenses;
  const mid = L.length > 1 ? [(L[0][0] + L[1][0]) / 2, cy] : [cx, cy];
  const credit = document.querySelector('[data-zone="attribution"] > div')?.getBoundingClientRect();
  return {
    credit: credit?.width ? a(credit.left + credit.width / 2, credit.top + credit.height / 2) : null,
    fig,
    vw: innerWidth,
    vh: innerHeight,
    centre: a(mid[0], mid[1]),
    inner: a(L[0][0] - fig.R * 0.8, cy),
    above: a(mid[0], Math.max(2, cy - fig.R - 14)),
    below: a(mid[0], Math.min(innerHeight - 3, cy + fig.R + 14)),
    corner: a(4, 4),
  };
}

// SwiftShader runs the lounge at a few frames a second here, so the eased
// magnification can take a while to reach the glasses-up mask.
async function settleBinoculars(h, ms = 30000) {
  return h.until(() => (window.__fly.airportWatch?.optics?.amount ?? 0) > 0.97, undefined, ms);
}

/** Box of each binocular part (CSS px, rounded). */
function binoParts() {
  const out = {};
  for (const sel of ['.bp-top', '.bp-bottom', '.bp-col-left', '.bp-col-right', '[data-testid="binocular-readout"]', '[data-testid="binocular-ident"]', '[data-testid="binocular-wheel"]', '[data-testid="binocular-lower"]', '[data-testid="binocular-notice"]']) {
    const el = document.querySelector(sel);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1) continue;
    out[sel] = { x: Math.round(r.left), y: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom) };
  }
  const fig = document.querySelector('.bp-figures b');
  out.fontPx = fig ? parseFloat(getComputedStyle(fig).fontSize) : 0;
  out.callsign = document.querySelector('.bp-callsign strong')?.textContent ?? null;
  return out;
}

/**
 * The binocular FIGURE (the glasses fully up, nothing to slew to): the mask is
 * the phone's, sized as designed, drawn clear through the glass and dark in
 * the bands, the map credit left readable, and every readout and control in
 * the bands beside or around the glass. `sizeGates` false re-checks only the
 * consistency of bands and glass (e.g. under emulated safe-area insets).
 */
async function figureGates(h, g, portrait, { label = 'binoculars', sizeGates = true } = {}) {
  const s = await h.page.evaluate(maskSample);
  const fig = s.fig;
  h.check(`${h.phase} ${label}: the mask figure is the phone's (${portrait ? 'one lens from the width' : 'twin lenses from the height'})`, !!fig && fig.mode === (portrait ? 'portrait' : 'landscape') && fig.lenses.length === (portrait ? 1 : 2), fig);
  if (!fig) return;
  if (sizeGates && portrait) {
    h.check(`portrait ${label}: the lens diameter is >= 90 % of the viewport width`, 2 * fig.R >= 0.9 * s.vw, { diameter: 2 * fig.R, width: s.vw });
    h.check(`portrait ${label}: the lens is fully inside vertically and centred on the optical axis`, fig.lenses[0][1] - fig.R >= 0 && fig.lenses[0][1] + fig.R <= s.vh && Math.abs(fig.lenses[0][1] - s.vh / 2) <= 1, { cy: fig.lenses[0][1], R: fig.R, vh: s.vh });
  } else if (sizeGates) {
    h.check(`landscape ${label}: the twin lenses are sized from the height and fully inside it`, fig.R <= 0.5 * s.vh && fig.lenses[0][1] - fig.R >= 0 && fig.lenses[0][1] + fig.R <= s.vh && fig.lenses[0][0] - fig.R > 0 && fig.lenses[1][0] + fig.R < s.vw, fig);
  }
  if (sizeGates) {
    // Read back from the canvas: the glass is clear, the bands are dark.
    h.check(`${h.phase} ${label}: the drawn mask is clear through the glass and dark in the bands`, s.centre < 20 && s.inner < 60 && s.above > 200 && s.below > 200 && s.corner > 200, { centre: s.centre, inner: s.inner, above: s.above, below: s.below, corner: s.corner });
    h.check(`${h.phase} ${label}: the map credit stays readable through the mask (its strip is left clear)`, s.credit === 0, { creditAlpha: s.credit });
  }
  const parts = await h.page.evaluate(binoParts);
  const cy = fig.lenses[0][1];
  const L = fig.lenses;
  if (portrait) {
    const top = parts['.bp-top'], ident = parts['[data-testid="binocular-ident"]'], wheel = parts['[data-testid="binocular-wheel"]'], lower = parts['[data-testid="binocular-lower"]'];
    h.check(`portrait ${label}: the readouts sit in the top band, above the glass`, !!top && !!ident && ident.b <= cy - fig.R + 2 && top.b <= cy - fig.R + 2, { ident, topBand: top, glassTop: cy - fig.R });
    h.check(`portrait ${label}: the thumb controls sit in the bottom band, under the glass`, !!wheel && !!lower && wheel.y >= cy + fig.R - 2 && lower.y >= cy + fig.R - 2, { wheel, lower, glassBottom: cy + fig.R });
  } else {
    const left = parts['.bp-col-left'], right = parts['.bp-col-right'];
    h.check(`landscape ${label}: the readouts and controls sit in the side columns beside the lenses`, !!left && !!right && left.r <= L[0][0] - fig.R + 4 && right.x >= L[1][0] + fig.R - 4, { left, right, lenses: L, R: fig.R });
  }
}

/** The rangefinder on a locked selection: identity, figures (after the pier room's Readouts switch), numerals. */
async function readoutGates(h, g, portrait) {
  const toggle = await g.stableRect('[data-testid="binocular-readouts"]', 1500);
  if (toggle && (await h.page.evaluate(() => document.querySelector('[data-testid="binocular-readouts"]').getAttribute('aria-pressed'))) !== 'true') {
    await h.touch.tap(toggle.x + toggle.w / 2, toggle.y + toggle.h / 2);
    await g.appear('[data-testid="binocular-readout"]');
  }
  const parts = await h.page.evaluate(binoParts);
  const readout = parts['[data-testid="binocular-readout"]'];
  h.check(`${h.phase} binoculars locked: the callsign and the rangefinder figures show (after the Readouts switch where the room has one)`, parts.callsign === 'QAL101' && !!readout, { callsign: parts.callsign, readout, readoutsSwitch: !!toggle });
  h.check(`${h.phase} binoculars locked: the figures are large tabular numerals (>= 16 px)`, parts.fontPx >= 16, { fontPx: parts.fontPx });
  if (portrait) {
    const fig = (await h.page.evaluate(maskSample)).fig;
    h.check('portrait binoculars locked: the figures sit in the top band, never over the glass', !!readout && !!fig && readout.b <= fig.lenses[0][1] - fig.R + 2, { readout, glassTop: fig && fig.lenses[0][1] - fig.R });
  }
}

/** The focus wheel: a preset tap, a continuous drag, a release that settles on a detent. */
async function wheelGates(h, g, axis) {
  const wheel = await g.rect('[data-testid="binocular-wheel"]');
  if (!wheel) return h.check(`${h.phase} focus wheel: present`, false);
  const target = async () => (await g.watch()).target;
  // A preset label is a button: a tap goes straight there.
  const p12 = await g.rect('[data-testid="binocular-preset-12"]');
  if (p12 && p12.x > wheel.x && p12.r < wheel.r && p12.y >= wheel.y - 1 && p12.b <= wheel.b + 1) await h.touch.tap(p12.x + p12.w / 2, p12.y + p12.h / 2);
  else await h.page.evaluate(() => window.__fly.airportWatch.setMagnification(12));
  await h.wait(500);
  const t12 = await target();
  h.check(`${h.phase} focus wheel: tapping the 12x preset sets optics.target to 12`, Math.abs(t12 - 12) < 1e-6, { target: t12, tappedLabel: !!p12 });
  // A drag toward the higher numbers zooms in continuously (no detent near 15.7x).
  const cx = wheel.x + wheel.w / 2, cy = wheel.y + wheel.h / 2;
  const d1 = 40;
  if (axis === 'x') await h.touch.drag(cx + 30, cy, cx + 30 - d1, cy, { steps: 14, ms: 700 });
  else await h.touch.drag(cx, cy - 30, cx, cy - 30 + d1, { steps: 14, ms: 700 });
  await h.wait(600);
  const t1 = await target();
  const expect1 = 12 * Math.exp(d1 / WHEEL.pxPerLog);
  h.check(`${h.phase} focus wheel: a ${d1} px drag zooms in continuously (12x -> about ${expect1.toFixed(1)}x)`, t1 > 13 && Math.abs(t1 - expect1) < 1.6 && !PRESETS.some((p) => Math.abs(t1 - p) < 0.05), { target: t1, expect: expect1 });
  // A short drag that ends within the snap distance of 20x settles exactly on it.
  const toward20 = Math.log(20 / t1) * WHEEL.pxPerLog - 8;
  if (axis === 'x') await h.touch.drag(cx, cy, cx - toward20, cy, { steps: 14, ms: 800 });
  else await h.touch.drag(cx, cy, cx, cy + toward20, { steps: 14, ms: 800 });
  await h.wait(700);
  const t2 = await target();
  h.check(`${h.phase} focus wheel: a release within ${WHEEL.snapPx} px of the 20x detent snaps to exactly 20`, Math.abs(t2 - 20) < 1e-6, { target: t2, draggedPx: Math.round(toward20) });
}

module.exports = {
  name: 'glass',
  // Shared with scratch probes (tablet, desktop); the runner reads only name /
  // portrait / landscape.
  helpers: { pageAudit, maskSample, glass, binoParts },

  async portrait(h) {
    const g = glass(h);
    const { page } = h;
    const insetsOk = await g.setInsets(INSETS.portrait);
    h.info('portrait safe-area emulation', insetsOk ? INSETS.portrait : 'unsupported by this Chromium');
    const insets = insetsOk ? INSETS.portrait : null;
    await h.wait(800);

    // --- layout and contracts ------------------------------------------------
    // Seated, nothing raised or selected (an earlier module may have left the
    // observer standing or the glasses up).
    await g.lowerAll();
    await page.evaluate(() => {
      const w = window.__fly.airportWatch;
      if (w.posture !== 'seated') w.sit(w.seats?.[0]?.id ?? 'window');
    });
    await h.until(() => window.__fly.airportWatch.posture === 'seated', undefined, 15000);
    await h.wait(600);
    h.check('portrait: the lounge is laid out as a phone (data-layout=phone-portrait)', (await g.section('data-layout')) === 'phone-portrait');
    // First-visit coach marks: touch-worded, dismissible, remembered. They fade
    // on their own after a few touches of the view, so when an earlier module
    // has already used the view, the dev handle brings them back to be read.
    const onArrival = await g.shown('[data-testid="lounge-coach"]');
    h.info('portrait: coach marks visible when the GLASS phase began', { onArrival, remembered: await page.evaluate(() => localStorage.getItem('fly-lounge-coach-v1')) });
    if (!onArrival) {
      await page.evaluate(() => window.__flyLoungeCoach?.open());
      await h.wait(600);
    }
    const coach = await g.shown('[data-testid="lounge-coach"]');
    const coachText = coach ? await page.evaluate(() => document.querySelector('[data-testid="lounge-coach"]').textContent) : '';
    h.check('portrait: first-visit coach marks speak touch (drag, pinch, tap, double-tap)', coach && /Drag/.test(coachText) && /Pinch/.test(coachText) && /Tap/.test(coachText) && /Double-tap/.test(coachText) && !/click|scroll|WASD/i.test(coachText), coachText);
    await h.shot('coach');
    // (They fade on their own after a while: bring them back if that just happened.)
    if (!(await g.shown('[data-testid="lounge-coach-dismiss"]'))) {
      await page.evaluate(() => window.__flyLoungeCoach?.open());
      await h.wait(500);
    }
    if (coach) await g.tapEl('[data-testid="lounge-coach-dismiss"]');
    const remembered = await page.evaluate(() => localStorage.getItem('fly-lounge-coach-v1'));
    h.check('portrait: the coach marks dismiss on a tap and are remembered', !(await g.shown('[data-testid="lounge-coach"]')) && remembered === '1', { remembered });

    // Seated idle.
    const head = await g.rect('[data-testid="lounge-header"]');
    const dock = await g.rect('[data-testid="lounge-dock"]');
    h.check('portrait idle: a compact header (<= 60 px tall, inside the width)', !!head && head.h <= 60 && head.x >= 0 && head.r <= h.viewport.width, head);
    const dockItems = await page.evaluate(() => [...document.querySelectorAll('[data-testid="lounge-dock"] > button')].map((b) => b.getAttribute('data-testid')));
    h.check('portrait idle: the thumb dock holds Board, Seats, Binoculars, Follow and More', !!dock && dockItems.join(',') === 'lounge-board-toggle,lounge-seats,lounge-binoculars,lounge-follow,lounge-more', dockItems);
    const fab = await g.rect('[data-testid="lounge-binoculars"]');
    h.check('portrait idle: the binoculars are the big primary action (>= 56 px, centred)', !!fab && fab.w >= 56 && Math.abs(fab.x + fab.w / 2 - h.viewport.width / 2) < 4, fab);
    const peek = await g.rect('[data-testid="lounge-board-peek"]');
    h.check('portrait idle: the live board folds to a one-line peek above the dock', !!peek && peek.h <= 56 && peek.b <= dock.y + 1, { peek, dockTop: dock?.y });
    // The thumb-zone contract (FLY_LOUNGE_MOBILE.md contract 2), measured the way TOUCH reads it.
    const zone = await page.evaluate(() => {
      const s = document.querySelector('.lounge');
      const probe = document.createElement('i');
      probe.style.cssText = 'position:absolute;width:1px;height:1px;left:var(--lounge-stick-left,-999px);bottom:var(--lounge-stick-bottom,-999px)';
      s.appendChild(probe);
      const r = probe.getBoundingClientRect();
      probe.remove();
      return { left: r.left, line: r.bottom, vh: innerHeight, blocked: s.getAttribute('data-thumb-blocked') };
    });
    h.check('portrait idle: the thumb zone is published (--lounge-stick-left / --lounge-stick-bottom) above the dock and the peek', zone.left > 0 && zone.left < 60 && zone.line <= peek.y - 4 && zone.line > h.viewport.height * 0.45 && zone.blocked === '0', { ...zone, peekTop: peek?.y });
    await g.audit('seated idle', { insets });
    await h.shot('idle');

    // The board: peek -> sheet.
    await g.tapEl('[data-testid="lounge-board-peek"] .lpk-main');
    const boardSheet = await g.rect('[data-testid="lounge-board"]');
    h.check('portrait board: the peek opens the board as a bottom sheet above the dock', !!boardSheet && boardSheet.b <= dock.y + 1 && boardSheet.y >= head.b, { boardSheet, dockTop: dock.y, headBottom: head.b });
    h.check('portrait board: the sheet blocks the thumb zone (LoungeTouchControls blocked)', (await g.section('data-thumb-blocked')) === '1');
    await g.audit('board sheet', { insets });
    await h.shot('board');
    await g.tapEl('[data-testid="lounge-board"] .lsheet-grab');
    h.check('portrait board: the grabber folds the sheet back to the peek', !(await g.shown('[data-testid="lounge-board"]')) && (await g.shown('[data-testid="lounge-board-peek"]')));

    // The spotter sheet.
    await page.evaluate(() => window.__fly.airportWatch.select('a1b2c3'));
    await g.appear('[data-testid="spotter-card"]');
    const card = await g.stableRect('[data-testid="spotter-card"]');
    const peekParts = await page.evaluate(() => ({
      binoculars: !!document.querySelector('[data-testid="spotter-binoculars"]')?.offsetWidth,
      follow: !!document.querySelector('[data-testid="spotter-follow"]')?.offsetWidth,
      tiles: !!document.querySelector('[data-testid="spotter-telemetry"]')?.offsetWidth,
      join: !!document.querySelector('[data-testid="spotter-join"]')?.offsetWidth,
      title: document.querySelector('[data-testid="spotter-card"] h2')?.textContent,
      phase: !!document.querySelector('[data-testid="spotter-phase"]')?.offsetWidth,
    }));
    h.check('portrait spotter: the selection opens a peek sheet (callsign, phase, Binoculars, Follow) above the dock', !!card && card.b <= dock.y + 1 && peekParts.title === 'QAL101' && peekParts.binoculars && peekParts.follow && peekParts.phase && !peekParts.tiles && !peekParts.join, { card, ...peekParts });
    h.check('portrait spotter: the board peek steps aside for it', !(await g.shown('[data-testid="lounge-board-peek"]')));
    await g.audit('spotter peek', { insets });
    await h.shot('spotter-peek');
    await g.tapEl('[data-testid="spotter-expand"]');
    await g.appear('[data-testid="spotter-telemetry"]');
    const expanded = await page.evaluate(() => ({ tiles: !!document.querySelector('[data-testid="spotter-telemetry"]')?.offsetWidth, join: !!document.querySelector('[data-testid="spotter-join"]')?.offsetWidth, details: !!document.querySelector('[data-testid="spotter-details"]')?.offsetWidth }));
    const cardX = await g.rect('[data-testid="spotter-card"]');
    h.check('portrait spotter: More expands the sheet to the figures and the minor actions, under the header', expanded.tiles && expanded.join && expanded.details && cardX.y >= head.b, { ...expanded, card: cardX });
    await g.audit('spotter expanded', { insets });
    await h.shot('spotter-expanded');
    // Android Back: the expanded sheet folds first, then the selection clears.
    await g.back('[data-testid="spotter-telemetry"]');
    const afterBack1 = await g.watch();
    h.check('portrait Back: Back folds the expanded spotter sheet first (the selection stays)', afterBack1.selected === 'a1b2c3' && !(await page.evaluate(() => !!document.querySelector('[data-testid="spotter-telemetry"]')?.offsetWidth)), afterBack1);

    // Binoculars on the selection, from the spotter sheet's primary action. The
    // head swings to it first (the field stays wide while slewing), so the
    // figure itself is measured below with nothing to slew to.
    await g.tapEl('[data-testid="spotter-binoculars"]');
    await g.appear('[data-testid="binocular-view"]');
    await h.wait(1200);
    await readoutGates(h, g, true);
    await g.audit('binoculars locked', { insets });
    await h.shot('binoculars');
    // Motion look: drawn exactly when the runtime says the device supports it.
    const w0 = await g.watch();
    const motionShown = await g.shown('[data-testid="binocular-motion"]');
    h.check('portrait binoculars: the motion-look toggle is drawn exactly when runtime motionLook.supported', motionShown === !!w0.motion?.supported, { motionLook: w0.motion, shown: motionShown });
    if (motionShown) {
      await g.tapEl('[data-testid="binocular-motion"]');
      await h.wait(600);
      const m1 = await g.watch();
      const pressed = await page.evaluate(() => document.querySelector('[data-testid="binocular-motion"]')?.getAttribute('aria-pressed'));
      h.check('portrait binoculars: the motion toggle reflects motionLook.active after a tap', pressed === String(!!m1.motion?.active), { pressed, motion: m1.motion });
      if (m1.motion?.active) await g.tapEl('[data-testid="binocular-motion"]');
    }
    await wheelGates(h, g, 'x');
    await h.shot('binoculars-20x');
    // Back lowers the glasses, then clears the selection.
    await g.back('[data-testid="binocular-view"]');
    const afterBack2 = await g.watch();
    h.check('portrait Back: Back lowers the binoculars next (the selection stays)', !afterBack2.binocular && afterBack2.selected === 'a1b2c3' && afterBack2.active, afterBack2);
    await g.back('[data-testid="spotter-card"]');
    const afterBack3 = await g.watch();
    h.check('portrait Back: then Back clears the selection, still in the lounge', !afterBack3.selected && afterBack3.active, afterBack3);
    h.check('portrait Back: at the root a lounge sentinel is still under the current entry (Back never leaves the app)', await page.evaluate(() => !!history.state?.__flyLounge));

    // The figure and the notice: binoculars raised where nothing flies. An
    // upright Safari page has no insets (its bars hold them), so the figure is
    // sized without; the insets of a home-screen app come back after.
    await g.setInsets(null);
    await page.evaluate(() => {
      const w = window.__fly.airportWatch;
      w.resetLook();
      w.dragLook(-2600, 0, innerHeight); // turn well away from both contacts
      w.binoculars(true);
    });
    const settled = await settleBinoculars(h);
    await h.wait(900);
    h.info('portrait binoculars settled (glasses fully up)', settled);
    await figureGates(h, g, true);
    const notice = await g.rect('[data-testid="binocular-notice"]');
    const noticeText = notice ? await page.evaluate(() => document.querySelector('[data-testid="binocular-notice"]').textContent) : null;
    const fig = (await page.evaluate(maskSample)).fig;
    h.check('portrait binoculars: "No aircraft near your line of sight" reads as a line inside the top band', !!notice && /line of sight/.test(noticeText) && !!fig && notice.b <= fig.lenses[0][1] - fig.R + 2 && notice.h <= 44, { notice, noticeText, glassTop: fig && fig.lenses[0][1] - fig.R });
    await g.audit('binoculars notice');
    await h.shot('binoculars-notice');
    if (insets) {
      await g.setInsets(insets);
      await h.wait(900);
      await figureGates(h, g, true, { label: 'binoculars under safe-area insets', sizeGates: false });
      await g.audit('binoculars under safe-area insets', { insets });
      await h.shot('binoculars-insets');
    }
    await g.tapEl('[data-testid="binocular-lower"]');
    h.check('portrait binoculars: Lower (bottom band) lowers the glasses', !(await g.watch()).binocular);
    await page.evaluate(() => window.__fly.airportWatch.resetLook());
    await h.wait(500);

    // The lounge menu: Airports and Leave in two taps.
    await g.tapEl('[data-testid="lounge-menu"]');
    const leave = await g.rect('[data-testid="lounge-leave"]');
    const airports = await g.rect('[data-testid="lounge-airports"]');
    h.check('portrait menu: Leave and Airports are two taps away (header menu, then the button)', !!leave && !!airports && leave.w >= 44 && leave.h >= 44, { leave, airports });
    await g.audit('menu sheet', { insets });
    await h.shot('menu');
    await g.back('[data-testid="lounge-more-sheet"]');
    h.check('portrait Back: Back closes the lounge menu first, still in the lounge', (await g.gone('[data-testid="lounge-more-sheet"]')) && (await g.watch()).active);
    // The dock's More opens the same sheet.
    await g.tapEl('[data-testid="lounge-more"]');
    h.check('portrait menu: the dock\'s More opens the lounge menu too', await g.appear('[data-testid="lounge-more-sheet"]'));
    await g.tapEl('[data-testid="lounge-more-sheet"] .lsheet-close');
    await g.gone('[data-testid="lounge-more-sheet"]');

    // The instruments' airport map (the pier room), from the lounge menu.
    if (await page.evaluate(() => !!window.__fly.airportWatch.observatory)) {
      await g.tapEl('[data-testid="lounge-menu"]');
      await g.tapEl('[data-testid="observatory-open"]');
      await h.wait(600);
      const map = await g.rect('[data-testid="observatory-panel"]');
      h.check('portrait airport map: a sheet between the header and the dock', !!map && map.y >= head.b && map.b <= dock.y + 1 && map.x >= 0 && map.r <= h.viewport.width, { map, headBottom: head.b, dockTop: dock.y });
      await g.audit('airport map', { insets });
      await h.shot('airport-map');
      await g.back('[data-testid="observatory-panel"]');
      h.check('portrait Back: Back closes the airport map', !(await g.shown('[data-testid="observatory-panel"]')) && (await g.watch()).active);
    } else h.info('portrait airport map', 'no instruments in this room');

    // The airport browser on the phone, from the lounge menu.
    await g.tapEl('[data-testid="lounge-menu"]');
    await g.tapEl('[data-testid="lounge-airports"]');
    await h.wait(900);
    const browser = await page.evaluate(() => {
      const b = document.querySelector('[data-testid="airport-browser"]');
      if (!b) return null;
      const r = b.getBoundingClientRect();
      const regions = b.querySelector('.ab-regions');
      const featured = b.querySelector('.ab-featured');
      return {
        x: r.left, r: r.right, y: r.top, b: r.bottom, vw: innerWidth, vh: innerHeight,
        keyboard: document.activeElement?.tagName === 'INPUT',
        featuredVisible: !!b.querySelector('[data-testid="airport-featured-KCMH"]')?.getBoundingClientRect().height && featured.getBoundingClientRect().top < innerHeight,
        regionsScroll: regions ? getComputedStyle(regions).flexWrap === 'nowrap' && regions.scrollWidth > regions.clientWidth : false,
        rowH: Math.min(...[...b.querySelectorAll('.ab-lounge-row')].slice(0, 6).map((e) => e.getBoundingClientRect().height)),
      };
    });
    h.check('portrait browser: a full-height sheet inside the viewport', !!browser && browser.x >= -1 && browser.r <= browser.vw + 1 && browser.b >= browser.vh - 2 && browser.y <= 70, browser);
    h.check('portrait browser: opening it does not raise the keyboard on a touch device', browser && !browser.keyboard);
    h.check('portrait browser: the featured lounges show on open, region chips scroll on one line, rows >= 44 px', browser && browser.featuredVisible && browser.regionsScroll && browser.rowH >= 44, browser);
    await g.audit('airport browser', { insets });
    await h.shot('browser-from-lounge');
    await g.back('[data-testid="airport-browser"]');
    h.check('portrait Back: Back closes the airport browser, still in the lounge', !(await g.shown('[data-testid="airport-browser"]')) && (await g.watch()).active);

    // Seats: the menu as a sheet; standing keeps the thumb zone clear.
    await g.tapEl('[data-testid="lounge-seats"]');
    const menu = await g.rect('[data-testid="lounge-seat-menu"]');
    h.check('portrait seats: the seat menu opens as a bottom sheet above the dock', !!menu && menu.b <= dock.y + 1 && menu.x >= 0 && menu.r <= h.viewport.width, menu);
    const seatFoot = await page.evaluate(() => document.querySelector('[data-testid="lounge-seat-menu"] .lsm-foot')?.textContent ?? '');
    h.check('portrait seats: the seat menu speaks touch (the stick and a tap, not WASD and a click)', /stick/.test(seatFoot) && /Tap/.test(seatFoot) && !/WASD|Click/.test(seatFoot), seatFoot);
    await g.audit('seat menu', { insets });
    await h.shot('seats');
    const seatBack = await g.back('[data-testid="lounge-seat-menu"]');
    h.check('portrait Back: Back closes the seat menu', seatBack && !(await g.shown('[data-testid="lounge-seat-menu"]')) && (await g.watch()).active);
    await page.evaluate(() => window.__fly.airportWatch.stand());
    await h.until(() => window.__fly.airportWatch.posture === 'standing', undefined, 30000);
    await h.wait(900);
    const free = await page.evaluate(() => {
      const s = document.querySelector('.lounge');
      const probe = document.createElement('i');
      probe.style.cssText = 'position:absolute;width:1px;height:1px;left:var(--lounge-stick-left);bottom:var(--lounge-stick-bottom)';
      s.appendChild(probe);
      const line = probe.getBoundingClientRect().bottom;
      probe.remove();
      const zone = { x: 0, y: line - 180, r: innerWidth * 0.42, b: line };
      const hits = [];
      for (const el of s.querySelectorAll('.lounge-header, .lounge-dock, .lounge-peek, .lounge-board, .lounge-card, .lounge-sit, .lounge-decor-prompt, .observatory-prompt, .observatory-nearby, .dir-cue, .lounge-menu-sheet, .lounge-seat-menu')) {
        const r = el.getBoundingClientRect();
        if (r.width < 1 || getComputedStyle(el).visibility === 'hidden') continue;
        if (r.left < zone.r && r.right > zone.x && r.top < zone.b && r.bottom > zone.y) hits.push(el.className.split(' ')[0]);
      }
      return { zone, hits, posture: s.getAttribute('data-posture') };
    });
    h.check('portrait standing: the lower-left thumb zone above the dock is free of persistent chrome', free.posture === 'standing' && free.hits.length === 0, free);
    await g.audit('standing', { insets });
    await h.shot('standing');
    // Back to the window seat for the landscape phase.
    await page.evaluate(() => {
      const w = window.__fly.airportWatch;
      w.sit(w.seats?.[0]?.id ?? 'window');
    });
    await h.until(() => window.__fly.airportWatch.posture === 'seated', undefined, 15000);
    await g.setInsets(null);
  },

  async landscape(h) {
    const g = glass(h);
    const { page } = h;
    const insetsOk = await g.setInsets(INSETS.landscape);
    const insets = insetsOk ? INSETS.landscape : null;
    await g.lowerAll();
    await h.wait(900);
    h.check('landscape: the lounge is laid out as a phone (data-layout=phone-landscape)', (await g.section('data-layout')) === 'phone-landscape');
    const rail = await g.rect('[data-testid="lounge-dock"]');
    h.check('landscape: the dock is a rail down the right edge, inside the width', !!rail && rail.h > rail.w && rail.r <= h.viewport.width && rail.x > h.viewport.width * 0.7, rail);
    const fab = await g.rect('[data-testid="lounge-binoculars"]');
    h.check('landscape: the binoculars sit at the foot of the rail, under the right thumb', !!fab && fab.y > rail.y + rail.h * 0.6, { fab, rail });
    await g.audit('seated idle', { insets });
    await h.shot('idle');
    // Board as a side sheet.
    await g.tapEl('[data-testid="lounge-board-toggle"]');
    const board = await g.rect('[data-testid="lounge-board"]');
    h.check('landscape board: a side sheet beside the rail (<= 370 px wide, never over it)', !!board && board.w <= 370 && board.r <= rail.x + 1, { board, railX: rail.x });
    await g.audit('board sheet', { insets });
    await h.shot('board');
    await g.tapEl('[data-testid="lounge-board-toggle"]');
    // Spotter.
    await page.evaluate(() => window.__fly.airportWatch.select('a1b2c3'));
    await h.wait(900);
    const card = await g.rect('[data-testid="spotter-card"]');
    h.check('landscape spotter: the card is a side sheet beside the rail', !!card && card.r <= rail.x + 1 && card.w <= 370, card);
    await g.audit('spotter', { insets });
    await h.shot('spotter');
    // Binoculars on the lock: the readouts and the vertical wheel.
    await g.tapEl('[data-testid="spotter-binoculars"]');
    await g.appear('[data-testid="binocular-view"]');
    await h.wait(1200);
    await readoutGates(h, g, false);
    await g.audit('binoculars locked', { insets });
    await h.shot('binoculars');
    await wheelGates(h, g, 'y');
    await h.shot('binoculars-20x');
    await g.back('[data-testid="binocular-view"]');
    h.check('landscape Back: Back lowers the binoculars', !(await g.watch()).binocular && (await g.watch()).active);
    await g.back('[data-testid="spotter-card"]');
    h.check('landscape Back: then clears the selection', !(await g.watch()).selected && (await g.watch()).active);
    // The twin-lens figure, raised where nothing flies.
    await page.evaluate(() => {
      const w = window.__fly.airportWatch;
      w.resetLook();
      w.dragLook(-2600, 0, innerHeight);
      w.binoculars(true);
    });
    h.info('landscape binoculars settled (glasses fully up)', await settleBinoculars(h));
    await h.wait(900);
    await figureGates(h, g, false);
    await g.audit('binoculars', { insets });
    await h.shot('binoculars-figure');
    await g.tapEl('[data-testid="binocular-lower"]');
    h.check('landscape binoculars: Lower lowers the glasses', !(await g.watch()).binocular);
    await page.evaluate(() => window.__fly.airportWatch.resetLook());
    // Menu.
    await g.tapEl('[data-testid="lounge-menu"]');
    h.check('landscape menu: Leave is two taps away', await g.shown('[data-testid="lounge-leave"]'));
    await g.audit('menu sheet', { insets });
    await h.shot('menu');
    await g.back('[data-testid="lounge-more-sheet"]');
    // The airport browser on a phone held sideways.
    await g.tapEl('[data-testid="lounge-menu"]');
    await g.tapEl('[data-testid="lounge-airports"]');
    await g.appear('[data-testid="airport-browser"]');
    await h.wait(700);
    const browser = await g.stableRect('[data-testid="airport-browser"]');
    const featured = await g.rect('[data-testid="airport-featured-KCMH"]');
    h.check('landscape browser: a full-height sheet inside the width, the featured lounges in view', !!browser && browser.x >= -1 && browser.r <= h.viewport.width + 1 && browser.b >= h.viewport.height - 2 && !!featured && featured.y < h.viewport.height, { browser, featured });
    await g.audit('airport browser', { insets });
    await h.shot('browser');
    await g.back('[data-testid="airport-browser"]');
    h.check('landscape Back: Back closes the airport browser, still in the lounge', !(await g.shown('[data-testid="airport-browser"]')) && (await g.watch()).active);
    // Seats.
    await g.tapEl('[data-testid="lounge-seats"]');
    const seats = await g.rect('[data-testid="lounge-seat-menu"]');
    h.check('landscape seats: the seat menu is a side sheet beside the rail', !!seats && seats.r <= rail.x + 1, seats);
    await g.audit('seat menu', { insets });
    await h.shot('seats');
    await g.back('[data-testid="lounge-seat-menu"]');
    await g.setInsets(null);
  },
};
