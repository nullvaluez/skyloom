/**
 * SHIP PASS LIGHT (FLY_SHIP_PASS.md 5.4) — the stream's one reader of its
 * flags and its one door into the device policy.
 *
 * Flags are read only through lib/fly/ship-pass.js (`shipPassOn`,
 * `shipPassBlock`), resolved once at module load (`?flags=NAME` /
 * `window.__fly<Name>Override`). Devices are gated only through
 * lib/fly/device-policy.js `deviceFeature(name, ctx)` (FLY_SHIP_PASS.md 3.2):
 * nothing in the LIGHT stream calls isPhoneClass() / isMobileGraphicsClass()
 * itself.
 *
 * HARNESS PIN. The cloud venue renders with SwiftShader, which the policy
 * classes as 'software' and refuses every LIGHT feature (correctly: a software
 * rasteriser should not pay for them). A harness that has to see the feature
 * render sets `window.__flyLightDeviceClass = 'dgpu' | 'igpu' | 'phone' |
 * 'tablet'` before boot; it reaches deviceFeature() as `ctx.cls`, the field
 * the frozen policy API already takes for callers that know the answer. With
 * no pin set, the live class is used. (Contract request to FRAME: a general
 * device-class pin in device-policy.js; this pin then becomes redundant.)
 */
import { shipPassBlock, shipPassOn } from './ship-pass';
import { deviceFeature } from './device-policy';

export const LIGHT_FLAGS = Object.freeze(['TERRAIN_SHADOW', 'TRAFFIC_SHADOWS', 'AIRFRAME_SHADOW', 'SHADOW_REACH', 'PHOTO_HIRES', 'HANGAR_EXPOSURE']);
const CLASSES = new Set(['phone', 'tablet', 'igpu', 'dgpu', 'software']);

/** The harness device-class pin, or undefined (live detection). */
export function lightDeviceClassPin() {
  const pin = globalThis.window?.__flyLightDeviceClass;
  return CLASSES.has(pin) ? pin : undefined;
}

/**
 * `deviceFeature(name)` for the LIGHT features, at a scene tier
 * ('low' | 'medium' | 'high') and preset ('ultra' etc.). The harness pin rides
 * in as ctx.cls; an explicit ctx.cls (node gates) wins over it.
 */
export function lightFeature(name, { tier, preset, cls } = {}) {
  const ctx = {};
  if (tier) ctx.tier = tier;
  if (preset) ctx.preset = preset;
  const c = cls ?? lightDeviceClassPin();
  if (c) ctx.cls = c;
  return deviceFeature(name, ctx);
}

/** True when the flag is on AND the device policy allows it at this tier. */
export function lightActive(name, ctx = {}) {
  if (!shipPassOn(name)) return false;
  return lightFeature(name, ctx).allowed === true;
}

/** The resolved block (constants merged with any pin) for tunables. */
export function lightBlock(name) {
  return shipPassBlock(name) ?? { enabled: false };
}

export { shipPassOn };
