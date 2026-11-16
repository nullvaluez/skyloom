// WORLD PASS review, lens "stream": summarise probe.json files (births at distance, ring fill, hitches).
const fs = require('node:fs');
const q = (a, p) => { a = a.filter(Number.isFinite).sort((x, y) => x - y); return a.length ? Math.round(a[Math.min(a.length - 1, Math.floor(p * a.length))]) : null; };
const out = {};
for (const f of process.argv.slice(2)) {
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  for (const [sc, s] of Object.entries(j.scenarios)) { if (!s.samples?.length) { out[sc] = { invalid: "page reloaded mid-run, no samples" }; continue; }
    const go = s.go ?? 0, end = go + (s.speed ? s.distM / s.speed : 999);
    const fly = s.samples.filter(x => x.t >= go && x.t <= end);
    const bb = s.births.filter(b => b.tag === 'bld' && b.t >= go && b.t <= end + 3);
    const sb = s.births.filter(b => b.tag === 'sky' && b.t >= go && b.t <= end + 3);
    const ready = fly.map(x => x.bld.liveReady ?? x.bld.ready);
    const arrive = s.samples.filter(x => x.t >= end - 1 && x.t <= end + 1);
    const hitches = fly.filter(x => x.dt.max > 50).length;
    const finMax = Math.max(0, ...s.samples.map(x => x.fin.bldMax || 0));
    const firstB = s.births.find(b => b.tag === 'bld'), firstS = s.births.find(b => b.tag === 'sky' && b.t > 1);
    const fullAt = s.samples.find(x => (x.bld.liveReady ?? x.bld.ready) >= 16);
    out[sc] = {
      speed: s.speed, altM: s.altM, go,
      detailBirthsInFlight: bb.length, detailBirthNearM: { p10: q(bb.map(b => b.nearM), .1), p50: q(bb.map(b => b.nearM), .5), p90: q(bb.map(b => b.nearM), .9) },
      horizonBirthsInFlight: sb.length, horizonBirthNearM: { p50: q(sb.map(b => b.nearM), .5) },
      detailReadyInFlight: { min: Math.min(...ready), p50: q(ready, .5), max: Math.max(...ready) },
      bodiesAtArrival: arrive.map(x => x.bld.bodies), readyAtArrival: arrive.map(x => x.bld.liveReady ?? x.bld.ready),
      samplesWithFrameOver50ms: hitches + ' of ' + fly.length, worstFinalizeMs: Math.round(finMax),
      settle: sc.startsWith('settle') ? { firstDetailS: firstB?.t, firstHorizonS: firstS?.t, detailFullS: fullAt?.t } : undefined,
      steady: (() => { const x = s.samples[s.samples.length - 1]; return { calls: x.gl?.calls, glTris: x.gl?.tris, bodies: x.bld.bodies, bldTris: x.bld.tris, horizonTris: x.sky.sTris, dtP50: x.dt.p50 }; })(),
    };
  }
}
console.log(JSON.stringify(out, null, 1));
