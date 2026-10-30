/**
 * SHIP PASS RL-7 — the entitlement seam (no UI, no flag). RELEASE owns it.
 *
 * `currentGrants()` is the ONLY source of grants for
 * lib/fly/content-access.mjs `contentAccess()` (its default `grants`
 * argument), so the day a trusted server issues grants (accounts and checkout
 * are backlogged: FLY_SHIP_PASS.md section 11, P-45/P-46) exactly one function
 * changes. Today it grants nothing: every pack is free or in free preview, so
 * behaviour is unchanged. Grants never come from a save import, a URL or
 * localStorage (save-backup.mjs refuses them; this module reads none of them).
 *
 * Zero imports on purpose: content-access.mjs is loaded natively by node gates.
 */
const NONE = Object.freeze([]);

/** The pack ids this player is granted (always [] until a trusted server exists). */
export function currentGrants() {
  return NONE;
}

/**
 * Server side (app/api/entitlements/route.js): the grants a deployment's
 * `SKYLOOM_GRANTS` env names, kept only when they are known pack ids.
 */
export function grantsFromList(raw, packs) {
  if (typeof raw !== 'string' || !raw.trim() || !packs) return [];
  return [...new Set(raw.split(',').map((s) => s.trim()).filter((id) => /^[a-z0-9-]{1,48}$/.test(id) && Object.prototype.hasOwnProperty.call(packs, id)))];
}
