// R25 C SKY — per-frame hooks wired by W0 into FlyScene. W0 STUBS: they must
// stay allocation-free and return before writing anything unless
// r25On(R25_SKY, …) (lib/fly/visuals-profile.js) — Classic = flag-off.

/**
 * Called immediately after applyWeatherAtmo(): may overwrite rim/voidC IN
 * PLACE with the analytic sky model's colours so fog, edge fade, depth haze,
 * setSkyAtmo and the aerial rim all read one horizon.
 * ctx is FlyScene's module-scope scratch (see _r25Ctx).
 */
export function r25SkyAtmo(_runtime, _rim, _voidC, _ctx) {}

/** Called once per frame after the style chain (sky/cloud/aerial/IBL/exposure writes). */
export function r25SkyFrame(_runtime, _ctx) {}
