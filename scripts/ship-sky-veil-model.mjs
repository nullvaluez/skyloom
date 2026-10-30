/**
 * SHIP PASS SKY (FLY_SHIP_PASS.md SK-1 / SK-2) — the veil, from the model.
 *
 * The second instrument beside scripts/ship-sky-veil.cjs (which renders the
 * fixture): the atmosphere's share of the grey veil computed from the
 * shipped atmosphere itself, the CPU mirror of the GPU tables
 * (lib/fly/atmosphere/model.js — the same medium, the same integrator), so it
 * is venue-independent and exact for the atmosphere term alone.
 *
 * GEOMETRY: the harness's — Midtown 20° below the horizon from 5,000 /
 * 6,000 / 7,500 / 8,500 / 10,000 ft, heading 22° (NNE) at a July clear noon
 * over New York (sun 72° up, due south, i.e. behind and above the eye), and a
 * near-horizontal 50 km sight line from 10,000 ft for "distant ridges keep
 * their depth".
 * GROUND: a Lambertian city of albedo 0.12 (dark imagery) lit by the
 * physical sun at the ground and the zenith sky (per unit sun illuminance,
 * the in-scatter's own units).
 * METRIC: the contrast transfer of a luminance pattern under additive
 * in-scatter, C_out / C_in = G·T / (G·T + S), on luminance — 1 is no veil.
 * AERIAL_CLARITY multiplies S by its keep factor at that distance and eye
 * height (lib/fly/aerial-clarity.js clarityKeep / aerialClarityK).
 *
 * Run: node scripts/ship-sky-veil-model.mjs   (prints the table)
 * Import: veilModel({ grade, clarity: bool }) → rows
 */
import { register } from 'node:module';
import { fileURLToPath } from 'node:url';

register('./_node-resolve.mjs', import.meta.url);
const M = await import('../lib/fly/atmosphere/model.js');
const C = await import('../lib/fly/fly-constants.js');
// SK-2's own module, when the tree has it (the model predates the fix).
const AC = await import('../lib/fly/aerial-clarity.js').catch(() => null);

const D = Math.PI / 180;
const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
export const ALTS_FT = [5000, 6000, 7500, 8500, 10000];

export function veilModel({ grade = C.PHYS_SKY.grade, clarity = false, albedo = 0.12, sunElDeg = 72, headingDeg = 22, depressionDeg = 20 } = {}) {
  const p = M.atmosphereParams(grade);
  const cpu = M.createAtmosphereCpu(p);
  const muS = Math.sin(sunElDeg * D);
  const T0 = M.lookupTransmittance(p, cpu.trans, 0.001, muS);
  const vis0 = M.sunVisibility(p, 0.001, muS);
  const z0 = M.skyRadiance(p, cpu.trans, cpu.ms, 0.001, 1, 1, muS, 16);
  const G = [0, 1, 2].map((i) => (albedo / Math.PI) * (T0[i] * vis0 * muS + Math.PI * z0[i]));
  const env = { day: 1, overcast: 0, fog: 0 };
  const sight = (hKm, mu, dKm, aglM) => {
    const nu = Math.sqrt(1 - mu * mu) * Math.cos(sunElDeg * D) * -Math.cos(headingDeg * D) + mu * muS;
    const r = M.inscatter(p, cpu.trans, cpu.ms, hKm, mu, muS, nu, dKm, 64, false);
    const keep = clarity && AC ? AC.clarityKeep(AC.aerialClarityK(aglM, env, true), dKm) : 1;
    const GT = [0, 1, 2].map((i) => G[i] * r.T[i]);
    const S = r.L.map((v) => v * keep);
    return { dKm, T: lum(r.T), sOverG: lum(S) / lum(G), transfer: lum(GT) / (lum(GT) + lum(S)), keep };
  };
  const rows = ALTS_FT.map((ft) => {
    const hKm = (ft * 0.3048) / 1000, dep = depressionDeg * D;
    return { ft, ...sight(hKm, -Math.sin(dep), hKm / Math.sin(dep), ft * 0.3048) };
  });
  const far = sight(3.048, -3.048 / 50, 50, 3048);
  return { rows, far };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const [label, opts] of [['shipped atmosphere', {}], ['no aerosol (turbidity 0)', { grade: { ...C.PHYS_SKY.grade, turbidity: 0 } }], ['no Rayleigh (rayleigh 0)', { grade: { ...C.PHYS_SKY.grade, rayleigh: 0 } }], ...(AC ? [['AERIAL_CLARITY on', { clarity: true }]] : [])]) {
    const { rows, far } = veilModel(opts);
    const at6 = rows.find((r) => r.ft === 6000).transfer;
    console.log(`\n${label}`);
    for (const r of rows) console.log(`  ${String(r.ft).padStart(5)} ft  slant ${r.dKm.toFixed(1)} km  T ${r.T.toFixed(3)}  S/G ${r.sOverG.toFixed(3)}  transfer ${r.transfer.toFixed(3)}  vs 6,000 ft ${(100 * (r.transfer / at6 - 1)).toFixed(1)}%`);
    console.log(`  50 km from 10,000 ft: transfer ${far.transfer.toFixed(3)} (keep ${far.keep.toFixed(3)})`);
  }
}
