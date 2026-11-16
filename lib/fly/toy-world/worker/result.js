/**
 * World Pass W0 (worker split): the two result helpers every builder shares,
 * moved VERBATIM from vector-tile.worker.js (c2bf5c06). withReason is the R21
 * empty-reason tag (TILE_PIPELINE); transferResult marks the transferables.
 */
import { transfer as comlinkTransfer } from 'comlink';
import { TILE_PIPELINE } from '../../fly-constants';

/**
 * Tag an EMPTY bundle with WHY it is empty (the R21 reason-code contract, read
 * by B STREAMKEEPER's engines):
 *   'no-data'  the upstream tile 404/204'd — this ground genuinely ships no
 *              vector data (open ocean, unmapped desert). Cacheable forever-ish.
 *   'zero'     the tile PARSED and the builder admitted nothing: no matching
 *              layer, a density lock, a minimum-count floor, an area floor, a
 *              vertex budget that produced no indices. Deterministic for the
 *              same input, but it is a decision this code made, not a statement
 *              about the network.
 * A THROW (never an empty result) is the third case: `Error('http-<code>')`,
 * which is a transient upstream condition (429/5xx/timeout) an engine must
 * RETRY rather than cache. Before R21 all three collapsed into one bare
 * `{empty:true}` — a rate-limited tile and an open-ocean tile were literally
 * the same object, so the engines cached both sticky-forever.
 */
function withReason(out, reason) {
  if (TILE_PIPELINE.enabled && TILE_PIPELINE.emptyReasons && out.empty === true) out.reason = reason;
  return out;
}

// Mark the result so Comlink moves the buffers instead of cloning them.
function transferResult(value, transferables) {
  return transferables.length ? comlinkTransfer(value, transferables) : value;
}

export { withReason, transferResult };
