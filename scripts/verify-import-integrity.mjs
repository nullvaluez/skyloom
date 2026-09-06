/**
 * R24 (E CERT) — verify-import-integrity: every module must be able to
 * EVALUATE.
 *
 * WHY THIS EXISTS. R24's certification run burned four browser rows and about
 * half an hour on a symptom that looked like a renderer defect, a fixture
 * defect and a harness defect in turn — "zero canvas elements, `__flyBoot`
 * undefined, no error" — and was none of them. The app's whole
 * `components/fly` chunk was throwing at MODULE EVALUATION:
 *
 *     ReferenceError: ATMO_GLSL_DECL is not defined
 *
 * `components/fly/AerialPerspective.jsx` used `ATMO_GLSL_DECL`,
 * `ATMO_GLSL_FRAGMENT`, `AERIAL_LAW`, `atmoUniforms` and `getAtmoLaw` with no
 * import, two of them inside a module-scope template literal — so the module
 * threw the moment it was evaluated, in BOTH styles, before a canvas could
 * exist. `app/page.js` mounts FlyMode through `dynamic(..., { ssr: false })`
 * whose `loading` is one empty dark div, so the page sat on that div in
 * silence. Two more of the same class were in the same tree:
 * `CloudField.jsx` calling an unimported `pinned()` at render, and
 * `FlyScene.jsx` calling an unimported `offsetUnits()` in the shadow catcher.
 *
 * Every browser gate in the fleet — 60 of them — is downstream of module
 * evaluation. None of them can report this, because none of them get to run.
 * A dozen node gates were green at the same time, because none of them
 * imports the React tree. So the cheapest possible signal, "the app can
 * evaluate", had no gate at all.
 *
 * This is that gate: eslint's `no-undef` over every first-party source
 * directory. It needs no browser, no dev server, no network and no GPU, it
 * finishes in seconds, and it belongs FIRST in every smoke — a red here makes
 * every browser number that follows meaningless.
 *
 * RED CALIBRATION (integration `bf319ca`, and this tree before the three
 * branch fixes): **3 files, 8 errors**
 *     components/fly/AerialPerspective.jsx  ATMO_GLSL_DECL (179),
 *         ATMO_GLSL_FRAGMENT (187), AERIAL_LAW (314 twice),
 *         atmoUniforms (387), getAtmoLaw (388)
 *     components/fly/CloudField.jsx         pinned (82)
 *     components/fly/FlyScene.jsx           offsetUnits (381)
 *
 * WHAT IS EXCLUDED, AND WHY — the exclusion is asserted, not assumed (gate 2):
 *   · `lib/fly/vendor/three-tile/plugin.js` — a VERBATIM vendored third-party
 *     bundle (see its VENDOR.md). Its own scoping is not ours to lint: the
 *     minified JPEG decoder inside it references `log`, `DNLMarkerError`,
 *     `SOS`, `EOI` and friends through bundler scoping that `no-undef` cannot
 *     see. Linting it would produce 22 permanent errors that no one may fix,
 *     which is the fastest way to teach a team to ignore a gate.
 *   · every generated `*.built.js` worker payload — same argument.
 * Nothing else. Gate 2 proves the ignore list matches exactly those two
 * patterns and that removing them would re-admit only vendored files.
 *
 * WHAT IS FILTERED, AND WHY. Messages of the form "Definition for rule 'X' was
 * not found" are artifacts of running a SINGLE rule: the sources carry inline
 * `eslint-disable` comments naming plugin rules (`react-hooks/exhaustive-deps`
 * and friends) that this minimal config does not load. They are not code
 * defects and they carry no `ruleId`. The gate's verdict is `no-undef` errors
 * only, and it prints the filtered count so the filter is visible rather than
 * silent.
 *
 * RUN (anywhere, no browser):
 *   node scripts/verify-import-integrity.mjs
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// First-party source roots. `scripts/` is deliberately NOT here: harnesses are
// node programs with their own globals and are exercised by running them.
const TARGETS = ['lib', 'components', 'app', 'hooks', 'stores'].filter((d) =>
  fs.existsSync(path.join(ROOT, d))
);

const IGNORES = ['lib/fly/vendor/three-tile/plugin.js', '**/*.built.js'];

