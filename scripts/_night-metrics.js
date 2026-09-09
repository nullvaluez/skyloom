/**
 * ROUND 23 (C "NIGHT-CERT") — `_night-metrics.js`, the SHARED NIGHT INSTRUMENT.
 *
 * Plan §3 asks for ONE instrument that every agent consumes, "no per-agent
 * metric dialects". This is it. A, B and C all read the same numbers off the
 * same screenshots, so an A/B claim made in A's memo is directly comparable to
 * a threshold frozen in C's gate.
 *
 * HOW TO USE IT (A and B — four lines, and please do not fork it):
 *
 *     const { nightMetrics, decodeRaw, fmtMetrics, readCensus, fmtCensus,
 *             deltaMetrics } = require('./_night-metrics');
 *     const census = await readCensus(page);                 // live __flyStats
 *     const buf = await page.locator('.fixed.inset-0 canvas').first().screenshot();
 *     const m = nightMetrics(await decodeRaw(buf), { groundBand: [0.55, 0.98] });
 *     console.log(fmtCensus('before', census), fmtMetrics('before', m));
 *     // …flip your flag, shoot again, then:
 *     console.log(deltaMetrics(after, m));   // signed A−B on every scalar
 *
 * The canonical poses and their FROZEN bands live in
 * `scripts/verify-night-alive.js` (P_MAN / P_POW / P_OWE / P_BB) — copy the
 * band with the pose, always, or two agents' numbers stop being comparable
 * for a reason neither of them will find quickly.
 *
 * WHAT IT MEASURES, AND WHY EACH ONE EXISTS (plan §0 symptoms in brackets)
 *
 *   litFrac      [S1 "almost silent black"] — the share of GROUND-BAND pixels
 *                whose luma clears `LIT_LUMA`. This is the aggregate "is there
 *                light down there at all" scalar. The threshold and the luma
 *                weights are R19 verify-groundlife's, VERBATIM (`0.2126 R +
 *                0.7152 G + 0.0722 B`, lit at `> 40`), so an R23 number can be
 *                read against R19's Powell measurements (lights-on 1.156% vs
 *                lights-off 0.465%) without a conversion. `litLadder` reports
 *                the same fraction at seven thresholds so a gate never has to
 *                be re-run to answer "what if the bar were 60?".
 *   p5/p50/p95   [S1, and the handoff §4 "rich blacks are measurable"] — the
 *                luma distribution of the band. A night that is black because
 *                nothing is lit and a night that is black because the grade
 *                crushed it look identical in a mean and different here.
 *   warmLitFrac  [S3 "very few show lights in windows"] — of the LIT pixels,
 *                the share that are warm (R − B >= `WARM_DELTA`). Sodium road
 *                glow, window atlases, city-glow domes and house lights are all
 *                warm by design; moonlit imagery, the sky and specular water
 *                are not. A frame can hold its litFrac while its warm share
 *                collapses — that is precisely "the windows went out but the
 *                moon is still on the roofs", and no single-channel metric
 *                sees it.
 *   whiteBlob*   [S2 "some buildings might have a white glow"] — the largest
 *                CONTIGUOUS run of high-luma LOW-SATURATION pixels, in px and
 *                as a share of the band, plus its bounding box and centroid.
 *                The user's complaint names a shape ("some buildings"), not a
 *                brightness, so the instrument finds a shape: an emissive with
 *                a null/incomplete map (plan §2 H3) renders as a compact white
 *                slab, while a healthy warm window grid is a large number of
 *                small SATURATED specks that this metric deliberately ignores.
 *   darkFrac     [S1] — share under `DARK_LUMA`. "Silent black" stated
 *                directly, and the Owens dark-control's positive assertion
 *                (the desert SHOULD be almost all dark).
 *
 * THE SKY-BAND EXCLUSION — the one judgement call in this file, stated loudly
 * -------------------------------------------------------------------------
 * Every metric is computed on a HORIZONTAL BAND of the frame, `groundBand`,
 * expressed as fractions of frame height and defaulting to [0.42, 1.00]. The
 * top of the frame at every R23 pose is sky: moon, stars, HDRI background,
 * cloud deck. Including it would (a) put the moon disc — a genuinely white,
 * genuinely high-luma, genuinely contiguous blob — into the white-glow metric
 * that exists to find emissive defects on BUILDINGS, and (b) let a starfield
 * change move a litFrac gate about ground lighting.
 *
 * The band is a FIXED FRACTION PER POSE, frozen in the harness alongside the
 * pose, and it is deliberately NOT a horizon detector. A detector's reference
 * moves with the very content under test — the R20 lesson that an instrument
 * sharing the defect is a coin — and at these poses the horizon is a product
 * of camera pitch and the world-bend curve, both of which R22 touched. A fixed
 * band can be wrong; it cannot be wrong DIFFERENTLY between two legs, which is
 * the only property an A/B needs. Callers that want the whole frame pass
 * `groundBand: [0, 1]`, and every metric row prints the band it used.
 *
 * DECODE PATH: `sharp` (already a transitive dep and the decoder every existing
 * pixel harness uses — r13-tonemap-capture, r20-b-shots, r22-a-measure,
 * verify-dusk, verify-groundlife, verify-aerial). No new runtime dep (plan §5.3).
 *
 * WHAT THIS INSTRUMENT CANNOT SEE (state it up front — the R22 §1c idiom):
 *   • It cannot tell WHICH layer lit a pixel. Attribution is the caller's job
 *     and is done the way R19 did it: an A/B with one layer's root parked.
 *   • It is blind to anything smaller than a pixel after tone mapping. Sparse
 *     point lights at cruise fall under the lit threshold before they fall out
 *     of the frame (the verify-sat-night "a mean is blind to sparse lights"
 *     lesson) — that is what `litLadder`'s low rungs and `sparkCount` exist for.
 *   • SwiftShader, headless, 1600x900. Every number frozen from it is an
 *     artefact of THIS environment, which is the right environment because the
 *     close sweep runs here too (plan §5.8).
 *   • It reports the frame it was handed. If the caller shot a frame with the
 *     player or live traffic in it, those pixels are in the metric (R17 §7.1 —
 *     a pixel gate must not contain actors it doesn't control; the caller
 *     parks them, not this module).
 */
