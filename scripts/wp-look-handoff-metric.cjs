// World Pass D (LOOK) round 3: the near / far handoff metric, from the frames
// scripts/wp-look-handoff.cjs saves for each shot:
//   <shot>.png            the full frame
//   <shot>__again.png     a second plain frame (what changes between the two is noise)
//   <shot>__nearonly.png  the far layer (runtime.satSkyline) hidden
//   <shot>__faronly.png   the near layer (runtime.satBuildings) hidden
// A pixel belongs to the near ring when it changes once the near layer is
// hidden; likewise the far. Frames are compared after a small blur (the
// renderer's grain moves single pixels by up to ~5 a channel between frames),
// pixels that change between the two plain frames are left out, both-set
// pixels are left out, and a 3 x 3 majority keeps blobs, not specks. Then the
// pixels of each set within `edge` px of the other set: mean sRGB luma and
// chroma of the FULL frame on each side of the boundary. step = far - near.
//   node scripts/wp-look-handoff-metric.cjs <dir> [<dir> ...] [--edge=24] [--json=<out>]
const sharp = require('sharp');
const fs = require('node:fs');
const path = require('node:path');

async function handoffFromFiles(stem, { edge = 24, T = 15, noiseT = 9, mask = true } = {}) {
  const blurred = async (f) => sharp(f).removeAlpha().blur(1.2).raw().toBuffer({ resolveWithObject: true });
  const full = await sharp(`${stem}.png`).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const [fb, ab, nb, rb] = await Promise.all([`${stem}.png`, `${stem}__again.png`, `${stem}__nearonly.png`, `${stem}__faronly.png`].map(blurred));
  const { width: W, height: H } = full.info;
  const diff = (a, b, i) => Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
  const near0 = new Uint8Array(W * H), far0 = new Uint8Array(W * H);
  let noise = 0;
  for (let p = 0; p < W * H; p++) {
    const i = p * 3;
    if (diff(fb.data, ab.data, i) > noiseT) {
      noise++;
      continue;
    }
    if (diff(fb.data, rb.data, i) > T) near0[p] = 1;
    if (diff(fb.data, nb.data, i) > T) far0[p] = 1;
    if (near0[p] && far0[p]) near0[p] = far0[p] = 0;
  }
  const major = (m) => {
    const o = new Uint8Array(W * H);
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      if (!m[y * W + x]) continue;
      let k = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) k += m[(y + dy) * W + x + dx];
      if (k >= 6) o[y * W + x] = 1;
    }
    return o;
  };
  const near = major(near0), far = major(far0);
  const dilate = (m) => {
    const h = new Uint8Array(W * H), o = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      let last = -1e9;
      for (let x = 0; x < W; x++) {
        if (m[y * W + x]) last = x;
        if (x - last <= edge) h[y * W + x] = 1;
      }
      last = 1e9;
      for (let x = W - 1; x >= 0; x--) {
        if (m[y * W + x]) last = x;
        if (last - x <= edge) h[y * W + x] = 1;
      }
    }
    for (let x = 0; x < W; x++) {
      let last = -1e9;
      for (let y = 0; y < H; y++) {
        if (h[y * W + x]) last = y;
        if (y - last <= edge) o[y * W + x] = 1;
      }
      last = 1e9;
      for (let y = H - 1; y >= 0; y--) {
        if (h[y * W + x]) last = y;
        if (last - y <= edge) o[y * W + x] = 1;
      }
    }
    return o;
  };
  const nearD = dilate(near), farD = dilate(far);
  const acc = () => ({ n: 0, L: 0, C: 0 });
  const sN = acc(), sF = acc(), aN = acc(), aF = acc();
  const add = (s, i) => {
    const r = full.data[i], g = full.data[i + 1], b = full.data[i + 2];
    s.n++;
    s.L += 0.2126 * r + 0.7152 * g + 0.0722 * b;
    s.C += Math.max(r, g, b) - Math.min(r, g, b);
  };
  const out = mask ? Buffer.alloc(W * H * 3) : null;
  for (let p = 0; p < W * H; p++) {
    const i = p * 3;
    if (near[p]) {
      add(aN, i);
      if (out) out[i] = 110;
      if (farD[p]) {
        add(sN, i);
        if (out) out[i] = 255;
      }
    }
    if (far[p]) {
      add(aF, i);
      if (out) out[i + 1] = 110;
      if (nearD[p]) {
        add(sF, i);
        if (out) out[i + 1] = 255;
      }
    }
  }
  if (out) await sharp(out, { raw: { width: W, height: H, channels: 3 } }).png().toFile(`${stem}__mask.png`);
  const fin = (s) => ({ px: s.n, luma: s.n ? +(s.L / s.n).toFixed(2) : null, chroma: s.n ? +(s.C / s.n).toFixed(2) : null });
  const nearSide = fin(sN), farSide = fin(sF);
  return {
    edgePx: edge,
    noisePct: +((100 * noise) / (W * H)).toFixed(2),
    nearSide,
    farSide,
    step: nearSide.px && farSide.px ? { luma: +(farSide.luma - nearSide.luma).toFixed(2), chroma: +(farSide.chroma - nearSide.chroma).toFixed(2) } : null,
    nearAll: fin(aN),
    farAll: fin(aF),
  };
}

module.exports = { handoffFromFiles };

if (require.main === module) {
  const args = process.argv.slice(2);
  const opt = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => a.slice(2).split('=')));
  const dirs = args.filter((a) => !a.startsWith('--'));
  (async () => {
    const all = {};
    for (const d of dirs) {
      for (const f of fs.readdirSync(d).filter((x) => x.endsWith('__faronly.png'))) {
        const stem = path.join(d, f.replace(/__faronly\.png$/, ''));
        const r = await handoffFromFiles(stem, { edge: Number(opt.edge || 24) });
        all[`${path.basename(d)}/${path.basename(stem)}`] = r;
        console.log(`${path.basename(d)}/${path.basename(stem)}`, JSON.stringify({ noise: r.noisePct, near: r.nearSide, far: r.farSide, step: r.step }));
      }
    }
    if (opt.json) fs.writeFileSync(opt.json, JSON.stringify(all, null, 1));
  })();
}
