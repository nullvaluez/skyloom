/**
 * World Pass W0 (worker split): satellite roof and rooftop geometry. Stream A
 * (TRUTH, later roof forms) owns this file.
 *
 *   createRoofState()   the per-tile caps and the `forms` telemetry (meta.forms)
 *   emitCoverageGable(satB, pushV, item, r)   the Enhanced gable on a
 *       coverage-only (non-detailed) house
 *   emitRoof(st, satB, pushV, item, r)   the R18 roof dispatch by height band
 *       (or the R15 dispatch verbatim with ROOFS_SAT off)
 *   pushInsetPeak / pushShed / pushPenthouse / pushWaterTank / pushChimney /
 *   pushMastSat / pushAntennaFarmSat / pushCrownSat / pushSpireSat and their
 *   helpers insetRing / hashPointIn: the satellite-only forms.
 *
 * pushGable / pushParapet / pushHvacBoxes / pushAABBox / simplifyRing live in
 * ../geom.js because the Neon/toy path draws with them too; a new satellite
 * form is a new function HERE, never an edit there.
 *
 * Moved VERBATIM from vector-tile.worker.js (c2bf5c06). The dispatch bodies
 * are the per-building loop's text with the per-tile counters held in `st`
 * (loaded into locals and written back, so the text is unchanged).
 */
import earcut from 'earcut';
import { ROOFS, ROOFS_SAT, SAT_BUILDINGS } from '../../../fly-constants';
import { signedArea, pointInPoly, mulberry32, ringCentroid, simplifyRing, pushGable, pushParapet, pushAABBox, pushHvacBoxes } from '../geom';

// --- Round 18 (A1 "BLOCKSMITH") SATELLITE roof-form helpers ------------------
// NEW functions, every one of them — the toy helpers above are FROZEN (their
// output is what keeps Neon byte-identical) and two of them (pushCrown /
// pushSpire) call pushV with SEVEN args to encode the neon emissive role,
// which the satellite path deliberately cannot carry. Everything below calls
// pushV with EXACTLY FOUR args, which on the satellite path means NEUTRAL_UV:
// the atlas's solid-white pier crossing, sampled at mip 0 because a constant
// uv has zero screen-space derivative. That is THE window-free roof contract —
// a 5th/6th arg here would put window panes on a chimney.
//
// Horizontal sizes arrive in world (mercator) meters and are converted to tile
// units by the caller's mToTile, matching the footprint's own frame; heights
// are meters directly (the vertical axis is unstretched).

/** Ring scaled toward its centroid by (1 - insetFrac). */
function insetRing(ring, insetFrac) {
  const c = ringCentroid(ring);
  return ring.map((p) => ({
    x: c.x + (p.x - c.x) * (1 - insetFrac),
    y: c.y + (p.y - c.y) * (1 - insetFrac),
  }));
}

/** Deterministic point strictly inside `poly`, with `halfTile` clearance. */
function hashPointIn(poly, rand, halfTile, tries = 12) {
  const ring = poly.outer;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of ring) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  for (let t = 0; t < tries; t++) {
    const sx = minX + rand() * (maxX - minX);
    const sy = minY + rand() * (maxY - minY);
    if (!pointInPoly(poly, sx, sy)) continue;
    // both diagonals inside ⇒ the whole box/prism lands on the roof (the
    // pushHvacBoxes placement test, reused so clutter never overhangs an eave)
    if (halfTile > 0) {
      if (!pointInPoly(poly, sx - halfTile, sy - halfTile)) continue;
      if (!pointInPoly(poly, sx + halfTile, sy + halfTile)) continue;
    }
    return { x: sx, y: sy };
  }
  return null;
}

