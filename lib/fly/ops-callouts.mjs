/**
 * GATE TO GATE — callouts (owner decision 4: visual HUD captions plus
 * synthesized tones, no voice). FLIGHT_DECK shows the captions (W1 D),
 * OPS_AUDIO plays the tones (W2 G); both key off these ids.
 *
 * createCalloutDetector() is fed once per frame and returns the ids that fire
 * this frame, each once per segment (a takeoff, an approach). W0: the ids and
 * an inert detector.
 */
export const CALLOUTS = Object.freeze([
  'speed80',
  'v1',
  'rotate',
  'positiveRate',
  'gearUp',
  'ra100',
  'ra50',
  'ra40',
  'ra30',
  'ra20',
  'ra10',
  'retard',
  'minimums',
  'gearWarn',
]);

/** Caption text per id (the deck renders these; no voice ever reads them). */
export const CALLOUT_LABEL = Object.freeze({
  speed80: '80 knots',
  v1: 'V1',
  rotate: 'Rotate',
  positiveRate: 'Positive rate',
  gearUp: 'Gear up',
  ra100: '100',
  ra50: '50',
  ra40: '40',
  ra30: '30',
  ra20: '20',
  ra10: '10',
  retard: 'Retard',
  minimums: 'Minimums',
  gearWarn: 'Too low, gear',
});

export function createCalloutDetector() {
  return {
    /** Feed one frame; returns the callout ids that fire now. */
    feed() {
      return [];
    },
    reset() {},
  };
}