const sharp = require('sharp');

/* ── FROZEN CONSTANTS (all overridable per call; defaults are the contract) ── */

/** R19 verify-groundlife's lit threshold, reused verbatim for comparability. */
const LIT_LUMA = 40;
/** The ladder a gate can re-read without a re-run. LIT_LUMA is a member. */
const LIT_LADDER = [8, 16, 24, 40, 60, 90, 128, 180];
/** "Warm" = R − B, in 0..255. 12 separates sodium/window warmth from the
 *  neutral grey of moonlit imagery at these poses; reported both ways so a
 *  caller can see the split rather than trusting the constant. */
const WARM_DELTA = 12;
/** White-glow blob: high luma AND low chroma. 170/0.14 catches an unmapped
 *  emissive (which saturates toward the material's white base) while excluding
 *  a warm window grid (chroma ~0.3+) and dim moonlit roofs (luma < 170). */
const WHITE_LUMA = 170;
const WHITE_SAT = 0.14;
/** Blobs smaller than this are speckle, not "a building with a white glow". */
const WHITE_MIN_BLOB = 24;
/** "Silent black". */
const DARK_LUMA = 8;
/** Default sky exclusion — see the header. */
const GROUND_BAND = [0.42, 1.0];

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Decode a PNG (Buffer from `locator.screenshot()`, or a path) to raw bytes.
 * @returns {Promise<{data: Buffer, width: number, height: number, channels: number}>}
 */
