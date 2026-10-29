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
// visible chrome boxes overlap except the intended layering (the walk stick's
// ring and label count as chrome); nothing sits outside the viewport
// horizontally; no control sits under an emulated safe-area inset; the
// status line and the binocular notice never wrap one word per line; and on
// a phone nothing over the live canvas carries a backdrop blur. Safe areas
// are emulated through CDP
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
    // The walk stick (TOUCH's): the seated Walk ring and its label, the standing ring.
    '.lounge .lounge-stick', '.lounge .lounge-stick-label',
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
  // Phones: nothing over the live canvas blurs it (a backdrop-filter re-reads
  // the framebuffer every frame; lounge-mobile.css's header).
  const blurred = [];
  const phone = document.querySelector('.lounge[data-layout^="phone"]');
  if (phone) {
    for (const el of phone.querySelectorAll('*')) {
      const cs = getComputedStyle(el);
      const f = cs.backdropFilter || cs.webkitBackdropFilter || 'none';
      if (f === 'none' || !visible(el)) continue;
      blurred.push(`${name(el)}: ${f}`);
    }
  }
  return { label, vw, vh, controls: controls.length, small, overlaps, overflow, inSafe, wraps, blurred, phone: !!phone, sit: !!document.querySelector('.lounge .lounge-sit') };
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
  /** On screen without scrolling: inside the viewport and inside every scrolling ancestor's visible box. */
  const inView = (sel) => page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.top < 0 || r.left < 0 || r.bottom > innerHeight || r.right > innerWidth) return false;
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (!/(auto|scroll|hidden)/.test(cs.overflowX + cs.overflowY)) continue;
      const c = p.getBoundingClientRect();
      if (r.top < c.top - 0.5 || r.bottom > c.bottom + 0.5 || r.left < c.left - 0.5 || r.right > c.right + 0.5) return false;
    }
    return true;
  }, sel);
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
    await page.evaluate((s) => document.querySelector(s)?.scrollIntoView({ block: 'nearest', inline: 'nearest' }), sel);
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
    if (a.phone) h.check(`${h.phase} ${label}: no backdrop blur over the live canvas (phone)`, a.blurred.length === 0, { blurred: a.blurred.slice(0, 6), sitPrompt: a.sit });
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
  return { tid, rect, shown, inView, stableRect, gone, appear, tapEl, setInsets, audit, watch, section, back, lowerAll };
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
  // Below the glass, above the map credit (whose strip the mask leaves clear).
  const gap = (credit?.width ? credit.top : innerHeight) - (cy + fig.R);
  return {
    credit: credit?.width ? a(credit.left + credit.width / 2, credit.top + credit.height / 2) : null,
    fig,
    vw: innerWidth,
    vh: innerHeight,
    centre: a(mid[0], mid[1]),
    inner: a(L[0][0] - fig.R * 0.8, cy),
    above: a(mid[0], Math.max(2, cy - fig.R - 14)),
    below: gap >= 6 ? a(mid[0], cy + fig.R + Math.min(14, gap / 2)) : null,
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
    h.check(`${h.phase} ${label}: the drawn mask is clear through the glass and dark in the bands`, s.centre < 20 && s.inner < 60 && s.above > 200 && (s.below == null || s.below > 200) && s.corner > 200, { centre: s.centre, inner: s.inner, above: s.above, below: s.below, corner: s.corner });
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

/*
 * The runner flies QAL101 in from 7 km on its own clock (t0), so it passes
 * over the lounge about two minutes after arrival. A GLASS phase that starts
 * later than that (after the TOUCH module, or on a slow machine) would find
 * nothing ahead to lock onto, and the director would lower the glasses on a
 * session that ended mid-check. For the length of each GLASS phase the
 * inbound is re-staged on the phase's own clock: 8 km out on the same bearing,
 * level at the same height, and slow (18 m/s), so it stays in the glass for
 * the whole phase. The runner's own fixture comes back when the phase ends, so
 * whatever runs after this module sees the feed the runner wrote. (The
 * runner's fixture reads each contact's lat / lon / altFt on every poll, so
 * getters move the contact on the phase's clock.)
 */
async function restage(h, hex = 'a1b2c3') {
  const c = (h.contacts || []).find((x) => x.hex === hex);
  if (!c) return () => {};
  const g = await h.page.evaluate(() => {
    const r = window.__fly, w = r.airportWatch, k = w.frame.k, e = w.eyeWorld();
    const facing = ((-w.roomHeading * 180) / Math.PI + 360) % 360;
    const a = w.roomHeading + 0.12, range = 8000;
    const geo = r.engine.worldToGeo({ x: e.x - Math.sin(a) * range * k, y: 0, z: e.z - Math.cos(a) * range * k });
    const track = (facing + 180) % 360, tr = (track * Math.PI) / 180, gs = 18;
    return { lat: geo.y, lon: geo.x, vLat: (gs * Math.cos(tr)) / 111320, vLon: (gs * Math.sin(tr)) / (111320 * Math.cos((geo.y * Math.PI) / 180)), altFt: (e.y + 380) * 3.28084, gsKt: gs * 1.943844, track };
  }).catch(() => null);
  if (!g) return () => {};
  const saved = { lat: c.lat, lon: c.lon, dLat: c.dLat, dLon: c.dLon, altFt: c.altFt, vsFpm: c.vsFpm, gsKt: c.gsKt, track: c.track };
  const t1 = Date.now();
  const at = () => (Date.now() - t1) / 1000;
  Object.defineProperties(c, {
    lat: { get: () => g.lat + g.vLat * at(), configurable: true, enumerable: true },
    lon: { get: () => g.lon + g.vLon * at(), configurable: true, enumerable: true },
  });
  Object.assign(c, { dLat: 0, dLon: 0, altFt: g.altFt, vsFpm: 0, gsKt: g.gsKt, track: g.track });
  h.info(`${h.phase}: QAL101 re-staged for this phase (8 km out on the same bearing, level, 18 m/s inbound)`);
  return () => {
    Object.defineProperties(c, {
      lat: { value: saved.lat, writable: true, configurable: true, enumerable: true },
      lon: { value: saved.lon, writable: true, configurable: true, enumerable: true },
    });
    Object.assign(c, saved);
  };
}

/**
 * Raise the glasses where nothing flies. A drag turns by the live field of
 * view and the head springs after it, so: lower and face the runway, let the
 * field come back to the naked eye, turn well away, let the head arrive (the
 * auto-acquire looks where the head IS), then raise. If the glasses still
 * found an aircraft (it was on that side), the other way. Returns the drag
 * that left nothing in the cone (null if neither did).
 */
async function raiseWhereNothingFlies(h) {
  const { page } = h;
  for (const dx of [-2600, 2600]) {
    await page.evaluate(() => {
      const w = window.__fly.airportWatch;
      w.binoculars(false);
      w.clearSelection();
      w.resetLook();
    });
    await h.until(() => (window.__fly.airportWatch.optics?.mag ?? 1) < 1.05, undefined, 20000);
    await page.evaluate((d) => window.__fly.airportWatch.dragLook(d, 0, innerHeight), dx);
    let last = null;
    for (let i = 0; i < 40; i++) {
      await h.wait(400);
      const yaw = await page.evaluate(() => window.__fly.airportWatch.yaw);
      if (last != null && Math.abs(yaw - last) < 0.002) break;
      last = yaw;
    }
    await page.evaluate(() => window.__fly.airportWatch.binoculars(true));
    if (!(await page.evaluate(() => window.__fly.airportWatch.selected))) return dx;
  }
  return null;
}

/**
 * Before the wheel gates: the glasses must still be up. Anything in the scene
 * that lowered them (the director ending a session on the selection) is
 * reported, and the glasses go back up without a target.
 */
async function keepGlassesUp(h, g) {
  if ((await g.watch()).binocular) return;
  h.info(`${h.phase}: the scene lowered the glasses before the wheel gates (raised again, no target)`, await h.page.evaluate(() => window.__fly.airportWatch.notice ?? null));
  await h.page.evaluate(() => window.__fly.airportWatch.binoculars(true, { acquire: false }));
  await g.appear('[data-testid="binocular-view"]');
  await h.wait(600);
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

/*
 * One sub-section of a phase: a throw records a FAIL and the phase goes on
 * (one stuck step must not drop every gate after it), and `after` puts the
 * lounge back to a calm state whatever happened.
 */
async function section(h, name, fn, after) {
  try {
    await fn();
  } catch (e) {
    h.check(`${h.phase} ${name}: ran to the end`, false, String(e?.message || e).slice(0, 300));
  }
  if (after) {
    try {
      await after();
    } catch (e) {
      h.info(`${h.phase} ${name}: the clean-up after it threw`, String(e?.message || e).slice(0, 200));
    }
  }
}

/** The phone's resting pose, nudged: a real phone keeps reporting while motion look listens. */
function orient(page, alpha = 2, beta = 88, gamma = 0) {
  return page.evaluate(([a, b, c]) => window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha: a, beta: b, gamma: c })), [alpha, beta, gamma]).catch(() => {});
}

