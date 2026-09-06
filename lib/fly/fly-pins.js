/**
 * Round 24 (A PACE) — the harness/diagnosis pin helper.
 *
 * Every R24 A feature can be armed at runtime by a `window.__fly<Name>Override`
 * object set BEFORE Fly mode mounts, instead of by editing constants. Two
 * reasons, both load-bearing:
 *
 *  - a harness that rewrites a constants file to run its arm is the hygiene
 *    defect recon HARN-HYG-9 names, and it makes the "flag-off is byte
 *    identical" claim untestable in the same process;
 *  - every fps / frame-pacing / stutter number this round cares about can only
 *    be measured on the USER'S machine, and asking them to edit a source file
 *    and rebuild is not a measurement protocol. A pasted line in the console
 *    before boot is.
 *
 * The idiom is R16's `__flyWeatherOverride`, generalised. Production reads
 * nothing extra: with no global set, `pinned()` returns the constants object
 * itself, by reference.
 */

/** The constants object with `window.__fly<Name>Override` merged over it. */
export function pinned(base, globalName) {
  if (typeof window === 'undefined') return base;
  const pin = window[globalName];
  return pin ? { ...base, ...pin } : base;
}
