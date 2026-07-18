/**
 * Contracts v1 (round 6, Phase F): light rotating objectives that give a
 * flight a reason — spot classes, chase to formation, overfly landmarks,
 * warp to bases, altitude milestones. Static, offline, hand-curated.
 * Aircraft-type knowledge stays HERE (lib/classify.js is shared 2D code
 * and stays untouched).
 */

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
];

/** Does a passport spot record advance this contract? */
export function spotAdvances(contract, spot) {
  if (contract.kind === 'spot-any') return true;
  if (contract.kind === 'spot-class') return spot.classification === contract.cls;
  if (contract.kind === 'spot-type') return !!spot.type && contract.types.has(spot.type);
  return false;
}
