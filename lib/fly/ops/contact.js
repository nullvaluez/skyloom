/**
 * Operations contact: the one place the operations core asks "what surface is
 * under the wheels". Owned by the airport-world work (W1 stream B); every
 * other ops module goes through it.
 */
import { findAirportSurface } from '../operations-airports.js';

/** The surface under (x, z) in scene coordinates, or null off every pavement. */
export function surfaceAt(ops, x, z) {
  return findAirportSurface(x, z);
}
