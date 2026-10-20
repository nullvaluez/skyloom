/**
 * Living World — compose the before/after review set.
 *
 * Reads the two manifests written by scripts/capture-graphics-pass.cjs and,
 * for every capture present in both arms, writes:
 *   <id>-before.webp, <id>-after.webp   (full size, WebP q82)
 *   <id>-compare.webp                   (side by side, labelled)
 * plus index.json for the gallery. Pixels are the captures' own: resized and
 * re-encoded only, never retouched.
 *
 *   node scripts/compose-graphics-pass.cjs \
 *     --before=.graphics-review/living-world/before --after=.graphics-review/living-world/after \
 *     --out=docs/reviews/living-world
 */
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

const args = Object.fromEntries(process.argv.slice(2).map((s) => { const [k, ...v] = s.replace(/^--/, '').split('='); return [k, v.join('=') || true]; }));
const beforeDir = path.resolve(args.before || '.graphics-review/living-world/before');
const afterDir = path.resolve(args.after || '.graphics-review/living-world/after');
const out = path.resolve(args.out || 'docs/reviews/living-world');
const readManifest = (d) => JSON.parse(fs.readFileSync(path.join(d, 'manifest.json'), 'utf8'));

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function label(width, height, text, sub, align) {
  const x = align === 'right' ? width - 24 : 24, anchor = align === 'right' ? 'end' : 'start';
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#05080f" stop-opacity=".78"/><stop offset="1" stop-color="#05080f" stop-opacity="0"/></linearGradient></defs>
  <rect width="${width}" height="${Math.round(height)}" fill="url(#g)"/>
  <text x="${x}" y="40" text-anchor="${anchor}" font-family="DejaVu Sans, Arial, sans-serif" font-size="26" font-weight="700" fill="#eef5ff">${esc(text)}</text>
  <text x="${x}" y="68" text-anchor="${anchor}" font-family="DejaVu Sans, Arial, sans-serif" font-size="16" fill="#b8c9dc">${esc(sub)}</text>
</svg>`);
}

(async () => {
  const before = readManifest(beforeDir), after = readManifest(afterDir);
  fs.mkdirSync(out, { recursive: true });
  const scenes = Object.fromEntries([...(before.scenes || []), ...(after.scenes || [])].map((s) => [s.id, s]));
  const menuTitles = { 'menu-title': ['Title screen', 'The front door over the live world'], 'menu-hangar': ['Hangar', 'Choosing an aircraft and a destination'], 'menu-pause': ['Pause menu', 'Settings and navigation in flight'] };
  const index = { purpose: 'Unedited game frames, before and after the Living World pass, same poses and pins. Software (SwiftShader) captures: look evidence, not performance.', before: { url: before.url, capturedAt: before.capturedAt }, after: { url: after.url, capturedAt: after.capturedAt }, viewport: after.viewport, items: [] };
  for (const cap of after.captures) {
    const b = before.captures.find((c) => c.scene === cap.scene);
    if (!b) continue;
    const id = cap.scene;
    const base = id.replace(/-hud$/, '');
    const meta = scenes[base] ?? {};
    const [title, detail] = menuTitles[id] ?? [meta.title ? `${meta.title}${id.endsWith('-hud') ? ' (HUD)' : ''}` : id, meta.detail ?? ''];
    const bi = sharp(path.join(beforeDir, b.file)), ai = sharp(path.join(afterDir, cap.file));
    const { width, height } = await ai.metadata();
    await bi.clone().webp({ quality: 82 }).toFile(path.join(out, `${id}-before.webp`));
    await ai.clone().webp({ quality: 82 }).toFile(path.join(out, `${id}-after.webp`));
    const w = Math.round(width / 2), h = Math.round(height / 2), gap = 6;
    const half = async (src, text, align) => sharp(await src.clone().resize(w, h).toBuffer()).composite([{ input: label(w, 92, text, `${title}${detail ? ` · ${detail}` : ''}`, align), top: 0, left: 0 }]).toBuffer();
    const left = await half(bi, 'Before', 'left'), right = await half(ai, 'After', 'right');
    await sharp({ create: { width: w * 2 + gap, height: h, channels: 3, background: '#05080f' } })
      .composite([{ input: left, left: 0, top: 0 }, { input: right, left: w + gap, top: 0 }])
      .webp({ quality: 84 }).toFile(path.join(out, `${id}-compare.webp`));
    index.items.push({ id, title, detail, before: `${id}-before.webp`, after: `${id}-after.webp`, compare: `${id}-compare.webp`, ui: !!cap.ui, ready: { before: b.ready ?? null, after: cap.ready ?? null } });
    console.log(`COMPOSED ${id}`);
  }
  index.errors = { before: before.errors, after: after.errors };
  fs.writeFileSync(path.join(out, 'index.json'), JSON.stringify(index, null, 2));
  console.log(`DONE ${index.items.length} pairs -> ${out}`);
})();