async function decodeRaw(src) {
  const { data, info } = await sharp(src).raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

/** Band rows for a frame height, as [y0, y1) — y1 exclusive, always >= y0+1. */
function bandRows(height, band = GROUND_BAND) {
  const y0 = Math.max(0, Math.min(height - 1, Math.floor(height * clamp01(band[0]))));
  const y1 = Math.max(y0 + 1, Math.min(height, Math.ceil(height * clamp01(band[1]))));
  return [y0, y1];
}

/** Percentile off a 256-bin integer-luma histogram. Returns the bin (0..255). */
function pct(hist, total, q) {
  const want = total * q;
  let acc = 0;
  for (let b = 0; b < 256; b++) {
    acc += hist[b];
    if (acc >= want) return b;
  }
  return 255;
}

/**
 * THE METRIC. Everything the round measures about a night frame, from one pass
 * over the band plus one flood-fill for the blob.
 *
 * @param {{data:Buffer,width:number,height:number,channels:number}} raw decodeRaw output
 * @param {object} [opts]
 * @param {[number,number]} [opts.groundBand]  sky exclusion, fractions of height
 * @param {number} [opts.litLuma] [opts.warmDelta] [opts.whiteLuma] [opts.whiteSat]
 * @returns {object} metric row (all fractions are 0..1 of the BAND, not the frame)
 */
function nightMetrics(raw, opts = {}) {
  const { data, width, height, channels } = raw;
  const band = opts.groundBand ?? GROUND_BAND;
  const litLuma = opts.litLuma ?? LIT_LUMA;
  const warmDelta = opts.warmDelta ?? WARM_DELTA;
  const whiteLuma = opts.whiteLuma ?? WHITE_LUMA;
  const whiteSat = opts.whiteSat ?? WHITE_SAT;
  const minBlob = opts.whiteMinBlob ?? WHITE_MIN_BLOB;
  const [y0, y1] = bandRows(height, band);
  const bh = y1 - y0;
  /* OPTIONAL horizontal crop, same fraction convention as `groundBand`.
   * Live legs never use it — they park the DOM, so there is no HUD to exclude.
   * It exists for the ARCHIVE calibration (`r23-c-archive-metrics.js`), whose
   * source frames are historical `glShot`s taken with the HUD and minimap
   * composited in: the minimap alone is a bright saturated disc in the bottom
   * right of exactly the band the metric wants. Cropping it out is honest;
   * pretending it is city light would not be. */
  const xb = opts.xBand ?? [0, 1];
  const x0 = Math.max(0, Math.min(width - 1, Math.floor(width * clamp01(xb[0]))));
  const x1 = Math.max(x0 + 1, Math.min(width, Math.ceil(width * clamp01(xb[1]))));
  const bw = x1 - x0;
  const n = bw * bh;

  const hist = new Uint32Array(256);
  const white = new Uint8Array(n); // white-glow candidate mask, band-local
  let sum = 0;
  let lit = 0;
  let warmLit = 0;
  let coolLit = 0;
  let dark = 0;
  let whiteN = 0;
  const ladder = new Uint32Array(LIT_LADDER.length);

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const o = (y * width + x) * channels;
      const r = data[o];
      const g = data[o + 1];
      const b = data[o + 2];
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      sum += l;
      const li = l < 0 ? 0 : l > 255 ? 255 : Math.round(l);
      hist[li] += 1;
      for (let k = 0; k < LIT_LADDER.length; k++) if (l > LIT_LADDER[k]) ladder[k] += 1;
      if (l > litLuma) {
        lit += 1;
        if (r - b >= warmDelta) warmLit += 1;
        else if (b - r >= warmDelta) coolLit += 1;
      }
      if (l < DARK_LUMA) dark += 1;
      if (l >= whiteLuma) {
        const mx = r > g ? (r > b ? r : b) : g > b ? g : b;
        const mn = r < g ? (r < b ? r : b) : g < b ? g : b;
        const sat = mx === 0 ? 0 : (mx - mn) / mx;
        if (sat <= whiteSat) {
          white[(y - y0) * bw + (x - x0)] = 1;
          whiteN += 1;
        }
      }
    }
  }

  // Largest contiguous white-glow blob — 4-connected, iterative (an 832k-pixel
  // band would blow a recursive fill's stack).
  let blobPx = 0;
  let blobBox = null;
  let blobs = 0;
  let blobSum = 0;
  if (whiteN > 0) {
    const seen = new Uint8Array(n);
    const stack = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      if (!white[i] || seen[i]) continue;
      let sp = 0;
      stack[sp++] = i;
      seen[i] = 1;
      let size = 0;
      let minX = bw;
      let maxX = -1;
      let minY = bh;
      let maxY = -1;
      let cx = 0;
      let cy = 0;
      while (sp > 0) {
        const p = stack[--sp];
        const px = p % bw;
        const py = (p - px) / bw;
        size += 1;
        cx += px;
        cy += py;
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
        if (px > 0 && white[p - 1] && !seen[p - 1]) (seen[p - 1] = 1), (stack[sp++] = p - 1);
        if (px < bw - 1 && white[p + 1] && !seen[p + 1])
          (seen[p + 1] = 1), (stack[sp++] = p + 1);
        if (py > 0 && white[p - bw] && !seen[p - bw])
          (seen[p - bw] = 1), (stack[sp++] = p - bw);
        if (py < bh - 1 && white[p + bw] && !seen[p + bw])
          (seen[p + bw] = 1), (stack[sp++] = p + bw);
      }
      if (size >= minBlob) {
        blobs += 1;
        blobSum += size;
      }
      if (size > blobPx) {
        blobPx = size;
        blobBox = {
          x: minX + x0,
          y: minY + y0,
          w: maxX - minX + 1,
          h: maxY - minY + 1,
          cx: Math.round(cx / size) + x0,
          cy: Math.round(cy / size) + y0,
        };
      }
    }
  }

  const litLadder = {};
  LIT_LADDER.forEach((t, k) => {
    litLadder[t] = ladder[k] / n;
  });

  return {
    band: [+band[0].toFixed(3), +band[1].toFixed(3)],
    xBand: [+xb[0].toFixed(3), +xb[1].toFixed(3)],
    bandPx: n,
    frame: { w: width, h: height },
    mean: sum / n,
    p5: pct(hist, n, 0.05),
    p50: pct(hist, n, 0.5),
    p95: pct(hist, n, 0.95),
    p99: pct(hist, n, 0.99),
    litFrac: lit / n,
    litLadder,
    darkFrac: dark / n,
    warmLitFrac: lit > 0 ? warmLit / lit : 0, // share OF LIT
    coolLitFrac: lit > 0 ? coolLit / lit : 0,
    warmOfBand: warmLit / n,
    whiteFrac: whiteN / n,
    whiteBlobPx: blobPx,
    whiteBlobFrac: blobPx / n,
    whiteBlobs: blobs, // blobs >= WHITE_MIN_BLOB
    whiteBlobArea: blobSum / n, // their combined share of the band
    whiteBlobBox: blobBox,
    hist, // kept for callers that want their own percentile / plot
  };
}

