/**
 * Round 8.5 (§B): module-scope registry for scene→overlay action handles.
 *
 * Why: `runtime` is a stable object, but FlyScene's mount effect NULLS its
 * action handles on cleanup — an overlay that captured one (or a click that
 * lands in the unmount→remount dead window) hits a dead function and the
 * button silently "does nothing" (the user's "impossible to click warp or
 * chase"). The bus keeps ONE module-scope registry that FlyScene re-fills
 * on EVERY mount; consumers resolve actions AT CALL TIME (getRuntimeAction/
 * callRuntimeAction) so a scene remount heals instead of orphaning captured
 * nulls. fly-store's `runtimeReady` flag mirrors registration for
 * render-time enabled/disabled states. The legacy `runtime.*` handles keep
 * working — the bus wraps the same functions, it does not replace them.
 */

const registry = Object.create(null);

export function registerRuntimeActions(actions) {
  Object.assign(registry, actions);
}

export function clearRuntimeActions() {
  for (const k of Object.keys(registry)) registry[k] = null;
}

/** Resolve an action by name at call time; null when unregistered/dead. */
export function getRuntimeAction(name) {
  const fn = registry[name];
  return typeof fn === 'function' ? fn : null;
}

/** Resolve + invoke in one step. Returns false when the action is dead. */
export function callRuntimeAction(name, ...args) {
  const fn = getRuntimeAction(name);
  return fn ? fn(...args) : false;
}

// Dev-only handle: verify-inspect-actions simulates the scene-remount dead
// window (clear → click → re-register) through this without importing us.
if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  window.__flyRuntimeBus = {
    registerRuntimeActions,
    clearRuntimeActions,
    getRuntimeAction,
  };
}
