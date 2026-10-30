/**
 * SHIP PASS FRAME (FR-6, D16) — THE ONE BUDGET TABLE.
 *
 * Every budget the app and its gates hold a frame to lives here, once:
 *   - lib/fly/cinema-profile.js reads draws / triangles / texture and
 *     geometry bytes for each presentation profile from it;
 *   - lib/fly/device-report.js and scripts/verify-device-report.mjs grade
 *     device reports against it (gradeReport);
 *   - the soak tooling (scripts/beta-soak.cjs, analyze-beta-soak.mjs) and the
 *     census gate (scripts/verify-ship-frame.mjs) read their limits from it.
 * scripts/verify-ship-frame.mjs FR-6 asserts each consumer imports this file.
 * (TRUE EARTH's per-tier budgets and the grader lived here before; the
 * grader keeps its name and shape.)
 *
 * FRAME TIME IS GRADED AS A SHARE, NOT A PERCENTILE. The pre-pass grader held
 * High to p95 ≤ 12 ms, which a 60 Hz display can never show: vsync quantizes
 * every frame to 16.7 ms (PF-04). A frame "misses" when its interval exceeds
 * 1.5× the target interval (25 ms at 60 fps, 50 ms at 30), i.e. at least one
 * vblank was dropped; the budget is the share of frames that may miss
 * (`missedFrac`). p95 / p99 stay in the report as information.
 *
 * PROVISIONAL. W0.6 produced no RTX 5080 or iPhone report in the cloud venue
 * (FLY_SHIP_PASS.md 3.8), so every row is `provisional: true`, taken from the
 * existing records (sources below). After the owner's W0.6 runs,
 *   node scripts/derive-budget-table.mjs .graphics-review/device-reports/*.json --write
 * re-derives the rows from the reports (measured peak + 5% headroom, the D16
 * regression rule) and rewrites the block between the BUDGET TABLE markers.
 *
 * Where the records disagreed, the stricter number was kept and the conflict
 * is named in `sources`: High's draws/triangles (cinema-profile 375 / 2.2 M vs
 * the TRUE EARTH grader's 450 / 4.0 M → 375 / 2.2 M, the soak gate EXPLORER_BETA
 * measures against), and the phone (cinema-profile 375 / 2.2 M vs the
 * TRUE EARTH 250 / 1.2 M that MOBILE_ENHANCED_VISUALS says "no budget was
 * raised" over → 250 / 1.2 M). Rendering work is untouched: only verdict
 * thresholds come from here.
 */
const MiB = 1048576;

// BUDGET TABLE begin (scripts/derive-budget-table.mjs rewrites this block)
export const BUDGET_TABLE = Object.freeze({
  ultra: Object.freeze({
    label: 'Ultra (desktop dGPU)', classes: ['dgpu'], targetFps: 60,
    draws: 900, triangles: 8000000, textureMiB: 768, geometryMiB: 256, gpuMs: 12,
    stallsPerMin: 1, missedFrac: 0.01, provisional: true,
    sources: ['lib/fly/cinema-profile.js ultra (draws, triangles, texture, geometry)', 'FLY_SHIP_PASS.md section 2 (at most 1 interval over 100 ms per minute)'],
  }),
  high: Object.freeze({
    label: 'High (desktop dGPU)', classes: ['dgpu'], targetFps: 60,
    draws: 375, triangles: 2200000, textureMiB: 300, geometryMiB: null, gpuMs: 12,
    stallsPerMin: 1, missedFrac: 0.01, provisional: true,
    sources: ['lib/fly/cinema-profile.js high', 'EXPLORER_BETA.md soak gate (p95 draws 375, triangles 2.2 M)', 'conflict: TRUE EARTH tier-budgets high 450 / 4.0 M (stricter kept)'],
  }),
  medium: Object.freeze({
    label: 'Medium (integrated GPU)', classes: ['igpu'], targetFps: 60,
    draws: 375, triangles: 2200000, textureMiB: 300, geometryMiB: null, gpuMs: 14,
    stallsPerMin: 1, missedFrac: 0.02, provisional: true,
    sources: ['lib/fly/cinema-profile.js medium', 'TRUE EARTH tier-budgets medium (375 / 2.2 M, agree)'],
  }),
  phone: Object.freeze({
    label: 'Phone (A17 Pro class)', classes: ['phone'], targetFps: 60,
    draws: 250, triangles: 1200000, textureMiB: 300, geometryMiB: null, gpuMs: 14,
    stallsPerMin: 1, missedFrac: 0.05, provisional: true,
    sources: ['TRUE EARTH tier-budgets phone (250 / 1.2 M)', 'MOBILE_ENHANCED_VISUALS.md (city 284/285 over 250; no budget was raised)', 'conflict: cinema-profile phone 375 / 2.2 M (stricter kept)', 'texture: cinema-profile 300 MiB (no phone memory report exists)'],
  }),
  tablet: Object.freeze({
    label: 'Tablet (iPad class)', classes: ['tablet'], targetFps: 60,
    draws: 250, triangles: 1200000, textureMiB: 300, geometryMiB: null, gpuMs: 14,
    stallsPerMin: 1, missedFrac: 0.05, provisional: true,
    sources: ['= phone (tablets run the phone profile; FLY_RENDER_OPTIMIZATION.md tablet rows)'],
  }),
  low: Object.freeze({
    label: 'Low (software or constrained)', classes: ['software'], targetFps: 60,
    draws: 375, triangles: 2200000, textureMiB: 300, geometryMiB: null, gpuMs: null,
    stallsPerMin: 1, missedFrac: 0.05, provisional: true,
    sources: ['lib/fly/cinema-profile.js low', 'a software rasteriser certifies nothing (FLY_SHIP_PASS.md 3.8)'],
  }),
});
// BUDGET TABLE end

