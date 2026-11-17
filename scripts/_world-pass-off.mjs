/**
 * World Pass (2026-11-17): the five streams ship ON (FLY_WORLD_PASS.md
 * "Default on (2026-11-17)"). A node gate whose frozen numbers were certified
 * on the old world calls this once, before it builds anything, to latch the
 * reader on the `?flags=-WORLD_TRUTH,...,-WORLD_GROUND` arm: the request
 * scripts/world-pass-worker-proof.mjs proves byte-identical to c2bf5c06, and
 * the browser fleet's pin in scripts/_boot.js.
 *
 * The reader latches once per process on its first call, from the pins on
 * `window` at that moment, so this sets the five off pins on `window` (a
 * temporary object when there is none), latches, and restores `window`.
 * Throws unless the latched request is the all-off one ('wp1-0').
 *
 *   import { latchWorldPassOff } from './_world-pass-off.mjs';
 *   await latchWorldPassOff();
 */
export const WORLD_PASS_OFF_PINS = Object.freeze(
  Object.fromEntries(['Truth', 'Arrival', 'Reach', 'Look', 'Ground'].map((n) => [`__flyWorld${n}Override`, Object.freeze({ enabled: false })])),
);

export async function latchWorldPassOff() {
  const W = await import('../lib/fly/world-pass.js');
  const had = 'window' in globalThis;
  const prev = globalThis.window;
  const win = had && prev ? prev : { location: { search: '' } };
  // The latch also publishes window.__flyStats.worldPass; restore it too.
  const saved = Object.fromEntries([...Object.keys(WORLD_PASS_OFF_PINS), '__flyStats'].map((k) => [k, win[k]]));
  Object.assign(win, WORLD_PASS_OFF_PINS);
  globalThis.window = win;
  let key;
  try {
    W.__resetWorldPassLatchForTests();
    key = W.worldPassKey();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete win[k];
      else win[k] = v;
    }
    if (had) globalThis.window = prev;
    else delete globalThis.window;
  }
  if (key !== 'wp1-0') throw new Error(`latchWorldPassOff: the reader latched ${key}, not the all-off request wp1-0`);
  return key;
}
