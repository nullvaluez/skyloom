/**
 * R25 (C SKY) — a node module hook that lets a NODE gate import a `.jsx` app
 * module (components/fly/Effects.jsx, AerialPerspective.jsx, SkyDome.jsx) and
 * build the REAL shader text from it, instead of source-parsing it.
 *
 * Two jobs, both only for `.jsx`:
 *   resolve — an extensionless `@/…` or relative specifier that names a `.jsx`
 *             file (and no `.js` twin) resolves to it (the bundler's rule);
 *   load    — the file is transpiled with the repo's own TypeScript
 *             (`transpileModule`, jsx: react-jsx, ESM out) and handed to node
 *             as a module. No type checking, no semantics change: the JSX
 *             becomes `jsx()` calls from react/jsx-runtime, which is what
 *             Next's compiler emits too.
 * Register AFTER scripts/_node-resolve.mjs (which handles `@/` and
 * extensionless `.js`). Nothing here ships or runs in the app.
 */
import { readFile } from 'node:fs/promises';
import { statSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ts = createRequire(import.meta.url)(path.join(ROOT, 'node_modules/typescript'));
const isFile = (p) => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};

export async function resolve(spec, ctx, next) {
  let base = null;
  if (spec.startsWith('@/')) base = path.join(ROOT, spec.slice(2));
  else if (spec.startsWith('.') && ctx.parentURL?.startsWith('file:')) {
    base = path.resolve(path.dirname(fileURLToPath(ctx.parentURL)), spec);
  }
  if (base && !path.extname(base) && !isFile(`${base}.js`) && isFile(`${base}.jsx`)) {
    return { url: pathToFileURL(`${base}.jsx`).href, shortCircuit: true };
  }
  return next(spec, ctx);
}

export async function load(url, context, next) {
  if (!url.endsWith('.jsx')) return next(url, context);
  const src = await readFile(new URL(url), 'utf8');
  const out = ts.transpileModule(src, {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: fileURLToPath(url),
  });
  return { format: 'module', source: out.outputText, shortCircuit: true };
}
