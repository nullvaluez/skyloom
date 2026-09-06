/**
 * Load the VENDORED three-tile bundle in plain node.
 *
 * The bundle is ESM inside a CommonJS package, so node needs it under an .mjs
 * name; and since PATCH 5 it imports its own generated worker source next door,
 * so the copy has to keep that neighbour. Copying the folder into
 * scripts/r24-out/ (gitignored) keeps every write out of lib/ — a stray file
 * under lib/ would be picked up by the dev server's watcher mid-gate.
 *
 * The originals are never modified. Returns the imported module namespace.
 */
import { mkdirSync, copyFileSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function loadVendoredThreeTile() {
  const src = path.join(root, 'lib/fly/vendor/three-tile');
  const dir = path.join(root, 'scripts/r24-out', `.tt-${process.pid}`);
  mkdirSync(path.join(dir, 'workers'), { recursive: true });
  copyFileSync(path.join(src, 'index.js'), path.join(dir, 'index.mjs'));
  const built = path.join(src, 'workers/skirt-tail.built.js');
  if (existsSync(built)) copyFileSync(built, path.join(dir, 'workers/skirt-tail.built.js'));
  const mod = await import(pathToFileURL(path.join(dir, 'index.mjs')).href);
  rmSync(dir, { recursive: true, force: true });
  return mod;
}
