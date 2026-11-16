/**
 * World Pass W0: per-tile STAGE COUNTERS for the satellite builders (the
 * review's D-P8 / F-P1 telemetry: where do the buildings of a tile go?).
 *
 * Diagnostic only, and OPT-IN: the counters exist only while the worker's
 * `api.setDiag(true)` switch is on (tileCtx.diag), the R21 diag-meta idiom
 * that already gates `vegMeta`. Unlike `vegMeta` there is no always-on revert
 * arm: these keys never existed before W0, so with diag off (the production
 * default, and every flag state) no counter is allocated and the payload is
 * byte-identical to c2bf5c06. With diag on, the builder adds ONE key,
 * `out.wpStages`, after every other key, and changes nothing else.
 *
 * The main thread turns diag on per engine with the `__flyWorldPassDiag` pin
 * (lib/fly/world-pass.js worldPassDiag) and reads the sums off
 * satBuildings.stats.wpStages / satSkyline.stats.wpStages
 * (lib/fly/toy-world/world-pass-stages.js).
 *
 * A stream that adds a stage adds its counter here and increments it in its
 * own module behind `if (D)`; a counter is a plain number, or a `hist`
 * object of integer-metre bins (summed bin-wise by the engines).
 */

/** The 'sat-buildings' (detail ring) stages. */
function createBuildingStages() {
  return {
    ring: 'near',
    features: 0, // polygon features read (type 3, not hide_3d)
    rings: 0, // rings decoded from those features
    clipDropped: 0, // rings with < 3 points after the tile clip
    windingDropped: 0, // clipped rings the winding classification did not use
    polygons: 0, // classified polygons (outer rings) seen
    areaFloorDropped: 0, // per-polygon floor (SAT_POLY_COVER.minAreaM2, 70.4 m2 true)
    areaFloorDropped15to70: 0, // ...of which the TRUE area is in [15, 70) m2
    megaDropped: 0, // the merged mega-block guard (maxFootprintM2)
    airportDropped: 0, // operations-airport footprints (operationsFootprint)
    monumentDropped: 0, // marquee monument exclusion discs
    admitted: 0, // bodies that leave admission (the tile's buildings)
    detailed: 0, // ...of which the detailed (capped) subset
    height: {
      mapped: 0, // a mapped height (render_height / height > 0)
      untaggedSynth5: 0, // OpenMapTiles' synthesized render_height 5, treated as missing
      untagged: 0, // no height tag at all
      inferredHouse: 0, // R18 house band (ROOFS_SAT.houseInfer)
      inferredTypology: 0, // R19 typology band (suburban context)
      inferredCurve: 0, // the legacy sqrt-area curve
      inferredP50: null,
      inferredP90: null,
      mappedP50: null,
      mappedP90: null,
      inferredHist: {}, // integer-metre bins of the final inferred height
      mappedHist: {}, // integer-metre bins of the final mapped height
    },
    _synth5: new WeakSet(), // admission -> height provenance (stripped on finish)
  };
}

/** The 'sat-skyline' (far mass) stages. */
function createSkylineStages() {
  return {
    ring: 'far',
    features: 0,
    polygons: 0, // classified polygons seen
    megaDropped: 0,
    notPicked: 0, // polygons no admission pick took (tall / hatch / dense / horizon)
    picked: { tall: 0, legacyArea: 0, hatch: 0, dense: 0, horizon: 0 },
    monumentDropped: 0,
    lockDropped: 0, // removed by the Owens lock / hatch ramp
    candidates: 0, // bodies competing for the per-tile slots
    admitted: 0, // bodies selected
    bodyCapDropped: 0, // candidates the body cap (maxPerChunk / horizon maxBodies) left out
    triangleCapDropped: 0, // polygons skipped by the horizon triangle budget
    reserveDropped: 0, // polygons skipped to keep the neighbourhood reserve
    degenerateDropped: 0, // polygons whose ring simplified below 3 points / no triangles
    emittedPolygons: 0,
    emittedTriangles: 0, // cap + wall triangles
  };
}

function hist(h, v) {
  const b = Math.max(0, Math.floor(v));
  h[b] = (h[b] ?? 0) + 1;
}

/** Percentile (0..1) of an integer-metre histogram, bin lower edge; null when empty. */
function histPercentile(h, q) {
  let n = 0;
  for (const c of Object.values(h)) n += c;
  if (n === 0) return null;
  const bins = Object.keys(h).map(Number).sort((a, b) => a - b);
  const target = q * (n - 1);
  let seen = 0;
  for (const b of bins) {
    seen += h[b];
    if (seen > target) return b;
  }
  return bins[bins.length - 1];
}

/** Record the height provenance of one admitted building (detail ring). */
function countHeight(D, item) {
  const H = D.height;
  if (item.rawH > 0) {
    H.mapped += 1;
    hist(H.mappedHist, item.h);
    return;
  }
  if (D._synth5.has(item)) H.untaggedSynth5 += 1;
  else H.untagged += 1;
  if (item.inferredHouse) H.inferredHouse += 1;
  else if (item.typo) H.inferredTypology += 1;
  else H.inferredCurve += 1;
  hist(H.inferredHist, item.h);
}

/** The plain, structured-clone-safe counters for `out.wpStages`. */
function finishStages(D) {
  const out = {};
  for (const [k, v] of Object.entries(D)) if (k[0] !== '_') out[k] = v;
  if (out.height) {
    const H = out.height;
    H.inferredP50 = histPercentile(H.inferredHist, 0.5);
    H.inferredP90 = histPercentile(H.inferredHist, 0.9);
    H.mappedP50 = histPercentile(H.mappedHist, 0.5);
    H.mappedP90 = histPercentile(H.mappedHist, 0.9);
  }
  return out;
}

export { createBuildingStages, createSkylineStages, countHeight, finishStages, histPercentile };
