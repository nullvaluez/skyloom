// Room-only render harness — the page half (driven by scripts/render-lounge-room.cjs).
//
// Builds the REAL lounge through lib/fly/airport-lounge.js createAirportLounge
// ({variant}), with the real GPU surface-map bake (room-textures.js), the real
// offline AO bake (public/models/lounge-ao*.bin through room-ao.js loadBake),
// the real interior reflection probe, glass, steam and boards, and (when the
// LOUNGE_INSTRUMENTS switch is on) the real physical instruments sharing the
// room's metal material. Each frame it feeds the room exactly what
// components/fly/AirportLounge.jsx feeds it — updateRoomShading, glass.update,
// steam.update, board.update, the probe capture rule and the lounge exposure
// bias — from a cinema environment computed by the app's own
// lib/fly/cinema-environment.js evaluateCinemaEnvironment for a fixed sun.
//
// STAND-INS (what this harness does NOT reproduce — say so when citing it):
//   - the world: a procedural sky gradient (equirect background + a PMREM
//     environment from the same gradient) and one procedural ground plane
//     18 m below the floor (grass, two aprons, a runway and taxiway, night
//     edge lights). No terrain, buildings, airport set, aircraft or clouds.
//   - lights: ONE harness-only DirectionalLight (intensity env.sun, colour
//     env.keyColor, along env.keyDir) and one HemisphereLight (env.fill,
//     fillColor/groundColor), the app's own sun/hemi values. The app's sun
//     reaches the room through the cinema CSM cascade lights; there are no
//     cascades here (the room masks its key analytically and receives no
//     shadow map, so the interior result is the same light).
//   - post: RenderPass into a HalfFloat target (linear HDR, NoToneMapping, as
//     the app's composer) -> three's UnrealBloomPass (stand-in for the app's
//     postprocessing bloom; different kernel) -> OutputPass (AgX, exposure =
//     env.exposure x 2^lounge stops, sRGB) -> SMAAPass. No N8AO, no aerial
//     perspective, no immersive clouds, no grade/vignette, no TRUE_SCALE
//     anisotropy (k0 = 1, room scale 1).
//   - no HUD, no walk controller, no live traffic: the boards show their honest
//     empty state ("QUIET SKIES") and the instrument screens "WAITING FOR FRESH
//     POSITIONS". Nothing here is a contact.
//   - no performance meaning: this runs on SwiftShader. Draw and triangle
//     counts are exact; time is not.
import {
  AgXToneMapping, Color, DataTexture, DataUtils, DirectionalLight, EquirectangularReflectionMapping, HalfFloatType,
  HemisphereLight, LinearFilter, Mesh, PerspectiveCamera, PlaneGeometry, PMREMGenerator, RGBAFormat, Scene,
  FloatType, ShaderMaterial, SRGBColorSpace, Vector2, Vector3, WebGLCubeRenderTarget, WebGLRenderTarget, WebGLRenderer,
} from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { createAirportLounge } from '../../lib/fly/airport-lounge.js';
import { bakeRoomTextures } from '../../lib/fly/lounge/room-textures.js';
import { loadBake } from '../../lib/fly/lounge/room-ao.js';
import { updateRoomShading } from '../../lib/fly/lounge/room-shading.js';
import { InteriorProbe } from '../../lib/fly/lounge/lounge-probe.js';
import { roomVariant } from '../../lib/fly/lounge/room-plan.js';
import { createObservatoryInstruments } from '../../lib/fly/lounge/observatory-instruments.js';
import { ROOM_LOOK, VIEW } from '../../lib/fly/observation-config.js';
import { createCinemaEnvironment, evaluateCinemaEnvironment } from '../../lib/fly/cinema-environment.js';
import { resolvePose } from './poses.mjs';

/** Fixed suns (room-local = scene: the harness room has heading 0 and scale 1). */
export const TODS = Object.freeze({
  // Sun high in the front-left: patches through the front glazing downstairs
  // and over the lower roof into the upper room.
  day: { elevationDeg: 40, az: 2.6 },
  // Low sun in the east-front: long patches through the upper east glazing.
  golden: { elevationDeg: 5, az: -2.1 },
  // Deep night: the moon key, practicals at their night levels.
  night: { elevationDeg: -24, az: 0.6 },
});
const FIXED_TIME = 12; // seconds: steam, rain and grime phases are deterministic
const GROUND_DROP = 18; // the apron below the lounge floor (m), a typical seated floor height
const errors = [];
const warnings = [];

