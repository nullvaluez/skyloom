/** WORLD PASS B r2b: prints the boost probe's runs as table rows (for the ledger). */
const path = require('node:path');
for (const f of process.argv.slice(2)) {
  const r = require(path.resolve(f, 'boost.json'));
  for (const x of r.runs) {
    const arm = x.flags.includes('TRUTH') ? 'all four' : x.flags.includes('ARRIVAL') ? 'ARRIVAL' : 'off';
    const g = x.geometry ?? {};
    console.log(`| ${path.basename(f)} ${x.pair} | ${arm} | ${x.ringSec?.toFixed(0)} | ${x.behindDeathsInRing} | ${x.deathsInRingEngine ?? '-'} | ${x.deathsOwnRing ?? '-'} | ${x.holes?.aheadMean ?? '-'} / ${x.holes?.behindMean ?? '-'} | ${g.t4 ? `${g.t4.cpuMiB.total} / ${g.t4.gpuMiB.total} (${g.t4.cpuMiB.buildings})` : '-'} | ${g.t8 ? `${g.t8.cpuMiB.total} / ${g.t8.gpuMiB.total} (${g.t8.cpuMiB.buildings})` : '-'} | ${x.errors.length} |`);
  }
}