export const BUDGET_IDS = Object.freeze(Object.keys(BUDGET_TABLE));

/** The table key a profile name or a device report is held to. */
export function budgetIdFor(x) {
  if (typeof x === 'string') {
    if (BUDGET_TABLE[x]) return x;
    if (x.startsWith('phone')) return 'phone';
    if (x.startsWith('ultra')) return 'ultra';
    if (x.startsWith('high')) return 'high';
    return 'medium';
  }
  const report = x ?? {};
  const cls = report.gpu?.class;
  if (cls === 'high') return report.quality?.preset === 'ultra' ? 'ultra' : 'high';
  if (cls === 'phone') return report.device?.phoneClass === false ? 'tablet' : 'phone';
  if (cls === 'low') return 'low';
  return 'medium';
}

/**
 * Section 6 contract: budgetFor(profile) → the row ({ id, ...limits }) for a
 * profile name ('ultra' | 'high' | 'medium' | 'phone' | 'tablet' | 'low', or a
 * cinema profile name such as 'phone-lean') or for a device report.
 */
export function budgetFor(profileOrReport) {
  const id = budgetIdFor(profileOrReport);
  return { id, ...BUDGET_TABLE[id] };
}

/** Bytes form of a row's texture / geometry budget (cinema-profile.js). */
export function budgetBytes(id) {
  const b = BUDGET_TABLE[id];
  return { textureBytes: b.textureMiB * MiB, ...(b.geometryMiB ? { geometryBytes: b.geometryMiB * MiB } : {}) };
}

/**
 * Share of frames whose interval exceeds 1.5× the target interval, from a
 * list of frame intervals in ms → { frames, over, frac, intervalMs }.
 */
export function missedShare(dts, targetFps = 60) {
  const intervalMs = 1000 / targetFps;
  const limit = 1.5 * intervalMs;
  let over = 0;
  let frames = 0;
  for (const dt of dts ?? []) {
    if (!(dt > 0)) continue;
    frames++;
    if (dt > limit) over++;
  }
  return { frames, over, frac: frames ? over / frames : null, intervalMs: Math.round(intervalMs * 100) / 100 };
}

/** Back-compat view (the pre-pass TRUE EARTH shape some scripts print). */
export const TIER_BUDGETS = Object.freeze(
  Object.fromEntries(
    Object.entries(BUDGET_TABLE).map(([k, b]) => [k, { label: b.label, missedFrac: b.missedFrac, long100PerMin: b.stallsPerMin, triangles: b.triangles, draws: b.draws, textureMiB: b.textureMiB }]),
  ),
);

/**
 * Grade a device report → { tier, label, provisional, rows: [{ name, value,
 * limit, pass, info? }], pass }. A graded row whose value is missing is
 * reported with pass === null (unmeasured), never as a pass. GPU ms is graded
 * only when the report carries a GPU timing (no in-app timer source yet).
 */
export function gradeReport(report) {
  const tier = budgetIdFor(report);
  const b = BUDGET_TABLE[tier];
  const f = report?.frame || {};
  const r = report?.renderer || {};
  const rows = [];
  const row = (name, value, limit, info = false) => {
    const measured = Number.isFinite(value);
    rows.push({ name, value: measured ? value : null, limit, pass: info || limit == null ? true : measured ? value <= limit : null, ...(info ? { info: true } : {}) });
  };
  const missed = f.missed?.frac ?? (Array.isArray(f.dts) ? missedShare(f.dts, f.missed?.targetFps ?? b.targetFps).frac : null);
  row('frames over 1.5× the target interval (share)', missed, b.missedFrac);
  row('frames > 100 ms per minute', f.long100PerMin, b.stallsPerMin);
  row('triangles (peak)', r.trianglesPeak ?? r.triangles, b.triangles);
  row('draw calls (peak)', r.callsPeak ?? r.calls, b.draws);
  row('texture + renderbuffer MiB', Number.isFinite(r.textureBytes) ? Math.round((r.textureBytes / MiB) * 10) / 10 : null, b.textureMiB);
  if (Number.isFinite(f.gpuMs) && b.gpuMs != null) row('GPU ms (p95)', f.gpuMs, b.gpuMs);
  row('frame p95 (ms, information)', f.p95, null, true);
  row('frame p99 (ms, information)', f.p99, null, true);
  const pass = rows.every((x) => x.pass === true);
  return { tier, label: b.label, provisional: b.provisional === true, rows, pass };
}
