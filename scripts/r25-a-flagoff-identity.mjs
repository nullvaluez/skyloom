/**
 * ROUND 25 (A GROUND) — FLAG-OFF GLSL IDENTITY, byte for byte, against W0.
 *
 * The kickoff asks for flag-off identity PROVEN by "a fixture pixel A/B at a
 * pinned pose, a fingerprint, or the GLSL false-branch string verbatim". This
 * takes the third option, deliberately, because it is the stronger one: a
 * fixture pixel A/B on a 1–3 fps venue is bounded below by the venue's own
 * frame-to-frame noise and can only ever say "smaller than my noise floor",
 * whereas comparing the GENERATED STRINGS says the fragment, the vertex shader,
 * the uniform SET and the FINAL cache key are identical — from which pixel
 * identity follows rather than being sampled.
 *
 * HOW. It loads THIS tree's `applyHillshade` and the W0 BASE's copy of the same
 * function in one node process (through `scripts/_node-resolve.mjs`, which
 * resolves both the `@/` alias and extensionless relative specifiers) and runs
 * both through the same fake shader object. The base copy is extracted on
 * demand with `git show <BASE>:lib/fly/toy-world/world-bend.js` into
 * `scripts/r25-out/` (gitignored), so nothing stale can be compared by accident.
 *
 *   node scripts/r25-a-flagoff-identity.mjs
 */
import module from 'node:module';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const BASE = process.env.R25_BASE || '6bf628e'; // the W0 scaffolding tip
const OUT = path.join(ROOT, 'scripts', 'r25-out');
const BASE_FILE = path.join(OUT, 'world-bend-base.js');

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(
  BASE_FILE,
  execFileSync('git', ['show', `${BASE}:lib/fly/toy-world/world-bend.js`], {
    cwd: ROOT,
    maxBuffer: 64 * 1024 * 1024,
  })
);

module.register(pathToFileURL(path.join(ROOT, 'scripts', '_node-resolve.mjs')));
const { HILLSHADE } = await import('@/lib/fly/fly-constants');
const base = await import(pathToFileURL(BASE_FILE).href);
const now = await import('@/lib/fly/toy-world/world-bend');

/** Run applyHillshade against a fake shader and return everything it produced. */
function capture(mod, lodFade = null) {
  const m = { userData: {}, onBeforeCompile: null, customProgramCacheKey: null, needsUpdate: false };
  mod.applyHillshade(m, HILLSHADE, lodFade);
  const shader = {
    uniforms: {},
    vertexShader: '#include <common>\n#include <defaultnormal_vertex>\n#include <begin_vertex>\n',
    fragmentShader:
      '#include <common>\n#include <color_fragment>\n#include <dithering_fragment>\n#include <map_fragment>\n',
  };
  m.onBeforeCompile(shader, {});
  return {
    key: m.customProgramCacheKey(),
    frag: shader.fragmentShader,
    vert: shader.vertexShader,
    uni: Object.keys(shader.uniforms).sort().join(','),
  };
}

let fails = 0;
const gate = (n, ok, d = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ' — ' + d : ''}`);
  if (!ok) fails += 1;
};

delete globalThis.window; // flag off: no pin, the constants as they ship
const b = capture(base);
const a = capture(now);
gate('(1) flag-off FINAL tile key verbatim R24', a.key === b.key, `${b.key} vs ${a.key}`);
gate('(2) flag-off fragment string byte-identical', a.frag === b.frag, `${a.frag.length} vs ${b.frag.length} chars`);
gate('(3) flag-off vertex string byte-identical', a.vert === b.vert);
gate('(4) flag-off uniform set identical', a.uni === b.uni, a.uni);
gate('(5) flag-off fragment carries no R25 text', !/Round 25|uGroundDetail|gdP0/.test(a.frag));

// …and ARMED (the pin, exactly as a harness or the user sets it before boot).
globalThis.window = { __flyGroundDetailOverride: { enabled: true } };
const on = capture(now);
gate(
  "(6) armed key = the flag-off key + the single token 'd'",
  on.key === b.key.replace(/24$/, 'd24'),
  `${b.key} -> ${on.key}`
);
gate(
  '(7) armed fragment = the flag-off fragment PLUS the d block (a pure append)',
  on.frag
    .replace(/\n\/\/ Round 25[\s\S]*?\n}\n#include <dithering_fragment>/, '\n#include <dithering_fragment>')
    .replace('uniform float uGroundDetail;\nuniform vec2 uGroundAmp;\n', '') === b.frag
);
gate(
  '(8) armed adds exactly the two overlay uniforms and nothing else',
  on.uni === [...b.uni.split(','), 'uGroundDetail', 'uGroundAmp'].sort().join(','),
  on.uni
);

console.log(`\n${8 - fails} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
