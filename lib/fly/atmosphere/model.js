/**
 * TRUE EARTH Phase 2 — PHYS_SKY: a physically based atmosphere after Hillaire
 * 2020, "A Scalable and Production Ready Sky and Atmosphere Rendering
 * Technique" (EGSR), with Bruneton 2017's transmittance parameterisation.
 *
 * This module is the CPU MIRROR of the GPU lookup tables in glsl.js: the same
 * medium, the same table parameterisations and the same integrators, so
 * (a) scripts/verify-phys-sky.mjs can check the GPU tables against it and
 * against closed forms, and (b) the frame loop can light the scene from it
 * (the sun's colour at the eye, the horizon and zenith radiance, the ground's
 * irradiance) without reading pixels back.
 *
 * Units: kilometres. Radiance and in-scatter are per unit sun illuminance.
 * Frame: y is up at the eye, so a direction's view-zenith cosine is its y.
 * Pure: no three, no DOM, no runtime state.
 */

const PI = Math.PI;

/** Earth's clear-sky medium (Hillaire 2020 / Bruneton 2017 values, per km). */
export const EARTH_ATMOSPHERE = Object.freeze({
  bottomKm: 6360,
  topKm: 6460,
  rayleighScattering: Object.freeze([5.802e-3, 13.558e-3, 33.1e-3]),
  rayleighScaleKm: 8,
  mieScattering: 3.996e-3,
  mieExtinction: 4.4e-3,
  mieScaleKm: 1.2,
  mieG: 0.8,
  ozoneAbsorption: Object.freeze([0.65e-3, 1.881e-3, 0.085e-3]),
  ozoneCenterKm: 25,
  ozoneHalfWidthKm: 15,
  groundAlbedo: 0.3,
});

/** Table sizes and step counts, shared verbatim with the GLSL (glsl.js). */
export const ATMO_TABLES = Object.freeze({
  transmittance: Object.freeze([256, 64]),
  multiScattering: Object.freeze([32, 32]),
  skyView: Object.freeze([192, 108]),
  // The aerial-perspective volume: 64 x 64 directions x 32 distance slices,
  // laid out as an 8 x 4 atlas of slices (512 x 256 texels).
  aerial: Object.freeze([64, 64, 32]),
  aerialAtlas: Object.freeze([8, 4]),
});
export const ATMO_STEPS = Object.freeze({
  transmittance: 40,
  multiScattering: 20,
  msSqrtDirections: 8,
  skyView: 32,
  aerialBase: 6, // slice z marches aerialBase + z steps
});
/**
 * Radiance tables store value x GAIN, so deep-twilight radiance stays inside
 * half-float normals (a power of two: exact both ways).
 */
export const ATMO_GAIN = 1024;
/** The sun's angular radius (rad): the width of the soft planet-shadow edge. */
export const SUN_ANGULAR_RADIUS = 0.004675;

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const unitToSub = (x, n) => 0.5 / n + x * (1 - 1 / n);
export const subToUnit = (u, n) => (u - 0.5 / n) / (1 - 1 / n);

/**
 * The effective medium: the Earth values with the grade's multipliers.
 * grade = { rayleigh, turbidity (Mie density), ozone, mieG, groundAlbedo }.
 */
export function atmosphereParams(grade = {}, base = EARTH_ATMOSPHERE) {
  const k = (v, d = 1) => (Number.isFinite(v) && v >= 0 ? v : d);
  const ray = k(grade.rayleigh);
  const mie = k(grade.turbidity);
  const oz = k(grade.ozone);
  return {
    bottomKm: base.bottomKm,
    topKm: base.topKm,
    rayleighScattering: base.rayleighScattering.map((v) => v * ray),
    rayleighScaleKm: base.rayleighScaleKm,
    mieScattering: base.mieScattering * mie,
    mieExtinction: base.mieExtinction * mie,
    mieScaleKm: base.mieScaleKm,
    mieG: Number.isFinite(grade.mieG) ? clamp(grade.mieG, 0, 0.99) : base.mieG,
    ozoneAbsorption: base.ozoneAbsorption.map((v) => v * oz),
    ozoneCenterKm: base.ozoneCenterKm,
    ozoneHalfWidthKm: base.ozoneHalfWidthKm,
    groundAlbedo: Number.isFinite(grade.groundAlbedo) ? clamp(grade.groundAlbedo, 0, 1) : base.groundAlbedo,
  };
}

