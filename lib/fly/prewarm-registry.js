/**
 * SHIP PASS (FLY_SHIP_PASS.md 3.2 "Prewarm", FR-3) — the prewarm registry.
 *
 * Every program variant a Ship Pass stream adds is registered here, in that
 * stream's own block, so lib/fly/prewarm.js (FRAME, the consumer) can compile
 * it during the boot hold and the title instead of on first use after the
 * reveal. A stream never edits prewarm.js; it registers.
 *
 * FROZEN API (W0; a change is a contract change recorded in section 6):
 *   registerPrewarm({ stream, key, build(gl, scene), when: { tiers?, devices?, flags? } })
 *   prewarmEntries() → the registered entries, in registration order
 *
 * `key` is unique per stream ('<STREAM>:<name>'); registering it again
 * replaces the entry (HMR-safe). `build(gl, scene)` returns an Object3D (or an
 * array) whose materials carry the variant's exact program key — the
 * consumer adds it to a warm scene, compiles it and disposes it; it must not
 * touch the live scene. `when` narrows where the variant is reachable:
 * `tiers` (scene tiers 'low'|'medium'|'high', or presets incl. 'ultra'),
 * `devices` (lib/fly/device-policy.js classes) and `flags` (Ship Pass flag
 * names that must all be on). An absent field means "everywhere".
 *
 * `entryReachable(entry, ctx)` is the one filter the consumer and the gates
 * use, so "reachable at the current tier and device" means one thing.
 */
const ENTRIES = new Map();
const STREAMS = new Set(['FRAME', 'SKY', 'CITY', 'LIGHT', 'RELEASE']);

export function registerPrewarm(entry) {
  const { stream, key, build, when = {} } = entry ?? {};
  if (!STREAMS.has(stream)) throw new Error(`registerPrewarm: unknown stream ${stream}`);
  if (typeof key !== 'string' || !key.startsWith(`${stream}:`)) throw new Error(`registerPrewarm: key must start with "${stream}:" (got ${key})`);
  if (typeof build !== 'function') throw new Error(`registerPrewarm: ${key} has no build(gl, scene)`);
  ENTRIES.set(key, Object.freeze({ stream, key, build, when: Object.freeze({ ...when }) }));
}

export function prewarmEntries() {
  return [...ENTRIES.values()];
}

/**
 * Is `entry` reachable here? ctx = { tier, preset, device, flagOn(name) }.
 * A missing ctx field does not narrow (the consumer passes what it knows).
 */
export function entryReachable(entry, ctx = {}) {
  const w = entry?.when ?? {};
  if (w.tiers?.length && (ctx.tier || ctx.preset) && !w.tiers.includes(ctx.tier) && !w.tiers.includes(ctx.preset)) return false;
  if (w.devices?.length && ctx.device && !w.devices.includes(ctx.device)) return false;
  if (w.flags?.length && typeof ctx.flagOn === 'function' && !w.flags.every((f) => ctx.flagOn(f))) return false;
  return true;
}

// SHIP PASS FRAME prewarm begin
// SHIP PASS FRAME prewarm end

// SHIP PASS SKY prewarm begin
// SKY's variants replace default texts for the page load (lib/fly/sky-prewarm.js):
// REAL_MOON the cloud composite (the phase terminator); SKY_LITE the aerial
// lookup inside the cloud march / composite and the merged aerial pass.
import { skyPrewarmObject } from './sky-prewarm.js';
registerPrewarm({ stream: 'SKY', key: 'SKY:real-moon-composite', build: () => skyPrewarmObject('cloud-r25'), when: { flags: ['REAL_MOON'] } });
registerPrewarm({ stream: 'SKY', key: 'SKY:sky-lite-clouds', build: () => skyPrewarmObject('cloud-r25'), when: { flags: ['SKY_LITE'] } });
registerPrewarm({ stream: 'SKY', key: 'SKY:sky-lite-aerial', build: () => skyPrewarmObject('aerial-pass'), when: { flags: ['SKY_LITE'] } });
// SHIP PASS SKY prewarm end

// SHIP PASS CITY prewarm begin
// SHIP PASS CITY prewarm end

// SHIP PASS LIGHT prewarm begin
// SHIP PASS LIGHT prewarm end

// SHIP PASS RELEASE prewarm begin
// SHIP PASS RELEASE prewarm end
