/**
 * verify-play-city: PLAY PASS CITY (CITY_FACADES; FLY_PLAY_PASS.md F6) in node.
 *
 * The satellite building material is compiled through its real
 * onBeforeCompile against three's standard shader, in a child node process per
 * arm (the flag is resolved once, at module load, through
 * lib/fly/play-pass.js; `-CITY_FACADES` is the `window.__flyCityFacadesOverride`
 * pin the URL installs).
 *
 *  (1) flag OFF: the near and far programs (Enhanced and Classic) hash to the
 *      text main carried before this pass, and their cache keys carry no city
 *      key: the previous experience, byte for byte;
 *  (2) flag ON: every anchored edit lands in both programs and both looks
 *      (applyCityFacades throws on a missing or repeated anchor), the cache
 *      key gains '|city-facades-v1', and every daytime change is weighted by
 *      cityDay = uCinema × (1 − night), so full night, Classic, Neon and the
 *      toy world render as before;
 *  (3) the shimmer contract in the text: frames are archStripe (derivative
 *      filtered), the per-panel tilt retires with the facade footprint, the
 *      extra sky sample is high tier only (uCitySky, both rings) and
 *      env-guarded, and curtain walls carry no pane relief or texture bump;
 *  (4) the tunables: every region has 4 masonry / 4 render / 2 pitched / 2
 *      concrete valid colours, the roof shares sum to 1, the cladding cuts are
 *      ordered in [0,1], and the cell period is a multiple of the cell and of
 *      REBASE_CALM's quantum;
 *  (5) pure logic: region palettes (unknown → temperate), the dominant-region
 *      vote, the eased palette (a first region snaps, a change eases and
 *      settles), and the cell id surviving floating-origin rebases in float32;
 *  (6) seams: the flag is read only through lib/fly/play-pass.js, the layer
 *      calls the update only behind CITY_FACADES_ON, and nothing per frame
 *      logs.
 *
 * Run: node scripts/verify-play-city.mjs
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);

// The programs main carried before CITY_FACADES (a08407c + 553c4cb), compiled
// here against three's standard shader with mapStyle 'satellite'. Re-pin only
// for an intended change UPSTREAM of the city pass (bend, cinema, world-art,
// three), and say so in the commit.
const GOLDEN_OFF = {
  'enhanced-near': { vs: 'f7291e59aed5f96d', fs: 'e27c46a0d47798dd', key: 'world-bend-anchor-satbldg-r19|cinematic-architecture-v11-cinema-art-near|immersive-surface-v1|ground-window-v2|earth-architecture-v2|ground-light-v3-buildings-daylight-building-v2|painterly-v3-r5-architecture-world-art1|cinema-light-v1' },
  'enhanced-far': { vs: '91d95532613ec02f', fs: '30559e230885c74b', key: 'world-bend-anchor-satskyline-r19|cinematic-architecture-v11-cinema-art-far-coverage|immersive-surface-v1|ground-window-v2|earth-architecture-v2-daylight-building-v2|painterly-v3-r5-architecture-world-art1|cinema-light-v1' },
  'classic-near': { vs: 'f7291e59aed5f96d', fs: '74afda87a7becd89', key: 'world-bend-anchor-satbldg-r19|cinematic-architecture-v11-cinema-art-near|immersive-surface-v1|ground-window-v2|earth-architecture-v2|ground-light-v3-buildings-daylight-building-v2|painterly-v3-r5-architecture-world-art1' },
  'classic-far': { vs: '91d95532613ec02f', fs: '2e08d314ef5fcda5', key: 'world-bend-anchor-satskyline-r19|cinematic-architecture-v11-cinema-art-far-coverage|immersive-surface-v1|ground-window-v2|earth-architecture-v2-daylight-building-v2|painterly-v3-r5-architecture-world-art1' },
};

// ---------------------------------------------------------------------------
// CHILD: compile the four programs for one arm and print them as JSON.
async function child(arm) {
  const { register } = await import('node:module');
  register('./_node-resolve.mjs', import.meta.url);
  if (arm === 'off') globalThis.window = { __flyCityFacadesOverride: { enabled: false }, location: { search: '' } };
  const { ShaderLib, UniformsUtils } = await import('three');
  const { createSatelliteArchitectureMaterial } = await import('../lib/fly/satellite-architecture-material.js');
  const { useFlyStore } = await import('../stores/fly-store.js');
  const { playPassOn } = await import('../lib/fly/play-pass.js');
  delete globalThis.window; // pins are read once, at module load
  const out = { on: playPassOn('CITY_FACADES'), programs: {} };
  for (const visuals of ['enhanced', 'classic']) {
    useFlyStore.setState({ mapStyle: 'satellite', visuals });
    for (const distant of [false, true]) {
      const m = createSatelliteArchitectureMaterial({ distant });
      const s = { uniforms: UniformsUtils.clone(ShaderLib.standard.uniforms), vertexShader: ShaderLib.standard.vertexShader, fragmentShader: ShaderLib.standard.fragmentShader };
      let error = null;
      try { m.onBeforeCompile(s, {}); } catch (e) { error = e.message; }
      out.programs[`${visuals}-${distant ? 'far' : 'near'}`] = { vs: s.vertexShader, fs: s.fragmentShader, key: m.customProgramCacheKey(), uniforms: Object.keys(s.uniforms), error };
      m.dispose();
    }
  }
  process.stdout.write(JSON.stringify(out));
}

const armArg = process.argv.find((a) => a.startsWith('--arm='));
if (armArg) {
  await child(armArg.slice(6));
  process.exit(0);
}

let pass = 0, fail = 0;
function check(name, ok, detail = '') {
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}
function runArm(arm) {
  const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), `--arm=${arm}`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`arm ${arm} failed: ${r.stderr.slice(0, 2000)}`);
  return JSON.parse(r.stdout);
}

// (1) flag off
const off = runArm('off');
{
  const bad = Object.entries(GOLDEN_OFF).filter(([k, g]) => {
    const p = off.programs[k];
    return !p || p.error || sha(p.vs) !== g.vs || sha(p.fs) !== g.fs || p.key !== g.key;
  });
  check('(1) flag off: near/far × Enhanced/Classic programs and keys are the pre-pass text', !off.on && bad.length === 0,
    bad.map(([k]) => `${k} vs ${sha(off.programs[k]?.vs ?? '')} fs ${sha(off.programs[k]?.fs ?? '')}`).join('; '));
  const leak = Object.values(off.programs).filter((p) => /city[A-Z]|[uv]City/.test(p.vs + p.fs + p.uniforms.join(',')));
  check('(1) flag off: no city varying, uniform or code in any program', leak.length === 0);
}

// (2) flag on
const on = runArm('on');
{
  const errors = Object.entries(on.programs).filter(([, p]) => p.error);
  check('(2) flag on: every anchored edit lands in all four programs', on.on && errors.length === 0, errors.map(([k, p]) => `${k}: ${p.error}`).join('; '));
  check('(2) flag on: cache keys gain |city-facades-v1 (and only that)', Object.entries(on.programs).every(([k, p]) => p.key.includes('|city-facades-v1') && p.key.replace('|city-facades-v1', '') === GOLDEN_OFF[k].key));
  const near = on.programs['enhanced-near'].fs, nearVs = on.programs['enhanced-near'].vs;
  check('(2) flag on: the day weight is uCinema × (1 − night)', near.includes('float cityDay=uCinema*(1.-uArchitectureNight);'));
  check('(2) flag on: the albedo mixes in by cityDay; glass masks and curtain edits ride cityDay',
    near.includes('diffuseColor.rgb=mix(diffuseColor.rgb,mix(cityRoof,cityWall,isWall),cityDay);')
    && /float cityGlassMask=[^;]*\*cityDay;/.test(near) && near.includes('float cityCurtainDay=cityCurtain*cityDay;'));
  // Every edit to shipped lines is gated by cityDay, cityCurtainDay or cityGlassMask.
  const shipped = on.programs['enhanced-near'];
  const offNear = off.programs['enhanced-near'];
  const addedLines = shipped.fs.split('\n').filter((l) => !offNear.fs.split('\n').includes(l));
  const ungated = addedLines.filter((l) => /^(diffuseColor|roughnessFactor|material\.|reflectedLight|radiance|cmArchitecture|float revealDetail|\s*float spandrel|\s*float glassRelief|\s*float relief|\s*diffuseColor)/.test(l.trim())
    && !/cityDay|cityCurtainDay|cityGlassMask/.test(l));
  check('(2) flag on: every touched shipped line is weighted by the day/curtain/glass masks', ungated.length === 0, ungated.join(' | '));
  check('(2) flag on: emission (night windows) untouched', (() => {
    const em = (t) => { const at = t.indexOf('#include <emissivemap_fragment>'); return t.slice(at, t.indexOf('#include <', at + 10)); };
    return em(shipped.fs) === em(offNear.fs);
  })());
  check('(2) flag on: vertex adds only the up varying and the anchor cell', nearVs.includes('vCityUp = normal.y;') && nearVs.includes('vCityCell=floor(fract((cityHash.x+cityHash.y)*cityHash.x)*256.);'));
  check('(2) flag on: uniforms uCityPalette/uCityReflect/uCityPhase/uCitySky bound', ['uCityPalette', 'uCityReflect', 'uCityPhase', 'uCitySky'].every((u) => on.programs['enhanced-far'].uniforms.includes(u)));
}

// (3) the shimmer contract, in the text
{
  const fs = on.programs['enhanced-near'].fs;
  check('(3) frames are derivative-filtered stripes on the facade cell grid', /float cityFrame=max\(archStripe\(cell\.x\+\.5,[^)]*\)\*uArchitectureDetail,archStripe\(cell\.y\+\.5,/.test(fs));
  check('(3) the per-panel tilt retires with the facade footprint', fs.includes('*(1.-smoothstep(.15,.5,max(width.x,width.y)));'));
  check('(3) the sky sample is high-tier (uCitySky) and env-guarded', fs.includes('#if defined(RE_IndirectSpecular)&&defined(USE_ENVMAP)&&defined(ENVMAP_TYPE_CUBE_UV)') && fs.includes('if(cityGlassMask>.001&&uCitySky>.5){'));
  check('(3) curtain walls drop pane relief, panel bowing and texture bump', fs.includes('* paneMask*(1.-cityCurtainDay) - 0.006') && fs.includes('*paneMask*(1.-minify)*(1.-cityCurtainDay);') && fs.includes('cmArchitectureAmount*=1.-cityCurtainDay;'));
}

// (4)/(5) tunables and pure logic, against the module itself (flag on, no window)
{
  const { register } = await import('node:module');
  register('./_node-resolve.mjs', import.meta.url);
  const { CITY_FACADES, REBASE_CALM } = await import('../lib/fly/fly-constants.js');
  const cf = await import('../lib/fly/city-facades.js');
  const hex = (h) => /^#[0-9a-f]{6}$/i.test(h);
  const regions = Object.entries(CITY_FACADES.regions);
  const badRegion = regions.filter(([, r]) => r.masonry.length !== 4 || r.render.length !== 4 || r.pitched.length !== 2 || r.concrete.length !== 2 || ![...r.masonry, ...r.render, ...r.pitched, ...r.concrete].every(hex));
  const known = ['temperate', 'europe', 'mediterranean', 'east-asia', 'tropical-asia', 'south-asia', 'arid', 'latin', 'oceania'];
  check('(4) every architecture region has a full, valid palette', badRegion.length === 0 && known.every((k) => CITY_FACADES.regions[k]), badRegion.map(([k]) => k).join(', '));
  const shares = CITY_FACADES.flatRoofShares;
  check('(4) flat roof shares are one per colour and sum to 1', shares.length === CITY_FACADES.flatRoofs.length && Math.abs(shares.reduce((a, b) => a + b, 0) - 1) < 1e-9);
  check('(4) cladding cuts are ordered in [0,1]', Object.values(CITY_FACADES.claddingCuts).every((c) => c.length === 3 && c.every((x, i) => x >= 0 && x <= 1 && (i === 0 || x >= c[i - 1]))));
  const P = CITY_FACADES.cell.units * CITY_FACADES.cell.periodCells;
  check('(4) the cell period is a multiple of the cell and of REBASE_CALM.quantM', Number.isInteger(CITY_FACADES.cell.periodCells) && P % REBASE_CALM.quantM === 0, `P=${P}`);
  check('(4) glass, metal and roofs are valid colours; ranges are ordered', [...CITY_FACADES.glass, ...CITY_FACADES.metal, ...CITY_FACADES.flatRoofs].every(hex)
    && CITY_FACADES.glassF0[0] < CITY_FACADES.glassF0[1] && CITY_FACADES.glassRoughness[0] < CITY_FACADES.glassRoughness[1] && CITY_FACADES.valueJitter[0] < CITY_FACADES.valueJitter[1]);

  const t = cf.cityRegionPalette('temperate');
  check('(5) region palettes: 12 linear colours in [0,1]; unknown → temperate', known.every((k) => cf.cityRegionPalette(k).length === 12 && cf.cityRegionPalette(k).flat().every((x) => x >= 0 && x <= 1))
    && JSON.stringify(cf.cityRegionPalette('nowhere')) === JSON.stringify(t));
  const chunk = (style, n, state = 'ready') => ({ state, meta: { provenance: { region: { style } }, families: [n, 0, 0, 0, 0, 0, 0, 0] } });
  check('(5) the region vote follows the buildings and ignores chunks still loading', cf.dominantCityRegion([chunk('europe', 10), chunk('arid', 30), chunk('europe', 15)]) === 'arid'
    && cf.dominantCityRegion([chunk('europe', 10), chunk('arid', 300, 'building')]) === 'europe' && cf.dominantCityRegion([]) === null && cf.dominantCityRegion([{ state: 'ready' }]) === null);
  // The eased palette: a first region snaps; a change eases over regionEaseSec.
  const U = cf.CITY_FACADE_UNIFORMS.uCityPalette.value;
  const engine = (style) => ({ chunks: new Map([['a', chunk(style, 50)]]) });
  cf.updateCityFacades(engine('east-asia'), 10, { x: 0, z: 0 });
  const ea = cf.cityRegionPalette('east-asia'), ar = cf.cityRegionPalette('arid');
  const near = (a, b, eps) => a.every((c, i) => Math.abs(U[i].x - c[0]) + Math.abs(U[i].y - c[1]) + Math.abs(U[i].z - c[2]) < eps);
  const snapped = near(ea, 0, 1e-9);
  cf.updateCityFacades(engine('arid'), 11.0, { x: 0, z: 0 });
  cf.updateCityFacades(engine('arid'), 11.05, { x: 0, z: 0 });
  const midway = !near(ar, 0, 1e-3) && !near(ea, 0, 1e-6);
  for (let s = 11.1; s < 11.1 + CITY_FACADES.regionEaseSec * 4; s += 0.05) cf.updateCityFacades(engine('arid'), s, { x: 0, z: 0 });
  check('(5) the palette snaps on a first region, then eases to a new one and settles', snapped && midway && near(ar, 0, 1e-3) && cf.cityFacadesState().style === 'arid' && !cf.cityFacadesState().easing);
  // A clock that restarts (a remounted canvas) still votes: a new region is picked up at once.
  cf.updateCityFacades(engine('europe'), 0.5, { x: 0, z: 0 });
  check('(5) a clock that goes backwards still re-votes the region', cf.cityFacadesState().style === 'europe');
  // The cell id in float32, across rebases (REBASE_CALM quantised origins).
  const f32 = Math.fround, units = CITY_FACADES.cell.units;
  const cellOf = (absX, originX) => {
    const phase = cf.cityCellPhase({ x: originX, z: 0 })[0];
    const w = f32(absX - originX); // the rebased anchor (float64 matrix → float32 attribute math)
    const m = f32(f32(w + f32(phase)) - f32(P) * Math.floor(f32(w + f32(phase)) / f32(P)));
    return Math.floor(m / units);
  };
  let flips = 0, n = 0, seedX = 12345;
  const rnd = () => ((seedX = (seedX * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let i = 0; i < 20000; i++) {
    const origin = Math.round((rnd() * 4e7 - 2e7) / REBASE_CALM.quantM) * REBASE_CALM.quantM;
    const abs = origin + (rnd() - 0.5) * 6000;
    const next = origin + REBASE_CALM.quantM * Math.round((rnd() - 0.5) * 8);
    const edge = Math.abs(((abs % units) + units) % units);
    if (edge < 0.01 || units - edge < 0.01) continue; // an anchor on a cell edge is a tie either way
    n++;
    if (cellOf(abs, origin) !== cellOf(abs, next)) flips++;
  }
  check('(5) a building keeps its cell across floating-origin rebases (float32)', flips === 0, `${flips} flips in ${n}`);
}

// (6) seams
{
  const sources = [];
  const walk = (d) => {
    for (const f of readdirSync(d)) {
      const p = path.join(d, f);
      if (f === 'node_modules') continue;
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(m?js|jsx)$/.test(f)) sources.push([path.relative(ROOT, p).split(path.sep).join('/'), readFileSync(p, 'utf8')]);
    }
  };
  for (const dir of ['lib', 'components', 'app', 'stores']) walk(path.join(ROOT, dir));
  const direct = sources.filter(([rel, src]) => /\bCITY_FACADES\b/.test(src) && /from ['"][^'"]*fly-constants['"]/.test(src)
    && /import\s*\{[^}]*\bCITY_FACADES\b[^}]*\}\s*from ['"][^'"]*fly-constants/.test(src)
    && !['lib/fly/play-pass.js', 'lib/fly/device-report.js'].includes(rel));
  check('(6) CITY_FACADES is read only through lib/fly/play-pass.js', direct.length === 0, direct.map(([r]) => r).join(', '));
  const layer = read('components/fly/SatBuildingLayer.jsx');
  check('(6) the layer updates the facade uniforms only behind CITY_FACADES_ON', /if \(CITY_FACADES_ON\) updateCityFacades\(engine, clock\.elapsedTime, runtime\.origin\?\.anchor\);/.test(layer));
  check('(6) nothing in the city pass logs', !/console\./.test(read('lib/fly/city-facades.js')));
  const mat = read('lib/fly/satellite-architecture-material.js');
  check('(6) the material applies the pass only behind CITY_FACADES_ON', mat.includes('if (CITY_FACADES_ON) applyCityFacades(shader);') && mat.includes("${CITY_FACADES_ON ? CITY_FACADES_KEY : ''}"));
}

console.log(`\nPLAY CITY: ${pass}/${pass + fail}${fail ? ` (${fail} FAILED)` : ''}`);
process.exit(fail ? 1 : 0);
