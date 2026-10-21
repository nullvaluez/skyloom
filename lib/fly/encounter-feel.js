/**
 * PLAY PASS — ENCOUNTERS (ENCOUNTER_FEEL; FLY_PLAY_PASS.md F4, F5): the
 * runtime glue for "fly alongside that pays off".
 *
 *  · THE PAYOFF. Thirty seconds alongside used to end in a one-line toast while
 *    the camera kept doing what it was doing. Now the memory starts a beat: the
 *    escort camera eases in onto its best angle (escort-shot.js beatWeight),
 *    the shutter keeps a thumbnail of exactly that frame (the scene rig reads
 *    the graded canvas after the composer, as PhotoCapture does), a lower third
 *    shows it, and the escort lets go so you are flying again.
 *  · HONEST TRAILS. A traffic trail is spotter vapour only where real contrails
 *    form (sky-trails.js contrailFormation: Schmidt–Appleman against the live
 *    surface temperature). Below that it is a thin light line that gives way to
 *    the hull up close, and the aircraft you are escorting drops its trail at
 *    escort range — the helicopter at 900 ft no longer drags smoke over Midtown.
 *
 * Everything here is pure or runtime-local; nothing runs per frame unless an
 * escort or a beat is live. Flag off: nothing in this file is reached.
 */
import { playPassBlock, playPassOn } from './play-pass';
import { contrailFormation } from './sky-trails';
import { escortShotState, PAYOFF } from './escort-shot';

export const FEEL_ON = playPassOn('ENCOUNTER_FEEL');
const BLOCK = playPassBlock('ENCOUNTER_FEEL') ?? {};
export const FEEL = Object.freeze({
  holdDecay: BLOCK.holdDecay ?? 1.5,
  adoptEscorts: BLOCK.adoptEscorts ?? true,
  cleanFrame: BLOCK.cleanFrame ?? 0.6,
  trails: Object.freeze({ lineHeadM: 5, lineTailM: 3, lineVapor: 0.55, lineNearM: [500, 1800], escortFadeM: [1200, 3500], ...(BLOCK.trails ?? {}) }),
  payoff: PAYOFF,
});

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * One spotter trail's honest shape, written into `out` (no allocation):
 *   vapour  0 = a light line (below contrail-forming air) … 1 = the vapour trail as before
 *   headM, tailM  full ribbon widths (true metres) before the pixel floor
 *   alphaK  vapour opacity multiplier
 *   bodyK   body multiplier (alpha and emission): the hull carries the read up
 *           close, and the escorted aircraft drops its trail at escort range
 * `base` = { headM, tailM } the look's own widths this frame.
 */
export function honestTrail(out, altM, wx, distM, escorted, base, T = FEEL.trails) {
  const v = contrailFormation(altM, wx);
  const line = 1 - v;
  out.vapour = v;
  out.headM = base.headM + (T.lineHeadM - base.headM) * line;
  out.tailM = base.tailM + (T.lineTailM - base.tailM) * line;
  out.alphaK = 1 - (1 - T.lineVapor) * line;
  const near = 1 - line * (1 - smooth(T.lineNearM[0], T.lineNearM[1], distM));
  out.bodyK = near * (escorted ? smooth(T.escortFadeM[0], T.escortFadeM[1], distM) : 1);
  return out;
}

/** The hex the autopilot is escorting right now (intercept or formation), or null. */
export function escortedHex(runtime) {
  const mode = runtime?.autopilot?.mode;
  return mode && mode !== 'off' ? (runtime.targeting?.lockedHex ?? null) : null;
}

/**
 * The payoff controller (one per runtime). `start(memory, opts)` is called
 * when a memory is earned (a crossing: the cinematic beat; a discovery: the
 * shutter on the moment, or none when the player's own photo earned it);
 * the scene rig calls `tick(dt)` each
 * frame and `shot(blob)` with the shutter's frame. Returns from tick:
 * 'shutter' on the frame the thumbnail should be taken, 'release' when the
 * beat is over and the escort should let go, else null.
 */
export function createPayoff(P = PAYOFF) {
  const state = { live: null, t: 0, shutter: false, done: false };
  return {
    state,
    get live() {
      return state.live;
    },
    start(memory, { cinematic = true, shutter = true } = {}) {
      state.live = { memory, cinematic };
      state.t = 0;
      state.shutter = !shutter; // a memory that already has its photo skips the shutter
      state.done = false;
      if (cinematic) escortShotState.beat = { t0: escortShotState.clock };
    },
    tick(dt) {
      if (!state.live) return null;
      state.t += Math.min(0.1, Math.max(0, dt));
      if (!state.shutter && state.t >= (state.live.cinematic ? P.shutterSec : 0.15)) {
        state.shutter = true;
        return 'shutter';
      }
      const end = state.live.cinematic ? P.swingSec + P.holdSec : 0.3;
      if (!state.done && state.t >= end) {
        state.done = true;
        return 'release';
      }
      // The beat eases back out after its hold; then it is over.
      if (state.done && state.t >= end + P.swingSec) this.stop();
      return null;
    },
    stop() {
      state.live = null;
      escortShotState.beat = null;
    },
  };
}

const fmt = (m) => (m < 185 ? `${Math.round(m)} m` : `${(m / 1852).toFixed(1)} nm`);

/**
 * What the encounter shutter would see, in words — the photo-mode viewfinder
 * (EncounterMoment.jsx) reads it at 4 Hz from encounterPhotoFrame, the same
 * test the shutter applies (|x| ≤ .78, |y| ≤ .72, visible, known terrain, in
 * range). Null when the active experience has no photo to take.
 */
export function viewfinderStatus(frame, active, rangeM) {
  if (!active || (active.kind !== 'traffic' && active.kind !== 'photo')) return null;
  // A discovery is named for the shot ("Frame the Midtown skyline"); speak of its subject.
  const name = active.kind === 'photo' ? String(active.name).replace(/^Frame\s+/i, '') : active.name;
  const Name = name.charAt(0).toUpperCase() + name.slice(1);
  if (!frame) return { ok: false, text: active.kind === 'traffic' ? `Waiting for a fresh position from ${name}` : `Finding ${name}` };
  if (!frame.knownTerrain) return { ok: false, text: 'Scenery is still loading along this view' };
  if (!frame.visible) return { ok: false, text: `Turn the camera toward ${name}` };
  const out = Math.abs(frame.x) > 0.78 || Math.abs(frame.y) > 0.72;
  if (out) {
    const dir = Math.abs(frame.x) / 0.78 >= Math.abs(frame.y) / 0.72 ? (frame.x < 0 ? 'left' : 'right') : frame.y < 0 ? 'down' : 'up';
    return { ok: false, text: `Bring ${name} into the frame`, dir };
  }
  if (frame.distanceM > rangeM) return { ok: false, text: `Fly closer · ${fmt(frame.distanceM)} (within ${fmt(rangeM)})` };
  // A crossing's memory is earned alongside; a photo of it joins that memory.
  return { ok: true, text: active.kind === 'traffic' ? `${Name} is in frame · your shot joins the flight memory` : `${Name} is in frame · shoot to save the memory` };
}
