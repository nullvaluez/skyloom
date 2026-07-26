/**
 * Contracts v1 (round 6, Phase F): light rotating objectives that give a
 * flight a reason — spot classes, chase to formation, overfly landmarks,
 * warp to bases, altitude milestones. Static, offline, hand-curated.
 * Aircraft-type knowledge stays HERE (lib/classify.js is shared 2D code
 * and stays untouched).
 */

import { WARBIRD_TYPES } from '@/lib/warbirds';
import { CONTRACTS_LIVING } from './fly-constants';

// Widebody ICAO type codes for the spot-type contract
export const WIDEBODY_TYPES = new Set([
  'A332', 'A333', 'A338', 'A339', 'A342', 'A343', 'A345', 'A346',
  'A359', 'A35K', 'A388',
  'B742', 'B744', 'B748', 'B762', 'B763', 'B764',
  'B772', 'B773', 'B77L', 'B77W', 'B788', 'B789', 'B78X',
  'MD11', 'IL96', 'C17', 'K35R',
]);

export const CONTRACT_TEMPLATES = [
  {
    id: 'spot-3',
    label: 'Log 3 new spots',
    kind: 'spot-any',
    target: 3,
    pts: 100,
  },
  {
    id: 'spot-heli',
    label: 'Spot 2 helicopters',
    kind: 'spot-class',
    cls: 'helicopter',
    target: 2,
    pts: 150,
  },
  {
    id: 'chase-formation',
    label: 'Fly formation with any aircraft',
    kind: 'formation',
    target: 1,
    pts: 200,
  },
  {
    id: 'overfly-landmarks',
    label: 'Overfly 2 landmarks',
    kind: 'overfly',
    target: 2,
    pts: 150,
  },
  {
    id: 'spot-widebody',
    label: 'Spot a widebody',
    kind: 'spot-type',
    types: WIDEBODY_TYPES,
    target: 1,
    pts: 200,
  },
  // Round 14 "AirVenture": warbirds & classics (lib/warbirds.js). The Set
  // includes common types (T-6, Stearman, Cubs) so it stays completable
  // off-airshow.
  {
    id: 'spot-warbird',
    label: 'Log a warbird or classic',
    kind: 'spot-type',
    types: WARBIRD_TYPES,
    target: 1,
    pts: 300,
  },
  {
    id: 'alt-fl300',
    label: 'Climb through FL300',
    kind: 'altitude',
    altM: 9144,
    target: 1,
    pts: 100,
  },
  {
    id: 'visit-base',
    label: 'Atlas-warp to a military base',
    kind: 'visit-kind',
    poiKind: 'military',
    target: 1,
    pts: 250,
  },
  {
    id: 'spot-military',
    label: 'Spot a military aircraft',
    kind: 'spot-class',
    cls: 'military',
    target: 1,
    pts: 250,
  },
  // Round 7: airports are gameplay (lib/fly/airport-buzz.js detector)
  {
    id: 'buzz-tower',
    label: 'Buzz a control tower',
    kind: 'airport-buzz',
    target: 1,
    pts: 200,
  },
  {
    id: 'touch-go',
    label: 'Fly a touch-and-go',
    kind: 'touch-go',
    target: 1,
    pts: 250,
  },
  // -------------------------------------------------------------------------
  // Round 17 "Your Wings" — LIVING-WORLD CONTRACTS.
  //
  // APPEND-ONLY, STRICTLY AFTER `touch-go`: the first three entries are the
  // frozen starting set (Contracts.jsx slices [0,3]) and the rotation walks
  // this array in order, so inserting anywhere above would reshuffle every
  // existing player's wheel. The eleven templates above are byte-unchanged.
  //
  // The four weather + two night templates carry a `requires` descriptor and
  // are therefore SATELLITE-ONLY (see contractEligible + CONTRACTS_LIVING):
  // they are only ever offered when the sky can actually deliver them, and
  // they rotate out silently once it can't. The last three read data that
  // exists in both styles, so they carry no `requires`.
  // -------------------------------------------------------------------------
  {
    id: 'storm-chaser',
    label: 'Fly 60 s in rain or snow',
    kind: 'weather-hold',
    wx: 'precip',
    target: 60, // 1 Hz ticks
    pts: 300,
    requires: { style: 'satellite', weather: 'precip' },
  },
  {
    id: 'ifr-legs',
    label: 'Fly 8 km in fog',
    kind: 'weather-distance',
    wx: 'fog',
    target: 8, // CONTRACTS_LIVING.fogStepM each
    pts: 250,
    requires: { style: 'satellite', weather: 'fog' },
  },
  {
    id: 'wind-rider',
    label: 'Hold 2 min aloft in 15 m/s wind',
    kind: 'weather-hold',
    wx: 'wind',
    target: 120, // 1 Hz ticks
    pts: 250,
    requires: { style: 'satellite', weather: 'wind' },
  },
  {
    id: 'above-weather',
    label: 'Top the overcast at FL200',
    kind: 'weather-alt',
    wx: 'overcast',
    target: 1,
    pts: 200,
    requires: { style: 'satellite', weather: 'overcast' },
  },
  {
    id: 'night-spots',
    label: 'Log 3 spots at night',
    kind: 'spot-night',
    target: 3,
    pts: 250,
    requires: { style: 'satellite', night: true },
  },
  {
    id: 'night-buzz',
    label: 'Buzz a tower after dark',
    kind: 'buzz-night',
    target: 1,
    pts: 350,
    requires: { style: 'satellite', night: true },
  },
  // The Atlas has carried tags on military bases and spotting hotspots since
  // round 5 and nothing read them. `visit-tag` resolves the tag list from the
  // atlas entry (recents only carry key/name/kind), so these two are one data
  // lookup away from the existing visit path.
  {
    id: 'visit-boneyard',
    label: 'Atlas-warp to a boneyard',
    kind: 'visit-tag',
    tag: 'boneyard',
    target: 1,
    pts: 300,
  },
  {
    id: 'visit-factory',
    label: 'Atlas-warp to an airliner factory',
    kind: 'visit-tag',
    tag: 'factory',
    target: 1,
    pts: 300,
  },
  {
    id: 'overfly-hotspot',
    label: 'Overfly a spotting hotspot',
    kind: 'overfly-kind',
    poiKind: 'hotspot',
    target: 1,
    pts: 200,
  },
];