/** Medium at altitude h (clamped to the ground, so a ray through it keeps sea-level air). */
export function medium(p, hKm, out) {
  const h = hKm > 0 ? hKm : 0;
  const dr = Math.exp(-h / p.rayleighScaleKm);
  const dm = Math.exp(-h / p.mieScaleKm);
  const doz = Math.max(0, 1 - Math.abs(h - p.ozoneCenterKm) / p.ozoneHalfWidthKm);
  const sM = p.mieScattering * dm;
  const eM = p.mieExtinction * dm;
  for (let c = 0; c < 3; c++) {
    out.sR[c] = p.rayleighScattering[c] * dr;
    out.ext[c] = out.sR[c] + eM + p.ozoneAbsorption[c] * doz;
  }
  out.sM = sM;
  return out;
}
export const newMedium = () => ({ sR: [0, 0, 0], ext: [0, 0, 0], sM: 0 });

/*
 * Sphere distances written in the altitude h = r − bottom, so the GPU's
 * float32 never cancels two 6,400 km squares: r² − R² = h(2R + h).
 */
/** Distance from altitude h along cos-zenith mu to the top of the atmosphere. */
export function distanceToTop(p, h, mu) {
  const r = p.bottomKm + h;
  const dTop = p.topKm - p.bottomKm;
  const disc = r * r * mu * mu + (dTop - h) * (p.topKm + r);
  return Math.max(0, -r * mu + Math.sqrt(Math.max(disc, 0)));
}
/** Distance to the ground (radius bottom − shrink), or −1 when the ray misses it. */
export function distanceToGround(p, h, mu, shrink = 0) {
  if (mu >= 0) return -1;
  const r = p.bottomKm + h;
  const disc = r * r * mu * mu - (h + shrink) * (r + p.bottomKm - shrink);
  if (disc < 0) return -1;
  return Math.max(0, -r * mu - Math.sqrt(disc));
}
/** The altitude, and the cosine of a second direction's zenith, after t along a ray. */
export function alongRay(p, h, mu, t, nu, muS, out) {
  const R = p.bottomKm;
  const r = R + h;
  const rt = Math.sqrt(Math.max(r * r + t * t + 2 * r * mu * t, 0));
  out.h = (h * (2 * R + h) + t * (t + 2 * r * mu)) / (rt + R);
  out.r = rt;
  out.muS = rt > 0 ? clamp((r * muS + t * nu) / rt, -1, 1) : muS;
  return out;
}
/** Soft planet shadow: 1 with the sun clear of the local horizon, 0 below it. */
export function sunVisibility(p, h, muS) {
  const R = p.bottomKm;
  const hh = Math.max(h, 0);
  const r = R + hh;
  const muH = -Math.sqrt(hh * (2 * R + hh)) / r;
  const x = clamp((muS - muH + SUN_ANGULAR_RADIUS) / (2 * SUN_ANGULAR_RADIUS), 0, 1);
  return x * x * (3 - 2 * x);
}

export function rayleighPhase(nu) {
  return (3 / (16 * PI)) * (1 + nu * nu);
}
export function miePhase(nu, g) {
  const g2 = g * g;
  const d = Math.max(1 + g2 - 2 * g * nu, 1e-6);
  return (1 - g2) / (4 * PI * d * Math.sqrt(d));
}

