/** WORLD PASS C (REACH) round 2b: does the far ring keep the photo's street pattern?
 * Pearson correlation of band-passed luma between a reference frame (the flags-off control,
 * same session) and each other frame, over a rectangle. Band-pass = blur(r1) - blur(r2) of
 * sRGB luma (box blurs), so the score follows street-scale structure (lines a few pixels wide)
 * and ignores the overall tone. 1 = the same pattern, 0 = unrelated. Aircraft and clouds are
 * the same in every frame of a session (same pose, same clock), so they add equally to every arm;
 * keep the rectangle on the ground.
 *
 *   node scripts/wp-reach-structure.cjs --rect=x0,y0,x1,y1 [--r1=1 --r2=6] <control.png> <a.png> ...
 */
const sharp = require('sharp');
const args = Object.fromEntries(process.argv.slice(2).filter((s) => s.startsWith('--')).map((s) => { const [k, v] = s.slice(2).split('='); return [k, v]; }));
const files = process.argv.slice(2).filter((s) => !s.startsWith('--'));
const [x0, y0, x1, y1] = String(args.rect || '0,0,1600,900').split(',').map(Number);
const r1 = Number(args.r1 ?? 1), r2 = Number(args.r2 ?? 6);
function blur(L, w, h, r) {
  if (r <= 0) return L;
  const t = new Float32Array(w * h), o = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let s = 0, n = 0; for (let d = -r; d <= r; d++) { const xx = x + d; if (xx >= 0 && xx < w) { s += L[y * w + xx]; n++; } } t[y * w + x] = s / n; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let s = 0, n = 0; for (let d = -r; d <= r; d++) { const yy = y + d; if (yy >= 0 && yy < h) { s += t[yy * w + x]; n++; } } o[y * w + x] = s / n; }
  return o;
}
async function band(f) {
  const w = x1 - x0, h = y1 - y0;
  const { data, info } = await sharp(f).extract({ left: x0, top: y0, width: w, height: h }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const L = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) L[i] = 0.2126 * data[i * info.channels] + 0.7152 * data[i * info.channels + 1] + 0.0722 * data[i * info.channels + 2];
  const a = blur(L, w, h, r1), b = blur(L, w, h, r2);
  const B = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) B[i] = a[i] - b[i];
  return B;
}
(async () => {
  const ref = await band(files[0]);
  const corr = (A, B) => { let ma = 0, mb = 0; for (let i = 0; i < A.length; i++) { ma += A[i]; mb += B[i]; } ma /= A.length; mb /= B.length; let sab = 0, saa = 0, sbb = 0; for (let i = 0; i < A.length; i++) { const p = A[i] - ma, q = B[i] - mb; sab += p * q; saa += p * p; sbb += q * q; } return sab / Math.sqrt(saa * sbb); };
  for (const f of files.slice(1)) console.log(`${f}  r=${corr(ref, await band(f)).toFixed(3)}`);
})();
