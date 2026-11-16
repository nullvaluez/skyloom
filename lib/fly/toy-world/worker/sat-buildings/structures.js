/**
 * World Pass D (LOOK): building parts -> structures, and the per-tile look
 * state colour.js reads. Stream D owns this file.
 *
 * relateStructures(items, tileCtx) receives the admitted footprints of one
 * tile (admission.js admitFootprints, after the marquee discs, before any
 * height) and returns the list the rest of the near build uses.
 *
 * With the look stream off (tileCtx.worldPass.look.on false) it returns its
 * input untouched (the same array) and sets nothing, so the build is
 * byte-identical to c2bf5c06.
 *
 * With it on it records `tileCtx.look` (the item list and the resolved worker
 * tunables), which colour.js reads lazily on its first call, after every
 * height is known.
 */
import { photoConfig } from '../photo-sampler';

function relateStructures(items, tileCtx) {
  const look = tileCtx.worldPass.look;
  if (!look.on || tileCtx.visuals !== true) return items;
  tileCtx.look = { items, photo: photoConfig(look), prep: null, structOf: null };
  return items;
}

export { relateStructures };
