/** Conservative exception to regional suppression for an evidenced local hole.
 * Inputs are existing residential anchors and the mapped-building source ring.
 * No anchors or unresolved source never mean permission to invent settlement.
 */
const WORLD = 2 * Math.PI * 6378137;
const Z = 14;
const SPAN = WORLD / 2 ** Z;

export function parcelGapSourceReady(chunks, x, z, radius, now) {
  if (!chunks?.size) return false;
  const x0 = Math.floor((x - radius + WORLD / 2) / SPAN);
  const x1 = Math.floor((x + radius + WORLD / 2) / SPAN);
  const z0 = Math.floor((z - radius + WORLD / 2) / SPAN);
  const z1 = Math.floor((z + radius + WORLD / 2) / SPAN);
  for (let tx = x0; tx <= x1; tx++) for (let tz = z0; tz <= z1; tz++) {
    const c = chunks.get(`${Z}/${tx}/${tz}`);
    // A source error, absent tile, coarse drape, or a mesh still being born is
    // not evidence of a missing neighbourhood. Empty records are conservative.
    if (!c || c.state !== 'ready' || c.coarse || c.badFrac > 0 ||
        !Number.isFinite(c.readyAt) || now - c.readyAt < 3) return false;
  }
  return true;
}

export function parcelGapSupported(anchors, x, z, mercatorK) {
  const radiusSq = (450 * mercatorK) ** 2;
  let neighbours = 0;
  for (const a of anchors) {
    if ((a.x - x) ** 2 + (a.z - z) ** 2 > radiusSq) continue;
    if (++neighbours >= 8) return true;
  }
  return false;
}

/** An observed mapped column veto is sticky until the next warp. A streaming
 * lapse retains earlier evidence; it never opens a new local exception.
 */
export function parcelGapDecision(previous, { ready, supported, columns }) {
  if (previous === false || columns > 0) return false;
  if (!ready) return previous === true;
  return supported === true;
}