/** decodeRaw + nightMetrics in one call. `src` = Buffer or path. */
async function metricsOf(src, opts) {
  return nightMetrics(await decodeRaw(src), opts);
}

/** One-line row for a run log. Stable field order — diffable across runs.
 *  NB `warm=…%-of-lit`, not `%ofLit`: `%o` is a console.log format specifier,
 *  and a caller that passes a second argument gets it substituted into the
 *  middle of the row. Found by running it. */
function fmtMetrics(tag, m) {
  return (
    `${tag} lit=${(m.litFrac * 100).toFixed(3)}% warm=${(m.warmLitFrac * 100).toFixed(1)}%-of-lit ` +
    `dark=${(m.darkFrac * 100).toFixed(1)}% p5/p50/p95=${m.p5}/${m.p50}/${m.p95} ` +
    `mean=${m.mean.toFixed(2)} white=${(m.whiteFrac * 100).toFixed(4)}% ` +
    `blob=${m.whiteBlobPx}px(${(m.whiteBlobFrac * 100).toFixed(4)}%)x${m.whiteBlobs} ` +
    `band=${m.band[0]}..${m.band[1]}`
  );
}

/** Signed A−B on the scalars that matter. For paired-leg claims. */
function deltaMetrics(a, b) {
  return {
    dLitFrac: a.litFrac - b.litFrac,
    litRatio: b.litFrac > 0 ? a.litFrac / b.litFrac : null,
    dWarmLitFrac: a.warmLitFrac - b.warmLitFrac,
    dWarmOfBand: a.warmOfBand - b.warmOfBand,
    dMean: a.mean - b.mean,
    dP5: a.p5 - b.p5,
    dP50: a.p50 - b.p50,
    dP95: a.p95 - b.p95,
    dDarkFrac: a.darkFrac - b.darkFrac,
    dWhiteFrac: a.whiteFrac - b.whiteFrac,
    dWhiteBlobPx: a.whiteBlobPx - b.whiteBlobPx,
  };
}

