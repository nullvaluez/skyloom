/**
 * World Pass W0 (worker split): THE building height entry point. Stream A
 * (TRUTH) owns this file; its one height model replaces both legacy rules
 * behind the truth stream's request (tileCtx.worldPass.truth), read here and
 * nowhere else.
 *
 *   heightOf(item, tileCtx, 'near')  the detailed ring (sat-buildings/index.js
 *       pass 2): mapped height, else the R18 house band, the R19 typology band
 *       (suburban context only) or the legacy sqrt-area curve; the S.minH
 *       floor; the toy soft knee; and in Enhanced (`visuals`) a mapped height
 *       is never stylized.
 *       item: { rawH, areaM2, id, polys } (an admitted footprint)
 *       returns { h, hash, typo, inferredHouse }
 *   heightOf(item, tileCtx, 'far')   the far mass (sat-skyline.js, both its
 *       per-polygon and per-feature admission): mapped height, else the R19
 *       far-suburb hatch band or the dead R18 area curve; the soft knee; the
 *       same Enhanced rule.
 *       item: { rawH, areaM2, id, hatch }
 *       returns { h, hash, typo: null, inferredHouse: false }
 *
 * Both branches are the c2bf5c06 code moved verbatim (same expressions, same
 * order), so the two legacy behaviours are bit-identical. The third legacy
 * height guess, building-profiles.js buildingClassificationHeight (the style
 * classifier, typology.js architectureStyle), is not routed here yet.
 */
import { ROOFS_SAT, SAT_BUILDINGS, SAT_FAR_SUBURB, TOY_WORLD } from '../../../fly-constants';
import { pickTypology } from './typology';

/** Local clamp (buildSatBuildings kept its own inside its closure). */
function clamp01Range(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function nearHeight(it, tileCtx) {
  const B = TOY_WORLD.buildings;
  const S = SAT_BUILDINGS;
  const RS = ROOFS_SAT;
  const visuals = tileCtx.visuals === true;
  const clamp = clamp01Range;
  const hash = (((it.id * 2654435761) >>> 0) % 4096) / 4096;
  let h = it.rawH;
  // Round 18 (A1) — HOUSE HEIGHT INFERENCE. The √area curve was authored for
  // untagged commercial lots; fed a 150 m² suburban house it returned
  // 9 + 12.2·0.5 ≈ 15 m, i.e. a five-storey block where a bungalow stands.
  // Whole American suburbs came out as mid-rise carpet. Footprints under
  // houseInfer.maxAreaM2 now read as 1–2-storey houses over a hash-spread
  // band, which ALSO lands them inside the small-band roof dispatch below
  // (h < ROOFS_SAT.small.maxH) — that is where the gable/hip carpet comes
  // from. Bigger untagged footprints keep the legacy curve untouched.
  let inferredHouse = false;
  // Round 19 (A HOMESTEAD): the typology band this footprint took, or null.
  // Carried onto the item because THREE later sites read it — the roof
  // palette band, the NEUTRAL_UV wall contract, and the housePts emission.
  let typo = null;
  if (h <= 0) {
    if (RS.enabled && it.areaM2 <= RS.houseInfer.maxAreaM2) {
      const hb = RS.houseInfer.hM;
      h = hb[0] + hash * (hb[1] - hb[0]);
      inferredHouse = true;
    } else if ((typo = pickTypology(it, tileCtx))) {
      // Round 19 — TYPOLOGY INFERENCE (suburban context only; pickTypology
      // returns null everywhere else, so the legacy curve below is
      // untouched byte-for-byte over every downtown).
      h = typo.hM[0] + hash * (typo.hM[1] - typo.hM[0]);
    } else {
      h = clamp(9 + Math.sqrt(it.areaM2) * 0.5, S.minH, 42) * (0.85 + hash * 0.3);
    }
  }
  // The S.minH (6 m) floor exists so a mapped 2 m shed isn't a decal; a
  // DELIBERATELY inferred 5 m house must not be dragged up by it (that would
  // compress the [5,8] band to [6,8] and undo half the fix). Round 19: the
  // typology bands are authored as ABSOLUTE metre bands for the same reason
  // — every one of them starts at or above S.minH today, so this is an
  // identity right now, but a future tune down to 5 m must not be silently
  // clamped back up.
  if (!inferredHouse && !typo) h = Math.max(h, S.minH);
  if (h > B.kneeM) h = B.kneeM + (h - B.kneeM) * B.kneeSlope;
  h = Math.min(h, B.maxH);
  if (visuals && Number.isFinite(Number(it.rawH)) && Number(it.rawH) > 0) h = Number(it.rawH); // Mapped heights are never stylized in cinematic.
  return { h, hash, typo, inferredHouse };
}

function farHeight(it, tileCtx) {
  const B = TOY_WORLD.buildings;
  const FS = SAT_FAR_SUBURB;
  const visuals = tileCtx.visuals === true;
  const rawH = it.rawH;
  const hash = (((it.id * 2654435761) >>> 0) % 4096) / 4096;
  // Area-only picks carry no mapped height: infer enough bulk to read as a
  // block (a 2500 m² untagged footprint is a warehouse/mall, not a house).
  let h;
  if (rawH > 0) h = rawH;
  else if (it.hatch) h = Math.min(FS.hardCapM, FS.hM[0] + hash * (FS.hM[1] - FS.hM[0]));
  else h = clamp01Range(12 + Math.sqrt(it.areaM2) * 0.6, 18, 60) * (0.9 + hash * 0.2);
  if (h > B.kneeM) h = B.kneeM + (h - B.kneeM) * B.kneeSlope; // same soft knee as the near ring
  h = Math.min(h, B.maxH);
  if (visuals && Number.isFinite(Number(rawH)) && Number(rawH) > 0) h = Number(rawH);
  return { h, hash, typo: null, inferredHouse: false };
}

/**
 * @param item    an admitted footprint (see the header for the fields each ring reads)
 * @param tileCtx the build's context (worker/tile-ctx.js); 'near' also reads
 *                tileCtx.suburban, set by sat-buildings/index.js
 * @param ring    'near' | 'far'
 */
function heightOf(item, tileCtx, ring) {
  return ring === 'far' ? farHeight(item, tileCtx) : nearHeight(item, tileCtx);
}

export { heightOf, clamp01Range };
