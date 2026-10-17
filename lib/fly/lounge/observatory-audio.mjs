/** Directional exterior microphone: clockwise bearing from true north.
 * Keeps the normal through-glass path intact and uses the existing delayed voices. */
export function listeningGain(dx, dz, bearing) {
  if (![dx, dz, bearing].every(Number.isFinite)) return 0;
  const d = Math.hypot(dx, dz);
  if (d < 1e-6) return 0;
  const a = bearing * Math.PI / 180;
  const dot = (dx * Math.sin(a) - dz * Math.cos(a)) / d;
  return Math.pow(Math.max(0, dot), 6);
}
