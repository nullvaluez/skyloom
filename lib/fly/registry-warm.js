/**
 * SHIP PASS FRAME (FR-3, SHADER_READY) — the prewarm-registry consumer.
 *
 * Every program variant a Ship Pass stream adds is registered in
 * lib/fly/prewarm-registry.js (its own block) with `when: { tiers, devices,
 * flags }`. This module compiles each entry that `entryReachable()` says is
 * reachable HERE (this tier/preset, this device class, these Ship Pass flags)
 * so it never first-compiles after the reveal:
 *   - during the boot hold (lib/fly/prewarm.js runPrewarm drains it before
 *     the reveal, like every other warm unit),
 *   - on the title and whenever new entries appear (a stream's module can
 *     register late; PrewarmRig rescans),
 *   - ahead of a tier step (the tiers below the boot tier are queued at boot
 *     on idle frames, and a step queues whatever is still missing),
 *   - and across the day/night bucket crossing (a new scene.environment is a
 *     new compile signature; programs already resident LINK instead of
 *     compiling, only genuinely new keys cost anything).
 *
 * RETENTION. An entry's built object is compiled against the LIVE scene (so
 * lights, fog, environment and shadow state fold into its program key exactly
 * as production's draw will) and then RETAINED for the session: three
 * refcounts programs per material, and a warmed program whose material is
 * disposed is deleted before the real draw asks for it (prewarm.js
 * "RETENTION IS THE POINT"). Geometry is kept with it; entries are tiny.
 * A lost context drops every retained entry (the programs are gone).
 *
 * The registry may be empty (the consumer then does nothing) and entries may
 * throw (counted in `failed`, never thrown into the warm queue).
 *
 * Published as `window.__flyStats.prewarm.registry` (via prewarm.js) and
 * `registryWarmState()`.
 */
import { Scene } from 'three';
import { entryReachable, prewarmEntries } from './prewarm-registry';
import { shipPassOn } from './ship-pass';
import { deviceClassOf } from './device-policy';

const state = { entries: 0, reachable: 0, warmed: 0, failed: 0, compiles: 0, lastSig: null, errors: [], warmedKeys: [] };
const retained = new Map(); // `${key}|${sig}` -> holder Scene
const inflight = new Set();

export function registryWarmState() {
  return state;
}

/** The reachability context for a (tier, preset) on this device. */
export function registryContext({ tier, preset, device = deviceClassOf(), flagOn = shipPassOn } = {}) {
  return { tier, preset, device, flagOn };
}

/**
 * The compile signature: what, besides the entry itself, folds into a
 * program key — the scene environment (mapping + CubeUV height), fog, shadow
 * maps on, and the tier/preset the entry was judged reachable at.
 */
export function compileSignature(ctx, scene, gl) {
  const env = scene?.environment;
  return [ctx?.tier ?? '', ctx?.preset ?? '', env ? `${env.mapping}:${env.image?.height ?? ''}` : 'none', scene?.fog ? scene.fog.type ?? 'fog' : 'nofog', gl?.shadowMap?.enabled ? 'sh' : 'nosh'].join('|');
}

/** Entries reachable under `ctx` that have not been warmed under `sig`. */
export function pendingRegistryEntries(ctx, sig, entries = prewarmEntries()) {
  state.entries = entries.length;
  const out = [];
  let reachable = 0;
  for (const entry of entries) {
    if (!entryReachable(entry, ctx)) continue;
    reachable++;
    const id = `${entry.key}|${sig}`;
    if (!retained.has(id) && !inflight.has(id)) out.push(entry);
  }
  state.reachable = reachable;
  return out;
}

/**
 * Warm ONE entry. `compile(holder)` performs the compile (prewarm.js passes
 * its render-target-matched compileAsync); it may return a promise.
 */
export async function warmRegistryEntry(entry, { gl, scene, sig, compile }) {
  const id = `${entry.key}|${sig}`;
  if (retained.has(id) || inflight.has(id)) return false;
  inflight.add(id);
  try {
    const built = entry.build(gl, scene);
    const holder = new Scene();
    for (const o of Array.isArray(built) ? built : [built]) if (o) holder.add(o);
    if (!holder.children.length) throw new Error('build returned nothing');
    await compile(holder);
    retained.set(id, holder);
    state.warmed++;
    state.compiles++;
    state.lastSig = sig;
    if (state.warmedKeys.length < 64 && !state.warmedKeys.includes(entry.key)) state.warmedKeys.push(entry.key);
    return true;
  } catch (e) {
    state.failed++;
    if (state.errors.length < 8) state.errors.push(`${entry.key}: ${String(e?.message ?? e)}`);
    return false;
  } finally {
    inflight.delete(id);
  }
}

/** Warm every pending entry under ctx, one after another. Returns the count warmed. */
export async function warmRegistry({ gl, scene, ctx, compile, entries }) {
  const sig = compileSignature(ctx, scene, gl);
  let n = 0;
  for (const entry of pendingRegistryEntries(ctx, sig, entries)) if (await warmRegistryEntry(entry, { gl, scene, sig, compile })) n++;
  return n;
}

/** Forget everything (context loss: the programs no longer exist). */
export function resetRegistryWarm() {
  retained.clear();
  inflight.clear();
  Object.assign(state, { warmed: 0, failed: 0, compiles: 0, lastSig: null, errors: [], warmedKeys: [] });
}
