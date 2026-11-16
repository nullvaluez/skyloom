// WORLD PASS review, lens "stream": compose a filmstrip grid from probe frames.
//   node scripts/wp-probe-stream-filmstrip.cjs <dir> <out.png> [every=2] [cols=4] [w=400]
const sharp = require('sharp');
const fs = require('node:fs');
const path = require('node:path');
(async () => {
  const [dir, outFile, every = 2, cols = 4, w = 400] = process.argv.slice(2);
  const files = fs.readdirSync(dir).filter(f => /^[ft]\d+\.png$/.test(f)).sort().filter((_, i) => i % Number(every) === 0);
  const W = Number(w), H = Math.round(W * 9 / 16), C = Number(cols), R = Math.ceil(files.length / C);
  const comps = [];
  for (let i = 0; i < files.length; i++) {
    const img = await sharp(path.join(dir, files[i])).resize(W, H).png().toBuffer();
    const label = Buffer.from(`<svg width="${W}" height="22"><rect width="100%" height="100%" fill="black" opacity="0.6"/><text x="6" y="16" font-size="15" fill="white" font-family="monospace">${files[i].replace('.png', '')}</text></svg>`);
    comps.push({ input: img, left: (i % C) * W, top: Math.floor(i / C) * H }, { input: label, left: (i % C) * W, top: Math.floor(i / C) * H });
  }
  await sharp({ create: { width: W * C, height: H * R, channels: 3, background: '#000' } }).composite(comps).png().toFile(outFile);
  console.log('wrote', outFile, files.length, 'frames');
})();
