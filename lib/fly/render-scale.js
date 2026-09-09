/** Scene X/Z are Mercator units; Y is metres. Keep all coordinate conversion here. */
export function renderDistance(metres, mercatorScale = 1) {
  return metres * Math.max(1, mercatorScale);
}
export function physicalBendCoefficient(radiusM, mercatorScale = 1) {
  return 1 / (2 * radiusM * Math.max(1, mercatorScale) ** 2);
}
export function metricDirection(vector, distanceM, mercatorScale = 1) {
  vector.x *= renderDistance(distanceM, mercatorScale);
  vector.y *= distanceM;
  vector.z *= renderDistance(distanceM, mercatorScale);
  return vector;
}