const smooth = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

// --- The sky stand-in ---------------------------------------------------------
function skyRadiance(env, dir, out) {
  const y = dir[1];
  const up = Math.max(0, y);
  for (let i = 0; i < 3; i++) {
    const sky = env.horizon[i] + (env.zenith[i] - env.horizon[i]) * Math.pow(up, 0.55);
    const ground = env.groundColor[i] * 0.55 + env.horizon[i] * 0.25;
    out[i] = y >= 0 ? sky : ground + (env.horizon[i] - ground) * Math.exp(y * 18);
  }
  // A sun glow (not a disc: the env map is coarse); the key's own colour.
  const s = env.sunDir, mu = Math.max(0, dir[0] * s[0] + dir[1] * s[1] + dir[2] * s[2]);
  const vis = smooth(-0.04, 0.02, s[1]) * (y > -0.02 ? 1 : 0);
  const glow = (Math.pow(mu, 900) * 40 + Math.pow(mu, 24) * 0.35) * vis;
  for (let i = 0; i < 3; i++) out[i] += env.keyColor[i] * glow * (0.3 + 0.7 * env.day);
  return out;
}
function skyTexture(env, w = 512, h = 256) {
  const data = new Uint16Array(w * h * 4), c = [0, 0, 0];
  for (let j = 0; j < h; j++) {
    const theta = ((j + 0.5) / h - 0.5) * Math.PI;
    for (let i = 0; i < w; i++) {
      const phi = ((i + 0.5) / w - 0.5) * 2 * Math.PI;
      skyRadiance(env, [Math.cos(theta) * Math.cos(phi), Math.sin(theta), Math.cos(theta) * Math.sin(phi)], c);
      const o = (j * w + i) * 4;
      data[o] = DataUtils.toHalfFloat(c[0]); data[o + 1] = DataUtils.toHalfFloat(c[1]); data[o + 2] = DataUtils.toHalfFloat(c[2]); data[o + 3] = DataUtils.toHalfFloat(1);
    }
  }
  const t = new DataTexture(data, w, h, RGBAFormat, HalfFloatType);
  t.mapping = EquirectangularReflectionMapping;
  t.magFilter = LinearFilter; t.minFilter = LinearFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  t.name = 'harness-sky';
  return t;
}

