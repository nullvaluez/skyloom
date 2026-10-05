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

/** Convert a rotated, metre-authored model to the map frame. Stretch WORLD
 * horizontal basis rows, never local axes (which would stretch height in a bank).
 * Translation is already projected. Recompose before each call; do not compound. */
export function projectModelMatrix(matrix, mercatorScale = 1) {
  const k = Number.isFinite(mercatorScale) ? Math.max(1, mercatorScale) : 1, e = matrix.elements;
  for (const i of [0, 4, 8, 2, 6, 10]) e[i] *= k;
  return matrix;
}
