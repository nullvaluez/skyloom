#!/usr/bin/env node
/**
 * R24 C LIGHT — verify-shadow-calm (recon L5 / FL-12). A NODE gate.
 *
 * WHY THIS EXISTS AND WHAT IT DOES NOT CLAIM. SHADOW_CALM's browser gate does
 * not exist: it would have to un-pin `__flySatShadowOverride` (the fleet pins
 * it to 0, which is the FIRST term of the catcher's four-term mount condition —
 * see the ledger), and this container's browser budget belongs to
 * certification. So the feature would otherwise ship on structural scans alone.
 *
 * It does not have to. The load-bearing half of SHADOW_CALM is two edits to a
 * STRING and one piece of arithmetic, and both are executable here:
 *
 *   (A) the ShaderChunk patch is a PURE function of three's real chunk text
 *       (`r24PatchShadowChunk`), so this gate runs it against the text the
 *       renderer would actually compile, with the options forced BOTH ways.
 *       That is a stronger statement than any source scan: it is not "the code
 *       looks right", it is "here is the GLSL three would receive".
 *   (B) the texel snap is pure arithmetic over three's own Matrix4/Vector3, so
 *       this gate evaluates FlyScene's own `snapToShadowTexel` body against a
 *       real shadow-camera basis and checks the quantisation numerically.
 *
 * WHAT REMAINS UNPROVEN HERE, stated so the ship table can be honest: no pixel
 * moves, no draw count, and no evidence that the catcher receives a shadow. The
 * arm gate's "Owens is 0 by construction" rests on `queryColumns` returning an
 * empty array over empty terrain, which is a browser fact. Those rows belong to
 * the user's machine or to a future verify-shadow-calm with a renderer.
 *
 * Run: node scripts/verify-shadow-calm.mjs
 */
import { readFileSync } from 'node:fs';
import { ShaderChunk, Matrix4, Vector3, Object3D } from 'three';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const read = (p) => readFileSync(`${ROOT}/${p}`, 'utf8');

