/**
 * R25 (D GROUND) — offline GLSL ES 3.00 compile check for a patched three.js
 * material, via glslangValidator when it is installed (it is not required:
 * callers report NOT CALIBRATED when `available()` is false).
 *
 * three builds its program as <prefix> + ShaderLib text with every
 * `#include <chunk>` resolved. This module reproduces that for a MeshStandard
 * terrain material with the defines the live satellite tile program has
 * (USE_MAP, one directional + one hemisphere light, fog, an environment map,
 * render-target output = no tone mapping / linear output) — a CONTROL: the
 * Classic text must compile under the same prefix, or the prefix is wrong and
 * the verdict is NOT CALIBRATED rather than a pass or a fail of the patch.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function available() {
  try {
    execFileSync('glslangValidator', ['--version'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function resolveIncludes(src, ShaderChunk, depth = 0) {
  if (depth > 8) return src;
  return src.replace(/^[ \t]*#include +<([\w\d./]+)>/gm, (_, name) => {
    const chunk = ShaderChunk[name];
    if (chunk == null) throw new Error(`unknown chunk ${name}`);
    return resolveIncludes(chunk, ShaderChunk, depth + 1);
  });
}

const DEFINES = [
  // glslang reserves `average` (an extension built-in); three declares its own
  // in <common>. Rename it consistently — a harness artefact, not a patch.
  '#define average three_average',
  '#define SHADER_TYPE MeshStandardMaterial',
  '#define STANDARD',
  '#define USE_MAP',
  '#define MAP_UV uv',
  '#define USE_FOG',
  '#define USE_ENVMAP',
  '#define ENVMAP_TYPE_CUBE_UV',
  '#define ENVMAP_MODE_REFLECTION',
  '#define ENVMAP_BLENDING_NONE',
  '#define CUBEUV_TEXEL_WIDTH 0.0013',
  '#define CUBEUV_TEXEL_HEIGHT 0.0010',
  '#define CUBEUV_MAX_MIP 8.0',
  '#define USE_SHADOWMAP',
  '#define SHADOWMAP_TYPE_PCF',
  '#define USE_REVERSED_DEPTH_BUFFER',
  '#define DOUBLE_SIDED_UNUSED',
];
const LIGHTS = [
  '#define NUM_DIR_LIGHTS 1',
  '#define NUM_POINT_LIGHTS 0',
  '#define NUM_SPOT_LIGHTS 0',
  '#define NUM_SPOT_LIGHT_COORDS 0',
  '#define NUM_RECT_AREA_LIGHTS 0',
  '#define NUM_HEMI_LIGHTS 1',
  '#define NUM_DIR_LIGHT_SHADOWS 1',
  '#define NUM_POINT_LIGHT_SHADOWS 0',
  '#define NUM_SPOT_LIGHT_SHADOWS 0',
  '#define NUM_SPOT_LIGHT_MAPS 0',
  '#define NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS 0',
  '#define NUM_LIGHT_PROBES 0',
  '#define NUM_CLIPPING_PLANES 0',
  '#define UNION_CLIPPING_PLANES 0',
];

function vertexPrefix() {
  return [
    '#version 300 es',
    '#define attribute in',
    '#define varying out',
    '#define texture2D texture',
    'precision highp float;',
    'precision highp int;',
    'precision highp sampler2D;',
    ...DEFINES,
    ...LIGHTS,
    'uniform mat4 modelMatrix;',
    'uniform mat4 modelViewMatrix;',
    'uniform mat4 projectionMatrix;',
    'uniform mat4 viewMatrix;',
    'uniform mat3 normalMatrix;',
    'uniform vec3 cameraPosition;',
    'uniform bool isOrthographic;',
    'attribute vec3 position;',
    'attribute vec3 normal;',
    'attribute vec2 uv;',
    '',
  ].join('\n');
}

function fragmentPrefix() {
  return [
    '#version 300 es',
    '#define varying in',
    'layout(location = 0) out highp vec4 pc_fragColor;',
    '#define gl_FragColor pc_fragColor',
    '#define gl_FragDepthEXT gl_FragDepth',
    '#define texture2D texture',
    '#define textureCube texture',
    '#define texture2DProj textureProj',
    '#define texture2DLodEXT textureLod',
    '#define texture2DProjLodEXT textureProjLod',
    '#define textureCubeLodEXT textureLod',
    '#define texture2DGradEXT textureGrad',
    '#define texture2DProjGradEXT textureProjGrad',
    '#define textureCubeGradEXT textureGrad',
    'precision highp float;',
    'precision highp int;',
    'precision highp sampler2D;',
    'precision highp samplerCube;',
    'precision highp sampler2DShadow;',
    ...DEFINES,
    ...LIGHTS,
    'uniform mat4 viewMatrix;',
    'uniform vec3 cameraPosition;',
    'uniform bool isOrthographic;',
    'vec4 linearToOutputTexel( vec4 value ) { return value; }',
    '',
  ].join('\n');
}

// three's own post-processing of the program body (WebGLProgram): light counts
// are substituted TEXTUALLY, clipping-plane counts likewise, then every
// `#pragma unroll_loop_start` loop is unrolled with UNROLLED_LOOP_INDEX bound.
const LIGHT_NUMS = [
  [/NUM_DIR_LIGHTS/g, 1], [/NUM_SPOT_LIGHTS/g, 0], [/NUM_SPOT_LIGHT_MAPS/g, 0],
  [/NUM_SPOT_LIGHT_COORDS/g, 0], [/NUM_RECT_AREA_LIGHTS/g, 0], [/NUM_POINT_LIGHTS/g, 0],
  [/NUM_HEMI_LIGHTS/g, 1], [/NUM_DIR_LIGHT_SHADOWS/g, 1],
  [/NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS/g, 0], [/NUM_SPOT_LIGHT_SHADOWS/g, 0], [/NUM_POINT_LIGHT_SHADOWS/g, 0],
  [/NUM_CLIPPING_PLANES/g, 0], [/UNION_CLIPPING_PLANES/g, 0],
];
const UNROLL = /#pragma unroll_loop_start\s+for\s*\(\s*int\s+i\s*=\s*(\d+)\s*;\s*i\s*<\s*(\d+)\s*;\s*i\s*\+\+\s*\)\s*{([\s\S]+?)}\s+#pragma unroll_loop_end/g;
function post(body) {
  let s = body;
  for (const [re, n] of LIGHT_NUMS) s = s.replace(re, String(n));
  return s.replace(UNROLL, (_, a, b, snip) => {
    let out = '';
    for (let i = +a; i < +b; i++) out += snip.replace(/\[\s*i\s*\]/g, '[ ' + i + ' ]').replace(/UNROLLED_LOOP_INDEX/g, i);
    return out;
  });
}

/**
 * Compile a { vertexShader, fragmentShader } pair (post-onBeforeCompile, with
 * unresolved #include lines). Returns { ok, vs, fs } with the validator's log.
 */
export function compileProgram(shader, ShaderChunk) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'r25glsl-'));
  const run = (stage, text) => {
    const f = path.join(dir, `s.${stage}`);
    writeFileSync(f, text);
    try {
      execFileSync('glslangValidator', [f], { stdio: 'pipe' });
      return { ok: true, log: '' };
    } catch (e) {
      return { ok: false, log: String(e.stdout || e.message).split('\n').filter((l) => /ERROR/.test(l)).slice(0, 6).join('\n') };
    }
  };
  try {
    const vs = run('vert', vertexPrefix() + post(resolveIncludes(shader.vertexShader, ShaderChunk)));
    const fs = run('frag', fragmentPrefix() + post(resolveIncludes(shader.fragmentShader, ShaderChunk)));
    return { ok: vs.ok && fs.ok, vs, fs };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