/**
 * THE WORKHOUSE FORM. Outer rim ring at roofY → the same ring scaled toward
 * its centroid by (1 - insetFrac), raised to roofY + riseM: n side quads + an
 * earcut cap of the inset ring. One primitive covers three real roof forms by
 * insetFrac alone —
 *   0.42 on a 4-corner ring  ≈ HIP      (four sloped planes, short ridge)
 *   0.25 on a low-rise       ≈ MANSARD  (steep skirt, big flat deck)
 *   0.55 on a 3/5/6-corner   ≈ PYRAMID  (truncated, reads as a peak)
 * — which is why it, not a per-form generator, is the small-band workhorse.
 *
 * CONCAVITY GUARD: scaling toward the centroid is only shape-preserving for
 * convex-ish rings. On a deep L/U footprint the inset ring can fold through
 * itself, which earcut would happily tessellate into a knot of inside-out
 * triangles. A self-intersecting inset flips or blows up the ring's SIGNED
 * AREA, so we test exactly that (sign must hold, magnitude must shrink) and
 * bail to flat when it fails. Returns true iff geometry was emitted.
 */
function pushInsetPeak(building, pushV, ring, roofY, riseM, insetFrac, col) {
  const n = ring.length;
  if (n < 3) return false;
  const inner = insetRing(ring, insetFrac);
  const a0 = signedArea(ring);
  const a1 = signedArea(inner);
  if (!(Math.abs(a0) > 1e-9)) return false;
  if (Math.sign(a1) !== Math.sign(a0)) return false; // folded through itself
  const shrink = Math.abs(a1) / Math.abs(a0);
  if (!(shrink > 0.02 && shrink < 1)) return false; // degenerate or grew
  const peakY = roofY + riseM;
  for (let e = 0, j = n - 1; e < n; j = e++) {
    const a = ring[j];
    const b = ring[e];
    const ia = inner[j];
    const ib = inner[e];
    const v0 = pushV(a.x, a.y, roofY, col);
    const v1 = pushV(b.x, b.y, roofY, col);
    const v2 = pushV(ib.x, ib.y, peakY, col);
    const v3 = pushV(ia.x, ia.y, peakY, col);
    building.idx.push(v0, v2, v1, v0, v3, v2);
  }
  // cap the inset ring (same winding flip the footprint roof cap uses — MVT
  // exteriors wind CW in y-down tile coords)
  const flat = [];
  for (const p of inner) flat.push(p.x, p.y);
  const tris = earcut(flat);
  if (tris.length === 0) return true; // sides already read as a roof
  const base = building.vtx;
  for (const p of inner) pushV(p.x, p.y, peakY, col);
  for (let t = 0; t < tris.length; t += 3) {
    building.idx.push(base + tris[t], base + tris[t + 2], base + tris[t + 1]);
  }
  return true;
}

/**
 * Single-pitch SHED roof on a 4-corner ring: one tilted quad plus the two
 * triangular ends that fill the wedge over the sloping side walls. `edgePick`
 * (any integer, hashed by the caller) chooses which edge is raised, so a row
 * of identical warehouses doesn't all lean the same way.
 */
function pushShed(building, pushV, quad, roofY, riseM, col, edgePick) {
  const hi = ((edgePick % 4) + 4) % 4;
  const highY = roofY + riseM;
  const isHigh = (i) => i === hi || i === (hi + 1) % 4;
  const v = [];
  for (let i = 0; i < 4; i++) v.push(pushV(quad[i].x, quad[i].y, isHigh(i) ? highY : roofY, col));
  building.idx.push(v[0], v[1], v[2], v[0], v[2], v[3]); // the tilted plane
  // the two side wedges: high corner up top, both corners of that edge at eave
  const wedge = (hiIdx, loIdx) => {
    const t0 = pushV(quad[hiIdx].x, quad[hiIdx].y, highY, col);
    const t1 = pushV(quad[hiIdx].x, quad[hiIdx].y, roofY, col);
    const t2 = pushV(quad[loIdx].x, quad[loIdx].y, roofY, col);
    building.idx.push(t0, t1, t2);
  };
  wedge((hi + 1) % 4, (hi + 2) % 4);
  wedge(hi, (hi + 3) % 4);
}

