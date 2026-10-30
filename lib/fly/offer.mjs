/**
 * SHIP PASS RL-7 (D3) — the future "Skyloom Pass", described as DATA only.
 *
 * Free core plus an optional pass: what it would contain, so product, store
 * copy and a later checkout read one description. No prices, currencies or
 * purchase URLs live here (none are shown anywhere; scripts/verify-ship-release
 * enforces it), and nothing reads this to gate content — access stays with
 * content-access.mjs and lib/fly/entitlements.js.
 */
import { PACKS } from './content-access.mjs';

export const FREE_CORE = Object.freeze({
  id: 'free-core',
  name: 'Skyloom',
  summary: 'Free Flight over the whole real Earth, Watch an Airport, Takeoff & Landing, the First Flights journeys and every aircraft.',
  includes: Object.freeze([
    { kind: 'feature', id: 'world' },
    { kind: 'feature', id: 'visuals' },
    { kind: 'feature', id: 'operations' },
    { kind: 'feature', id: 'spotting' },
    { kind: 'feature', id: 'photo' },
    { kind: 'pack', id: 'first-flights' },
  ]),
});

export const SKYLOOM_PASS = Object.freeze({
  id: 'skyloom-pass',
  name: 'Skyloom Pass',
  status: 'planned', // not on sale: no accounts or checkout exist (FLY_SHIP_PASS.md D3)
  summary: 'Every Wild Earth journey and the packs that follow it, for players who want more places to discover.',
  includes: Object.freeze([{ kind: 'pack', id: 'wild-earth' }]),
});

/** Every pack id the offer names exists in PACKS (the gate checks this). */
export function offerPackIds() {
  return [...FREE_CORE.includes, ...SKYLOOM_PASS.includes].filter((x) => x.kind === 'pack').map((x) => x.id).filter((id) => id in PACKS);
}