/** Optical depth (rgb) over [0, dist] from (h, mu), midpoint rule. */
export function opticalDepth(p, h, mu, dist, steps, out = [0, 0, 0]) {
  const m = newMedium();
  const s = { h: 0, r: 0, muS: 0 };
  const dt = dist / steps;
  out[0] = out[1] = out[2] = 0;
  for (let i = 0; i < steps; i++) {
    alongRay(p, h, mu, (i + 0.5) * dt, 0, 0, s);
    medium(p, s.h, m);
    out[0] += m.ext[0] * dt;
    out[1] += m.ext[1] * dt;
    out[2] += m.ext[2] * dt;
  }
  return out;
}

/** Transmittance from (h, mu) to the top of the atmosphere. */
export function transmittanceToTop(p, h, mu, steps = ATMO_STEPS.transmittance, out = [0, 0, 0]) {
  opticalDepth(p, h, mu, distanceToTop(p, h, mu), steps, out);
  out[0] = Math.exp(-out[0]);
  out[1] = Math.exp(-out[1]);
  out[2] = Math.exp(-out[2]);
  return out;
}

/* ---------------- Table parameterisations (Bruneton 2017, Hillaire 2020) ---------------- */

const horizonDistance = (p) => Math.sqrt((p.topKm - p.bottomKm) * (p.topKm + p.bottomKm));

/** (h, mu) → transmittance-table uv (texel-centre aware). */
export function transmittanceUv(p, h, mu, W = ATMO_TABLES.transmittance[0], H = ATMO_TABLES.transmittance[1]) {
  const Hh = horizonDistance(p);
  const hh = Math.max(h, 0);
  const rho = Math.sqrt(hh * (2 * p.bottomKm + hh));
  const d = distanceToTop(p, hh, mu);
  const dMin = p.topKm - p.bottomKm - hh;
  const dMax = rho + Hh;
  const xMu = (d - dMin) / Math.max(dMax - dMin, 1e-9);
  const xR = rho / Hh;
  return [unitToSub(clamp(xMu, 0, 1), W), unitToSub(clamp(xR, 0, 1), H)];
}
/** Transmittance-table uv → (h, mu). */
export function transmittanceHMu(p, u, v, W = ATMO_TABLES.transmittance[0], H = ATMO_TABLES.transmittance[1]) {
  const Hh = horizonDistance(p);
  const xMu = subToUnit(u, W);
  const xR = subToUnit(v, H);
  const rho = Hh * xR;
  const R = p.bottomKm;
  const r = Math.sqrt(rho * rho + R * R);
  const h = (rho * rho) / (r + R);
  const dMin = p.topKm - R - h;
  const dMax = rho + Hh;
  const d = dMin + xMu * (dMax - dMin);
  const mu = d <= 0 ? 1 : (Hh * Hh - rho * rho - d * d) / (2 * r * d);
  return { h, mu: clamp(mu, -1, 1) };
}

/** The horizon geometry at altitude h: { beta, zenithHorizonAngle }. */
export function horizonAngles(p, h) {
  const hh = Math.max(h, 1e-6);
  const r = p.bottomKm + hh;
  const vHorizon = Math.sqrt(hh * (2 * p.bottomKm + hh));
  const beta = Math.acos(clamp(vHorizon / r, -1, 1));
  return { beta, zenithHorizonAngle: PI - beta };
}
/**
 * Sky-view uv (Hillaire's non-linear map: the horizon row sits at v = 0.5,
 * resolution concentrates there, and u = sqrt of the relative azimuth so the
 * sun's aureole gets the most columns). `skyOnly` clamps a ground-bound ray to
 * the last sky row: the horizon colour, never the ground half.
 */
