/** WORLD PASS B r2b: prints the pacing probe's runs as one line each (for the ledger). */
const r = require(require('node:path').resolve(process.argv[2]));
for (const run of r.runs) for (const w of ['cold', 'warm']) {
  const x = run[w]; if (!x) continue;
  const f = x.wpFrames ?? {};
  console.log([run.pair, run.flags.includes('TRUTH') ? 'all4' : run.flags.includes('ARRIVAL') ? 'ARRIVAL' : 'off', w,
    `longest ${x.top5.slice(0, 2).join(' (')})`, `>33 ${x.over33}`, `>100 ${x.over100}`, `firstTile ${x.firstTileSec}`, `ground ${x.groundSec == null ? '-' : (+x.groundSec).toFixed(1)}`,
    `finFrame ${x.finalizeFrameMsMax}`, `worst ${x.finWorst ? `pre ${x.finWorst.pre} fin ${x.finWorst.fin}` : '-'}`,
    `bldFrameMax ${f.buildingMax} top ${(f.topBuilding ?? []).join('/')}`, `skyMax ${f.skylineMax}`, `sumMax ${f.sumMax}`, `both>1 ${f.bothOver1}`,
    `share ${x.share?.wholeGranted ?? '-'}/${x.share?.wholeRefused ?? '-'}/${x.share?.slicesYielded ?? '-'}`, `steps ${x.finPh ? JSON.stringify(x.finPh) : '-'}`, `progs ${(x.programs ?? []).slice(0, 2).map((p) => `${p.key.split('#')[0].slice(0, 12)}#${(p.key.split('#')[1] ?? '').slice(0, 8)} ${p.ms}`).join(', ')}`, `err ${run.errors.length}`].join(' | '));
}
