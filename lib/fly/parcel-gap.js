/** Conservative exception to regional suppression for an evidenced local hole.
 * Inputs are existing residential anchors and the mapped-building source ring.
 * No anchors or unresolved source never mean permission to invent settlement.
 */
const WORLD = 2 * Math.PI * 6378137;
const Z = 14;
const SPAN = WORLD / 2 ** Z;

// At boost a two-second placement interval can leave 1.5 km of new ground
// behind the aircraft. Keep the parked cadence and cap moving scans at 2 Hz.
export function parcelPlacementDue(elapsed, dx, dz, mercatorK) {
  return elapsed >= 2 || (elapsed >= 0.5 && dx * dx + dz * dz >= (350 * mercatorK) ** 2);
}

// A ready source can arrive or leave while the legacy ring and its counts
// remain unchanged. Grid commits include heals and same-key replacements.
export function residentParcelSignature(engine) {
  let signature = '|parcels=' + engine.supportRevision;
  for (const [key, chunk] of engine.chunks) {
    if (chunk.state === 'ready' && chunk.parcel?.length) signature += '|' + key;
  }
  return signature;
}

export function inParcelRing(outer, roadside, nearTile, distanceSq, nearSq, outerSq) {
  if (!outer) return distanceSq <= nearSq;
  return roadside && distanceSq < outerSq && (!nearTile || distanceSq > nearSq);
}

// Give the near ring first claim under its original per-tile rules. Only
// the surplus can fund the extended roadside layer; split it across every
// eligible tile, regardless of which tile is closest to the player.
export function placeParcelRings(near, resident, pool, nearShare, place, px, pz, range) {
  let placed = 0;
  for (const chunk of near) {
    if (placed >= pool) break;
    placed = place(chunk, Math.min(pool, placed + nearShare), false);
  }
  if (!resident || placed >= pool) return;
  const tiles = resident.filter(c => {
    if (!c.parcelKind?.includes(1)) return false;
    const dx = Math.max(0, Math.abs(c.cx-px) - c.span/2);
    const dz = Math.max(0, Math.abs(c.cz-pz) - c.span/2);
    return dx*dx + dz*dz < range*range;
  });
  if (!tiles.length) return;
  // Worker roadside candidates are already in geographical hash order.
  // Use a stable tile ordering only to apportion the indivisible remainder.
  const tileHash = c => (Math.imul(c.tile.x, 73856093) ^ Math.imul(c.tile.y, 19349663)) >>> 0;
  tiles.sort((a,b) => tileHash(a)-tileHash(b) || a.tile.x-b.tile.x || a.tile.y-b.tile.y);
  const spare = pool - placed, share = Math.floor(spare / tiles.length), remainder = spare % tiles.length;
  for (let i = 0; i < tiles.length; i++) {
    const allowance = share + (i < remainder ? 1 : 0);
    if (!allowance) break;
    placed = place(tiles[i], placed + allowance, true);
  }
}

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
    const knownEmpty=c?.state==='empty'&&c.reason==='zero'&&Number.isFinite(c.emptyAt)&&now-c.emptyAt>=3;
    if(!knownEmpty&&(!c || c.state !== 'ready' || !c.columns || c.coarse || c.badFrac > 0 ||
        !Number.isFinite(c.readyAt) || now - c.readyAt < 3)) return false;
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