/**
 * KINDS that need nothing from the sky, the Atlas or the weather — pure
 * mechanics a player can complete anywhere, in any conditions. This is the
 * pool the DAILY set draws from (lib/fly/daily.js), which is what makes
 * "today's two" identical for every player on earth AND always completable.
 *
 * Deliberately excluded: `formation` (needs a cooperative live contact),
 * `visit-kind` / `visit-tag` (need the Atlas), `overfly-kind`, and every
 * weather/night kind.
 */
export const DAILY_KINDS = new Set([
  'spot-any', 'spot-class', 'spot-type', 'overfly', 'altitude',
  'airport-buzz', 'touch-go',
]);

/** Templates the daily set may draw (definition order = stable pool order). */
export const DAILY_TEMPLATES = CONTRACT_TEMPLATES.filter(
  (t) => DAILY_KINDS.has(t.kind) && !t.requires
);

/** Just their ids — lib/fly/daily.js is zero-import and samples plain values. */
export const DAILY_TEMPLATE_IDS = DAILY_TEMPLATES.map((t) => t.id);

/**
 * Is it night, for GAMEPLAY purposes?
 *
 * Satellite-only ON PURPOSE. `runtime.sun` is published by FlyScene's day
 * cycle, which returns early in toy — so in toy the value is either undefined
 * (fresh boot) or a stale leftover from the last satellite session. A night
 * objective scored off a stale sun is a lie, so toy is simply never night.
 */
export function nightNow(ctx) {
  if (ctx?.mapStyle !== 'satellite') return false;
  const frac = ctx?.sunFrac;
  return Number.isFinite(frac) && frac <= CONTRACTS_LIVING.nightFrac;
}

/**
 * May this template be OFFERED right now?
 *
 * Pure — the caller supplies the world:
 *   ctx = { mapStyle: 'toy'|'satellite', wx: runtime.weather?.wx, sunFrac }
 *
 * Templates with no `requires` are always eligible (every pre-R17 template).
 * A `requires` template must clear its style AND its live condition, judged at
 * the looser `offer` thresholds. Missing data is never "close enough": no wx
 * object, `wx.found === false` (the honest no-weather state), or a non-finite
 * sun all mean NOT eligible.
 */
export function contractEligible(tpl, ctx) {
  const req = tpl?.requires;
  if (!req) return true;
  const style = ctx?.mapStyle ?? null;
  if (req.style && style !== req.style) return false;
  // Belt and braces: both live classes are satellite facts regardless of what
  // a template's `requires.style` happens to say.
  if ((req.weather || req.night) && style !== 'satellite') return false;
  if (req.night && !nightNow(ctx)) return false;
  if (req.weather) {
    const wx = ctx?.wx;
    if (!wx || !wx.found) return false;
    const o = CONTRACTS_LIVING.offer;
    if (req.weather === 'precip') return wx.precip !== 'none' && wx.precipT > o.precipT;
    if (req.weather === 'fog') return wx.fogT > o.fogT;
    if (req.weather === 'wind') return Math.hypot(wx.windX, wx.windZ) >= o.windMps;
    if (req.weather === 'overcast') return wx.overcastT > o.overcastT;
    return false; // unknown descriptor: refuse rather than offer a dead row
  }
  return true;
}

/**
 * Does a passport spot record advance this contract?
 *
 * R17 adds an optional third argument — `ctx = { night }` — for the spot
 * kinds that care what the sky is doing. The three original branches and the
 * default are unchanged, so every existing caller behaves identically.
 */
export function spotAdvances(contract, spot, ctx) {
  if (contract.kind === 'spot-any') return true;
  if (contract.kind === 'spot-class') return spot.classification === contract.cls;
  if (contract.kind === 'spot-type') return !!spot.type && contract.types.has(spot.type);
  if (contract.kind === 'spot-night') return !!ctx?.night;
  return false;
}
