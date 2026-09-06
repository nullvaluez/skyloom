/**
 * R24 D — a 20-line Node resolve hook mapping the app's `@/` alias to the repo
 * root, so a node gate can import an app module that uses it.
 *
 * Why it exists: `lib/fly/toy-world/world-bend.js` was import-free for twenty
 * rounds, which is what let `verify-lod-fade` compile `applyHillshade` twice
 * and byte-compare the two shader texts. R24 C gave it a `@/lib/fly/fly-constants`
 * import, so node can no longer resolve it. Rather than downgrade the gate to
 * source-parsing (which cannot prove text identity), the gate registers this.
 *
 * Registered with `module.register()` from inside the gate; it affects nothing
 * at runtime and nothing that ships.
 */
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    let p = path.join(ROOT, specifier.slice(2));
    for (const ext of ['', '.js', '.mjs', '/index.js']) {
      try {
        const { statSync } = await import('node:fs');
        if (statSync(p + ext).isFile()) return { url: pathToFileURL(p + ext).href, shortCircuit: true };
      } catch { /* try the next extension */ }
    }
    return { url: pathToFileURL(p).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