/**
 * Stair/lift head-house: ONE centered AABB at `spanFrac` of the short
 * footprint span. Uses the both-diagonals-inside placement test so it never
 * overhangs on an L-shaped roof; returns false (caller falls back) if the
 * footprint can't hold it.
 */
function pushPenthouse(building, pushV, poly, roofY, cfg, mToTile, hash, col) {
  const ring = poly.outer;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of ring) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const span = Math.min(maxX - minX, maxY - minY);
  const frac = cfg.spanFrac[0] + hash * (cfg.spanFrac[1] - cfg.spanFrac[0]);
  const half = (span * frac) / 2;
  if (half <= 0) return false;
  const c = ringCentroid(ring);
  if (!pointInPoly(poly, c.x - half, c.y - half) || !pointInPoly(poly, c.x + half, c.y + half))
    return false;
  const hM = cfg.hM[0] + hash * (cfg.hM[1] - cfg.hM[0]);
  pushAABBox(building, pushV, c.x, c.y, half, roofY, roofY + hM, col);
  // mToTile is unused for the span-relative size but kept in the signature so
  // every clutter helper reads the same way at the call site.
  void mToTile;
  return true;
}

/** Rooftop water tank: 6-sided prism + a 6-triangle conical cap. */
function pushWaterTank(building, pushV, poly, roofY, rM, hM, mToTile, rand, col) {
  const N = 6;
  const r = rM * mToTile;
  const at = hashPointIn(poly, rand, r);
  if (!at) return false;
  const capY = roofY + hM;
  const apexY = capY + hM * 0.35;
  const px = [];
  const py = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    px.push(at.x + Math.cos(a) * r);
    py.push(at.y + Math.sin(a) * r);
  }
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    const s0 = pushV(px[i], py[i], roofY, col);
    const s1 = pushV(px[j], py[j], roofY, col);
    const s2 = pushV(px[j], py[j], capY, col);
    const s3 = pushV(px[i], py[i], capY, col);
    building.idx.push(s0, s2, s1, s0, s3, s2);
  }
  const apex = pushV(at.x, at.y, apexY, col);
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    const c0 = pushV(px[i], py[i], capY, col);
    const c1 = pushV(px[j], py[j], capY, col);
    building.idx.push(c0, c1, apex);
  }
  return true;
}

/** Brick flue near the ridge — the detail that says "house" from 600 m. */
function pushChimney(building, pushV, poly, roofY, topY, halfM, mToTile, rand, col) {
  const half = halfM * mToTile;
  // Bias toward the middle of the roof (that is where a ridge is) by lerping
  // a sampled point 60% of the way back to the centroid, then re-testing.
  const c = ringCentroid(poly.outer);
  const at = hashPointIn(poly, rand, half);
  if (!at) return false;
  const bx = c.x + (at.x - c.x) * 0.4;
  const by = c.y + (at.y - c.y) * 0.4;
  const ok = pointInPoly(poly, bx - half, by - half) && pointInPoly(poly, bx + half, by + half);
  const fx = ok ? bx : at.x;
  const fy = ok ? by : at.y;
  pushAABBox(building, pushV, fx, fy, half, roofY, topY, col);
  return true;
}

/**
 * 4-sided tapered mast — the daylight twin of pushSpire, with NO emissive tip
 * (a plain top cap instead of the neon quad, and 4-arg pushV throughout).
 * `tipCol` is PAINT, not glow: a white-painted mast head is photo-plausible on
 * daylight imagery; an emissive one would need attrs this path doesn't carry.
 */
