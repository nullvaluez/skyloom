/**
 * LOUNGE MOBILE — GLASS (FLY_LOUNGE_MOBILE.md): the binocular figure's
 * geometry and the focus wheel's scale, pure, shared by the two things that
 * must agree to the pixel — the mask canvas (LoungeOverlay) and the DOM
 * readouts laid out in its dark bands (BinocularHud).
 *
 * Modes (lib/fly/observation-config.js MOBILE_GLASS.bino):
 *  - 'portrait': ONE circular field sized from the width (a phone held
 *    upright has no room for two side-by-side eyepieces: the desktop's twin
 *    lenses sized from the height are each wider than the screen there). It is
 *    centred on the OPTICAL AXIS — the screen centre, where the follow holds a
 *    locked aircraft and through which the picker projects — so the reticle
 *    and the lock box tell the truth; the dark bands above and below carry the
 *    readouts, and their minimum heights shrink the circle on a short screen.
 *  - 'landscape': the desktop's twin-lens figure scaled from the height, a
 *    little tighter so the readouts fit the side columns.
 *  - 'desktop': not described here: the desktop mask keeps its own code.
 *
 * Every length is CSS px; `insets` are the safe-area insets.
 */
import { MOBILE_GLASS } from '../observation-config.js';

const NO_INSETS = Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 });

/** The binocular figure for a mode and a viewport: lens centres, radius and the free bands. */
export function binocularFigure(mode, w, h, insets = NO_INSETS) {
  const B = MOBILE_GLASS.bino;
  const cx = w / 2, cy = h / 2;
  if (mode === 'portrait') {
    const top = (insets.top || 0) + B.portrait.topBandPx;
    const bottom = (insets.bottom || 0) + B.portrait.bottomBandPx;
    const R = Math.max(40, Math.min((w * B.portrait.diameterFrac) / 2, cy - Math.max(top, bottom)));
    return { mode, R, cx, cy, lenses: [{ cx, cy }], top: cy - R, bottom: cy + R, left: cx - R, right: cx + R };
  }
  if (mode === 'landscape') {
    // From the height, unless the side columns (inside the notch insets)
    // would fall under sideMinPx: then the lenses give way to the readouts.
    const side = Math.max(insets.left || 0, insets.right || 0) + B.landscape.sideMinPx;
    const R = Math.max(40, Math.min(h * B.landscape.radiusFrac, (w / 2 - side) / (1 + B.landscape.sepFrac)));
    const sep = R * B.landscape.sepFrac;
    return { mode, R, cx, cy, sep, lenses: [{ cx: cx - sep, cy }, { cx: cx + sep, cy }], top: cy - R, bottom: cy + R, left: cx - sep - R, right: cx + sep + R };
  }
  return null;
}

/**
 * The portrait top band's need (CSS px, insets excluded): its padding, the
 * tape row, the identity line, then the tallest of what can follow — the
 * figures, a notice of up to two lines (a notice that comes while the figures
 * are up floats over the foot of the glass instead), or the hint.
 */
export function portraitTopNeed() {
  const t = MOBILE_GLASS.bino.portrait.top;
  return t.padPx + t.tapePx + t.gapPx + t.identPx + t.gapPx + Math.max(t.figuresPx, t.noticePx);
}

/**
 * The portrait bottom row at viewport width `w`: Lower, the focus wheel, then
 * the side toggles (`readouts`: the pier room's instruments; `motion`: a
 * device with an orientation sensor). Returns the side count, the round size,
 * how many rounds there are (a spacer holds the side slot when there is no
 * toggle, so the wheel stays centred) and the width left to the wheel.
 */
export function portraitControls(w, insets = NO_INSETS, { readouts = false, motion = false } = {}) {
  const C = MOBILE_GLASS.bino.portrait.controls;
  const side = (readouts ? 1 : 0) + (motion ? 1 : 0);
  const round = side > 1 ? C.compactRoundPx : C.roundPx;
  const rounds = 1 + Math.max(1, side);
  const inner = w - (insets.left || 0) - (insets.right || 0) - 2 * C.padPx;
  return { side, round, rounds, wheel: inner - rounds * (round + C.gapPx) };
}

/** The figure at raise amount `up` (0..1, eased): the eyepieces close in from wide as the glasses come up. */
export function raisedRadius(R, up) {
  return R * (1.5 - 0.5 * up);
}

/** The reticle's post geometry from the lens radius. */
export function reticleFor(R) {
  const r = MOBILE_GLASS.bino.reticle;
  const gap = Math.round(R * r.gapFrac), reach = Math.round(R * r.reachFrac);
  return { gap, reach, step: (reach - gap) / r.ticks, ticks: r.ticks };
}

// --- the focus wheel ---------------------------------------------------------
const W = () => MOBILE_GLASS.wheel;
/** Wheel position (px along the scale) of a magnification. */
export const wheelPx = (mag) => Math.log(Math.min(W().maxMag, Math.max(W().minMag, mag))) * W().pxPerLog;
/** Magnification at a wheel position. */
export const wheelMag = (px) => Math.min(W().maxMag, Math.max(W().minMag, Math.exp(px / W().pxPerLog)));

/**
 * The detent (a preset) within `reachPx` of a wheel position, or null.
 * `presets` are magnifications (VIEW.optics.steps).
 */
export function detentNear(px, presets, reachPx) {
  let best = null, bestD = Infinity;
  for (const m of presets) {
    const d = Math.abs(wheelPx(m) - px);
    if (d <= reachPx && d < bestD) {
      best = m;
      bestD = d;
    }
  }
  return best;
}

/** The presets crossed going from wheel position a to b (for the detent ticks), in order. */
export function detentsCrossed(a, b, presets) {
  const lo = Math.min(a, b), hi = Math.max(a, b);
  const hit = presets.filter((m) => {
    const p = wheelPx(m);
    return p > lo && p <= hi;
  });
  return a <= b ? hit : hit.reverse();
}

/** The wheel's tick marks: every whole power to 10, then every 2 to the top, presets flagged. */
export function wheelTicks(presets) {
  const out = [];
  const seen = new Set();
  const add = (m, major) => {
    if (m < W().minMag || m > W().maxMag || seen.has(m)) return;
    seen.add(m);
    out.push({ mag: m, px: wheelPx(m), preset: presets.includes(m), major });
  };
  for (const m of presets) add(m, true);
  for (let m = 2; m <= 10; m++) add(m, m === 2 || m === 5 || m === 10);
  for (let m = 12; m <= 25; m += 2) add(m, false);
  add(25, true);
  return out.sort((a, b) => a.px - b.px);
}
