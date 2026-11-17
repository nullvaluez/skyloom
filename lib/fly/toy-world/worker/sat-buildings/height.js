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
import { pickTypology, truthTable } from './typology';

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

// --- WORLD PASS A (TRUTH): ONE height law -----------------------------------
// Read only while tileCtx.worldPass.truth.on && .heights (the request; rule 1).
// A mapped height (a real tag, not OpenMapTiles' synthesized 5) passes through
// the legacy rule untouched, so mapped Manhattan keeps its heights. An
// unmapped one comes from the tile's fact table (typology.js truthTable), the
// same table in the near ring, the far mass and the style classifier:
//   (a) its typology class (shed, house, terrace, apartment, block,
//       commercial, civic, industrial, bigbox);
//   (b) area-matched evidence: the mapped heights of ground-standing
//       buildings of the same class in the same tile with area in
//       [A / band, A * band], at least minSample of them. Where the class is
//       well mapped in the tile (representativeShare) the building takes a
//       quantile of that sample (its own, from its sid), so the unmapped ones
//       vary the way the mapped ones do; where it is sparsely mapped (the
//       mapped ones are the tall and notable) the sample median is averaged
//       with the prior's centre;
//   (c) else the regional prior: a centre in storeys (the class's `mu`, or for
//       density classes the local open-land-corrected cover blended with the
//       footprint's size), and a spread around it;
// then quantised to storeys (residential, commercial with a tall ground
// floor, civic) and capped at maxInventedM: nothing unmapped is ever a tower.
// Round 2: the spread is a deterministic draw per building (from its sid), so
// a district is not one height: house regions mix one and two storeys, dense
// cores spread over two or three storeys instead of piling on the prior's top.

/** Stable per-building hashes from the cross-tile id (seam halves agree). */
function truthHashes(sid) {
  return {
    hash: ((Math.imul(sid, 2654435761) >>> 0) % 4096) / 4096,
    hash2: (((Math.imul(sid, 2246822519) + 374761393) >>> 0) % 4096) / 4096,
  };
}

