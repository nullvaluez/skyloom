/** WORLD PASS C (REACH): summarise a wp-reach-motion.cjs probe.json.
 *   node scripts/wp-reach-motion-summary.cjs <probe.json> [<probe.json> ...]
 * Per scenario, during the straight flight only (t >= go):
 *   sky group births (each one a CHUNK_FADE birth unless counted in fadeBudgetMiss),
 *   fadeBudgetMiss delta (a group that appeared or left WITHOUT a fade: a real pop),
 *   group births' true distance p10 / p50, evictions,
 *   stand-ins drawn p50 / max, minPx min / max, the largest single-sample change of
 *   minPx (a budget step; the shader dissolve hides it only if it is small),
 *   stand-in triangles max, rAF frame time p50 / p95 / max.
 */
const fs = require('node:fs');
const q = (a, p) => (a.length ? a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(p * a.length))] : null);
for (const file of process.argv.slice(2)) {
  const r = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const [name, sc] of Object.entries(r.scenarios)) {
    const go = sc.go ?? 0;
    const S = sc.samples.filter((s) => s.t >= go);
    const births = sc.births.filter((b) => b.tag === 'sky' && b.t >= go);
    const deaths = sc.deaths.filter((b) => b.tag === 'sky' && b.t >= go);
    const first = S[0]?.sky ?? {};
    const last = S[S.length - 1]?.sky ?? {};
    const minPx = S.map((s) => s.sky.standInMinPx).filter(Number.isFinite);
    let maxStep = 0;
    for (let i = 1; i < minPx.length; i++) maxStep = Math.max(maxStep, Math.abs(minPx[i] - minPx[i - 1]));
    const drawn = S.map((s) => s.sky.standInsDrawn).filter(Number.isFinite);
    const tris = S.map((s) => s.sky.standInTris).filter(Number.isFinite);
    const p95 = S.map((s) => s.dt?.p95).filter(Number.isFinite);
    const mx = S.map((s) => s.dt?.max).filter(Number.isFinite);
    const p50 = S.map((s) => s.dt?.p50).filter(Number.isFinite);
    const skyMax = S.map((s) => s.fin?.skyMax).filter(Number.isFinite);
    console.log(`${file.split(/[\\/]/).slice(-2, -1)[0]} ${name}: ${S.length} samples over ${(S.length * 0.25).toFixed(0)} s`);
    console.log(`  sky group births ${births.length} (true distance p10 ${q(births.map((b) => b.nearM), 0.1)?.toFixed(0)} m, p50 ${q(births.map((b) => b.nearM), 0.5)?.toFixed(0)} m), deaths ${deaths.length}`);
    console.log(`  fadeBudgetMiss ${first.fadeBudgetMiss} -> ${last.fadeBudgetMiss} (pops = ${(last.fadeBudgetMiss ?? 0) - (first.fadeBudgetMiss ?? 0)}), evictions ${first.evictions} -> ${last.evictions}`);
    if (drawn.length) console.log(`  stand-ins drawn p50 ${q(drawn, 0.5)} max ${Math.max(...drawn)}; tris max ${Math.max(...tris)}; minPx ${Math.min(...minPx)} .. ${Math.max(...minPx)}, largest step per 0.25 s ${maxStep.toFixed(3)}`);
    console.log(`  frame ms p50 ${q(p50, 0.5)} p95(p50 of windows) ${q(p95, 0.5)} worst window p95 ${Math.max(...p95)} max ${Math.max(...mx)}; skyline finalize max ${Math.max(0, ...skyMax)} ms`);
  }
}