export function skyViewUv(p, h, viewZenithCos, lightViewCos, W = ATMO_TABLES.skyView[0], H = ATMO_TABLES.skyView[1], skyOnly = false) {
  const { beta, zenithHorizonAngle } = horizonAngles(p, h);
  const theta = Math.acos(clamp(viewZenithCos, -1, 1));
  let v;
  if (theta <= zenithHorizonAngle) {
    const coord = 1 - Math.sqrt(Math.max(0, 1 - theta / zenithHorizonAngle));
    v = coord * 0.5;
  } else {
    v = skyOnly ? 0.5 : Math.sqrt(Math.max(0, (theta - zenithHorizonAngle) / beta)) * 0.5 + 0.5;
  }
  const u = Math.sqrt(Math.max(0, -lightViewCos * 0.5 + 0.5));
  let vs = unitToSub(clamp(v, 0, 1), H);
  if (skyOnly) vs = Math.min(vs, (H / 2 - 0.5) / H);
  return [unitToSub(clamp(u, 0, 1), W), vs];
}
/** Sky-view uv → (viewZenithCos, lightViewCos). */
export function skyViewParams(p, h, u, v, W = ATMO_TABLES.skyView[0], H = ATMO_TABLES.skyView[1]) {
  const x = subToUnit(u, W);
  const y = subToUnit(v, H);
  const { beta, zenithHorizonAngle } = horizonAngles(p, h);
  let viewZenithCos;
  if (y < 0.5) {
    let coord = 1 - 2 * y;
    coord = 1 - coord * coord;
    viewZenithCos = Math.cos(zenithHorizonAngle * coord);
  } else {
    const coord = 2 * y - 1;
    viewZenithCos = Math.cos(zenithHorizonAngle + beta * coord * coord);
  }
  const lightViewCos = 1 - 2 * x * x;
  return { viewZenithCos, lightViewCos };
}
/** The cosine between a view (viewZenithCos, lightViewCos) and the sun (muS). */
export function viewSunCos(viewZenithCos, lightViewCos, muS) {
  const sinV = Math.sqrt(Math.max(0, 1 - viewZenithCos * viewZenithCos));
  const sinS = Math.sqrt(Math.max(0, 1 - muS * muS));
  return clamp(sinV * lightViewCos * sinS + viewZenithCos * muS, -1, 1);
}

/* ---------------- Tables on the CPU ---------------- */

/** A bilinear, clamp-to-edge rgb table (the GPU's sampler, in doubles). */
export function makeTable(W, H, data = new Float32Array(W * H * 3)) {
  return { W, H, data };
}
export function sampleTable(t, u, v, out = [0, 0, 0]) {
  const x = clamp(u * t.W - 0.5, 0, t.W - 1);
  const y = clamp(v * t.H - 0.5, 0, t.H - 1);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, t.W - 1);
  const y1 = Math.min(y0 + 1, t.H - 1);
  const fx = x - x0;
  const fy = y - y0;
  const d = t.data;
  for (let c = 0; c < 3; c++) {
    const a = d[(y0 * t.W + x0) * 3 + c] * (1 - fx) + d[(y0 * t.W + x1) * 3 + c] * fx;
    const b = d[(y1 * t.W + x0) * 3 + c] * (1 - fx) + d[(y1 * t.W + x1) * 3 + c] * fx;
    out[c] = a * (1 - fy) + b * fy;
  }
  return out;
}

export function buildTransmittanceTable(p, W = ATMO_TABLES.transmittance[0], H = ATMO_TABLES.transmittance[1], steps = ATMO_STEPS.transmittance) {
  const t = makeTable(W, H);
  const T = [0, 0, 0];
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const { h, mu } = transmittanceHMu(p, (i + 0.5) / W, (j + 0.5) / H, W, H);
      transmittanceToTop(p, h, mu, steps, T);
      t.data.set(T, (j * W + i) * 3);
    }
  }
  return t;
}
export function lookupTransmittance(p, trans, h, mu, out = [0, 0, 0]) {
  const [u, v] = transmittanceUv(p, h, mu, trans.W, trans.H);
  return sampleTable(trans, u, v, out);
}

