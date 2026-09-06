/**
 * ROUND 24 (E CERT) — THE HARNESS FINALIZE-BUDGET SCALER.
 *
 * WHY THIS EXISTS, and why it is not a feature.
 *
 * Every streaming engine spends its DEM-drape and GPU-upload work against a
 * PER-FRAME budget: `SAT_BUILDINGS.drapeBudgetMs` is 1.0 ms and
 * `finalizePerFrame` is 1, and the skyline, roads and toy engines are the
 * same shape. On the calibration GPU at 120 fps that is 120 ms of drape per
 * SECOND and a chunk lands in well under a second — the budget is doing its
 * job, which is to keep a burst off any one frame.
 *
 * In the R24 build container the renderer is ANGLE/SwiftShader and the game
 * runs at 1-3 fps (recon HARN-ENV-3). The same budget is then 1-3 ms of drape
 * per second. MEASURED here at Powell with the offline world fixture: the
 * terrain quadtree settles fully (maxZ 17, ground elevation converged to
 * 271-273 m against the fixture's true 276 m, zero downloads in flight), and
 * after SIX MINUTES `__satBuildings.stats` still reads
 * `{ chunks: 16, ready: 0, empty: 0 }` — because each chunk's drape is ~400
 * `getElevationAt` calls, each a full-quadtree raycast over 229 tiles (recon
 * T9 / FL-08), and 1 ms per frame cannot get through them.
 *
 * The consequence is not "the fixture is slow". It is that EVERY satellite
 * content gate — sat-buildings, roof-variety, skyline, suburbia, parcel-homes,
 * and R24's own flash-guard and fade — would be certifying a world whose
 * buildings never arrived, and would read `0` for counts that should be
 * thousands. That is the R20 false-green shape.
 *
 * So: a harness-only multiplier, read live at the five budget sites, using the
 * same idiom as the live-weather override (`lib/fly/weather-model.js:113`) and
 * the R24 tile fixture. With the global ABSENT — which is every production
 * load and every harness that does not set it — `budgetK()` returns exactly 1
 * and the arithmetic at each site is byte-identical to R21.
 *
 *   window.__flyFinalizeBudgetK = 40;   // set BEFORE the app mounts
 *
 * WHAT IT MUST NEVER BE USED FOR. It changes PACING, so any gate that measures
 * pacing, frame time, stalls, per-frame spike behaviour or the shape of a
 * stream-in must NOT set it — and none of E's do. It is for gates that ask
 * "what does the world CONTAIN once it has settled": counts, census, draw and
 * triangle totals, geometry fingerprints, fixed-pose pixels. Those answers are
 * independent of how many frames the drape took to finish, which is exactly
 * why scaling the budget is sound for them and unsound for anything else.
 *
 * The value is clamped to [1, 500]: a harness may only ever make the budget
 * MORE generous, never tighter, so it cannot be used to manufacture a green by
 * starving a competitor for frames.
 */

let warned = false;

/**
 * @returns {number} the per-frame budget multiplier — exactly 1 in production.
 */
export function budgetK() {
  if (typeof window === 'undefined') return 1;
  const v = window.__flyFinalizeBudgetK;
  if (v === undefined || v === null) return 1;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 1) return 1;
  if (process.env.NODE_ENV === 'development' && !warned) {
    warned = true;
    console.warn(
      `[fly] HARNESS finalize-budget scaler active: x${Math.min(n, 500)}. ` +
        'Pacing measurements taken under this flag are meaningless.'
    );
  }
  return Math.min(n, 500);
}
