/**
 * R24 (E CERT) — a resolve hook that lets a node gate import an APP module.
 *
 * Two things stop node from importing `lib/fly/**` directly, and D's
 * `_alias-loader.mjs` handles only the first:
 *   1. the `@/` alias (D's hook);
 *   2. EXTENSIONLESS RELATIVE specifiers — `lib/fly/sun-model.js` imports
 *      `'./fly-constants'`, which bundlers resolve and node ESM does not.
 *
 * This hook does both, so a gate can compute with the app's own model instead
 * of a copy of it. Nothing here ships and nothing at runtime sees it.
 */
import { pathToFileURL, fileURLToPath } from 'node:url';
import { statSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const EXTS = ['', '.js', '.mjs', '/index.js'];

function firstFile(base) {
  for (const ext of EXTS) {
    try {
      if (statSync(base + ext).isFile()) return base + ext;
    } catch {
      /* try the next extension */
    }
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    const hit = firstFile(path.join(ROOT, specifier.slice(2)));
    if (hit) return { url: pathToFileURL(hit).href, shortCircuit: true };
  }
  if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
    const base = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier);
    if (!path.extname(base)) {
      const hit = firstFile(base);
      if (hit) return { url: pathToFileURL(hit).href, shortCircuit: true };
    }
  }
  return nextResolve(specifier, context);
}