function pushMastSat(building, pushV, cx, cy, y0, hM, baseRTile, mastCol, tipCol) {
  const tipY = y0 + hM;
  const r = baseRTile;
  const tipR = r * 0.15;
  const base = [
    [cx - r, cy - r],
    [cx + r, cy - r],
    [cx + r, cy + r],
    [cx - r, cy + r],
  ];
  const top = [
    [cx - tipR, cy - tipR],
    [cx + tipR, cy - tipR],
    [cx + tipR, cy + tipR],
    [cx - tipR, cy + tipR],
  ];
  for (let s = 0; s < 4; s++) {
    const a = base[s];
    const b = base[(s + 1) % 4];
    const tb = top[(s + 1) % 4];
    const ta = top[s];
    const m0 = pushV(a[0], a[1], y0, mastCol);
    const m1 = pushV(b[0], b[1], y0, mastCol);
    const m2 = pushV(tb[0], tb[1], tipY, mastCol);
    const m3 = pushV(ta[0], ta[1], tipY, mastCol);
    building.idx.push(m0, m2, m1, m0, m3, m2);
  }
  const q0 = pushV(top[0][0], top[0][1], tipY, tipCol);
  const q1 = pushV(top[1][0], top[1][1], tipY, tipCol);
  const q2 = pushV(top[2][0], top[2][1], tipY, tipCol);
  const q3 = pushV(top[3][0], top[3][1], tipY, tipCol);
  building.idx.push(q0, q2, q1, q0, q3, q2);
  return tipY;
}

/** 2–4 masts at hashed points — the antenna farm on a 45–120 m roof. */
function pushAntennaFarmSat(building, pushV, poly, roofY, cfg, mToTile, rand, col) {
  const [lo, hi] = cfg.antennaCount;
  const want = lo + ((rand() * (hi - lo + 1)) | 0);
  let placed = 0;
  for (let i = 0; i < want; i++) {
    const rM = cfg.antenna.baseRM[0] + rand() * (cfg.antenna.baseRM[1] - cfg.antenna.baseRM[0]);
    const rTile = rM * mToTile;
    const at = hashPointIn(poly, rand, rTile);
    if (!at) continue;
    const hM = cfg.antenna.hM[0] + rand() * (cfg.antenna.hM[1] - cfg.antenna.hM[0]);
    pushMastSat(building, pushV, at.x, at.y, roofY, hM, rTile, col, col);
    placed += 1;
  }
  return placed;
}

/**
 * Supertall CROWN: two stacked setback steps ABOVE the roofline. Note this is
 * NOT the toy pushCrown geometry — that draws an inset band just UNDER the
 * roofline, which only reads because it is emissive; on the satellite path an
 * inset band below the cap is buried inside the solid wall box and invisible.
 * Stepping UP is what makes a tower top read as a crown in daylight.
 */
function pushCrownSat(building, pushV, ring, roofY, stepM, stepInset, col) {
  let y = roofY;
  let cur = ring;
  let any = false;
  for (let s = 0; s < stepM.length; s++) {
    const inner = insetRing(cur, stepInset[s]);
    const a0 = signedArea(cur);
    const a1 = signedArea(inner);
    if (!(Math.abs(a0) > 1e-9) || Math.sign(a1) !== Math.sign(a0)) break;
    const shrink = Math.abs(a1) / Math.abs(a0);
    if (!(shrink > 0.05 && shrink < 1)) break;
    const y1 = y + stepM[s];
    const n = inner.length;
    for (let e = 0, j = n - 1; e < n; j = e++) {
      const a = inner[j];
      const b = inner[e];
      const v0 = pushV(a.x, a.y, y, col);
      const v1 = pushV(b.x, b.y, y, col);
      const v2 = pushV(b.x, b.y, y1, col);
      const v3 = pushV(a.x, a.y, y1, col);
      building.idx.push(v0, v2, v1, v0, v3, v2);
    }
    const flat = [];
    for (const p of inner) flat.push(p.x, p.y);
    const tris = earcut(flat);
    const base = building.vtx;
    for (const p of inner) pushV(p.x, p.y, y1, col);
    for (let t = 0; t < tris.length; t += 3) {
      building.idx.push(base + tris[t], base + tris[t + 2], base + tris[t + 1]);
    }
    y = y1;
    cur = inner;
    any = true;
  }
  return any;
}

