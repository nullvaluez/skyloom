/** WORLD PASS C (REACH) round 2: colour statistics of a frame region, to compare the far ring with
 * the flags-off control (the photo) shot in the same session. Pure image maths (sharp), no browser.
 *
 *   node scripts/wp-reach-colour-stats.cjs --rect=x0,y0,x1,y1 <a.png> <b.png> ...
 *
 * Per frame, over the rectangle (pixels of the frame as captured):
 *   L      mean sRGB luma (0-255)
 *   C      mean chroma, max(r,g,b) - min(r,g,b) (0-255): how saturated the region reads
 *   hf     mean absolute luma difference between horizontal neighbours: fine-grain contrast
 *   chf    mean absolute chroma-vector difference between horizontal neighbours: colour confetti
 *   rows   the same L and C for the top, middle and bottom third of the rectangle (a ring
 *          boundary shows as a step between thirds)
 */
const sharp = require('sharp');

const args = process.argv.slice(2);
const rectArg = args.find((a) => a.startsWith('--rect='));
const files = args.filter((a) => !a.startsWith('--'));
const [x0, y0, x1, y1] = (rectArg ? rectArg.slice(7) : '0,330,1600,620').split(',').map(Number);

(async () => {
  for (const f of files) {
    const { data, info } = await sharp(f).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const W = info.width;
    const at = (x, y) => (y * W + x) * 3;
    const thirds = [0, 1, 2].map(() => ({ L: 0, C: 0, n: 0 }));
    let L = 0, C = 0, hf = 0, chf = 0, n = 0, m = 0;
    for (let y = y0; y < y1; y++) {
      const t = thirds[Math.min(2, Math.floor(((y - y0) / (y1 - y0)) * 3))];
      for (let x = x0; x < x1; x++) {
        const o = at(x, y);
        const r = data[o], g = data[o + 1], b = data[o + 2];
        const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        const c = Math.max(r, g, b) - Math.min(r, g, b);
        L += l; C += c; n += 1; t.L += l; t.C += c; t.n += 1;
        if (x + 1 < x1) {
          const p = at(x + 1, y);
          const r2 = data[p], g2 = data[p + 1], b2 = data[p + 2];
          hf += Math.abs(l - (0.2126 * r2 + 0.7152 * g2 + 0.0722 * b2));
          // chroma vector: the pixel minus its own grey
          const m1 = (r + g + b) / 3, m2 = (r2 + g2 + b2) / 3;
          chf += Math.hypot(r - m1 - (r2 - m2), g - m1 - (g2 - m2), b - m1 - (b2 - m2));
          m += 1;
        }
      }
    }
    const f1 = (v) => v.toFixed(1);
    console.log(`${f.split(/[\\/]/).slice(-2).join('/')}  L ${f1(L / n)}  C ${f1(C / n)}  hf ${f1(hf / m)}  chf ${f1(chf / m)}  rows ${thirds.map((t) => `${f1(t.L / t.n)}/${f1(t.C / t.n)}`).join(' ')}`);
  }
})();
