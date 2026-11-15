/** LOOK PASS before/after: side-by-side pairs, one contact sheet and delta numbers.
 *
 *   node scripts/look-pass-compare.cjs --a=baseline --b=atmos-v1
 *   Options: --out=<absolute dir>  --width=800 (per side)  --cols=2 (pairs per sheet row)
 *
 * Reads <main checkout>/.graphics-review/look-pass/<a|b>/ and writes
 * <...>/compare/<a>__vs__<b>/{<pose>__<time>.jpg, sheet.jpg, compare.json}.
 * Clouds and water animate between runs, so pixel deltas carry a noise floor
 * (compare two runs of the same code to read it); band statistics are steadier.
 */
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');
const sharp = require('sharp');

const args = Object.fromEntries(process.argv.slice(2).map(s => { const [k, ...v] = s.replace(/^--/, '').split('='); return [k, v.join('=') || true]; }));
const a = String(args.a || 'baseline'), b = String(args.b || '');
if (!b) { console.error('Usage: --a=<label> --b=<label>'); process.exit(2); }
let home;
try { home = path.resolve(execSync('git rev-parse --path-format=absolute --git-common-dir', { encoding: 'utf8' }).trim(), '..'); }
catch { home = path.resolve(__dirname, '..'); }
const root = path.join(home, '.graphics-review', 'look-pass');
const dirA = path.join(root, a), dirB = path.join(root, b);
const out = path.resolve(typeof args.out === 'string' ? args.out : path.join(root, 'compare', `${a}__vs__${b}`));
fs.mkdirSync(out, { recursive: true });
const W = Number(args.width || 800), cols = Number(args.cols || 2), BAR = 30;

const manifest = dir => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')); } catch { return { captures: [] }; } };
const metricsOf = (m, file) => m.captures.find(c => c.file === file)?.metrics ?? null;
const burstOf = (m, file) => m.captures.find(c => c.file === file)?.burst?.sparklePct ?? null;
const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const caption = (text, width, color) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${BAR}"><rect width="100%" height="100%" fill="#101418"/><text x="10" y="20" font-family="Segoe UI, Arial, sans-serif" font-size="15" font-weight="600" fill="${color}">${esc(text)}</text></svg>`);

async function pixelDelta(fileA, fileB) {
  const size = { width: 400, height: 225, fit: 'fill' };
  const [pa, pb] = await Promise.all([fileA, fileB].map(f => sharp(f).removeAlpha().resize(size).raw().toBuffer()));
  let sum = 0, changed = 0; const n = pa.length / 3;
  for (let i = 0; i < pa.length; i += 3) {
    const d0 = Math.abs(pa[i] - pb[i]), d1 = Math.abs(pa[i + 1] - pb[i + 1]), d2 = Math.abs(pa[i + 2] - pb[i + 2]);
    sum += (d0 + d1 + d2) / 3; if (Math.max(d0, d1, d2) > 10) changed++;
  }
  return { meanAbsDiff: Math.round(sum / n * 100) / 100, pctChanged: Math.round(changed / n * 1000) / 10 };
}

(async () => {
  const mA = manifest(dirA), mB = manifest(dirB);
  const files = fs.readdirSync(dirB).filter(f => /__.*\.png$/.test(f) && fs.existsSync(path.join(dirA, f))).sort();
  if (!files.length) { console.error(`No common captures between ${a} and ${b}`); process.exit(1); }
  const report = { a, b, pairs: [] }, tiles = [];
  for (const file of files) {
    const name = file.replace(/\.png$/, '');
    const [imgA, imgB] = await Promise.all([dirA, dirB].map(d => sharp(path.join(d, file)).resize({ width: W }).toBuffer({ resolveWithObject: true })));
    const H = imgA.info.height;
    const pair = await sharp({ create: { width: W * 2 + 4, height: H + BAR, channels: 3, background: '#101418' } }).composite([
      { input: caption(`BEFORE  ${a}  |  ${name.replace('__', '  ')}`, W, '#9fb2c4'), left: 0, top: 0 },
      { input: caption(`AFTER  ${b}`, W, '#ffd27a'), left: W + 4, top: 0 },
      { input: imgA.data, left: 0, top: BAR }, { input: await sharp(imgB.data).resize({ width: W, height: H, fit: 'fill' }).toBuffer(), left: W + 4, top: BAR },
    ]).jpeg({ quality: 88 }).toBuffer();
    fs.writeFileSync(path.join(out, `${name}.jpg`), pair);
    tiles.push({ name, buffer: pair, width: W * 2 + 4, height: H + BAR });
    const ma = metricsOf(mA, file), mb = metricsOf(mB, file), delta = {};
    if (ma && mb) for (const band of ['frame', 'upper', 'middle', 'lower']) delta[band] = Object.fromEntries(['meanLuma', 'lumaStd', 'meanSat', 'p05', 'p95'].map(k => [k, Math.round((mb[band][k] - ma[band][k]) * 100) / 100]));
    report.pairs.push({ name, ...(await pixelDelta(path.join(dirA, file), path.join(dirB, file))), delta, sparkle: { a: burstOf(mA, file), b: burstOf(mB, file) } });
  }
  const scale = 0.5, tw = Math.round(tiles[0].width * scale), th = Math.round(tiles[0].height * scale), rows = Math.ceil(tiles.length / cols);
  const sheet = await sharp({ create: { width: tw * cols + 6 * (cols - 1), height: th * rows + 6 * (rows - 1), channels: 3, background: '#05070a' } })
    .composite(await Promise.all(tiles.map(async (t, i) => ({ input: await sharp(t.buffer).resize({ width: tw, height: th, fit: 'fill' }).toBuffer(), left: (i % cols) * (tw + 6), top: Math.floor(i / cols) * (th + 6) }))))
    .jpeg({ quality: 86 }).toBuffer();
  fs.writeFileSync(path.join(out, 'sheet.jpg'), sheet);
  const mean = k => Math.round(report.pairs.reduce((s, p) => s + p[k], 0) / report.pairs.length * 100) / 100;
  report.summary = { pairs: report.pairs.length, meanAbsDiff: mean('meanAbsDiff'), pctChanged: mean('pctChanged') };
  fs.writeFileSync(path.join(out, 'compare.json'), JSON.stringify(report, null, 2));
  for (const p of report.pairs) console.log(`${p.name.padEnd(24)} absDiff ${String(p.meanAbsDiff).padStart(6)}  changed ${String(p.pctChanged).padStart(5)}%  luma ${p.delta.frame?.meanLuma ?? '-'}  contrast ${p.delta.frame?.lumaStd ?? '-'}  sat ${p.delta.frame?.meanSat ?? '-'}${p.sparkle.a != null && p.sparkle.b != null ? `  sparkle ${p.sparkle.a}% -> ${p.sparkle.b}%` : ''}`);
  console.log(`SHEET ${path.join(out, 'sheet.jpg')}  (${report.summary.pairs} pairs, mean absDiff ${report.summary.meanAbsDiff}, changed ${report.summary.pctChanged}%)`);
})().catch(e => { console.error(e); process.exit(1); });
