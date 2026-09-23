/**
 * R25 B FLIGHT PLAN — node resolve/load hooks for scripts/verify-r25-flight-plan.mjs.
 *
 * Three jobs, nothing here ships:
 *  1. JSX: any `.jsx` under the repo is transpiled with the repo's own
 *     TypeScript (jsx: react-jsx) so the gate can server-render the REAL
 *     GroundHangar with react-dom/server and byte-compare its markup.
 *  2. STUBS for the three things a DOM render of the hangar cannot load in
 *     node: the WebGL preview (`./HangarScene`), drei (`useGLTF.clear`), the
 *     stylesheet import; and `@react-three/fiber` (operations-runtime's
 *     `invalidate`), replaced by a counter the gate reads back
 *     (`globalThis.__r25bInvalidations`).
 *  3. THE W0 ARM: a file URL carrying `?r25bw0` loads that file's text AT THE
 *     r25-w0 TAG (git show) instead of the working tree — how the gate runs
 *     RED against the scaffold, and how it renders W0's hangar next to ours.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const W0 = '?r25bw0';

const STUB = {
  'r25b-stub:drei': 'export const useGLTF = Object.assign(() => ({}), { clear() {}, preload() {} });',
  'r25b-stub:hangar-scene': 'export function HangarScene() { return null; }',
  'r25b-stub:css': 'export default {};',
  'r25b-stub:fiber':
    'export function invalidate() { globalThis.__r25bInvalidations = (globalThis.__r25bInvalidations || 0) + 1; }\n' +
    'export function useThree() { return {}; }\nexport function useFrame() {}',
};

export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@react-three/drei') return { url: 'r25b-stub:drei', shortCircuit: true };
  if (specifier === '@react-three/fiber') return { url: 'r25b-stub:fiber', shortCircuit: true };
  if (specifier === './HangarScene') return { url: 'r25b-stub:hangar-scene', shortCircuit: true };
  if (specifier.endsWith('.css')) return { url: 'r25b-stub:css', shortCircuit: true };
  // A W0-arm module's relative imports resolve against the working tree
  // (the parent URL's query is dropped by URL resolution) — only the files
  // the gate names with `?r25bw0` are read from the tag.
  if (specifier.startsWith('.') && context.parentURL?.startsWith('file:') && specifier.endsWith('.jsx')) {
    return { url: new URL(specifier, context.parentURL).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}

function w0Text(file) {
  const rel = path.relative(ROOT, file).split(path.sep).join('/');
  try {
    return execFileSync('git', ['show', `r25-w0:${rel}`], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null; // the file did not exist at r25-w0
  }
}

export async function load(url, context, nextLoad) {
  if (url.startsWith('r25b-stub:')) return { format: 'module', source: STUB[url], shortCircuit: true };
  if (!url.startsWith('file:')) return nextLoad(url, context);
  const u = new URL(url);
  const file = fileURLToPath(u.origin === 'null' ? `file://${u.pathname}` : url.split('?')[0]);
  const w0 = u.search === W0;
  if (!w0 && !file.endsWith('.jsx')) return nextLoad(url, context);
  let source = w0 ? w0Text(file) : readFileSync(file, 'utf8');
  if (source == null) throw new Error(`r25b: ${path.relative(ROOT, file)} does not exist at r25-w0`);
  if (file.endsWith('.jsx')) {
    source = ts.transpileModule(source, {
      fileName: file,
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText;
  }
  return { format: 'module', source, shortCircuit: true };
}