/**
 * Motion look end to end (FLY_LOUNGE_MOBILE.md contract 3), from the toggle:
 * enabled from the tap itself, the active state on the button, off from the
 * button, off when the glasses come down, and the notice when the browser
 * refuses the permission (iOS's requestPermission, stubbed to 'denied'). A
 * toggle that went away (a sensorless device: no orientation within the
 * probe) is the withdrawal path, never a crash.
 */
async function motionGates(h, g) {
  const { page } = h;
  const w0 = await g.watch();
  const shown = await g.shown('[data-testid="binocular-motion"]');
  h.check(`${h.phase} binoculars: the motion-look toggle is drawn exactly when runtime motionLook.supported`, shown === !!w0.motion?.supported, { motionLook: w0.motion, shown });
  if (!shown) return;
  const pressed = () => page.evaluate(() => document.querySelector('[data-testid="binocular-motion"]')?.getAttribute('aria-pressed') ?? null);
  const withdrawn = async () => {
    const m = (await g.watch()).motion;
    const notice = await page.evaluate(() => document.querySelector('[data-testid="binocular-notice"]')?.textContent ?? '');
    return !m?.supported && /does not report its orientation/.test(notice);
  };
  // Refused first (iOS asks once a session: after a grant, enable() never
  // asks again): the prompt answers 'denied', the toggle stays off and the
  // band says why. Chromium has requestPermission too and grants it, so the
  // stub stands in for the person tapping Don't Allow.
  if (await page.evaluate(() => !!window.__fly.airportWatch.motionLook?.needsPermission)) {
    await page.evaluate(() => {
      window.__glassPermission = window.DeviceOrientationEvent.requestPermission;
      window.DeviceOrientationEvent.requestPermission = () => Promise.resolve('denied');
    });
    try {
      await g.tapEl('[data-testid="binocular-motion"]');
      await h.wait(400);
      const denied = await g.watch();
      const notice = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="binocular-notice"]');
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { text: el.textContent, y: r.top, b: r.bottom, h: r.height };
      });
      h.check(`${h.phase} binoculars: a refused permission leaves motion look off and says why`, !denied.motion?.active && (await pressed()) === 'false' && !!notice && /motion|orientation/i.test(notice.text), { motion: denied.motion, notice });
    } finally {
      await page.evaluate(() => {
        if (window.__glassPermission) window.DeviceOrientationEvent.requestPermission = window.__glassPermission;
        else delete window.DeviceOrientationEvent.requestPermission;
        delete window.__glassPermission;
      });
    }
  } else h.info(`${h.phase} binoculars: motion look's permission was already granted this session (iOS asks once); the refusal path is not re-askable here`);
  // On.
  await g.tapEl('[data-testid="binocular-motion"]');
  await orient(page);
  await h.wait(500);
  const on = await g.watch();
  if (!(await g.shown('[data-testid="binocular-motion"]'))) {
    h.check(`${h.phase} binoculars: a motion toggle that went away is the sensorless path (the notice says so)`, await withdrawn(), on.motion);
    await page.evaluate(() => window.__fly.airportWatch.motionLook?.disable?.());
    return;
  }
  h.check(`${h.phase} binoculars: a tap on Motion turns motion look on (enabled from the tap) and the toggle shows it`, !!on.motion?.active && (await pressed()) === 'true', { motion: on.motion, pressed: await pressed() });
  // Off from the button.
  await g.tapEl('[data-testid="binocular-motion"]');
  const off = await g.watch();
  h.check(`${h.phase} binoculars: a second tap turns it off`, !off.motion?.active && (await pressed()) === 'false', { motion: off.motion, pressed: await pressed() });
  // Off when the glasses come down (and the next raise starts with it off).
  await g.tapEl('[data-testid="binocular-motion"]');
  await orient(page, 3);
  await h.wait(300);
  const again = (await g.watch()).motion;
  await page.evaluate(() => window.__fly.airportWatch.binoculars(false));
  await h.until(() => !window.__fly.airportWatch.motionLook?.active, undefined, 6000);
  const down = await g.watch();
  h.check(`${h.phase} binoculars: lowering the glasses turns motion look off`, !!again?.active && !down.motion?.active && !down.binocular, { before: again, after: down.motion });
  await page.evaluate(() => window.__fly.airportWatch.select('a1b2c3', { binoculars: true }));
  await g.appear('[data-testid="binocular-view"]');
  await h.wait(600);
}