/** Supertall SPIRE: a scaled-up mast with a white-PAINTED (not lit) tip. */
function pushSpireSat(building, pushV, ring, roofY, spireHM, baseRM, mToTile, mastCol, tipCol) {
  const c = ringCentroid(ring);
  return pushMastSat(
    building,
    pushV,
    c.x,
    c.y,
    roofY,
    spireHM,
    baseRM * mToTile,
    mastCol,
    tipCol
  );
}

/** The per-tile roof caps and form telemetry (meta.forms keeps this key order). */
function createRoofState() {
  return {
    nParapet: 0,
    nHvac: 0,
    nGable: 0,
    // Round 18: per-chunk caps + form telemetry. `forms` is what
    // verify-roof-variety reads to prove the dispatch actually produces variety
    // (≥ 4 distinct forms with nonzero counts, flat-only share ≤ 5%).
    nSmallForm: 0,
    nClutter: 0,
    nChimney: 0,
    forms: {
      gable: 0,
      hip: 0,
      shed: 0,
      pyramid: 0,
      mansard: 0,
      parapet: 0,
      penthouse: 0,
      tank: 0,
      hvac: 0,
      chimney: 0,
      antenna: 0,
      crown: 0,
      spire: 0,
      flat: 0, // buildings that ended the dispatch with NO treatment at all
    },
  };
}

/**
 * Enhanced only: a coverage body (a mapped footprint outside the detailed
 * subset) of a small family-0 house still gets a simple gable.
 * r: { visuals, detailed, style, outer, roofY, roofCol }
 */
function emitCoverageGable(satB, pushV, item, r) {
  const { visuals, detailed, style, outer, roofY, roofCol } = r;
  const RS = ROOFS_SAT;
  if(visuals&&!detailed.has(item)&&style.family===0&&item.h<16&&(style.roofRise??1)>0){
    const simple=simplifyRing(outer,RS.simplifyTolTile);
    if(simple.length===4)pushGable(satB,pushV,simple,roofY,(2+item.hash)*(style.roofRise??1),roofCol);
  }
}

/**
 * The roof dispatch for one building.
 * st: createRoofState()   r: { frame (the tileCtx), visuals, detailed (Set),
 *   levels, style, outer, roofY, roofCol, parapetCol, hash2, mToTile, kA,
 *   tones (colour.js clutterTones()) }
 */
