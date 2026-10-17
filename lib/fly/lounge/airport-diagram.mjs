// Readable airport-scale geometry shared by the map and its bearing markers.
// Live contacts never choose the scale: a distant selection belongs at the
// edge, rather than reducing the actual airport to an unreadable cluster.
const CENTRE_X = 180, CENTRE_Y = 139, RADIUS = 112;
const valid = (point) => Number.isFinite(point?.x) && Number.isFinite(point?.z);

export function airportDiagramFrame(runways = []) {
  let radiusM = 1200;
  for (const runway of runways ?? []) {
    for (const point of [runway?.a, runway?.b]) {
      if (valid(point)) radiusM = Math.max(radiusM, Math.hypot(point.x, point.z));
    }
  }
  const extent = radiusM * 1.15, scale = RADIUS / extent;
  const project = (point) => {
    if (!valid(point)) throw new TypeError('Airport diagram positions must have finite x and z coordinates.');
    return [CENTRE_X + point.x * scale, CENTRE_Y + point.z * scale];
  };
  const locate = (contact) => {
    if (!valid(contact)) throw new TypeError('Airport diagram contacts must have finite x and z coordinates.');
    const range = Math.hypot(contact.x, contact.z), offMap = range > extent;
    const factor = offMap ? extent / range : 1;
    return {
      point: project({ x: contact.x * factor, z: contact.z * factor }),
      offMap,
      // Clockwise from map-up: front/-Z is 0°, right/+X is 90°.
      angleDeg: range ? (Math.atan2(contact.x, -contact.z) * 180 / Math.PI + 360) % 360 : 0,
    };
  };
  return Object.freeze({ extent, scale, project, locate });
}