const fails = [];
let n = 0;
const gate = (name, ok, detail = '') => {
  n++;
  if (!ok) fails.push(name);
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

// ---------------------------------------------------------------------------
// Load shadow-kernel.js without a bundler. Its two imports are stripped and the
// bindings injected, the same technique verify-worker-normals uses on the
// vendored worker source: the app's relative imports are extensionless
// (bundler resolution) and this gate must not force a source change to suit
// node's resolver.
// ---------------------------------------------------------------------------
const KSRC = read('lib/fly/shadow-kernel.js')
  .replace(/^import .*?;$/gm, '')
  .replace(/\bexport\s+(function|const)\b/g, '$1');
const kernelMod = new Function(
  'ShaderChunk',
  'SHADOW_CALM',
  `${KSRC}\nreturn { r24PatchShadowChunk, installShadowKernel, shadowKernelState };`
);

// The SHIPPED options, read from the constants file rather than hard-coded, so
// a knob change cannot silently drift away from what this gate certifies.
const CONSTS = read('lib/fly/fly-constants.js');
const SC_BLOCK = CONSTS.slice(
  CONSTS.indexOf('export const SHADOW_CALM = '),
  CONSTS.indexOf('export const TERRAIN_LIGHT = ')
);
const shipped = {
  enabled: /enabled:\s*true/.test(SC_BLOCK),
  biasSignFix: /biasSignFix:\s*true/.test(SC_BLOCK),
  kernel: (/kernel:\s*'(\w+)'/.exec(SC_BLOCK) || [, 'three'])[1],
  toyNormalBias: +(/toyNormalBias:\s*([\d.]+)/.exec(SC_BLOCK) || [, NaN])[1],
  satNormalBias: +(/satNormalBias:\s*([\d.]+)/.exec(SC_BLOCK) || [, NaN])[1],
  satCadence: +(/satCadence:\s*([\d.]+)/.exec(SC_BLOCK) || [, NaN])[1],
};
console.log('shipped SHADOW_CALM:', JSON.stringify(shipped), '\n');

const BASE = ShaderChunk.shadowmap_pars_fragment;
const K = kernelMod(ShaderChunk, { ...shipped, enabled: true });
const patch = K.r24PatchShadowChunk;

// ---- (A1) flag-off / options-off is BYTE-IDENTICAL ------------------------
{
  const off = patch(BASE, {});
  gate('options off: the chunk is returned byte-identical', off.src === BASE);
  gate('options off: nothing is reported as patched', off.biasSign === false && off.kernel === null);
  const three = patch(BASE, { biasSignFix: false, kernel: 'three' });
  gate("kernel 'three' is an explicit opt-out, also byte-identical", three.src === BASE);
}

// ---- (A2) the anchors are UNIQUE — a replace cannot land in a sibling branch
{
  const PCF_ANCHOR =
    'float shadow = 1.0;\n\t\t\tshadowCoord.xyz /= shadowCoord.w;\n\t\t\tshadowCoord.z += shadowBias;';
  const PHI_ANCHOR =
    'float radius = shadowRadius * texelSize.x;\n\t\t\t\tfloat phi = interleavedGradientNoise( gl_FragCoord.xy ) * PI2;';
  const count = (h, x) => h.split(x).length - 1;
  gate(
    'the PCF bias anchor occurs EXACTLY once in three\'s chunk',
    count(BASE, PCF_ANCHOR) === 1,
    `${count(BASE, PCF_ANCHOR)} — VSM and BASIC carry the #ifdef form and must not be touched`
  );
  gate(
    'the directional phi anchor occurs EXACTLY once',
    count(BASE, PHI_ANCHOR) === 1,
    `${count(BASE, PHI_ANCHOR)} — getPointShadow has the same phi line and is deliberately out of scope`
  );
  // The defect itself, asserted against the library so an upstream fix is loud.
  gate(
    'three STILL adds shadowBias unconditionally in the PCF branch (the defect)',
    BASE.includes(PCF_ANCHOR),
    'recon L5: VSM and BASIC flip the sign under USE_REVERSED_DEPTH_BUFFER, PCF does not'
  );
  gate(
    '…while VSM and BASIC still carry the reversed-depth #ifdef (the precedent)',
    (BASE.match(/#ifdef USE_REVERSED_DEPTH_BUFFER\n\t\t\t\tshadowCoord\.z -= shadowBias;/g) || [])
      .length === 2,
    'two branches got it right; the one this app runs did not'
  );
}

// ---- (A3) the bias-sign patch produces the right GLSL ----------------------
{
  const r = patch(BASE, { biasSignFix: true });
  gate('biasSignFix reports itself applied', r.biasSign === true && r.kernel === null);
  gate(
    'the PCF branch now carries the reversed-depth #ifdef',
    (r.src.match(/#ifdef USE_REVERSED_DEPTH_BUFFER\n\t\t\t\tshadowCoord\.z -= shadowBias;/g) || [])
      .length === 3,
    'was 2 (VSM + BASIC), now 3 (+ PCF)'
  );
  gate(
    'the unconditional PCF `z += shadowBias` is gone',
    !r.src.includes(
      'float shadow = 1.0;\n\t\t\tshadowCoord.xyz /= shadowCoord.w;\n\t\t\tshadowCoord.z += shadowBias;'
    )
  );
  gate(
    'preprocessor pairs stay balanced (+1 #ifdef, +1 #else, +1 #endif)',
    r.src.split('#ifdef').length - BASE.split('#ifdef').length === 1 &&
      r.src.split('#else').length - BASE.split('#else').length === 1 &&
      r.src.split('#endif').length - BASE.split('#endif').length === 1
  );
  gate(
    'nothing outside the PCF getShadow moved',
    r.src.replace(
      /float shadow = 1\.0;\n\t\t\tshadowCoord\.xyz \/= shadowCoord\.w;\n\t\t\t#ifdef USE_REVERSED_DEPTH_BUFFER\n\t\t\t\tshadowCoord\.z -= shadowBias;\n\t\t\t#else\n\t\t\t\tshadowCoord\.z \+= shadowBias;\n\t\t\t#endif/,
      'float shadow = 1.0;\n\t\t\tshadowCoord.xyz /= shadowCoord.w;\n\t\t\tshadowCoord.z += shadowBias;'
    ) === BASE,
    'reversing the edit reproduces three\'s text exactly'
  );
}

// ---- (A4) the kernel patch -------------------------------------------------
{
  const w = patch(BASE, { kernel: 'world' });
  gate('kernel world: reports itself applied', w.kernel === 'world' && w.biasSign === false);
  gate(
    'kernel world: the DIRECTIONAL rotation hashes the shadow texel',
    w.src.includes('float phi = interleavedGradientNoise( shadowCoord.xy * shadowMapSize ) * PI2;')
  );
  gate(
    'kernel world: getPointShadow\'s screen-space rotation is UNTOUCHED',
    (w.src.match(/interleavedGradientNoise\( gl_FragCoord\.xy \) \* PI2/g) || []).length === 1,
    'the edit is scoped to the branch that ships; point lights do not exist in this scene'
  );
  const f = patch(BASE, { kernel: 'fixed' });
  gate('kernel fixed: phi is a literal 0.0', f.src.includes('float phi = 0.0;'));
  gate(
    'kernel fixed: no rotation source remains in the directional branch',
    !f.src.includes(
      'float radius = shadowRadius * texelSize.x;\n\t\t\t\tfloat phi = interleavedGradientNoise'
    )
  );
  gate(
    'an unknown kernel name is ignored rather than mis-patched',
    patch(BASE, { kernel: 'nonsense' }).src === BASE
  );
}

// ---- (A5) both edits together, and idempotence -----------------------------
{
  const both = patch(BASE, { biasSignFix: shipped.biasSignFix, kernel: shipped.kernel });
  gate(
    'the SHIPPED option set applies both edits',
    both.biasSign === true && both.kernel === shipped.kernel,
    `biasSignFix=${shipped.biasSignFix} kernel='${shipped.kernel}'`
  );
  const twice = patch(both.src, { biasSignFix: shipped.biasSignFix, kernel: shipped.kernel });
  gate(
    'patching an already-patched chunk is a no-op (idempotent)',
    twice.src === both.src && twice.biasSign === false && twice.kernel === null,
    'the anchors are gone, so nothing matches — a double install cannot corrupt the chunk'
  );
}

// ---- (A6) install() honours the master flag --------------------------------
{
  const before = ShaderChunk.shadowmap_pars_fragment;
  const Koff = kernelMod(ShaderChunk, { ...shipped, enabled: false });
  const st = Koff.installShadowKernel();
  gate(
    'installShadowKernel is a NO-OP with the master flag off',
    ShaderChunk.shadowmap_pars_fragment === before && st.biasSign === false && st.kernel === null
  );
  gate('…and shadowKernelState reports the truth, not the request', Koff.shadowKernelState().enabled === false);
}

// ---------------------------------------------------------------------------
// (B) THE TEXEL SNAP — real arithmetic, over three's own Matrix4/Vector3.
// FlyScene.jsx cannot be imported here (JSX + '@/' aliases + R3F), so the
// function body is lifted from source and evaluated with its module scratch
// injected — the verify-worker-normals technique.
// ---------------------------------------------------------------------------
{
  const FS = read('components/fly/FlyScene.jsx');
  const start = FS.indexOf('function snapToShadowTexel(');
  const end = FS.indexOf('\n}', start) + 2;
  const snap = new Function(
    '_snapV',
    `${FS.slice(start, end)}\nreturn snapToShadowTexel;`
  )(new Vector3());

  // A real directional-shadow camera basis: light 40° up, 30° round, looking at
  // the origin — built the way three builds it (position + lookAt + update),
  // so `matrixWorldInverse` is the same matrix the renderer would produce.
  const cam = new Object3D();
  cam.matrixWorldInverse = new Matrix4();
  const el = (40 * Math.PI) / 180;
  const az = (30 * Math.PI) / 180;
  const dir = new Vector3(-Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
  cam.position.copy(dir).multiplyScalar(3000);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld(true);
  cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
  const sun = { shadow: { camera: cam } };

  const radiusM = 1500;
  const mapSize = 2048;
  const texel = (2 * radiusM) / mapSize; // 1.46484375 m
  const snapAt = (x, y, z) => snap(sun, x, y, z, radiusM, mapSize).clone();

  // Light-space coordinates of a world point — the space the quantisation must
  // land in, and the reason the function uses the camera's OWN basis rather
  // than a hand-built one (a basis differing by a roll would quantise onto a
  // ROTATED grid and snap to nothing).
  const ls = (v) => v.clone().applyMatrix4(cam.matrixWorldInverse);

  const a = snapAt(0, 0, 0);
  gate(
    'a snapped point lands on the light-space texel lattice',
    (() => {
      const p = ls(a);
      return (
        Math.abs(p.x / texel - Math.round(p.x / texel)) < 1e-4 &&
        Math.abs(p.y / texel - Math.round(p.y / texel)) < 1e-4
      );
    })(),
    `texel ${texel} m`
  );

  // Step the target along a light-space axis by half a texel: the snap must not
  // move. That IS the defect being fixed — an un-snapped rig re-rasterises every
  // silhouette into a shifted grid every frame.
  const right = new Vector3(1, 0, 0).transformDirection(cam.matrixWorld);
  const halfStep = right.clone().multiplyScalar(texel * 0.4);
  const b = snapAt(halfStep.x, halfStep.y, halfStep.z);
  gate(
    'stepping the target by 0.4 texel does NOT move the snapped target',
    a.distanceTo(b) < 1e-4,
    `moved ${a.distanceTo(b).toExponential(2)} m`
  );

  // Step by 1.4 texels: it must move by exactly ONE texel, not 1.4.
  const bigStep = right.clone().multiplyScalar(texel * 1.4);
  const c = snapAt(bigStep.x, bigStep.y, bigStep.z);
  gate(
    'stepping by 1.4 texels moves the snapped target by exactly ONE texel',
    Math.abs(a.distanceTo(c) - texel) < 1e-3,
    `moved ${a.distanceTo(c).toFixed(5)} m vs texel ${texel}`
  );

  // Continuous travel must produce a STAIRCASE: as many distinct snapped
  // positions as texels crossed, and never more.
  {
    const seen = new Set();
    const SPAN = 10; // texels
    for (let i = 0; i <= 400; i++) {
      const d = right.clone().multiplyScalar((texel * SPAN * i) / 400);
      const p = snapAt(d.x, d.y, d.z);
      seen.add(`${p.x.toFixed(4)},${p.y.toFixed(4)},${p.z.toFixed(4)}`);
    }
    gate(
      'continuous travel produces a texel staircase, not a slide',
      seen.size === SPAN + 1,
      `${seen.size} distinct positions across ${SPAN} texels of travel (401 samples)`
    );
  }

  gate(
    'a missing shadow camera or a zero map size returns null, never NaN',
    snap({ shadow: {} }, 0, 0, 0, radiusM, mapSize) === null &&
      snap(sun, 0, 0, 0, radiusM, 0) === null &&
      snap(sun, 0, 0, 0, 0, mapSize) === null
  );
}

// ---- (C) the structural half: arm gate, normalBias, the refusal ------------
{
  const FS = read('components/fly/FlyScene.jsx');
  gate(
    'the catcher mounts only under satShadowsOn AND a catcher flag',
    /\{satShadowsOn && \(SAT_SHADOWS\.catcher\.enabled \|\| SHADOW_CALM\.enabled\) && \(/.test(FS)
  );
  gate(
    'the arm gate is caster-presence AND AGL, on a cadence',
    /queryColumns/.test(FS) &&
      /SHADOW_CALM\.catcher\.aglM/.test(FS) &&
      /SHADOW_CALM\.catcher\.everyNFrames/.test(FS)
  );
  gate(
    'normalBias comes down only when the bias SIGN is fixed',
    (FS.match(/SHADOW_CALM\.enabled && SHADOW_CALM\.biasSignFix\s*\n?\s*\?\s*SHADOW_CALM\.(sat|toy)NormalBias/g) || [])
      .length === 2,
    `toy ${shipped.toyNormalBias}, sat ${shipped.satNormalBias} — 4 and 2 with the flag off`
  );
  gate(
    'the texel snap is applied to BOTH rigs and only while casting on satellite',
    (FS.match(/SHADOW_CALM\.enabled && SHADOW_CALM\.texelSnap/g) || []).length === 2 &&
      /SHADOW_CALM\.texelSnap && satShadowRef\.current/.test(FS)
  );
  gate(
    'satCadence ships 0 — the documented refusal, not an oversight',
    shipped.satCadence === 0,
    'the ortho follows the AIRCRAFT; skipping updates strands the map behind the world it shadows'
  );
}

console.log(fails.length ? `\nVERIFY: FAIL (${fails.join(', ')})` : `\nVERIFY: PASS (${n} gates)`);
console.log('NOT PROVEN HERE: no pixel moves, no draw count, and no evidence that the');
console.log('catcher receives a shadow. "Owens is 0 by construction" rests on queryColumns');
console.log('answering [] over empty terrain, which is a browser fact. Those rows belong to');
console.log('the user\'s machine or to a future browser verify-shadow-calm.');
process.exit(fails.length ? 1 : 0);
