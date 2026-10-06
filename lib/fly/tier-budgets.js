/**
 * TRUE EARTH — per-tier performance budgets (TRUE_EARTH_PASS.md, "Per-tier
 * budgets") and the grader the diagnostics overlay and
 * scripts/verify-device-report.mjs share. A budget is only as good as the
 * venue it is read on: these grade a report from a REAL device; the cloud
 * container's SwiftShader numbers grade nothing.
 */
export const TIER_BUDGETS = {
  high: { label: 'High (desktop dGPU)', p95Ms: 12, p99Ms: 20, long100PerMin: 0, triangles: 4.0e6, draws: 450 },
  medium: { label: 'Medium (integrated GPU)', p95Ms: 16.7, p99Ms: 33, long100PerMin: 1, triangles: 2.2e6, draws: 375 },
  phone: { label: 'Phone (A17 Pro class)', p95Ms: 20, p99Ms: null, long100PerMin: 1, triangles: 1.2e6, draws: 250 },
};

/** Which budget a report is held to: the device's GPU class (low grades as medium). */
export function budgetFor(report) {
  const cls = report?.gpu?.class;
  return TIER_BUDGETS[cls] ? cls : 'medium';
}

/**
 * Grade a device report. Returns { tier, rows: [{ name, value, limit, pass }], pass }.
 * A row whose value is missing is reported with pass === null (unmeasured),
 * never as a pass.
 */
export function gradeReport(report) {
  const tier = budgetFor(report);
  const b = TIER_BUDGETS[tier];
  const f = report?.frame || {};
  const r = report?.renderer || {};
  const rows = [];
  const row = (name, value, limit) => {
    const measured = Number.isFinite(value);
    rows.push({ name, value: measured ? value : null, limit, pass: limit == null ? true : measured ? value <= limit : null });
  };
  row('frame p95 (ms)', f.p95, b.p95Ms);
  if (b.p99Ms != null) row('frame p99 (ms)', f.p99, b.p99Ms);
  row('frames > 100 ms per minute', f.long100PerMin, b.long100PerMin);
  row('triangles (peak)', r.trianglesPeak ?? r.triangles, b.triangles);
  row('draw calls (peak)', r.callsPeak ?? r.calls, b.draws);
  const pass = rows.every((x) => x.pass === true);
  return { tier, label: b.label, rows, pass };
}
