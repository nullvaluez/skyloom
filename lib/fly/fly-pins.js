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

/*
 * TRUE EARTH (2026-10-06) — `?flags=NAME,-NAME` on the page URL.
 *
 * The owner A/Bs flags on a live build, including on an iPhone, which has no
 * console to paste a pin into. Each NAME maps to the same
 * `window.__fly<Name>Override` global that `pinned()` already reads, so a URL
 * flag and a pasted console pin are one mechanism. A pin that is already set
 * (a harness's addInitScript, a pasted line) wins over the URL. Non-object
 * pins such as `__flyVisualsOverride = 'classic'` are never touched.
 */
const FLAG_TOKEN = /^-?[A-Z][A-Z0-9_]*$/;

/** TWILIGHT_FIX -> '__flyTwilightFixOverride' (the existing pin naming). */
export function overrideGlobalName(flag) {
  const pascal = String(flag)
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join('');
  return `__fly${pascal}Override`;
}

/** '?flags=A,-b&flags=C' -> { A: true, B: false, C: true }. Junk tokens are ignored. */
export function parseFlagParam(search) {
  const out = {};
  if (typeof search !== 'string' || !search) return out;
  let lists;
  try {
    lists = new URLSearchParams(search).getAll('flags');
  } catch {
    return out;
  }
  for (const list of lists) {
    for (const token of list.split(',')) {
      const t = token.trim().toUpperCase();
      if (!FLAG_TOKEN.test(t)) continue;
      if (t[0] === '-') out[t.slice(1)] = false;
      else out[t] = true;
    }
  }
  return out;
}

/**
 * Install URL flags as pins. Call once, before any Fly module reads a pin
 * (app/page.js does this at module scope). Returns the flags it applied;
 * `window.__flyUrlFlags` keeps them for the diagnostics overlay.
 */
export function installUrlFlags(win = typeof window === 'undefined' ? undefined : window) {
  if (!win || !win.location) return {};
  const applied = {};
  const flags = parseFlagParam(win.location.search);
  for (const name of Object.keys(flags)) {
    const g = overrideGlobalName(name);
    const prev = win[g];
    if (prev !== undefined && (prev === null || typeof prev !== 'object' || 'enabled' in prev)) continue;
    win[g] = { ...(prev || {}), enabled: flags[name] };
    applied[name] = flags[name];
  }
  // Two condition pins for looking at the sky on a device with no console:
  // ?sunUtc=2026-06-21T00:30:00Z (or epoch ms) sets the sun clock, ?weather=
  // a weather-model state ('baseline', 'overcast', ...). Both are the
  // production-honoured overrides harnesses already use, and an existing pin
  // wins over the URL.
  let params = null;
  try {
    params = new URLSearchParams(win.location.search);
  } catch {
    params = null;
  }
  const sun = params?.get('sunUtc');
  if (sun && win.__flySunOverride === undefined) {
    const ms = /^\d+$/.test(sun) ? Number(sun) : Date.parse(sun);
    if (Number.isFinite(ms)) {
      win.__flySunOverride = ms;
      applied.sunUtc = new Date(ms).toISOString();
    }
  }
  const weather = params?.get('weather');
  if (weather && /^[a-z-]{2,24}$/.test(weather) && win.__flyWeatherOverride === undefined) {
    win.__flyWeatherOverride = weather;
    applied.weather = weather;
  }
  win.__flyUrlFlags = applied;
  if (Object.keys(applied).length && win.console) win.console.info('[skyloom] URL flags', applied);
  return applied;
}