function emitRoof(st, satB, pushV, item, r) {
  const { frame, visuals, detailed, levels, style, outer, roofY, roofCol, parapetCol, hash2, mToTile, kA, tones } = r;
  const { hvacCol, chimneyCol, tankCol, penthouseCol, mastCol, spireCol, spireTipCol } = tones;
  const S = SAT_BUILDINGS;
  const RS = ROOFS_SAT;
  const RT = S.roofTones;
  const forms = st.forms;
  let { nParapet, nHvac, nGable, nSmallForm, nClutter, nChimney } = st;
  // ---- Round 18 (A1) SATELLITE ROOF DISPATCH -----------------------------
  // Replaces the R15 three-way (gable | parapet | HVAC). That dispatch left
  // the city almost roofless in practice: a gable needed an EXACT 4-corner
  // ring AND h < 16 AND area < 400 m² (most houses failed at least one), a
  // parapet needed h ≥ 18 AND area ≥ 250, so NOTHING happened between 16 and
  // 18 m, nothing above 120 m (crowns/spires were toy-only), and there was
  // no rooftop clutter of any kind. Bands below are height-ordered, first
  // match wins on FORM, and clutter is additive + capped. Every knob is in
  // ROOFS_SAT; the whole block is skipped (and the R15 code runs verbatim
  // below) when ROOFS_SAT.enabled is false.
  if (S.roofDetail && RS.enabled && (!visuals || detailed.has(item)) && !levels) {
    const simp = simplifyRing(outer, RS.simplifyTolTile);
    const nC = simp.length;
    const h = item.h;
    const poly0 = item.polys[0];
    // Own RNG stream per building, seeded off the stable feature id: the same
    // rooftop gets the same clutter in every session, and it can't be
    // perturbed by how many buildings were drawn before it.
    const rand = mulberry32((Math.imul(item.id, 2654435761) ^ 0x9e3779b9) >>> 0);
    const rise = (RS.small.riseM[0] + item.hash * (RS.small.riseM[1] - RS.small.riseM[0])) * (style?.roofRise ?? 1);
    const MID_MAX = RT.tallMinH; // 45 — the band edge the roof palette already uses
    const SUPER_MIN = RS.super.minH; // 120
    let treated = false;

    if(visuals && rise===0 && h<RS.small.maxH){
      pushParapet(satB,pushV,outer,roofY,.45,.035,parapetCol);forms.parapet++;treated=true;
    } else if (h < RS.small.maxH && item.areaM2 < RS.small.maxAreaM2) {
      // --- SMALL BAND: houses + low commercial. This is the band the suburb
      // fix feeds, and it is where "a real city from the air" is won or lost.
      if (nSmallForm < RS.caps.smallForm) {
        if (nC === 4) {
          if (item.hash < RS.small.gableFrac) {
            pushGable(satB, pushV, simp, roofY, rise, roofCol);
            forms.gable += 1;
            nGable += 1;
            treated = true;
          } else if (item.hash < RS.small.hipFrac) {
            if (pushInsetPeak(satB, pushV, simp, roofY, rise, RS.small.hipInsetFrac, roofCol)) {
              forms.hip += 1;
              treated = true;
            }
          } else {
            pushShed(satB, pushV, simp, roofY, rise, roofCol, item.id >>> 3);
            forms.shed += 1;
            treated = true;
          }
        } else if (nC === 3 || nC === 5 || nC === 6) {
          if (pushInsetPeak(satB, pushV, simp, roofY, rise, RS.small.pyramidInsetFrac, roofCol)) {
            forms.pyramid += 1;
            treated = true;
          }
        }
        if (treated) nSmallForm += 1;
      }
      // A chimney rides a pitched roof at chimneyFrac; a >6-corner ring stays
      // flat by design (no believable single pitch) but always earns one, so
      // the complex footprints are not the bare patch in a suburb.
      const wantChimney = nC > 6 || (treated && hash2 < RS.small.chimneyFrac);
      if (wantChimney && nChimney < RS.caps.chimney) {
        const cc = RS.small.chimney;
        const top =
          roofY + (treated ? rise : 0) + cc.riseM[0] + item.hash * (cc.riseM[1] - cc.riseM[0]);
        if (pushChimney(satB, pushV, poly0, roofY, top, cc.halfM, mToTile, rand, chimneyCol)) {
          nChimney += 1;
          forms.chimney += 1;
          treated = true;
        }
      }
    } else if (h < MID_MAX) {
      // --- MID BAND 16–45 m: parapet OR mansard, then ONE clutter pick.
      // Mansard and parapet are mutually exclusive on purpose — a real
      // mansard IS the building's lip; ringing one with a parapet reads as
      // two hats.
      let mansard = false;
      if (
        nC === 4 && (!(frame.sceneryForms||frame.showcaseEarth) || !visuals || (style?.roofRise??1)>0) &&
        h < RS.mid.mansardMaxH &&
        item.hash < RS.mid.mansardFrac &&
        nSmallForm < RS.caps.smallForm
      ) {
        if (pushInsetPeak(satB, pushV, simp, roofY, rise, RS.mid.mansardInsetFrac, roofCol)) {
          nSmallForm += 1;
          forms.mansard += 1;
          mansard = true;
          treated = true;
        }
      }
      if (!mansard && item.areaM2 >= RS.mid.parapetMinAreaM2 && nParapet < RS.caps.parapet) {
        pushParapet(satB, pushV, outer, roofY, ROOFS.parapet.heightM, ROOFS.parapet.insetFrac, parapetCol);
        nParapet += 1;
        forms.parapet += 1;
        treated = true;
      }
      if (nClutter < RS.caps.clutter) {
        if (hash2 < RS.mid.penthouseFrac) {
          if (pushPenthouse(satB, pushV, poly0, roofY, RS.mid.penthouse, mToTile, item.hash, penthouseCol)) {
            nClutter += 1;
            forms.penthouse += 1;
            treated = true;
          }
        } else if (hash2 < RS.mid.tankFrac && item.areaM2 >= RS.mid.tankMinAreaM2) {
          const rM = RS.mid.tankRM[0] + item.hash * (RS.mid.tankRM[1] - RS.mid.tankRM[0]);
          const tH = RS.mid.tankHM[0] + item.hash * (RS.mid.tankHM[1] - RS.mid.tankHM[0]);
          if (pushWaterTank(satB, pushV, poly0, roofY, rM, tH, mToTile, rand, tankCol)) {
            nClutter += 1;
            forms.tank += 1;
            treated = true;
          }
        } else if (pushHvacBoxes(satB, pushV, poly0, roofY, ROOFS.hvac, mToTile, rand, hvacCol) > 0) {
          nHvac += 1;
          nClutter += 1;
          forms.hvac += 1;
          treated = true;
        }
      }
    } else if (h < SUPER_MIN) {
      // --- TALL BAND 45–120 m: parapet + penthouse-or-HVAC + antenna farms.
      if (item.areaM2 >= RS.mid.parapetMinAreaM2 && nParapet < RS.caps.parapet) {
        pushParapet(satB, pushV, outer, roofY, ROOFS.parapet.heightM, ROOFS.parapet.insetFrac, parapetCol);
        nParapet += 1;
        forms.parapet += 1;
        treated = true;
      }
      if (nClutter < RS.caps.clutter) {
        if (hash2 < RS.mid.penthouseFrac) {
          if (pushPenthouse(satB, pushV, poly0, roofY, RS.mid.penthouse, mToTile, item.hash, penthouseCol)) {
            nClutter += 1;
            forms.penthouse += 1;
            treated = true;
          }
        } else if (pushHvacBoxes(satB, pushV, poly0, roofY, ROOFS.hvac, mToTile, rand, hvacCol) > 0) {
          nHvac += 1;
          nClutter += 1;
          forms.hvac += 1;
          treated = true;
        }
      }
      if (item.hash < RS.tall.antennaFrac && nClutter < RS.caps.clutter) {
        if (pushAntennaFarmSat(satB, pushV, poly0, roofY, RS.tall, mToTile, rand, mastCol) > 0) {
          nClutter += 1;
          forms.antenna += 1;
          treated = true;
        }
      }
    } else {
      // --- SUPERTALL ≥ 120 m: the skyline read. Geometry only — a photo-
      // plausible stone/mechanical crown or a painted mast. NO emissive:
      // night windows ride the NEUTRAL_UV texel and an emissive vert here
      // would need the neon attrs this path deliberately does not carry.
      if (visuals) {
        // Ordinary mapped towers receive a mechanical roof inside the envelope.
        // Landmark silhouettes are supplied by the separately mapped models.
        pushParapet(satB, pushV, outer, roofY-.6, .6, ROOFS.parapet.insetFrac, parapetCol);
        forms.parapet += 1;
        treated = true;
      } else if (item.hash < RS.super.crownFrac) {
        const crownCol = roofCol.map((c) => c * RS.super.crownGain);
        if (pushCrownSat(satB, pushV, outer, roofY, RS.super.crownStepM, RS.super.crownStepInset, crownCol)) {
          forms.crown += 1;
          treated = true;
        }
      } else {
        const sp = RS.super.spire;
        const spireH = h * (sp.hFrac[0] + item.hash * (sp.hFrac[1] - sp.hFrac[0]));
        pushSpireSat(satB, pushV, outer, roofY, spireH, sp.baseRM, mToTile, spireCol, spireTipCol);
        forms.spire += 1;
        treated = true;
      }
      if (nParapet < RS.caps.parapet) {
        pushParapet(satB, pushV, outer, roofY, ROOFS.parapet.heightM, ROOFS.parapet.insetFrac, parapetCol);
        nParapet += 1;
        forms.parapet += 1;
      }
    }

    // "ALWAYS-SOMETHING" guarantee: no band may leave a building bare while
    // its caps still have room. A chimney lands on any house footprint; a
    // parapet lands on any ring at all. Only a genuinely exhausted cap (or a
    // degenerate polygon) produces a flat roof — verify-roof-variety gates
    // that share at ≤ 5% of extruded buildings.
    // Complex low commercial roofs gain an actual inset lip under the SAME
    // parapet cap. Houses retain their pitched forms and chimney dispatch.
    if(visuals&&!treated&&h>=8&&h<RS.small.maxH&&nC>6&&item.areaM2/(kA*kA)>180&&nParapet<RS.caps.parapet){
      pushParapet(satB,pushV,outer,roofY,ROOFS.parapet.heightM,ROOFS.parapet.insetFrac,parapetCol);
      nParapet++;forms.parapet++;treated=true;
    }
    if (!treated) {
      if (h < RS.small.maxH) {
        if (nChimney < RS.caps.chimney) {
          const cc = RS.small.chimney;
          const top = roofY + cc.riseM[0] + item.hash * (cc.riseM[1] - cc.riseM[0]);
          if (pushChimney(satB, pushV, poly0, roofY, top, cc.halfM, mToTile, rand, chimneyCol)) {
            nChimney += 1;
            forms.chimney += 1;
            treated = true;
          }
        }
      } else if (nParapet < RS.caps.parapet) {
        pushParapet(satB, pushV, outer, roofY, ROOFS.parapet.heightM, ROOFS.parapet.insetFrac, parapetCol);
        nParapet += 1;
        forms.parapet += 1;
        treated = true;
      }
    }
    if (!treated) forms.flat += 1;
  } else if (S.roofDetail && !visuals) {
    // ---- R15 dispatch, VERBATIM (the ROOFS_SAT.enabled:false revert path).
    // Do not "clean this up" — its job is to be byte-identical to pre-R18.
    const simp = simplifyRing(outer, 2);
    if (
      item.h < ROOFS.gable.maxH &&
      item.areaM2 < ROOFS.gable.maxAreaM2 &&
      simp.length === 4 &&
      nGable < ROOFS.gable.maxPerChunk
    ) {
      const rise = ROOFS.gable.riseM[0] + item.hash * (ROOFS.gable.riseM[1] - ROOFS.gable.riseM[0]);
      pushGable(satB, pushV, simp, roofY, rise, roofCol);
      nGable += 1;
    } else if (
      item.h >= ROOFS.parapet.minH &&
      item.areaM2 >= ROOFS.parapet.minAreaM2 &&
      nParapet < ROOFS.parapet.maxPerChunk
    ) {
      pushParapet(satB, pushV, outer, roofY, ROOFS.parapet.heightM, ROOFS.parapet.insetFrac, parapetCol);
      nParapet += 1;
    }
    if (
      item.h >= ROOFS.hvac.minH &&
      item.h < ROOFS.hvac.maxH &&
      item.hash < ROOFS.hvac.frac &&
      nHvac < ROOFS.hvac.maxPerChunk
    ) {
      const rand = mulberry32((item.id * 2654435761) >>> 0);
      if (pushHvacBoxes(satB, pushV, item.polys[0], roofY, ROOFS.hvac, mToTile, rand, hvacCol) > 0)
        nHvac += 1;
    }
  }
  st.nParapet = nParapet;
  st.nHvac = nHvac;
  st.nGable = nGable;
  st.nSmallForm = nSmallForm;
  st.nClutter = nClutter;
  st.nChimney = nChimney;
}

export { createRoofState, emitCoverageGable, emitRoof, insetRing, hashPointIn, pushInsetPeak, pushShed, pushPenthouse, pushWaterTank, pushChimney, pushMastSat, pushAntennaFarmSat, pushCrownSat, pushSpireSat };
