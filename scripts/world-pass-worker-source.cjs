/**
 * World Pass W0 (worker split): the vector-tile worker's SOURCE is now
 * lib/fly/toy-world/vector-tile.worker.js PLUS every module under
 * lib/fly/toy-world/worker/. Source-text gates that used to read the worker
 * file alone (verify-icons B5/B6, verify-neon-cover 1/2/3a/4a,
 * verify-parcel-homes (I)) read the satellite builders' text through
 * readWorkerSource() instead.
 *
 * The files are joined with a `function __file__() {}` line in front of each,
 * so a gate that slices the text into top-level functions
 * (verify-neon-cover's `^(?:function (\w+)|const (api) = )`) never attributes
 * one module's import block to the previous module's last function.
 *
 *   const { readWorkerSource } = require('./world-pass-worker-source.cjs');
 *   const workerSrc = readWorkerSource();            // the joined text
 *
 * Run directly, it replays the SOURCE halves of those gates on both readings
 * (the worker file alone, and the joined source) and prints each verdict:
 *   node scripts/world-pass-worker-source.cjs [--root <tree>]
 */
const fs = require('fs');
const path = require('path');

const SEP = '\nfunction __file__() {}\n';

function workerFiles(root) {
  const base = path.join(root, 'lib/fly/toy-world');
  const out = [path.join(base, 'vector-tile.worker.js')];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir).sort()) {
      const p = path.join(dir, name);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (/\.m?js$/.test(name)) out.push(p);
    }
  };
  walk(path.join(base, 'worker'));
  return out;
}

function readWorkerSource(root = path.join(__dirname, '..')) {
  return workerFiles(root)
    .map((f) => SEP + fs.readFileSync(f, 'utf8'))
    .join('');
}

module.exports = { readWorkerSource, workerFiles };

if (require.main === module) {
  const i = process.argv.indexOf('--root');
  const root = path.resolve(i > 0 ? process.argv[i + 1] : path.join(__dirname, '..'));
  const single = fs.readFileSync(path.join(root, 'lib/fly/toy-world/vector-tile.worker.js'), 'utf8');
  const joined = readWorkerSource(root);
  const SAT_BUILDERS = ['buildSatBuildings', 'buildSatRoads', 'buildSatSkyline', 'buildSatVeg'];
  const R20_FLAGS = ['NEON_COVER', 'TOY_MID_SUBURB', 'MONUMENT_MODELS', 'PARCEL_HOMES', 'SAT_POLY_COVER', 'TILE_PIPELINE'];
  const EXPECTED_TOY_FLAGS = ['NEON_COVER', 'TOY_MID_SUBURB', 'MONUMENT_MODELS', 'TILE_PIPELINE'];
  const gates = (src) => {
    const r = {};
    // verify-icons B5 / B6
    r['icons B5'] = /function marqueeExclusionTile\([^)]*\)\s*\{\s*\n\s*if \(!MONUMENT_MODELS\.enabled \|\| MONUMENT_EXCLUSIONS\.length === 0\) return null;/.test(src);
    r['icons B6 (3 sites)'] = (src.match(/if \(marqueeEx\) dropMarqueeFootprints\(items, marqueeEx\);/g) ?? []).length === 3;
    // verify-neon-cover 1 / 2 / 3a / 4a (source halves)
    const bounds = [];
    const fnRe = /^(?:function (\w+)|const (api) = )/gm;
    let m;
    while ((m = fnRe.exec(src))) bounds.push({ name: m[1] || m[2], start: m.index });
    bounds.push({ name: '<eof>', start: src.length });
    const bodyOf = (name) => {
      const k = bounds.findIndex((b) => b.name === name);
      return k < 0 ? null : src.slice(bounds[k].start, bounds[k + 1].start);
    };
    r['neon 1'] = /const classifyToy\s*=\s*NEON_COVER\.enabled\s*\?\s*classifyRingsSat\s*:\s*classifyRings;/.test(src);
    r['neon 2'] = (src.match(/classifyToy\(rings/g) || []).length === 3 && (src.match(/=\s*classifyRings\(/g) || []).length === 0;
    const apiStart = bounds.find((b) => b.name === 'api')?.start ?? 0;
    const apiBody = bodyOf('api') || '';
    let lastSatReturn = 0;
    for (const mm of apiBody.matchAll(/return build(?:SatBuildings|SatRoads|SatSkyline|SatVeg)\(/g)) lastSatReturn = Math.max(lastSatReturn, mm.index + mm[0].length);
    const toyBodyStart = apiStart + lastSatReturn;
    const toyBody = apiBody.slice(lastSatReturn);
    const topLevelFns = new Set(bounds.map((b) => b.name));
    const toyHelpers = new Set([...toyBody.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)].map((mm) => mm[1]).filter((n) => topLevelFns.has(n)));
    const enclosingFn = (idx) => {
      let name = '<module>';
      for (const b of bounds) {
        if (b.start <= idx) name = b.name;
        else break;
      }
      return name;
    };
    const toyReachable = R20_FLAGS.filter((f) => {
      const re = new RegExp(`\\b${f}\\b`, 'g');
      let mm;
      while ((mm = re.exec(src))) {
        if (mm.index >= toyBodyStart && mm.index < apiStart + apiBody.length) return true;
        if (toyHelpers.has(enclosingFn(mm.index))) return true;
      }
      return false;
    });
    r['neon 3a'] = toyReachable.length === EXPECTED_TOY_FLAGS.length && EXPECTED_TOY_FLAGS.every((f) => toyReachable.includes(f));
    r['neon 3a detail'] = toyReachable.join('+');
    const leaky = SAT_BUILDERS.filter((n) => {
      const body = bodyOf(n);
      return body === null || /NEON_COVER/.test(body);
    });
    r['neon 4a'] = leaky.length === 0 && ((bodyOf('api') || '').match(/NEON_COVER/g)?.length ?? 0) > 0;
    // verify-parcel-homes (I)
    r['parcel (I) guards'] = (src.match(/if\s*\(PARCEL_HOMES\.enabled\)/g) ?? []).length >= 2 && /out\.satParcel\s*=/.test(src);
    r['parcel (I) prand'] = /const\s+prand\s*=\s*mulberry32\(/.test(src) && /prand\(\)/.test(src) && !/parcelPts\.push\([^)]*rand\(\)/.test(src);
    // verify-stylized-earth / graphics-unit / verify-city-horizon: the protocol stays in the worker file
    r['protocol in worker file'] = /const WORKER_PROTOCOL = (\d+)/.test(src);
    return r;
  };
  const a = gates(single);
  const b = gates(joined);
  console.log(`root ${root}\n${workerFiles(root).length} files\n`);
  console.log('gate'.padEnd(28) + 'worker file alone'.padEnd(26) + 'readWorkerSource()');
  for (const k of Object.keys(a)) console.log(k.padEnd(28) + String(a[k]).padEnd(26) + String(b[k]));
  const fails = Object.entries(b).filter(([k, v]) => v === false).map(([k]) => k);
  process.exit(fails.length ? 1 : 0);
}