/**
 * The portrait top band with everything in it: the pier room's Readouts on, a
 * lock, motion look supported (its toggle in the bottom band too). Every
 * piece of the band starts at or below the top inset + 8 and ends above the
 * glass; the Readouts switch is a labelled control of >= 44 px; and a notice
 * that comes now (motion look refused: two lines) floats over the foot of the
 * glass instead of pushing the band up.
 */
async function topBandGates(h, g, label, insets) {
  const { page } = h;
  const safeTop = insets?.top ?? 0;
  const m = await page.evaluate(() => {
    const fig = JSON.parse(document.querySelector('[data-testid="binocular-mask"]')?.dataset.figure || 'null');
    const top = document.querySelector('.bp-top');
    if (!top || !fig) return null;
    const parts = [];
    for (const el of top.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1 || getComputedStyle(el).visibility === 'hidden') continue;
      // The tape's ribbon runs off both ends by design (masked): its height is what counts.
      parts.push({ name: el.getAttribute('data-testid') || String(el.className || el.tagName).split(' ')[0], y: Math.round(r.top * 10) / 10, b: Math.round(r.bottom * 10) / 10 });
    }
    const ro = document.querySelector('[data-testid="binocular-readouts"]');
    const rr = ro?.getBoundingClientRect();
    return {
      glassTop: fig.lenses[0][1] - fig.R,
      parts,
      motion: !!document.querySelector('[data-testid="binocular-motion"]'),
      readouts: ro ? { w: rr.width, h: rr.height, text: ro.textContent.trim(), inTop: top.contains(ro), pressed: ro.getAttribute('aria-pressed') } : null,
      figures: !!document.querySelector('[data-testid="binocular-readout"]'),
    };
  });
  if (!m) return h.check(`portrait ${label}: the top band and the figure are there`, false);
  const high = m.parts.filter((p) => p.y < safeTop + 8 - 0.5);
  const low = m.parts.filter((p) => p.b > m.glassTop + 2);
  h.check(`portrait ${label}: with Motion and Readouts both there, nothing in the top band sits above the inset + 8 px`, m.motion && !!m.readouts && high.length === 0, { safeTop, motion: m.motion, readouts: !!m.readouts, high: high.slice(0, 6) });
  h.check(`portrait ${label}: ... and nothing in it runs onto the glass`, low.length === 0, { glassTop: m.glassTop, low: low.slice(0, 6) });
  h.check(`portrait ${label}: the Readouts switch is a labelled control (>= 44 px, "Readouts") in the thumb's band, not the top band`, !!m.readouts && m.readouts.w >= 43.5 && m.readouts.h >= 43.5 && /readouts/i.test(m.readouts.text) && !m.readouts.inTop, m.readouts);
  h.check(`portrait ${label}: the figures show (Readouts on)`, m.figures);
}

/**
 * The thumb's corner while the walk stick shows: the coach marks (forced open
 * through the dev handle), a status line and a director lower third (each a
 * probe element with the real classes, measured through the real cascade and
 * removed) never cover the stick — seated, its Walk ring and its label;
 * standing, the zone a thumb may start it in — and the coach's first tip has
 * no stick under it.
 */
async function floatsClearOfStick(h, g, label, { dismiss = true } = {}) {
  const { page } = h;
  // Standing by a chair the Sit prompt is itself the hint and the tips step
  // aside for it (by design): walk off with the stick until no place prompt
  // is up, so the tips can be measured standing.
  if ((await g.watch()).posture === 'standing') {
    const prompt = () => page.evaluate(() => !!document.querySelector('.lounge :is(.lounge-sit, .lounge-decor-prompt, .observatory-prompt, .observatory-nearby)'));
    for (const [dx, dy] of [[0, 46], [-40, 30], [40, 30], [0, 46]]) {
      if (!(await prompt())) break;
      const z = await g.rect('.lounge-stick-zone');
      if (!z) break;
      await h.touch.push(z.x + 80, z.b - 80, z.x + 80 + dx, z.b - 80 + dy, 1600);
      await h.wait(600);
    }
    h.info(`${h.phase} ${label}: walked clear of the place prompts for the tips`, { prompt: await prompt() });
  }
  await page.evaluate(() => window.__flyLoungeCoach?.open());
  await g.appear('[data-testid="lounge-coach"]', 4000);
  await h.wait(400);
  const m = await page.evaluate(() => {
    const box = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return r.width < 1 ? null : { x: r.left, y: r.top, r: r.right, b: r.bottom };
    };
    const s = document.querySelector('.lounge');
    const stick = document.querySelector('[data-testid="lounge-stick"]');
    const ring = box(stick);
    const label = box(stick?.querySelector('.lounge-stick-label'));
    const zone = box(document.querySelector('.lounge-stick-zone'));
    const posture = s.getAttribute('data-posture');
    const probe = (cls, inner) => {
      const el = document.createElement(inner ? 'div' : 'p');
      el.className = cls;
      el.style.transform = cls.includes('lounge-status') ? 'translateX(-50%)' : '';
      if (inner) el.innerHTML = `<div class="dir-lower"><span>Touchdown · QAL101 on runway 28L</span></div>`;
      else el.textContent = 'A status line long enough to take most of a phone’s width';
      s.appendChild(el);
      const r = box(el);
      el.remove();
      return r;
    };
    const coachEl = document.querySelector('[data-testid="lounge-coach"]');
    const tip = coachEl?.querySelector('li');
    const tr = tip?.getBoundingClientRect();
    const under = tr ? document.elementsFromPoint(tr.left + tr.width / 2, tr.top + tr.height / 2).map((e) => e.getAttribute('data-testid') || String(e.className || '').split(' ')[0]) : [];
    return {
      posture,
      show: document.querySelector('.lounge-touch')?.getAttribute('data-show'),
      ring, label, zone,
      coach: box(coachEl),
      status: probe('lounge-status airport-status'),
      lower: probe('dir-lower-slot', true),
      under,
    };
  });
  const hit = (a, b) => !!a && !!b && Math.min(a.r, b.r) - Math.max(a.x, b.x) > 1 && Math.min(a.b, b.b) - Math.max(a.y, b.y) > 1;
  const standing = m.posture === 'standing';
  const guard = standing ? [m.zone, m.ring] : [m.ring, m.label];
  const floats = { coach: m.coach, status: m.status, lower: m.lower };
  const over = Object.entries(floats).filter(([, r]) => guard.some((gd) => hit(r, gd))).map(([k]) => k);
  h.check(`${h.phase} ${label}: the walk stick shows, and the coach marks, the status line and the lower thirds keep out of its ${standing ? 'zone' : 'Walk ring'}`, m.show === '1' && !!m.ring && !!m.coach && over.length === 0, { posture: m.posture, show: m.show, over, ring: m.ring, zone: standing ? m.zone : undefined, ...floats });
  h.check(`${h.phase} ${label}: no part of the stick lies under the coach's first tip (a first touch there is a look, not a walk)`, !m.under.some((n) => /lounge-stick/.test(n)), m.under.slice(0, 6));
  if (dismiss) await page.evaluate(() => document.querySelector('[data-testid="lounge-coach-dismiss"]')?.click());
}