/** Ψ_ms for (h, muS), per unit illuminance: 64 directions x `steps`, ground bounce, isotropic phase (Hillaire eq. 5–10). */
export function multiScatteringAt(p, trans, h, muS, steps = ATMO_STEPS.multiScattering, sqrtDirs = ATMO_STEPS.msSqrtDirections, out = [0, 0, 0]) {
  const m = newMedium();
  const s = { h: 0, r: 0, muS: 0 };
  const T = [0, 0, 0];
  const sinS = Math.sqrt(Math.max(0, 1 - muS * muS));
  const uniformPhase = 1 / (4 * PI);
  const L = [0, 0, 0];
  const f = [0, 0, 0];
  const n = sqrtDirs * sqrtDirs;
  for (let i = 0; i < sqrtDirs; i++) {
    for (let j = 0; j < sqrtDirs; j++) {
      const theta = (2 * PI * (i + 0.5)) / sqrtDirs;
      const phi = Math.acos(1 - (2 * (j + 0.5)) / sqrtDirs);
      // y-up: (cos θ sin φ, cos φ, sin θ sin φ); the sun is (sinS, muS, 0).
      const mu = Math.cos(phi);
      const nu = Math.cos(theta) * Math.sin(phi) * sinS + mu * muS;
      const dG = distanceToGround(p, h, mu);
      const ground = dG >= 0;
      const tMax = ground ? dG : distanceToTop(p, h, mu);
      const dt = tMax / steps;
      let tr0 = 1, tr1 = 1, tr2 = 1;
      for (let k = 0; k < steps; k++) {
        alongRay(p, h, mu, (k + 0.5) * dt, nu, muS, s);
        medium(p, s.h, m);
        lookupTransmittance(p, trans, s.h, s.muS, T);
        const vis = sunVisibility(p, s.h, s.muS);
        for (let c = 0; c < 3; c++) {
          const ext = Math.max(m.ext[c], 1e-12);
          const seg = Math.exp(-ext * dt);
          const sc = m.sR[c] + m.sM;
          const S = T[c] * vis * sc * uniformPhase;
          const thr = c === 0 ? tr0 : c === 1 ? tr1 : tr2;
          L[c] += (thr * (S - S * seg)) / ext;
          f[c] += (thr * (sc - sc * seg)) / ext;
          if (c === 0) tr0 *= seg;
          else if (c === 1) tr1 *= seg;
          else tr2 *= seg;
        }
      }
      if (ground) {
        const muG = clamp((((p.bottomKm + h) * muS) + tMax * nu) / p.bottomKm, -1, 1);
        lookupTransmittance(p, trans, 0, muG, T);
        const nl = Math.max(muG, 0) * p.groundAlbedo / PI;
        L[0] += T[0] * tr0 * nl;
        L[1] += T[1] * tr1 * nl;
        L[2] += T[2] * tr2 * nl;
      }
    }
  }
  for (let c = 0; c < 3; c++) {
    const L2 = L[c] / n;
    const fms = f[c] / n;
    out[c] = L2 / Math.max(1 - fms, 1e-6);
  }
  return out;
}
export function buildMultiScatteringTable(p, trans, W = ATMO_TABLES.multiScattering[0], H = ATMO_TABLES.multiScattering[1], steps = ATMO_STEPS.multiScattering, sqrtDirs = ATMO_STEPS.msSqrtDirections) {
  const t = makeTable(W, H);
  const v = [0, 0, 0];
  const dTop = p.topKm - p.bottomKm;
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const muS = subToUnit((i + 0.5) / W, W) * 2 - 1;
      const h = Math.max(subToUnit((j + 0.5) / H, H) * dTop, 1e-3);
      multiScatteringAt(p, trans, h, muS, steps, sqrtDirs, v);
      // Stored × GAIN, exactly like the GPU texture; lookups divide it out.
      t.data.set([v[0] * ATMO_GAIN, v[1] * ATMO_GAIN, v[2] * ATMO_GAIN], (j * W + i) * 3);
    }
  }
  return t;
}
/** The multiple-scattering table at (h, muS), still × GAIN (the GPU texture's units). */
export function lookupMultiScattering(p, ms, h, muS, out = [0, 0, 0]) {
  const dTop = p.topKm - p.bottomKm;
  const u = unitToSub(clamp(muS * 0.5 + 0.5, 0, 1), ms.W);
  const v = unitToSub(clamp(h / dTop, 0, 1), ms.H);
  return sampleTable(ms, u, v, out);
}