let pass = 0;
let fail = 0;
function gate(name, ok, detail) {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

const require_ = (await import('node:module')).createRequire(import.meta.url);
const { ESLint } = await import(
  pathToFileURL(require_.resolve('eslint', { paths: [ROOT] })).href
);
const globals = (
  await import(pathToFileURL(require_.resolve('globals', { paths: [ROOT] })).href)
).default;

function makeLinter(ignores) {
  return new ESLint({
    cwd: ROOT,
    // A single rule, and OUR config — not the repo's. The repo's Next config
    // loads plugins whose absence would drown the signal, and this gate is
    // about one question only: can every module evaluate?
    overrideConfigFile: true,
    overrideConfig: [
      {
        files: ['**/*.{js,jsx,mjs}'],
        ignores,
        languageOptions: {
          ecmaVersion: 2023,
          sourceType: 'module',
          parserOptions: { ecmaFeatures: { jsx: true } },
          // Browser + node + worker: the app spans all three (the vector-tile
          // worker and the aircraft processor are worker-scope modules).
          globals: { ...globals.browser, ...globals.node, ...globals.worker },
        },
        rules: { 'no-undef': 'error' },
      },
    ],
  });
}

const NOT_A_DEFECT = /^Definition for rule /;

async function sweep(ignores) {
  const results = await makeLinter(ignores).lintFiles(TARGETS);
  const files = [];
  let filtered = 0;
  for (const r of results) {
    const errs = r.messages.filter((m) => {
      if (m.severity !== 2) return false;
      if (NOT_A_DEFECT.test(m.message)) {
        filtered++;
        return false;
      }
      return true;
    });
    if (errs.length)
      files.push({ file: path.relative(ROOT, r.filePath), errs, linted: results.length });
  }
  return { files, filtered, linted: results.length };
}

const main = await sweep(IGNORES);

console.log(
  `swept ${TARGETS.join(' ')} — ${main.linted} files linted, ${main.filtered} ` +
    `"Definition for rule" notices filtered (see the header)`
);
for (const f of main.files) {
  console.log(`  ${f.file}`);
  for (const m of f.errs) console.log(`      ${m.line}:${m.column}  ${m.message}`);
}

const total = main.files.reduce((n, f) => n + f.errs.length, 0);
// THE DENOMINATOR FIRST (§2.10 WEAK, now closed). "zero errors" is also what a
// sweep that linted nothing reports — a moved directory, a bad glob, or an
// ESLint config that silently matched no files would all print a clean green.
// The floor is deliberately far below the real count (200 at the time of
// writing) so it catches a COLLAPSE, not growth.
const LINT_FLOOR = 120;
gate(
  '(1a) THE SWEEP HAS SOMETHING TO LINT',
  main.linted >= LINT_FLOOR,
  `${main.linted} files linted across ${TARGETS.join(' ')} (floor ${LINT_FLOOR}) — below this, ` +
    'a clean (1) means the glob missed the tree, not that the tree is clean'
);
gate(
  '(1) EVERY FIRST-PARTY MODULE CAN EVALUATE — zero no-undef errors',
  total === 0,
  total === 0
    ? `${main.linted} files clean`
    : `${total} error(s) in ${main.files.length} file(s). Each one throws a ReferenceError at ` +
      'MODULE EVALUATION, which takes the whole chunk down before any canvas exists — and every ' +
      'browser gate in the fleet is downstream of that.'
);

// (2) The exclusion is exactly the two documented patterns, and dropping them
// re-admits ONLY vendored/generated files. A gate whose ignore list can quietly
// grow is a gate that can be silenced.
const bare = await sweep([]);
const extra = bare.files
  .map((f) => f.file)
  .filter((f) => !main.files.some((m) => m.file === f));
const allVendored = extra.every(
  (f) => f.startsWith('lib/fly/vendor/three-tile/') || f.endsWith('.built.js')
);
gate(
  '(2) THE EXCLUSION IS ONLY THE VENDORED BUNDLE AND GENERATED WORKERS',
  allVendored,
  extra.length
    ? `un-ignoring re-admits ${extra.length} file(s), all vendored/generated: ${extra.join(', ')}`
    : 'the ignore list currently hides nothing at all'
);
gate(
  '(3) THE IGNORE LIST IS THE TWO DOCUMENTED PATTERNS, UNCHANGED',
  IGNORES.length === 2 &&
    IGNORES[0] === 'lib/fly/vendor/three-tile/plugin.js' &&
    IGNORES[1] === '**/*.built.js',
  IGNORES.join(' , ')
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