/**
 * PER-LAYER CENSUS — a page-side function, pass it to `page.evaluate`.
 *
 * Deliberately NOT a scene-total difference. R19 ruling 1 retired that
 * instrument for exactly this job: differencing four breathing scene totals
 * returns negative "layer draws" whose sign flips run to run. This counts the
 * loop instead — every layer's own meshes, its own drawn meshes, its own
 * triangles and its own instance counts, read straight off the live objects.
 *
 * It also carries the H3 instrument the plan asks for (§2): every mesh in the
 * scene with a non-zero emissive, and whether it actually holds an
 * `emissiveMap`. An emissive WITHOUT a map is the white-glow mechanism named
 * in S2, so the census counts them and names the worst offenders.
 *
 * Read-only. It creates nothing, moves nothing and parks nothing.
 */
const NIGHT_CENSUS = () => {
  const S = window.__flyStats ?? {};
  const num = (v) => (typeof v === 'number' ? v : null);

  const geomTris = (g) => {
    if (!g) return 0;
    const idx = g.index ? g.index.count : (g.getAttribute('position')?.count ?? 0);
    return Math.floor(idx / 3);
  };
  const censusOf = (root) => {
    if (!root) return null;
    const o3 = root.object ?? root.dome ?? root; // engines expose `.object`
    if (!o3 || typeof o3.traverse !== 'function') return null;
    let meshes = 0;
    let drawn = 0;
    let tris = 0;
    let instances = 0;
    const mats = new Set();
    o3.traverse((o) => {
      if (!o.isMesh && !o.isPoints && !o.isLine) return;
      meshes += 1;
      // Effective visibility: an object under an invisible parent is not drawn
      // (the R19 postmortem — `traverse` does not stop at an invisible parent,
      // and a census that ignores that indicts actors it merely failed to
      // exclude).
      let vis = o.visible && (o.material?.visible ?? true);
      for (let p = o.parent; p && vis; p = p.parent) vis = vis && p.visible;
      const count = o.isInstancedMesh ? o.count : 1;
      if (vis) {
        drawn += 1;
        instances += count;
        tris += geomTris(o.geometry) * (o.isInstancedMesh ? count : 1);
      }
      if (o.material) mats.add(o.material.uuid);
    });
    return { meshes, drawn, tris, instances, mats: mats.size };
  };

  const layers = {};
  for (const [name, h] of [
    ['satRoads', window.__satRoads],
    ['satBuildings', window.__satBuildings],
    ['satSkyline', window.__satSkyline],
    ['satCityGlow', window.__satCityGlow],
    ['satVeg', window.__satVeg],
    ['satBeacons', window.__satBeacons],
    ['satClutter', window.__satClutter],
    ['monuments', window.__flyMonuments],
    ['clouds', window.__flyClouds],
    ['cirrus', window.__flyCirrus],
    ['traffic', window.__flyTraffic],
    ['tracers', window.__flyTracers],
  ]) {
    layers[name] = h ? censusOf(h) : null;
  }

  // Scene-wide emissive audit (plan §2 H3). Walk from any live root.
  let root =
    window.__fly?.engine?.object ?? window.__satRoads?.object ?? window.__flyPlayer ?? null;
  while (root?.parent) root = root.parent;
  const emissive = { meshes: 0, withMap: 0, withoutMap: 0, drawn: 0, worst: [] };
  try {
    root?.traverse((o) => {
      const m = o.material;
      if (!o.isMesh || !m) return;
      const mats = Array.isArray(m) ? m : [m];
      for (const mm of mats) {
        const ei = mm.emissiveIntensity;
        const ec = mm.emissive;
        const lum = ec ? ec.r + ec.g + ec.b : 0;
        if (!(typeof ei === 'number' && ei > 0 && lum > 0.001)) continue;
        emissive.meshes += 1;
        let vis = o.visible;
        for (let p = o.parent; p && vis; p = p.parent) vis = vis && p.visible;
        if (vis) emissive.drawn += 1;
        if (mm.emissiveMap) emissive.withMap += 1;
        else {
          emissive.withoutMap += 1;
          if (emissive.worst.length < 12)
            emissive.worst.push({
              name: o.name || o.type,
              mat: mm.name || mm.type,
              ei: +ei.toFixed(3),
              e: [+ec.r.toFixed(3), +ec.g.toFixed(3), +ec.b.toFixed(3)],
              vis,
              instances: o.isInstancedMesh ? o.count : 1,
            });
        }
      }
    });
  } catch {
    /* a traverse fault must not take the census down — it is reported empty */
  }

  const f = window.__fly?.flight ?? null;
  return {
    scene: { draws: num(S.drawCalls), tris: num(S.triangles), traffic: num(S.traffic) },
    tier: window.__flyStore?.getState?.().qualityTier ?? null,
    governor: S.governor ?? null,
    dpr: window.__flyGl?.getPixelRatio?.() ?? null,
    sky: {
      elDeg: S.skyElDeg ?? null,
      state: S.skyState ?? null,
      blendS: S.skyBlendS ?? null,
      env: S.envIntensity ?? null,
      bg: S.bgIntensity ?? null,
      hdri: S.hdriBucket ?? null,
      sunFrac: S.sunFactor ?? null,
      envUrl: S.envUrl ?? null,
    },
    night: {
      roadMix: S.satRoadMix ?? null,
      roads: S.satRoads ?? null,
      buildings: S.satBuildings ?? null,
      bldgFade: S.satBldgFade ?? null,
      skyline: S.satSkyline ?? null,
      houseLights: S.houseLights ?? null,
      cityGlow: {
        placed: S.satCityGlowPlaced ?? null,
        maxD: S.satCityGlowMaxD ?? null,
        nightK: S.satCityGlowNightK ?? null,
      },
      beacons: S.satBeacons ?? null,
      parcelHomes: S.parcelHomes ?? null,
      clutter: S.clutter ?? null,
      bloom: S.bloom ?? null,
      popin: S.popin ?? null,
    },
    layers,
    emissive,
    /* R23 W2 — A NIGHT-TRUTH's telemetry block, recorded verbatim and NEVER
     * merged into the `night` block above: that one is C's own read of the
     * layer stats and these are A's 2 Hz wall-clocked samples, and two
     * instruments that agree are evidence only while they stay separable.
     * `null` on any tree that predates A's merge — consumers must treat it as
     * "not measured", never as "measured zero". */
    telemetry: S.night ?? null,
    /* The LIVE atmosphere state, read through FlyScene's own dev handle
     * (`getAerialState` / `getQuiltGrade` / `getSatContentHaze`). `haze.max` is
     * the CONTENT haze — the term A's F1 finding is about — and it is readable
     * WITHOUT tiles, because it is a uniform, not a pixel. That is what makes
     * the content-haze legs exercisable in an egress-blocked session. */
    aerial: window.__flyAerial
      ? {
          post: window.__flyAerial.get?.() ?? null,
          quilt: window.__flyAerial.quilt?.() ?? null,
          haze: window.__flyAerial.haze?.() ?? null,
        }
      : null,
    pose: f
      ? {
          altM: Math.round(f.pos.y),
          groundElev: Math.round(f.groundElev),
          aglM: Math.round(f.pos.y - f.groundElev),
          heading: +f.heading.toFixed(3),
          pitch: +f.pitch.toFixed(3),
        }
      : null,
    // The pin state this leg actually ran under — a gate that claims to
    // measure the un-pinned world must be able to PROVE it did (the R22
    // `__r22PinAttempt` contract).
    pins: {
      terra: window.__flyTerraPin ?? null,
      settle: window.__flySettlePin ?? null,
      clutter: window.__flyClutterPin ?? null,
      depth: window.__flyDepthPin ?? null,
      gov: window.__flyGovPin ?? null,
      weather: window.__flyWeatherOverride ?? null,
      // R23 W2: the R19 plain-window aerial pin. `null` here means RELEASED
      // (FlyScene tests `!= null`), which is what an un-pinned night leg wants.
      aerialOverride: window.__flyAerialOverride ?? null,
      satShadowOverride: window.__flySatShadowOverride ?? null,
      unpinned: window.__r22Unpinned ?? null,
      attempted: window.__r22PinAttempt ?? null,
    },
    terraStats: window.__fly?.terraStats ?? window.__fly?.engine?.terraStats ?? null,
  };
};

