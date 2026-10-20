/**
 * Living World — build the before/after gallery page.
 *
 * Fills scripts/living-world-gallery.html with docs/reviews/living-world/
 * index.json (written by scripts/compose-graphics-pass.cjs) and the per-pose
 * notes below, and prints the `files` map that publishes the images next to
 * the page under img/.
 *
 *   node scripts/build-living-world-gallery.cjs --out=<page.html>
 */
const fs = require('node:fs');
const path = require('node:path');

const args = Object.fromEntries(process.argv.slice(2).map((s) => { const [k, ...v] = s.replace(/^--/, '').split('='); return [k, v.join('=') || true]; }));
const ROOT = path.resolve(__dirname, '..');
const dir = path.resolve(ROOT, args.dir || 'docs/reviews/living-world');
const index = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
const notes = JSON.parse(fs.readFileSync(path.join(dir, 'notes.json'), 'utf8'));
const template = fs.readFileSync(path.join(__dirname, 'living-world-gallery.html'), 'utf8');

const order = notes.order ?? index.items.map((i) => i.id);
const items = [];
for (const id of order) {
  const it = index.items.find((i) => i.id === id);
  const n = notes.poses[id];
  if (!it || !n) continue;
  items.push({ id, group: n.group, title: n.title ?? it.title, detail: n.detail ?? it.detail, before: `img/${it.before}`, after: `img/${it.after}`, changes: n.changes });
}
const data = { ...notes.page, items };
// JSON inside <script>: no "</" can close the element early.
const html = template.replace('__DATA__', () => JSON.stringify(data).replace(/</g, '\\u003c'));
const out = path.resolve(args.out || path.join(dir, 'gallery.html'));
fs.writeFileSync(out, html);
const files = {};
for (const it of items) for (const k of ['before', 'after']) files[it[k]] = path.relative(ROOT, path.join(dir, it[k].slice(4)));
console.log(JSON.stringify({ page: out, poses: items.length, files }, null, 2));
