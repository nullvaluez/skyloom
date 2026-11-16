/**
 * World Pass W0 (worker split): building parts -> structures. Stream D (LOOK,
 * the FableFlight relate() port) owns this file and arms it behind the look
 * stream's `structures` sub-switch (tileCtx.worldPass.look.structures).
 *
 * relateStructures(items, tileCtx) receives the admitted footprints of one
 * tile (admission.js admitFootprints, after the marquee discs, before any
 * height) and returns the list the rest of the near build uses. Today it is
 * an identity hook: it returns its input untouched (the same array), so the
 * build is byte-identical to c2bf5c06.
 */
function relateStructures(items, tileCtx) {
  void tileCtx;
  return items;
}

export { relateStructures };