// --- The ground stand-in ----------------------------------------------------------
const GROUND_FRAG = /* glsl */ `
uniform vec3 uKey; uniform vec3 uKeyColor; uniform float uSun;
uniform vec3 uFill; uniform vec3 uGround; uniform vec3 uHorizon; uniform vec3 uZenith; uniform float uNight; uniform float uEnv;
varying vec3 vW;
float box( vec2 p, vec2 lo, vec2 hi, vec2 aa ) {
  vec2 a = smoothstep( lo - aa, lo + aa, p ) * ( 1.0 - smoothstep( hi - aa, hi + aa, p ) );
  return a.x * a.y;
}
void main() {
  vec2 p = vW.xz;
  vec2 aa = max( fwidth( p ), vec2( 0.05 ) );
  vec3 grass = vec3( 0.13, 0.17, 0.09 ), conc = vec3( 0.36, 0.35, 0.33 ), asph = vec3( 0.07, 0.07, 0.075 );
  vec3 alb = grass;
  alb = mix( alb, conc, box( p, vec2( -320.0, -270.0 ), vec2( 320.0, -24.0 ), aa ) ); // front apron
  alb = mix( alb, conc, box( p, vec2( -220.0, 34.0 ), vec2( 220.0, 210.0 ), aa ) );   // rear apron
  alb = mix( alb, asph, box( p, vec2( -1900.0, -432.0 ), vec2( 1900.0, -408.0 ), aa ) ); // taxiway
  alb = mix( alb, asph, box( p, vec2( -2100.0, -650.0 ), vec2( 2100.0, -590.0 ), aa ) ); // runway
  // runway centreline dashes, faded before they alias
  float dash = box( vec2( fract( p.x / 60.0 ) * 60.0, p.y ), vec2( 0.0, -620.6 ), vec2( 30.0, -619.4 ), aa );
  alb = mix( alb, vec3( 0.75 ), dash * ( 1.0 - smoothstep( 0.4, 1.2, aa.y ) ) );
  // stand lead-in lines on the front apron
  float lead = box( vec2( abs( fract( p.x / 45.0 + 0.5 ) - 0.5 ) * 45.0, p.y ), vec2( -0.1, -250.0 ), vec2( 0.1, -30.0 ), aa );
  alb = mix( alb, vec3( 0.55, 0.45, 0.12 ), lead * ( 1.0 - smoothstep( 0.2, 0.6, aa.x ) ) );
  // Lambert, as three lights a MeshStandardMaterial: direct and hemisphere
  // irradiance over pi, plus the sky's radiance (the IBL's diffuse term).
  vec3 skyAmb = mix( uHorizon, uZenith, 0.35 ) * uEnv;
  vec3 col = alb * ( ( uKeyColor * uSun * max( uKey.y, 0.0 ) + uFill ) / 3.14159265 + skyAmb );
  // night: runway edge lights, green taxiway centre lights, apron flood pools
  if ( uNight > 0.01 ) {
    float rx = p.x - floor( p.x / 60.0 + 0.5 ) * 60.0;
    float r = max( 0.45, 1.4 * aa.x );
    float edge = 1.0 - smoothstep( r * 0.5, r, length( vec2( rx, abs( p.y + 620.0 ) - 30.0 ) ) );
    float tx = p.x - floor( p.x / 30.0 + 0.5 ) * 30.0;
    float taxi = 1.0 - smoothstep( r * 0.5, r, length( vec2( tx, p.y + 420.0 ) ) );
    float pool = 0.0;
    for ( int i = -3; i <= 3; i ++ ) {
      vec2 m = vec2( float( i ) * 90.0, -150.0 ), b = vec2( float( i ) * 110.0, 140.0 );
      pool += exp( -dot( p - m, p - m ) / 2600.0 ) + exp( -dot( p - b, p - b ) / 2600.0 ) * 0.8;
    }
    col += uNight * ( vec3( 1.0, 0.86, 0.62 ) * edge * 1.1 + vec3( 0.25, 1.0, 0.45 ) * taxi * 0.6 + alb * vec3( 1.0, 0.82, 0.58 ) * pool * 0.6 );
  }
  float d = length( vW - cameraPosition );
  col = mix( col, uHorizon, ( 1.0 - exp( -d / 7000.0 ) ) * 0.85 );
  gl_FragColor = vec4( col, 1.0 );
}`;
function createGround() {
  const material = new ShaderMaterial({
    name: 'harness-ground',
    uniforms: {
      uKey: { value: new Vector3(0, 1, 0) }, uKeyColor: { value: new Color() }, uSun: { value: 1 },
      uFill: { value: new Color() }, uGround: { value: new Color() }, uHorizon: { value: new Color() }, uZenith: { value: new Color() }, uNight: { value: 0 }, uEnv: { value: 0.6 },
    },
    vertexShader: 'varying vec3 vW; void main() { vec4 w = modelMatrix * vec4( position, 1.0 ); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: GROUND_FRAG,
  });
  const geometry = new PlaneGeometry(60000, 60000, 1, 1);
  geometry.rotateX(-Math.PI / 2);
  const mesh = new Mesh(geometry, material);
  mesh.position.y = -GROUND_DROP;
  mesh.name = 'harness:ground';
  mesh.frustumCulled = false;
  return mesh;
}

// --- Counting the scene pass (bloom/output/SMAA draw too) ---------------------------
class CountingRenderPass extends RenderPass {
  render(renderer, writeBuffer, readBuffer, deltaTime, maskActive) {
    const info = renderer.info.render, c0 = info.calls, t0 = info.triangles;
    super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
    this.last = { calls: info.calls - c0, triangles: info.triangles - t0 };
  }
}

/**
 * Counts non-finite linear pixels in the scene pass (half-float NaN / Inf bit
 * patterns) and paints them MAGENTA before the bloom: a NaN fragment would
 * otherwise smear through the bloom blur and blank the frame. Magenta is
 * evidence, not a fix: every marked pixel is a real shader defect on this
 * implementation (SwiftShader); the owner's GPU may or may not show it.
 */