/**
 * A wheel flick then Lower straight away: the glide stops with the glasses
 * (it used to keep setting the power and raise them again). The flick is a
 * burst of synthetic touch pointer events on the wheel, and Lower is clicked
 * in the same task, before the glide's first frame.
 */
async function wheelGlideGate(h, g, axis) {
  const { page } = h;
  const r = await page.evaluate((ax) => {
    const wheel = document.querySelector('[data-testid="binocular-wheel"]');
    const lower = document.querySelector('[data-testid="binocular-lower"]');
    if (!wheel || !lower) return { ran: false };
    window.__fly.airportWatch.setMagnification(7);
    const b = wheel.getBoundingClientRect();
    const cx = b.left + b.width / 2, cy = b.top + b.height / 2;
    const ev = (type, d) => wheel.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 71, pointerType: 'touch', isPrimary: true, clientX: ax === 'x' ? cx - d : cx, clientY: ax === 'x' ? cy : cy + d }));
    ev('pointerdown', 0);
    for (let i = 1; i <= 8; i++) ev('pointermove', i * 6);
    ev('pointerup', 48);
    lower.click();
    return { ran: true, after: window.__fly.airportWatch.binocular };
  }, axis);
  await h.wait(700);
  const w = await g.watch();
  h.check(`${h.phase} focus wheel: a flick then Lower at once — the glasses stay down (the glide stops with them)`, r.ran && r.after === false && !w.binocular && w.target === 1, { ...r, binocular: w.binocular, target: w.target });
}

/**
 * The game's own reduced-motion setting (Settings, `fly-reduced-motion`),
 * with the OS setting off: the phone HUD stamps data-reduced and the lounge
 * menu sheet arrives without its spring (no transform on its first frame).
 */
async function reducedMotionGate(h, g) {
  const { page } = h;
  await page.evaluate(() => localStorage.setItem('fly-reduced-motion', '1'));
  try {
    const stamped = await h.until(() => document.querySelector('.lounge')?.getAttribute('data-reduced') === '1', undefined, 5000);
    const more = await g.rect('[data-testid="lounge-more"]');
    if (!more) return h.check(`${h.phase} reduced motion: the dock's More is there to open the menu`, false);
    const first = await page.evaluate(() => new Promise((resolve) => {
      document.querySelector('[data-testid="lounge-more"]').click();
      requestAnimationFrame(() => {
        const el = document.querySelector('[data-testid="lounge-more-sheet"]');
        resolve(el ? { transform: getComputedStyle(el).transform, inline: el.style.transform || '' } : null);
      });
    }));
    h.check(`${h.phase} reduced motion (the game's setting): data-reduced is stamped and the menu sheet has no slide on its first frame`, stamped && !!first && (first.transform === 'none' || /^matrix\(1, 0, 0, 1, 0, 0\)$/.test(first.transform)), { stamped, first });
    await g.back('[data-testid="lounge-more-sheet"]');
  } finally {
    await page.evaluate(() => localStorage.setItem('fly-reduced-motion', '0'));
    await h.until(() => !document.querySelector('.lounge')?.hasAttribute('data-reduced'), undefined, 5000);
  }
}