/** `page.evaluate(NIGHT_CENSUS)`, named so callers read as prose. */
const readCensus = (page) => page.evaluate(NIGHT_CENSUS);

/** Compact census line for a run log. */
function fmtCensus(tag, c) {
  const n = c.night ?? {};
  return (
    `${tag} tier=${c.tier} dpr=${c.dpr} draws=${c.scene.draws} tris=${c.scene.tris} ` +
    `el=${c.sky.elDeg}° state=${c.sky.state} roadMixN=${n.roadMix?.night ?? '—'} ` +
    `roads=${n.roads?.ready ?? '—'} bldg=${n.buildings?.ready ?? '—'} fade=${n.bldgFade ?? '—'} ` +
    `houseLights=${n.houseLights?.placed ?? '—'} glow=${n.cityGlow?.placed ?? '—'} ` +
    `emissive=${c.emissive.meshes}(noMap ${c.emissive.withoutMap}) agl=${c.pose?.aglM ?? '—'} ` +
    `aerialPin=${c.pins?.aerialOverride ?? 'RELEASED'} contentHaze=${c.aerial?.haze?.max ?? '—'} ` +
    `postAerial=${c.aerial?.post?.strength ?? '—'}` +
    (c.telemetry
      ? ` tel{tier=${c.telemetry.tier} haze=${c.telemetry.contentHaze} winEI=${c.telemetry.lit?.windowEI} winMap=${c.telemetry.lit?.windowMap}}`
      : ' tel=absent')
  );
}

module.exports = {
  LIT_LUMA,
  LIT_LADDER,
  WARM_DELTA,
  WHITE_LUMA,
  WHITE_SAT,
  WHITE_MIN_BLOB,
  DARK_LUMA,
  GROUND_BAND,
  decodeRaw,
  bandRows,
  nightMetrics,
  metricsOf,
  fmtMetrics,
  deltaMetrics,
  NIGHT_CENSUS,
  readCensus,
  fmtCensus,
};