/** A uniform draw in [0, 1) from the sid; `m` picks an independent stream. */
function truthU(sid, m) {
  let h = Math.imul(sid ^ m, 0x27d4eb2d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return ((h >>> 0) % 65536) / 65536;
}

/** A bounded, roughly normal draw from the sid (Irwin-Hall of 3, unit sd). */
function truthNormal(sid) {
  return (truthU(sid, 0x165667b1) + truthU(sid, 0x5bd1e995) + truthU(sid, 0x68e31da4) - 1.5) / 0.5;
}

function storeyHeight(s, kind, H) {
  if (kind === 'com') return H.com.groundM + (s - 1) * H.com.floorM;
  const K = kind === 'civic' ? H.civic : H.res;
  return K.plinthM + s * K.floorM;
}

function storeysOf(h, kind, H) {
  if (kind === 'com') return 1 + (h - H.com.groundM) / H.com.floorM;
  const K = kind === 'civic' ? H.civic : H.res;
  return (h - K.plinthM) / K.floorM;
}

/**
 * The sorted mapped heights of the same class in the area band, or null below
 * minSample. `exclude` (the hold-out probe) leaves one entry out. Without it
 * the window is centred on the area quantised to 1/8 octave and cached, so the
 * answer never depends on the order the rings ask in.
 */
function truthEvidence(T, e, exclude) {
  const list = T.evidence.get(e.cls);
  if (!list || list.length === 0) return null;
  const EV = T.W.heights.evidence;
  const q = Math.round(Math.log2(Math.max(1, e.wholeM2)) * 8);
  const key = `${e.cls}|${q}`;
  if (!exclude && T.evCache.has(key)) return T.evCache.get(key);
  const A = exclude ? e.wholeM2 : 2 ** (q / 8);
  const lo = A / EV.band;
  const hi = A * EV.band;
  let a = 0;
  let b = list.length;
  while (a < b) {
    const m = (a + b) >> 1;
    if (list[m].wholeM2 < lo) a = m + 1;
    else b = m;
  }
  const hs = [];
  for (let i = a; i < list.length && list[i].wholeM2 <= hi; i++) if (list[i] !== exclude) hs.push(list[i].rawH);
  let res = null;
  if (hs.length >= EV.minSample) {
    hs.sort((x, y) => x - y);
    res = hs;
  }
  if (!exclude) T.evCache.set(key, res);
  return res;
}

function quantileOf(hs, q) {
  const p = q * (hs.length - 1);
  const i = Math.floor(p);
  const f = p - i;
  return i + 1 < hs.length ? hs[i] * (1 - f) + hs[i + 1] * f : hs[i];
}

/**
 * The law for one table entry, ignoring any mapped height it carries (the
 * hold-out probe hides mapped heights this way). Pure but for T's caches.
 * Returns { h, cls, prov: 'evidence'|'prior'|'density'|'size', storeys }.
 */
function truthHeight(e, T, exclude = null) {
  const H = T.W.heights;
  const R = e.prior ?? T.prior;
  const { hash, hash2 } = truthHashes(e.sid);
  const cls = e.cls;
  const jitter = (hash2 - 0.5) * 2 * H.jitterM;
  const SP = H.spread;
  let h;
  let prov;
  let s = 0;
  if (cls === 'shed') {
    h = H.shedM[0] + hash * (H.shedM[1] - H.shedM[0]);
    prov = 'size';
  } else if (cls === 'industrial' || cls === 'bigbox') {
    const P = H[cls];
    h = P.baseM + P.perDoubling * Math.log2(Math.max(1, e.clsM2) / P.refM2);
    h = Math.round(Math.min(P.maxM, Math.max(P.minM, h)) * 2) / 2 + jitter;
    prov = 'size';
  } else {
    const kind = cls === 'commercial' ? 'com' : cls === 'civic' ? 'civic' : 'res';
    const [lo, hi, mu] = R[cls];
    const ev = e.straddle ? null : truthEvidence(T, e, exclude);
    // the prior's centre: the class's mu, or for a density class the local
    // open-land-corrected cover blended with the footprint's size (bigger
    // plates stand taller in the same street), mapped onto [lo, hi - topGap]
    let m;
    let sd;
    let top = hi;
    if (mu != null) {
      m = mu;
      sd = SP.sdMode;
    } else {
      const C = H.cover;
      const cn = Math.min(1, Math.max(0, (e.coverAdj - C.lo) / (C.hi - C.lo)));
      const A = SP.area[cls];
      let f = cn;
      if (A) {
        const an = Math.min(1, Math.max(0, Math.log2(Math.max(1, e.clsM2) / A.lo) / Math.log2(A.hi / A.lo)));
        f = (1 - A.w) * cn + A.w * an;
      }
      m = lo + (hi - SP.topGap - lo) * f;
      sd = SP.sdDensity;
      top = hi + SP.tail;
    }
    // Evidence is representative only where most of this class is mapped in
    // this tile (NYC, Brooklyn, Paris): there the building takes its own
    // quantile of the matched sample and may stand `headroom` storeys past
    // the prior. Where mapping is sparse (Tokyo, Lagos, Dubai) the mapped
    // ones are the tall and notable: their median is averaged with the prior.
    const rep = (T.classShare.get(cls) ?? 0) >= H.evidence.representativeShare;
    if (ev != null && rep) {
      const q = SP.evQuantile[0] + (SP.evQuantile[1] - SP.evQuantile[0]) * truthU(e.sid, 0x3c6ef372);
      s = Math.round(storeysOf(quantileOf(ev, q), kind, H));
      s = Math.min(hi + (H.evidence.headroom ?? 0), Math.max(lo, s));
      prov = 'evidence';
    } else {
      if (ev != null) {
        // the tall and notable pull the centre up, never past the prior's
        // top: the centre stops topGap under it and the spread does the rest
        // (clipping the draw instead would pile the district on one storey)
        m = Math.min(hi - SP.topGap, (storeysOf(quantileOf(ev, 0.5), kind, H) + m) / 2);
        prov = 'evidence';
      } else prov = mu != null ? 'prior' : 'density';
      s = Math.min(top, Math.max(lo, Math.round(m + sd * truthNormal(e.sid))));
    }
    h = storeyHeight(s, kind, H) + jitter;
  }
  // A representative mapped sample may stand past the invented-height cap
  // (Paris and Madrid map a quarter of their blocks over 24 m), never past
  // maxEvidenceM; everything else stops at maxInventedM.
  const cap = prov === 'evidence' && h > H.maxInventedM && (T.classShare.get(cls) ?? 0) >= H.evidence.representativeShare ? H.maxEvidenceM ?? H.maxInventedM : H.maxInventedM;
  return { h: Math.min(cap, h), cls, prov, storeys: s };
}

/** The resolved law for an entry (cached on the entry). */
function truthResolved(e, T) {
  if (!e._law) e._law = truthHeight(e, T, null);
  return e._law;
}

const TRUTH_FORM = { shed: 'house', house: 'house', terrace: 'house', commercial: 'strip', bigbox: 'bigbox', industrial: 'warehouse', apartment: 'school', block: 'school', civic: 'school' };

function truthOn(tileCtx) {
  const T = tileCtx.worldPass?.truth;
  return !!(T && T.on && T.heights && T.worker);
}

/** Stage counters for the truth law (diag only; one nested key). */
function countTruth(D, item, r) {
  const t = (D.truth ??= { cls: {}, prov: {}, sidMapped: 0 });
  if (r) {
    t.cls[r.cls] = (t.cls[r.cls] ?? 0) + 1;
    t.prov[r.prov] = (t.prov[r.prov] ?? 0) + 1;
  } else t.sidMapped += 1;
}

function truthNear(it, tileCtx) {
  const T = truthTable(tileCtx);
  const e = T.byId.get(it.id);
  if (!e) return null;
  const { hash } = truthHashes(e.sid);
  const D = tileCtx.stages;
  if (it.rawH > 0) {
    if (D) countTruth(D, it, null);
    return { ...nearHeight(it, tileCtx), hash, sid: e.sid };
  }
  const r = truthResolved(e, T);
  if (D) countTruth(D, it, r);
  const form = TRUTH_FORM[r.cls];
  return {
    h: r.h,
    hash,
    typo: { form, roofBand: form === 'house' ? 'low' : 'mid', hM: [r.h, r.h], cls: r.cls },
    inferredHouse: false,
    sid: e.sid,
  };
}

function truthFar(it, tileCtx) {
  if (it.rawH > 0) return null; // mapped: the legacy rule (unchanged)
  const T = truthTable(tileCtx);
  const e = T.byId.get(it.id);
  if (!e) return null;
  const { hash } = truthHashes(e.sid);
  return { h: truthResolved(e, T).h, hash, typo: null, inferredHouse: false, sid: e.sid };
}

/**
 * @param item    an admitted footprint (see the header for the fields each ring reads)
 * @param tileCtx the build's context (worker/tile-ctx.js); 'near' also reads
 *                tileCtx.suburban, set by sat-buildings/index.js
 * @param ring    'near' | 'far'
 * With the truth stream on (heights), the result also carries `sid`.
 */
function heightOf(item, tileCtx, ring) {
  if (truthOn(tileCtx)) {
    const r = ring === 'far' ? truthFar(item, tileCtx) : truthNear(item, tileCtx);
    if (r) return r;
    // far + mapped: the legacy rule; the far ring builds the table only for
    // the unmapped bodies it admits (the far-suburb hatch)
  }
  return ring === 'far' ? farHeight(item, tileCtx) : nearHeight(item, tileCtx);
}

export { heightOf, clamp01Range, truthHeight, truthResolved, truthHashes, truthEvidence, truthNormal, nearHeight, farHeight };
