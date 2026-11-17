// World Pass D (LOOK) round 3: frame numbers for any set of captures.
//   node scripts/wp-look-metrics.cjs <png> [<png> ...] [--bands=0.66-1,0.45-1] [--lit=110] [--json=<out>]
// Per file and band (fractions of the frame height, top = 0): mean sRGB luma,
// mean chroma (max - min channel), the share of pixels brighter than --lit
// (lit windows at night), and the mean of the pixels at or under it.
const sharp = require('sharp');
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const opt = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => a.slice(2).split('=')));
const files = args.filter((a) => !a.startsWith('--'));
const bands = (opt.bands || '0.6667-1,0.45-1,0.52-0.62,0.62-0.75').split(',').map((b) => b.split('-').map(Number));
const LIT = Number(opt.lit || 110);
(async () => {
  const out = {};
  for (const f of files) {
    const { data, info } = await sharp(f).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const row = {};
    for (const [a, b] of bands) {
      let n = 0, L = 0, ch = 0, lit = 0, un = 0, nu = 0;
      for (let y = Math.round(a * info.height); y < Math.round(b * info.height); y++) {
        for (let x = 0; x < info.width; x++) {
          const o = (y * info.width + x) * 3;
          const l = 0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2];
          n++;
          L += l;
          ch += Math.max(data[o], data[o + 1], data[o + 2]) - Math.min(data[o], data[o + 1], data[o + 2]);
          if (l > LIT) lit++;
          else {
            un += l;
            nu++;
          }
        }
      }
      row[`${a}-${b}`] = { luma: +(L / n).toFixed(2), chroma: +(ch / n).toFixed(2), litPct: +((100 * lit) / n).toFixed(2), unlitMean: +(un / Math.max(1, nu)).toFixed(2) };
    }
    out[path.relative(process.cwd(), f)] = row;
    console.log(path.basename(path.dirname(f)) + '/' + path.basename(f), JSON.stringify(row));
  }
  if (opt.json) fs.writeFileSync(opt.json, JSON.stringify(out, null, 1));
})();