/** No two visible buttons of the dock and the spotter sheet answer to the same name (two "More"s did two different things). */
async function labelsGate(h, label) {
  const m = await h.page.evaluate(() => {
    const seen = [];
    for (const el of document.querySelectorAll('[data-testid="lounge-dock"] button, [data-testid="spotter-card"] button')) {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if (r.width < 1 || cs.visibility === 'hidden' || cs.display === 'none') continue;
      const strong = el.querySelector('strong')?.textContent;
      const name = (el.getAttribute('aria-label') || strong || el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
      seen.push({ id: el.getAttribute('data-testid'), name });
    }
    return seen;
  });
  const dupes = m.filter((a, i) => m.findIndex((b) => b.name === a.name) !== i);
  h.check(`${h.phase} ${label}: no two visible dock / card buttons share a name`, m.length > 0 && dupes.length === 0, { buttons: m, dupes });
  return m;
}

/**
 * A phone held sideways, standing, with a side sheet up (the spotter card,
 * then the board): the sheet keeps clear of the walk stick's zone, so the
 * stick stays up (data-thumb-blocked 0) and a push walks.
 */
async function sideSheetStickGates(h, g) {
  const { page } = h;
  await page.evaluate(() => window.__fly.airportWatch.stand());
  await h.until(() => window.__fly.airportWatch.posture === 'standing', undefined, 30000);
  await h.wait(600);
  for (const [label, open, sel] of [
    ['the spotter card', () => page.evaluate(() => window.__fly.airportWatch.select('a1b2c3')), '[data-testid="spotter-card"]'],
    ['the board', async () => {
      await page.evaluate(() => window.__fly.airportWatch.clearSelection());
      await g.tapEl('[data-testid="lounge-board-toggle"]');
    }, '[data-testid="lounge-board"]'],
  ]) {
    await open();
    await g.appear(sel);
    const sheet = await g.stableRect(sel);
    const m = await page.evaluate(() => {
      const z = document.querySelector('.lounge-stick-zone')?.getBoundingClientRect();
      return {
        blocked: document.querySelector('.lounge')?.getAttribute('data-thumb-blocked'),
        stick: !!document.querySelector('[data-testid="lounge-stick"]')?.getBoundingClientRect().width,
        zone: z && z.width ? { x: z.left, y: z.top, r: z.right, b: z.bottom } : null,
      };
    });
    const clear = !!sheet && !!m.zone && (sheet.x >= m.zone.r - 1 || sheet.b <= m.zone.y + 1);
    h.check(`landscape standing with ${label} open: the side sheet keeps clear of the stick's zone and the stick stays up`, m.blocked === '0' && m.stick && clear, { ...m, sheet });
    if (label === 'the spotter card' && m.zone) {
      const before = await h.state();
      const x = m.zone.x + 80, y = m.zone.b - 80;
      await h.touch.push(x, y, x, y - 46, 1400);
      await h.wait(300);
      const after = await h.state();
      const moved = before?.eye && after?.eye ? Math.hypot(after.eye.x - before.eye.x, after.eye.z - before.eye.z) : 0;
      h.check('landscape standing with the spotter card open: a push on the stick walks', moved > 0.15 && after.selected === 'a1b2c3', { moved: Number(moved.toFixed(3)), selected: after?.selected });
    }
    await h.shot(`standing-${label === 'the board' ? 'board' : 'spotter'}`);
  }
  await page.evaluate(() => window.__fly.airportWatch.clearSelection());
  if (await g.shown('[data-testid="lounge-board"]')) await g.tapEl('[data-testid="lounge-board-toggle"]');
}

/**
 * The flight HUD's Back chain and the lounge's together (the blocker: the
 * Atlas's "Watch an airport" pill dropped the player on the title). From
 * flight (the harness skip: airborne by the field), on the phone:
 *  (b) Atlas -> the pill -> the browser's X: the Atlas stays, and one Back
 *      then closes it;
 *  (c) Atlas -> the pill -> Back: the browser closes, the Atlas stays; Back
 *      closes the Atlas;
 *  (a) Atlas -> the pill -> KCMH: the lounge is still up 3 s after it
 *      validates, a lounge sentinel on top, and one Back follows the lounge's
 *      order (the menu sheet first), still in the lounge.
 * It ends back in the KCMH lounge, so the runner's closing checks hold.
 */
async function atlasEntryGates(h, g) {
  const { page } = h;
  const atlasOpen = () => page.evaluate(() => !!window.__flyStore.getState().atlasOpen);
  const top = () => page.evaluate(() => ({ overlay: !!history.state?.__flyOverlay, lounge: !!history.state?.__flyLounge }));
  // Leave for the title, then fly from the field.
  await page.evaluate(() => window.__fly.airportWatch.exit?.());
  await page.getByTestId('title-screen').waitFor({ state: 'visible', timeout: 120000 });
  await page.evaluate(() => {
    const rt = window.__fly, st = window.__flyStore.getState();
    rt.operations.phase = 'airborne';
    rt.operations.profile = null;
    rt.operations.warp(rt.flight);
    st.setHangarOpen(false);
    rt.warpToGeo(39.9980, -82.8919, { altM: 900, headingRad: 0, name: null });
  });
  const flying = await h.until(() => window.__flyStore.getState().screen === 'flight' && !window.__flyStore.getState().airportWatch, undefined, 60000);
  h.check(`${h.phase} Back chains: in flight on the phone (the harness's airborne skip)`, flying);
  await h.wait(2500);
  const openAtlas = async () => {
    await page.evaluate(() => window.__flyStore.getState().setAtlasOpen(true));
    await g.appear('[data-testid="watch-airport"]', 20000);
    await h.wait(600);
  };
  const openPill = async () => {
    await g.tapEl('[data-testid="watch-airport"]');
    await g.appear('[data-testid="airport-browser"]', 20000);
    await h.wait(700);
  };
  // (b) the browser's X keeps the Atlas.
  await openAtlas();
  await openPill();
  await g.tapEl('[aria-label="Close airport search"]');
  await g.gone('[data-testid="airport-browser"]');
  await h.wait(900);
  const bOpen = await atlasOpen(), bTop = await top();
  h.check(`${h.phase} Back chains: Atlas -> browser -> X keeps the Atlas open, its own entry current`, bOpen && bTop.overlay && !bTop.lounge, { atlasOpen: bOpen, top: bTop });
  await page.evaluate(() => history.back());
  await h.until(() => !window.__flyStore.getState().atlasOpen, undefined, 6000);
  h.check(`${h.phase} Back chains: ... and one Back then closes the Atlas`, !(await atlasOpen()), await top());
  // (c) Back with the browser over the Atlas closes the browser only.
  await openAtlas();
  await openPill();
  await page.evaluate(() => history.back());
  await g.gone('[data-testid="airport-browser"]');
  await h.wait(900);
  const cOpen = await atlasOpen();
  h.check(`${h.phase} Back chains: Atlas -> browser -> Back closes the browser, the Atlas stays`, cOpen && !(await g.shown('[data-testid="airport-browser"]')), { atlasOpen: cOpen, top: await top() });
  await page.evaluate(() => history.back());
  await h.until(() => !window.__flyStore.getState().atlasOpen, undefined, 6000);
  h.check(`${h.phase} Back chains: ... and the next Back closes the Atlas`, !(await atlasOpen()));
  // (a) pick KCMH from the pill: the lounge stays.
  await openAtlas();
  await openPill();
  await g.tapEl('[data-testid="airport-featured-KCMH"]');
  const entered = await h.until(() => window.__fly.airportWatch?.validated && !!window.__flyStore.getState().airportWatch, undefined, 240000);
  await h.wait(3000);
  const aState = await page.evaluate(() => ({ active: !!window.__fly.airportWatch?.active, watch: !!window.__flyStore.getState().airportWatch, screen: window.__flyStore.getState().screen, lounge: !!history.state?.__flyLounge }));
  h.check(`${h.phase} Back chains: Atlas -> "Watch an airport" -> KCMH: still in the lounge 3 s after it validates, a lounge entry on top`, entered && aState.active && aState.watch && aState.screen !== 'title' && aState.lounge, { entered, ...aState });
  await g.tapEl('[data-testid="lounge-menu"]');
  await g.appear('[data-testid="lounge-more-sheet"]');
  await page.evaluate(() => history.back());
  await g.gone('[data-testid="lounge-more-sheet"]');
  await h.wait(1200);
  const after = await page.evaluate(() => ({ active: !!window.__fly.airportWatch?.active, screen: window.__flyStore.getState().screen, lounge: !!history.state?.__flyLounge, sheet: !!document.querySelector('[data-testid="lounge-more-sheet"]') }));
  h.check(`${h.phase} Back chains: ... then one Back closes the menu sheet first, still in the lounge, its entry back on top`, after.active && !after.sheet && after.screen !== 'title' && after.lounge, after);
}

module.exports = {
  name: 'glass',
  // Shared with scratch probes (tablet, desktop); the runner reads only name /
  // portrait / landscape.
  helpers: { pageAudit, maskSample, glass, binoParts, section, motionGates, topBandGates, floatsClearOfStick, wheelGlideGate, reducedMotionGate, labelsGate, sideSheetStickGates, atlasEntryGates, figureGates, readoutGates, raiseWhereNothingFlies, settleBinoculars },

  // Each phase runs with the inbound re-staged on its own clock (restage()).
  async portrait(h) {
    const restore = await restage(h);
    try {
      await this.portraitPhase(h);
    } finally {
      restore();
    }
  },

  async landscape(h) {
    const restore = await restage(h);
    try {
      await this.landscapePhase(h);
    } finally {
      restore();
    }
  },

  // --device ipad: an iPad mini, upright then sideways (h.phase).
  async tablet(h) {
    const restore = await restage(h);
    try {
      await this.tabletPhase(h);
    } finally {
      restore();
    }
  },

  /**
   * A coarse-touch tablet gets the desktop HUD with touch-sized targets, the
   * phone's single-lens binocular figure when upright (the desktop's twin
   * lenses sized from the height are each wider than an upright screen) and
   * the desktop's twin lenses sideways, and the same Back chain as a phone.
   * The auditor runs in each state: idle, the spotter card, the binoculars
   * (locked, then the bare figure), the airport browser.
   */
  async tabletPhase(h) {
    const g = glass(h);
    const { page } = h;
    const upright = h.phase === 'portrait';
    await g.lowerAll();
    await page.evaluate(() => {
      const w = window.__fly.airportWatch;
      if (w.posture !== 'seated') w.sit(w.seats?.[0]?.id ?? 'window');
    });
    await h.until(() => window.__fly.airportWatch.posture === 'seated', undefined, 15000);
    await h.wait(800);
    h.check(`tablet ${h.phase}: the lounge is laid out as a tablet (data-layout=tablet)`, (await g.section('data-layout')) === 'tablet');
    await section(h, 'tablet idle', async () => {
      h.check(`tablet ${h.phase} idle: the board, the header and the controls bar are there`, (await g.shown('[data-testid="lounge-board"]')) && (await g.shown('[data-testid="lounge-header"]')) && (await g.shown('.lounge-bar')));
      await g.audit('tablet idle');
      await h.shot('tablet-idle');
    });
    await section(h, 'tablet spotter', async () => {
      await page.evaluate(() => window.__fly.airportWatch.select('a1b2c3'));
      await g.appear('[data-testid="spotter-card"]');
      await g.stableRect('[data-testid="spotter-card"]');
      await g.audit('tablet spotter card');
      await h.shot('tablet-spotter');
    });
    await section(h, 'tablet binoculars', async () => {
      if (await g.shown('[data-testid="spotter-binoculars"]')) await g.tapEl('[data-testid="spotter-binoculars"]');
      else await page.evaluate(() => window.__fly.airportWatch.select('a1b2c3', { binoculars: true }));
      await g.appear('[data-testid="binocular-view"]');
      await h.wait(1200);
      const kind = await page.evaluate(() => ({ phone: !!document.querySelector('.bino-phone'), layout: document.querySelector('.bino-phone')?.getAttribute('data-layout') ?? 'desktop' }));
      h.check(`tablet ${h.phase} binoculars: ${upright ? 'the phone\'s single-lens view (upright)' : 'the desktop view (sideways)'}`, upright ? kind.phone && kind.layout === 'portrait' : !kind.phone, kind);
      await g.audit('tablet binoculars locked');
      await h.shot('tablet-binoculars');
      h.info(`tablet ${h.phase} binoculars: raised where nothing flies (drag)`, await raiseWhereNothingFlies(h));
      h.info(`tablet ${h.phase} binoculars settled`, await settleBinoculars(h));
      await h.wait(900);
      if (upright) await figureGates(h, g, true, { label: 'tablet binoculars' });
      await g.audit('tablet binoculars figure');
      await h.shot('tablet-binoculars-figure');
    }, () => g.lowerAll());
    await section(h, 'tablet airport browser', async () => {
      await page.evaluate(() => window.__flyStore.setState({ airportBrowserOpen: true }));
      await g.appear('[data-testid="airport-browser"]');
      await h.wait(700);
      await g.audit('tablet airport browser');
      await h.shot('tablet-browser');
      const closed = await g.back('[data-testid="airport-browser"]');
      h.check(`tablet ${h.phase} Back: Back closes the airport browser, still in the lounge`, closed && !(await g.shown('[data-testid="airport-browser"]')) && (await g.watch()).active);
    });
  },

  async portraitPhase(h) {
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
    if (!(await g.shown('[data-testid="lounge-coach"]'))) {
      await page.evaluate(() => window.__flyLoungeCoach?.open());
      await g.appear('[data-testid="lounge-coach"]');
    }
    const coachText = await page.evaluate(() => document.querySelector('[data-testid="lounge-coach"]')?.textContent ?? '');
    const coach = !!coachText;
    h.check('portrait: first-visit coach marks speak touch (drag, pinch, tap, double-tap)', coach && /Drag/.test(coachText) && /Pinch/.test(coachText) && /Tap/.test(coachText) && /Double-tap/.test(coachText) && !/click|scroll|WASD/i.test(coachText), coachText);
    await h.shot('coach');
    // Seated with the board's peek: the tips (and any float) keep off the Walk ring.
    await section(h, 'seated floats vs the Walk ring', () => floatsClearOfStick(h, g, 'seated, first visit', { dismiss: false }));
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
    // One name, one action: Follow is the card's while it is up (the dock's
    // slot steps aside), the dock's primary names the selection, and the
    // card's expand control is not a second "More".
    const dockFollow = await page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="lounge-follow"]')).visibility);
    const primaryName = await page.evaluate(() => document.querySelector('[data-testid="lounge-binoculars"]')?.getAttribute('aria-label'));
    const expandText = await page.evaluate(() => document.querySelector('[data-testid="spotter-expand"]')?.textContent.trim());
    h.check('portrait spotter: the dock\'s Follow steps aside for the card\'s, its primary names the selection, the card\'s toggle reads Expand', dockFollow === 'hidden' && /QAL101/.test(primaryName || '') && expandText === 'Expand', { dockFollow, primaryName, expandText });
    await labelsGate(h, 'spotter peek');
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
    const foldBack = await g.back('[data-testid="spotter-telemetry"]');
    const afterBack1 = await g.watch();
    h.check('portrait Back: Back folds the expanded spotter sheet first (the selection stays)', foldBack && afterBack1.selected === 'a1b2c3' && !(await page.evaluate(() => !!document.querySelector('[data-testid="spotter-telemetry"]')?.offsetWidth)), { pressed: foldBack, ...afterBack1 });

    // Binoculars on the selection, from the spotter sheet's primary action. The
    // head swings to it first (the field stays wide while slewing), so the
    // figure itself is measured below with nothing to slew to.
    await g.tapEl('[data-testid="spotter-binoculars"]');
    await g.appear('[data-testid="binocular-view"]');
    await h.wait(1200);
    await readoutGates(h, g, true);
    await g.audit('binoculars locked', { insets });
    await h.shot('binoculars');
    // The top band with everything in it (Motion and Readouts both there, a
    // lock, the figures), with the insets of a home-screen app and without.
    await section(h, 'binocular top band', async () => {
      await topBandGates(h, g, 'binoculars locked (Motion + Readouts, insets)', insets);
      await h.shot('binoculars-band');
      const r0 = await page.evaluate(() => JSON.parse(document.querySelector('[data-testid="binocular-mask"]')?.dataset.figure || 'null')?.R);
      await g.setInsets(null);
      // The mask follows in the overlay's frame loop (slow here): wait for it.
      await h.until((r) => JSON.parse(document.querySelector('[data-testid="binocular-mask"]')?.dataset.figure || 'null')?.R !== r, r0, 8000);
      await h.wait(500);
      await topBandGates(h, g, 'binoculars locked (Motion + Readouts, no insets)', null);
      await h.shot('binoculars-band-noinsets');
    }, () => g.setInsets(insets));
    // Motion look, end to end; whatever happens, it ends off with the glasses up.
    await section(h, 'motion look', () => motionGates(h, g), async () => {
      await page.evaluate(() => window.__fly.airportWatch.motionLook?.disable?.());
      if (!(await g.watch()).binocular) await page.evaluate(() => window.__fly.airportWatch.select('a1b2c3', { binoculars: true }));
      await g.appear('[data-testid="binocular-view"]');
    });
    await section(h, 'focus wheel', async () => {
      await keepGlassesUp(h, g);
      await wheelGates(h, g, 'x');
      await h.shot('binoculars-20x');
    });
    // Back lowers the glasses, then clears the selection.
    const lowerBack = await g.back('[data-testid="binocular-view"]');
    const afterBack2 = await g.watch();
    h.check('portrait Back: Back lowers the binoculars next (the selection stays)', lowerBack && !afterBack2.binocular && afterBack2.selected === 'a1b2c3' && afterBack2.active, { pressed: lowerBack, ...afterBack2 });
    const clearBack = await g.back('[data-testid="spotter-card"]');
    const afterBack3 = await g.watch();
    h.check('portrait Back: then Back clears the selection, still in the lounge', clearBack && !afterBack3.selected && afterBack3.active, { pressed: clearBack, ...afterBack3 });
    h.check('portrait Back: at the root a lounge sentinel is still under the current entry (Back never leaves the app)', await page.evaluate(() => !!history.state?.__flyLounge));

    // The figure and the notice: binoculars raised where nothing flies. An
    // upright Safari page has no insets (its bars hold them), so the figure is
    // sized without; the insets of a home-screen app come back after.
    await g.setInsets(null);
    h.info('portrait binoculars: raised where nothing flies (drag)', await raiseWhereNothingFlies(h));
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
      const r0 = fig?.R;
      await g.setInsets(insets);
      // The mask is redrawn in the overlay's frame loop, a frame or more after
      // the bands move (seconds at SwiftShader's frame rate): wait for the
      // figure itself to follow, not for a clock.
      const followed = await h.until((r) => {
        const f = JSON.parse(document.querySelector('[data-testid="binocular-mask"]')?.dataset.figure || 'null');
        return !!f && f.R !== r;
      }, r0, 15000);
      h.info('portrait binoculars: the mask figure followed the insets', { followed, R: r0 });
      await h.wait(600);
      await figureGates(h, g, true, { label: 'binoculars under safe-area insets', sizeGates: false });
      await g.audit('binoculars under safe-area insets', { insets });
      await h.shot('binoculars-insets');
    }
    await g.tapEl('[data-testid="binocular-lower"]');
    h.check('portrait binoculars: Lower (bottom band) lowers the glasses', !(await g.watch()).binocular);
    // A wheel flick, then Lower at once: the glide must not raise them again.
    await section(h, 'wheel glide vs Lower', async () => {
      await page.evaluate(() => window.__fly.airportWatch.binoculars(true, { acquire: false }));
      await g.appear('[data-testid="binocular-view"]');
      await h.wait(600);
      await wheelGlideGate(h, g, 'x');
    }, () => page.evaluate(() => window.__fly.airportWatch.binoculars(false)));
    await page.evaluate(() => window.__fly.airportWatch.resetLook());
    await h.wait(500);

    // The lounge menu: Airports and Leave in two taps.
    await g.tapEl('[data-testid="lounge-menu"]');
    const leave = await g.rect('[data-testid="lounge-leave"]');
    const airports = await g.rect('[data-testid="lounge-airports"]');
    h.check('portrait menu: Leave and Airports are two taps away (header menu, then the button; in view without scrolling)', !!leave && !!airports && leave.w >= 44 && leave.h >= 44 && (await g.inView('[data-testid="lounge-leave"]')) && (await g.inView('[data-testid="lounge-airports"]')), { leave, airports });
    await g.audit('menu sheet', { insets });
    await h.shot('menu');
    const menuBack = await g.back('[data-testid="lounge-more-sheet"]');
    h.check('portrait Back: Back closes the lounge menu first, still in the lounge', menuBack && (await g.gone('[data-testid="lounge-more-sheet"]')) && (await g.watch()).active, { pressed: menuBack });
    // The dock's More opens the same sheet.
    await g.tapEl('[data-testid="lounge-more"]');
    h.check('portrait menu: the dock\'s More opens the lounge menu too', await g.appear('[data-testid="lounge-more-sheet"]'));
    await g.tapEl('[data-testid="lounge-more-sheet"] .lsheet-close');
    await g.gone('[data-testid="lounge-more-sheet"]');
    // Reduced motion from the game's own setting (not only the OS's).
    await section(h, 'reduced motion', () => reducedMotionGate(h, g), async () => {
      if (await g.shown('[data-testid="lounge-more-sheet"]')) await g.tapEl('[data-testid="lounge-more-sheet"] .lsheet-close');
    });

    // The instruments' airport map (the pier room), from the lounge menu.
    if (await page.evaluate(() => !!window.__fly.airportWatch.observatory)) {
      await g.tapEl('[data-testid="lounge-menu"]');
      await g.tapEl('[data-testid="observatory-open"]');
      await g.appear('[data-testid="observatory-panel"]', 10000);
      const map = await g.stableRect('[data-testid="observatory-panel"]');
      h.check('portrait airport map: a sheet between the header and the dock', !!map && map.y >= head.b && map.b <= dock.y + 1 && map.x >= 0 && map.r <= h.viewport.width, { map, headBottom: head.b, dockTop: dock.y });
      await g.audit('airport map', { insets });
      await h.shot('airport-map');
      const mapBack = await g.back('[data-testid="observatory-panel"]');
      h.check('portrait Back: Back closes the airport map', mapBack && !(await g.shown('[data-testid="observatory-panel"]')) && (await g.watch()).active, { pressed: mapBack });
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
    const browserBack = await g.back('[data-testid="airport-browser"]');
    h.check('portrait Back: Back closes the airport browser, still in the lounge', browserBack && !(await g.shown('[data-testid="airport-browser"]')) && (await g.watch()).active, { pressed: browserBack });

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
    await g.lowerAll();
    await page.evaluate(() => window.__fly.airportWatch.stand());
    await h.until(() => window.__fly.airportWatch.posture === 'standing', undefined, 30000);
    await h.wait(900);
    const free = await page.evaluate(() => {
      const s = document.querySelector('.lounge');
      // The stick's own zone (TOUCH's .lounge-stick-zone), as drawn.
      const z = document.querySelector('.lounge-stick-zone')?.getBoundingClientRect();
      const zone = z ? { x: z.left, y: z.top, r: z.right, b: z.bottom } : { x: 0, y: 0, r: 0, b: 0 };
      const hits = [];
      for (const el of s.querySelectorAll('.lounge-header, .lounge-dock, .lounge-peek, .lounge-board, .lounge-card, .lounge-sit, .lounge-decor-prompt, .observatory-prompt, .observatory-nearby, .dir-cue, .lounge-menu-sheet, .lounge-seat-menu')) {
        const r = el.getBoundingClientRect();
        if (r.width < 1 || getComputedStyle(el).visibility === 'hidden') continue;
        if (r.left < zone.r && r.right > zone.x && r.top < zone.b && r.bottom > zone.y) hits.push(el.className.split(' ')[0]);
      }
      return { zone, hits, posture: s.getAttribute('data-posture') };
    });
    h.check('portrait standing: the lower-left thumb zone above the dock is free of persistent chrome', free.posture === 'standing' && free.zone.r > 0 && free.hits.length === 0, free);
    await g.audit('standing', { insets });
    await h.shot('standing');
    await section(h, 'standing floats vs the stick zone', () => floatsClearOfStick(h, g, 'standing'));
    // A selection while standing: its sheet is the one thing at the foot of
    // the screen (the place prompts wait under it), and it blocks the stick.
    await page.evaluate(() => window.__fly.airportWatch.select('a1b2c3'));
    await g.appear('[data-testid="spotter-card"]');
    await g.stableRect('[data-testid="spotter-card"]');
    h.check('portrait standing with a selection: the sheet blocks the thumb zone', (await g.section('data-thumb-blocked')) === '1');
    await g.audit('standing with a selection', { insets });
    // The overlay (labels, the out-of-frame arrow and its callsign pill) never
    // draws over the dock or the map credit.
    const marks = await page.evaluate(() => {
      const c = document.querySelector('[data-testid="lounge-marks"]');
      const dock = document.querySelector('[data-testid="lounge-dock"]')?.getBoundingClientRect();
      const credit = document.querySelector('[data-zone="attribution"] > div')?.getBoundingClientRect();
      if (!c || !c.width || !dock) return null;
      const k = c.width / c.clientWidth;
      const top = Math.round(Math.min(dock.top, credit?.height ? credit.top : Infinity) * k);
      const d = c.getContext('2d').getImageData(0, top, c.width, c.height - top).data;
      let max = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] > max) max = d[i];
      return { top: top / k, maxAlpha: max };
    });
    h.check('portrait standing with a selection: the overlay draws nothing over the dock or the map credit', !!marks && marks.maxAlpha < 8, marks);
    await h.shot('standing-selected');
    await g.lowerAll();
    // Back to the window seat for the landscape phase.
    await page.evaluate(() => {
      const w = window.__fly.airportWatch;
      w.sit(w.seats?.[0]?.id ?? 'window');
    });
    await h.until(() => window.__fly.airportWatch.posture === 'seated', undefined, 15000);
    await g.setInsets(null);
  },

  async landscapePhase(h) {
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
    await section(h, 'seated floats vs the Walk ring', () => floatsClearOfStick(h, g, 'seated, first visit'));
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
    await keepGlassesUp(h, g);
    await wheelGates(h, g, 'y');
    await h.shot('binoculars-20x');
    const lowerBack = await g.back('[data-testid="binocular-view"]');
    h.check('landscape Back: Back lowers the binoculars', lowerBack && !(await g.watch()).binocular && (await g.watch()).active, { pressed: lowerBack });
    const clearBack = await g.back('[data-testid="spotter-card"]');
    h.check('landscape Back: then clears the selection', clearBack && !(await g.watch()).selected && (await g.watch()).active, { pressed: clearBack });
    // The twin-lens figure, raised where nothing flies.
    h.info('landscape binoculars: raised where nothing flies (drag)', await raiseWhereNothingFlies(h));
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
    await g.stableRect('[data-testid="lounge-more-sheet"]');
    h.check('landscape menu: Leave and Airports are two taps away (in view without scrolling)', (await g.inView('[data-testid="lounge-leave"]')) && (await g.inView('[data-testid="lounge-airports"]')));
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
    const browserBack = await g.back('[data-testid="airport-browser"]');
    h.check('landscape Back: Back closes the airport browser, still in the lounge', browserBack && !(await g.shown('[data-testid="airport-browser"]')) && (await g.watch()).active, { pressed: browserBack });
    // Seats.
    await g.tapEl('[data-testid="lounge-seats"]');
    const seats = await g.rect('[data-testid="lounge-seat-menu"]');
    h.check('landscape seats: the seat menu is a side sheet beside the rail', !!seats && seats.r <= rail.x + 1, seats);
    await g.audit('seat menu', { insets });
    await h.shot('seats');
    await g.back('[data-testid="lounge-seat-menu"]');
    // Standing with a side sheet: the left thumb still walks.
    await section(h, 'standing with a side sheet', () => sideSheetStickGates(h, g), async () => {
      await g.lowerAll();
      await page.evaluate(() => {
        const w = window.__fly.airportWatch;
        if (w.posture !== 'seated') w.sit(w.seats?.[0]?.id ?? 'window');
      });
      await h.until(() => window.__fly.airportWatch.posture === 'seated', undefined, 15000);
    });
    await g.setInsets(null);
    // Last (it leaves the lounge and comes back): the two Back chains from flight.
    await section(h, 'Back chains from flight', () => atlasEntryGates(h, g), async () => {
      // Whatever happened, end in the KCMH lounge for the runner's closing checks.
      if (await page.evaluate(() => !!window.__fly.airportWatch?.active)) return;
      await page.evaluate(() => window.__fly.airportWatch?.enter?.('KCMH').catch(() => {}));
      await h.until(() => !!window.__fly.airportWatch?.validated, undefined, 240000);
    });
  },
};