class NonFinitePass extends Pass {
  constructor() {
    super();
    this.needsSwap = true;
    this.counts = { nan: 0, inf: 0 };
    this.quad = new FullScreenQuad(new ShaderMaterial({
      name: 'harness-nonfinite',
      uniforms: { tDiffuse: { value: null } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }',
      fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
        void main() { vec4 c = texture2D( tDiffuse, vUv ); bool bad = any( isnan( c.rgb ) ) || any( isinf( c.rgb ) ); gl_FragColor = bad ? vec4( 0.8, 0.0, 0.8, 1.0 ) : c; }`,
      depthTest: false, depthWrite: false,
    }));
  }
  render(renderer, writeBuffer, readBuffer) {
    const w = readBuffer.width, h = readBuffer.height;
    if (!this.buf || this.buf.length !== w * h * 4) this.buf = new Uint16Array(w * h * 4);
    renderer.readRenderTargetPixels(readBuffer, 0, 0, w, h, this.buf);
    let nan = 0, inf = 0;
    for (let i = 0; i < this.buf.length; i += 4) {
      let bad = 0;
      for (let c = 0; c < 3; c++) { const v = this.buf[i + c]; if ((v & 0x7c00) === 0x7c00) bad = (v & 0x03ff) ? 2 : Math.max(bad, 1); }
      if (bad === 2) nan++; else if (bad === 1) inf++;
    }
    this.counts = { nan, inf };
    this.quad.material.uniforms.tDiffuse.value = readBuffer.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }
  dispose() { this.quad.material.dispose(); this.quad.dispose(); }
}

let H = null; // the live harness state

async function setup({ variant = 'pier', width = 1280, height = 720, flags = [] } = {}) {
  const has = (name) => flags.includes(name) && !flags.includes(`-${name}`);
  const instrumentsOn = variant === 'pier' ? !flags.includes('-LOUNGE_INSTRUMENTS') : has('LOUNGE_INSTRUMENTS');
  const renderer = new WebGLRenderer({ antialias: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
  renderer.debug.checkShaderErrors = true;
  renderer.debug.onShaderError = (gl, program, vs, fs) => {
    const log = [gl.getProgramInfoLog(program), gl.getShaderInfoLog(vs), gl.getShaderInfoLog(fs)].filter(Boolean).join('\n');
    errors.push(`shader error: ${log.slice(0, 2000)}`);
    console.error(`[harness] shader error\n${log.slice(0, 4000)}`);
  };
  renderer.setPixelRatio(1);
  renderer.setSize(width, height);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = AgXToneMapping;
  renderer.info.autoReset = false;
  document.body.appendChild(renderer.domElement);

  const scene = new Scene();
  const camera = new PerspectiveCamera(VIEW.baseFovDeg, width / height, 0.05, 60000);
  scene.add(camera);
  const sun = new DirectionalLight(0xffffff, 1);
  sun.name = 'harness:sun';
  scene.add(sun, sun.target);
  const hemi = new HemisphereLight(0xffffff, 0x000000, 0.15);
  hemi.name = 'harness:hemi';
  scene.add(hemi);
  const ground = createGround();
  scene.add(ground);

  const resource = createAirportLounge({ variant, document });
  const textures = bakeRoomTextures(renderer);
  resource.attachMaps(textures.maps);
  if (has('SAFE_BUMP')) {
    // DIAGNOSTIC ONLY (not the app's shader): lgBump's normalize() receives an
    // exactly-zero (or non-finite) vector on some wood/stone quads under
    // SwiftShader and returns NaN. This guards it so the rest of the look can
    // be judged; the defect itself belongs to room-shading.js.
    for (const m of resource.litMaterials()) {
      const prev = m.onBeforeCompile, key = m.customProgramCacheKey;
      m.onBeforeCompile = (shader, r) => {
        prev.call(m, shader, r);
        const a = 'return normalize( abs( det ) * surfNorm - grad );';
        // The pier program carries its own guard since the LIGHT lane
        // (room-shading.js GLSL_FUNCS_PIER): nothing left to patch there.
        if (!shader.fragmentShader.includes(a) && shader.fragmentShader.includes('lgBn * inversesqrt( lgBl )')) return;
        if (!shader.fragmentShader.includes(a)) throw new Error('SAFE_BUMP: lgBump anchor missing');
        shader.fragmentShader = shader.fragmentShader.replace(a, 'vec3 lgv = abs( det ) * surfNorm - grad; return dot( lgv, lgv ) > 1e-30 ? normalize( lgv ) : surfNorm;');
      };
      m.customProgramCacheKey = () => `${key.call(m)}|harness-safe-bump`;
    }
  }
  const bake = await loadBake(variant);
  const aoApplied = bake ? resource.attachAO(bake) : false;
  if (!aoApplied) errors.push(`AO bake ${bake ? 'does not match the room geometry' : 'did not load'} (${variant})`);
  resource.group.visible = true;
  scene.add(resource.group);

  let instruments = null;
  if (instrumentsOn) {
    instruments = createObservatoryInstruments(variant, document);
    instruments.bodies.material = resource.materials.metal; // the room's interior shader, as ObservatoryInstruments does
    instruments.displays.material.opacity = 1;
    instruments.group.visible = true;
    instruments.update(1e9, { runways: [], contacts: [], suggestions: {}, listening: null, night: has('NIGHT_WATCH') });
    scene.add(instruments.group);
  }

  const probe = new InteriorProbe(ROOM_LOOK.probeSize);
  const watch = { active: true, airport: { ident: 'ROOM', name: 'Room harness', a: { lat: 40, lon: -83 } }, board: () => ({ arrivals: [], departures: [], ground: [], overhead: [], local: [], at: 0 }) };
  resource.board.update(0, watch, true, 'live');

  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(1);
  composer.setSize(width, height);
  const scenePass = new CountingRenderPass(scene, camera);
  const nonFinite = new NonFinitePass();
  // A tight radius: the app's bloom is a highlight glow, not a veil.
  const bloom = new UnrealBloomPass(new Vector2(width, height), 0.3, 0.12, 1.4);
  const output = new OutputPass();
  const smaa = new SMAAPass();
  composer.addPass(scenePass);
  composer.addPass(nonFinite);
  if (!flags.includes('NO_BLOOM')) composer.addPass(bloom);
  composer.addPass(output);
  if (!flags.includes('NO_SMAA')) composer.addPass(smaa);

  const pmrem = new PMREMGenerator(renderer);
  H = { variant, width, height, flags, renderer, scene, camera, sun, hemi, ground, resource, textures, instruments, probe, watch, composer, scenePass, nonFinite, bloom, pmrem, tod: null, env: null, envTex: null, skyTex: null, probeKey: null, nightWatch: has('NIGHT_WATCH') ? 1 : 0, probeOn: !flags.includes('NO_PROBE') };
  const roomTris = resource.meshes.concat([resource.board.mesh, resource.glass.mesh, resource.steam.mesh]).reduce((s, m) => s + (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3, 0);
  return {
    variant, instruments: !!instruments, aoApplied,
    room: {
      draws: resource.group.children.filter((o) => o.isMesh).length + (instruments ? 2 : 0),
      triangles: roomTris + (instruments ? instruments.stats.triangles : 0),
      roomTriangles: roomTris,
      practicals: resource.fixtures.lights, shadowBoxes: resource.fixtures.shadows,
      textureBytes: textures.bytes,
    },
  };
}

function setTod(tod) {
  if (H.tod === tod) return;
  const preset = TODS[tod];
  if (!preset) throw new Error(`unknown time of day ${tod}`);
  const env = evaluateCinemaEnvironment(createCinemaEnvironment(), { sinEl: Math.sin((preset.elevationDeg * Math.PI) / 180), az: preset.az }, {}, null);
  H.env = env;
  H.tod = tod;
  const key = new Vector3().fromArray(env.keyDir).normalize();
  H.sun.position.copy(key).multiplyScalar(200);
  H.sun.target.position.set(0, 0, 0);
  H.sun.intensity = env.sun;
  H.sun.color.fromArray(env.keyColor);
  H.hemi.intensity = env.fill;
  H.hemi.color.fromArray(env.fillColor);
  H.hemi.groundColor.fromArray(env.groundColor);
  H.skyTex?.dispose();
  H.envTex?.dispose();
  H.skyCube?.dispose();
  H.skyTex = skyTexture(env);
  H.envTex = H.pmrem.fromEquirectangular(H.skyTex).texture;
  // Convert the background to a cube map here: left to the renderer, the
  // first frame after a change would carry six extra conversion draws.
  H.skyCube = new WebGLCubeRenderTarget(512, { type: HalfFloatType }).fromEquirectangularTexture(H.renderer, H.skyTex);
  H.scene.background = H.skyCube.texture;
  H.scene.environment = H.envTex;
  H.scene.environmentIntensity = env.environment;
  const u = H.ground.material.uniforms;
  u.uKey.value.copy(key); u.uKeyColor.value.fromArray(env.keyColor); u.uSun.value = env.sun;
  u.uFill.value.fromArray(env.fillColor).multiplyScalar(env.fill); u.uGround.value.fromArray(env.groundColor);
  u.uHorizon.value.fromArray(env.horizon); u.uZenith.value.fromArray(env.zenith); u.uNight.value = env.night; u.uEnv.value = env.environment;
  H.probeKey = null;
}

function placeCamera(pose) {
  const c = H.camera;
  c.position.fromArray(pose.eye);
  c.up.set(0, 1, 0);
  c.lookAt(c.position.clone().add(new Vector3().fromArray(pose.dir)));
  c.updateProjectionMatrix();
  c.updateMatrixWorld(true);
}

async function render(poseName, tod) {
  if (!H) throw new Error('setup() first');
  // A named pose (poses.mjs), or an ad-hoc { name, eye, target } (diagnostics).
  let pose;
  if (typeof poseName === 'object') {
    const d = poseName.target.map((v, i) => v - poseName.eye[i]), l = Math.hypot(...d);
    pose = { name: poseName.name ?? 'custom', eye: poseName.eye, dir: d.map((v) => v / l), seatId: null, note: 'ad-hoc pose' };
    poseName = pose.name;
  } else pose = resolvePose(poseName, H.variant);
  if (!pose) return { skipped: true, reason: `pose ${poseName} does not exist in the ${H.variant} room` };
  const started = performance.now();
  setTod(tod);
  placeCamera(pose);
  const { resource, env } = H;
  const group = resource.group;
  group.updateMatrixWorld(true);
  const key = new Vector3().fromArray(env.keyDir);
  // AirportLounge.jsx: the interior lighting model.
  const shade = updateRoomShading(resource.uniforms, { group, camera: H.camera, env, sun: { sinEl: Math.sin((TODS[tod].elevationDeg * Math.PI) / 180), az: TODS[tod].az }, keyScene: key, time: FIXED_TIME, nightWatch: H.nightWatch }, {});
  resource.uniforms.uLoungeFade.value = 0;
  // The lounge exposure bias (AirportLounge.jsx), settled rather than eased.
  const X = ROOM_LOOK.exposure;
  const stops = X.night + (X.day - X.night) * shade.day - (X.day - X.golden) * shade.golden * shade.day;
  const exposure = env.exposure * 2 ** stops;
  H.renderer.toneMappingExposure = exposure;
  H.bloom.strength = env.bloomIntensity;
  H.bloom.threshold = env.bloomThreshold / exposure;
  // Glass and steam (the overlays take exposure 1: the output pass applies it to everything here).
  const u = resource.uniforms;
  const keyColor = env.keyColor;
  const keyI = env.sun * (env.sunVisibility ?? 1);
  const zen = env.zenith, hor = env.horizon;
  // Interior reflection probe: AirportLounge.jsx's rule (the room's probe eye,
  // or the upper probe eye when the observer is on the upper floor; the classic
  // window seat captures at the live eye).
  const plan = roomVariant(H.variant);
  const upperProbe = !!plan.upper && pose.eye[1] >= plan.upper.floorY + 0.5;
  const pe = upperProbe ? plan.upper.probeEye : plan.probeEye;
  // The pier shades each probe face from its own camera (lounge-probe.js), so
  // one capture serves every pose on a floor, as in the app. The classic room
  // still renders its probe with the live camera's shading uniforms, so it is
  // captured afresh for every pose: a capture shared across poses would make a
  // pose's reflections depend on the order poses ran in.
  const pier = H.variant === 'pier';
  const probeKey = `${tod}|${upperProbe ? 1 : 0}|${H.nightWatch}|${pier ? '' : poseName}`;
  if (H.probeOn && probeKey !== H.probeKey) {
    const eye = !pier && pose.seatId === 'window' ? H.camera.position.clone() : new Vector3(...pe).applyMatrix4(group.matrixWorld);
    H.probe.capture(H.renderer, H.scene, group, [...resource.meshes, resource.board.mesh], eye, pe, pier ? resource.uniforms : null);
    H.probeKey = probeKey;
  }
  resource.glass.update({
    eye: u.uLoungeEye.value, sun: u.uLoungeKey.value,
    sunColor: [keyColor[0] * keyI, keyColor[1] * keyI, keyColor[2] * keyI],
    sky: [zen[0] * 0.5 + hor[0] * 0.5, zen[1] * 0.5 + hor[1] * 0.5, zen[2] * 0.5 + hor[2] * 0.5],
    exposure: 1, rain: 0, night: shade.night, nightWatch: H.nightWatch, lens: 1, time: FIXED_TIME,
    roomRad: u.uLoungeRoomRad.value, probe: H.probeOn && H.probe.texture ? H.probe : null, probeLod: ROOM_LOOK.probeLod,
  });
  const sunView = key.clone().transformDirection(H.camera.matrixWorldInverse);
  resource.steam.update({ time: FIXED_TIME, exposure: 1, strength: 1, keyOn: shade.keyI > 0.01 ? 1 : 0, lens: 1, sunView, keyColor: [keyColor[0] * keyI, keyColor[1] * keyI, keyColor[2] * keyI], ambient: u.uLoungeBounce.value });

  H.renderer.info.reset();
  H.composer.render(1 / 60);
  const image = H.renderer.domElement.toDataURL('image/png');
  const info = H.renderer.info;
  return {
    pose: poseName, tod, note: pose.note, eye: pose.eye.map((v) => +v.toFixed(3)), seat: pose.seatId,
    scene: H.scenePass.last, // the scene pass (room + instruments + the harness sky and ground)
    frame: { calls: info.render.calls, triangles: info.render.triangles }, // every pass
    nonFinite: H.nonFinite.counts, // NaN / Inf pixels in the scene pass (painted magenta)
    programs: info.programs?.length ?? null,
    memory: { geometries: info.memory.geometries, textures: info.memory.textures },
    shading: { day: +shade.day.toFixed(3), night: +shade.night.toFixed(3), golden: +shade.golden.toFixed(3), practical: +shade.practical.toFixed(3), exposureStops: +stops.toFixed(3), exposure: +exposure.toFixed(3) },
    ms: Math.round(performance.now() - started),
    image,
  };
}

window.addEventListener('error', (e) => errors.push(`window error: ${e.message}`));
window.addEventListener('unhandledrejection', (e) => errors.push(`unhandled rejection: ${e.reason?.stack ?? e.reason}`));
const origWarn = console.warn.bind(console);
console.warn = (...a) => { warnings.push(a.map(String).join(' ').slice(0, 500)); origWarn(...a); };

/**
 * Diagnostics: render the last pose's scene pass into a float target and count
 * non-finite and very bright linear values (a NaN/Inf fragment would smear
 * through the bloom blur across the whole frame).
 */
function hdrCheck() {
  const { renderer, scene, camera, width, height } = H;
  const rt = new WebGLRenderTarget(width, height, { type: FloatType });
  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(rt);
  renderer.render(scene, camera);
  const px = new Float32Array(width * height * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, width, height, px);
  renderer.setRenderTarget(prev);
  rt.dispose();
  let nan = 0, inf = 0, over = 0, max = 0, firstBad = null;
  for (let i = 0; i < px.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const v = px[i + c];
      if (Number.isNaN(v)) { nan++; firstBad ??= [(i / 4) % width, Math.floor(i / 4 / width), 'nan']; }
      else if (!Number.isFinite(v)) { inf++; firstBad ??= [(i / 4) % width, Math.floor(i / 4 / width), 'inf']; }
      else { if (v > 64) over++; if (v > max) max = v; }
    }
  }
  return { nan, inf, over64: over, max, firstBad };
}

window.__loungeHarness = { setup, render, hdrCheck, state: () => H, errors, warnings, TODS };
window.__loungeHarnessReady = true;
