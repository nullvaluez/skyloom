/**
 * LOUNGE MOBILE haptics (FLY_LOUNGE_MOBILE.md; the TOUCH stream owns this
 * file). haptic(kind) with kind one of 'tick' | 'select' | 'lock' | 'raise' |
 * 'lower' | 'detent' (and 'run', the walk stick's run threshold). Callable
 * from anywhere (the GLASS stream's buttons included).
 *
 * A tap of the motor, never a buzz: the patterns are a few milliseconds
 * (MOBILE_TOUCH.haptics), and any two are at least minGapMs apart (a detent
 * after a detent: detentGapMs), so a fast pinch across the binocular line or
 * a spun focus wheel never strings pulses together. It is a silent no-op
 * where navigator.vibrate is missing (iOS Safari has none), on a
 * fine-pointer desktop (isMobileGraphicsClass: coarse pointer AND touch
 * hardware), and under reduced motion (the app's setting, else the OS). It
 * returns whether it vibrated.
 *
 * createHaptics(env) is the same function over injected { vibrate, now,
 * touch, reduced } so node can prove the no-op paths and the rate limit.
 */
import { MOBILE_TOUCH } from '../observation-config.js';
import { isMobileGraphicsClass } from '../device-class.js';
import { prefersReducedMotion } from '../airport-watch-camera.mjs';

const H = MOBILE_TOUCH.haptics;

export const HAPTIC_KINDS = Object.freeze(Object.keys(H.patterns));

export function createHaptics(env) {
  let lastAt = -Infinity, lastKind = null;
  return function haptic(kind) {
    const pattern = H.patterns[kind];
    if (pattern == null || typeof env.vibrate !== 'function') return false;
    if (!env.touch() || env.reduced()) return false;
    const now = env.now();
    const gap = kind === 'detent' && lastKind === 'detent' ? H.detentGapMs : H.minGapMs;
    if (now - lastAt < gap) return false;
    let ok = false;
    try {
      ok = env.vibrate(pattern) !== false;
    } catch {
      ok = false; // a blocked vibrate (no user activation yet) is just silence
    }
    if (ok) {
      lastAt = now;
      lastKind = kind;
    }
    return ok;
  };
}

const browserHaptic = createHaptics({
  vibrate: (p) => (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function' ? navigator.vibrate(p) : false),
  now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
  touch: () => isMobileGraphicsClass(),
  reduced: () => prefersReducedMotion(),
});

export function haptic(kind) {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return false;
  return browserHaptic(kind);
}