/**
 * In-scatter (and the path's transmittance) along a straight ray from altitude
 * h with view-zenith cosine mu, the sun at muS and view·sun = nu.
 * `toGround`: stop at the ground (the sky view) or march through it with the
 * sea-level medium (the aerial volume). `dist` < 0 = to the end of the air.
 */
export function inscatter(p, trans, ms, h, mu, muS, nu, dist, steps, toGround = true, out = { L: [0, 0, 0], T: [1, 1, 1] }) {
  const m = newMedium();
  const s = { h: 0, r: 0, muS: 0 };
  const T = [0, 0, 0];
  const M = [0, 0, 0];
  let tMax = dist;
  if (!(tMax >= 0)) {
    const dG = toGround ? distanceToGround(p, h, mu) : -1;
    tMax = dG >= 0 ? dG : distanceToTop(p, h, mu);
  }
  const dt = tMax / steps;
  const pr = rayleighPhase(nu);
  const pm = miePhase(nu, p.mieG);
  const L = out.L;
  const thr = out.T;
  L[0] = L[1] = L[2] = 0;
  thr[0] = thr[1] = thr[2] = 1;
  for (let k = 0; k < steps; k++) {
    alongRay(p, h, mu, (k + 0.5) * dt, nu, muS, s);
    const hs = Math.max(s.h, 0);
    medium(p, hs, m);
    lookupTransmittance(p, trans, hs, s.muS, T);
    lookupMultiScattering(p, ms, hs, s.muS, M);
    const vis = sunVisibility(p, hs, s.muS);
    for (let c = 0; c < 3; c++) {
      const ext = Math.max(m.ext[c], 1e-12);
      const seg = Math.exp(-ext * dt);
      const S = T[c] * vis * (m.sR[c] * pr + m.sM * pm) + (M[c] / ATMO_GAIN) * (m.sR[c] + m.sM);
      L[c] += (thr[c] * (S - S * seg)) / ext;
      thr[c] *= seg;
    }
  }
  return out;
}

/** Sky radiance (per unit sun illuminance) seen from altitude h. */
export function skyRadiance(p, trans, ms, h, viewZenithCos, lightViewCos, muS, steps = ATMO_STEPS.skyView, out = [0, 0, 0]) {
  const nu = viewSunCos(viewZenithCos, lightViewCos, muS);
  const r = inscatter(p, trans, ms, h, viewZenithCos, muS, nu, -1, steps, true);
  out[0] = r.L[0];
  out[1] = r.L[1];
  out[2] = r.L[2];
  return out;
}

/** The aerial volume's slice z distance (km): quadratic, so the near field gets the slices. */
export function aerialSliceKm(z, maxKm, slices = ATMO_TABLES.aerial[2]) {
  const w = (z + 0.5) / slices;
  return w * w * maxKm;
}

/**
 * Everything the frame loop needs, from small tables built once per medium
 * (~1/4 the GPU resolution: the lighting needs colour, not texture detail).
 */
export function createAtmosphereCpu(p, opts = {}) {
  const tW = opts.transmittance?.[0] ?? 128;
  const tH = opts.transmittance?.[1] ?? 32;
  const trans = buildTransmittanceTable(p, tW, tH);
  const msW = opts.multiScattering?.[0] ?? 16;
  const msH = opts.multiScattering?.[1] ?? 16;
  // Fewer directions and steps than the GPU: ~15 ms once, not ~0.5 s.
  const ms = buildMultiScatteringTable(p, trans, msW, msH, opts.msSteps ?? 10, opts.msSqrtDirections ?? 4);
  return { p, trans, ms };
}
