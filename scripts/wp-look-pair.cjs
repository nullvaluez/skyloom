// World Pass D: side-by-side crop of an off frame and an on frame.
// node scripts/wp-look-pair.cjs <off.png> <on.png> <out.png> [left top width height scale]
const sharp = require('sharp');
const [off, on, out, l = 0, t = 450, w = 1600, h = 450, sc = 0.5] = process.argv.slice(2);
(async () => {
  const r = { left: +l, top: +t, width: +w, height: +h };
  const W = Math.round(+w * +sc), H = Math.round(+h * +sc);
  const A = await sharp(off).extract(r).resize(W, H).toBuffer();
  const B = await sharp(on).extract(r).resize(W, H).toBuffer();
  await sharp({ create: { width: W, height: H * 2 + 6, channels: 3, background: '#000' } }).composite([{ input: A, left: 0, top: 0 }, { input: B, left: 0, top: H + 6 }]).png().toFile(out);
})();
