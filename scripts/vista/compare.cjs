/**
 * VISTA PASS — before/after sheets and a visible-change score (review tooling).
 *
 *   node scripts/vista/compare.cjs --before=<dir> --after=<dir> --out=<dir> [--poses=a,b] [--labels=Before,After]
 *
 * For every pose present in both arms it writes <pose>-ab.jpg (side by side,
 * labelled; pixels are the captures' own, resized and re-encoded only) and
 * prints + saves compare.json with, per pose:
 *   change     mean absolute RGB difference, 0-100 (percent of full scale)
 *   changeSky / changeMid / changeGround   the same over the top, middle and bottom thirds
 *   luma, sat, contrast   before -> after (mean luma 0-255, mean HSV saturation 0-1, luma std-dev)
 *
 * The score is a floor, not a verdict: a pass whose `change` sits under ~2 is
 * the "minor pass" this round exists to avoid; a big number can still be ugly.
 */
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

const args = Object.fromEntries(process.argv.slice(2).map((s) => { const [k, ...v] = s.replace(/^--/, '').split('='); return [k, v.join('=') || true]; }));
const beforeDir = path.resolve(args.before), afterDir = path.resolve(args.after), out = path.resolve(args.out || afterDir);
const [labA, labB] = String(args.labels || 'Before,After').split(',');
const only = args.poses ? String(args.poses).split(',') : null;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function tag(width, text) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="44">
  <rect width="${width}" height="44" fill="#05080f" fill-opacity=".62"/>
  <text x="16" y="29" font-family="DejaVu Sans, Arial, sans-serif" font-size="20" font-weight="700" fill="#eef5ff">${esc(text)}</text></svg>`);
}

async function stats(file, w, h) {
  const { data } = await sharp(file).resize(w, h, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return data;
}

function describe(d, w, h) {
  let l = 0, l2 = 0, s = 0; const n = w * h;
  for (let i = 0; i < d.length; i += 3) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b; l += y; l2 += y * y;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b); s += mx ? (mx - mn) / mx : 0;
  }
  const mean = l / n;
  return { luma: +mean.toFixed(1), sat: +(s / n).toFixed(3), contrast: +Math.sqrt(Math.max(0, l2 / n - mean * mean)).toFixed(1) };
}

function diff(a, b, w, y0, y1) {
  let sum = 0, n = 0;
  for (let y = y0; y < y1; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 3;
    sum += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]); n += 3;
  }
  return +((sum / n / 255) * 100).toFixed(2);
}

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const names = fs.readdirSync(afterDir).filter((f) => f.endsWith('.png') && fs.existsSync(path.join(beforeDir, f)))
    .map((f) => f.replace(/\.png$/, '')).filter((id) => !only || only.includes(id));
  const result = { before: beforeDir, after: afterDir, poses: {} };
  for (const id of names) {
    const a = path.join(beforeDir, `${id}.png`), b = path.join(afterDir, `${id}.png`);
    const meta = await sharp(b).metadata();
    const w = 480, h = Math.round((480 * meta.height) / meta.width), t = Math.floor(h / 3);
    const da = await stats(a, w, h), db = await stats(b, w, h);
    const sa = describe(da, w, h), sb = describe(db, w, h);
    result.poses[id] = { change: diff(da, db, w, 0, h), changeSky: diff(da, db, w, 0, t), changeMid: diff(da, db, w, t, 2 * t), changeGround: diff(da, db, w, 2 * t, h),
      luma: `${sa.luma} -> ${sb.luma}`, sat: `${sa.sat} -> ${sb.sat}`, contrast: `${sa.contrast} -> ${sb.contrast}` };
    const pw = 800, ph = Math.round((pw * meta.height) / meta.width);
    const left = await sharp(a).resize(pw, ph, { fit: 'fill' }).composite([{ input: tag(pw, `${labA} · ${id}`), top: 0, left: 0 }]).toBuffer();
    const right = await sharp(b).resize(pw, ph, { fit: 'fill' }).composite([{ input: tag(pw, `${labB} · ${id}`), top: 0, left: 0 }]).toBuffer();
    await sharp({ create: { width: pw * 2 + 6, height: ph, channels: 3, background: '#05080f' } })
      .composite([{ input: left, top: 0, left: 0 }, { input: right, top: 0, left: pw + 6 }]).jpeg({ quality: 88 }).toFile(path.join(out, `${id}-ab.jpg`));
    console.log(`${id}: change ${result.poses[id].change} (sky ${result.poses[id].changeSky} / mid ${result.poses[id].changeMid} / ground ${result.poses[id].changeGround})  luma ${result.poses[id].luma}  sat ${result.poses[id].sat}  contrast ${result.poses[id].contrast}  -> ${path.join(out, `${id}-ab.jpg`)}`);
  }
  if (!names.length) console.log('no common poses');
  fs.writeFileSync(path.join(out, 'compare.json'), JSON.stringify(result, null, 2));
})();
