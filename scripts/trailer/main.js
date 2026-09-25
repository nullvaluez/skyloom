// Skyloom trailer — deterministic frame renderer + 2D compositor.
// window.T.renderFrame(i) renders frame i of timeline.json and returns a JPEG data URL.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { clamp, lerp, smooth, easeOut, rng } from './common.js';

const q = new URLSearchParams(location.search);
const W = +(q.get('w') || 1920), H = +(q.get('h') || 1080);
const TL = await (await fetch('./timeline.json')).json();
const FPS = +(q.get('fps') || TL.fps);
for (const s of TL.shots) s.dur = s.t1 - s.t0;

const out = document.getElementById('out'); out.width = W; out.height = H; const ctx = out.getContext('2d');
const glc = document.createElement('canvas');
const renderer = new THREE.WebGLRenderer({ canvas: glc, antialias: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(1); renderer.setSize(W, H, false);
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.outputColorSpace = THREE.SRGBColorSpace;

const rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, samples: +(q.get('msaa') || 4) });
const composer = new EffectComposer(renderer, rt);
const renderPass = new RenderPass(new THREE.Scene(), new THREE.PerspectiveCamera());
const bloom = new UnrealBloomPass(new THREE.Vector2(W, H), 0.6, 0.5, 0.9);
const grade = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uCA: { value: 0.0015 }, uTint: { value: new THREE.Color(1, 1, 1) }, uLift: { value: new THREE.Color(0, 0, 0) }, uSat: { value: 1.05 }, uCon: { value: 1.06 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uCA; uniform vec3 uTint; uniform vec3 uLift; uniform float uSat; uniform float uCon; varying vec2 vUv;
    void main(){ vec2 d = vUv - 0.5; float r2 = dot(d,d);
      vec3 c; c.r = texture2D(tDiffuse, vUv - d * uCA * r2 * 4.0).r; c.g = texture2D(tDiffuse, vUv).g; c.b = texture2D(tDiffuse, vUv + d * uCA * r2 * 4.0).b;
      c = c * uTint + uLift * (1.0 - c);
      float l = dot(c, vec3(0.2126,0.7152,0.0722)); c = mix(vec3(l), c, uSat);
      c = clamp((c - 0.5) * uCon + 0.5, 0.0, 1.0);
      c = c * c * (3.0 - 2.0 * c) * 0.18 + c * 0.82;
      gl_FragColor = vec4(c, 1.0); }`,
});
composer.addPass(renderPass); composer.addPass(bloom); composer.addPass(new OutputPass()); composer.addPass(grade);

// ---- assets -----------------------------------------------------------------
const fonts = [['Archivo', '/public/fonts/ArchivoBlack-Regular.ttf']];
for (const [n, u] of fonts) { const f = new FontFace(n, `url(${u})`); await f.load(); document.fonts.add(f); }

const images = new Map();
async function loadImage(src) { if (images.has(src)) return images.get(src); const im = new Image(); im.src = src; await im.decode(); images.set(src, im); return im; }
for (const s of TL.shots) for (const im of s.images || []) await loadImage(im.src);

const sceneFactories = {
  globe: () => import('./scene-globe.js').then((m) => m.createGlobe()),
  sky: () => import('./scene-sky.js').then((m) => m.createSky(renderer)),
  harbor: () => import('./scene-harbor.js').then((m) => m.createHarbor(renderer)),
  paris: () => import('./scene-paris.js').then((m) => m.createParis(renderer)),
};
const scenes = {};
const only = q.get('scenes') ? q.get('scenes').split(',') : Object.keys(sceneFactories);
for (const k of only) scenes[k] = await sceneFactories[k]();

// ---- 2D finishing layers ---------------------------------------------------
const BAR = Math.round((H - W / 2.39) / 2);
const vignette = (() => { const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d'); const r = g.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, W * 0.62); r.addColorStop(0, 'rgba(0,0,0,0)'); r.addColorStop(1, 'rgba(0,0,0,0.55)'); g.fillStyle = r; g.fillRect(0, 0, W, H); return c; })();
const grains = [];
for (let k = 0; k < 6; k++) {
  const c = document.createElement('canvas'); c.width = W / 2; c.height = H / 2; const g = c.getContext('2d'); const id = g.createImageData(c.width, c.height); const r = rng(100 + k);
  for (let i = 0; i < id.data.length; i += 4) { const v = 128 + (r() + r() + r() - 1.5) * 110; id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 255; }
  g.putImageData(id, 0, 0); grains.push(c);
}

function shotAt(t) { for (const s of TL.shots) if (t >= s.t0 && t < s.t1) return s; return TL.shots[TL.shots.length - 1]; }

function drawGL(sh, t) {
  const sc = scenes[sh.scene]; if (!sc) { ctx.fillStyle = '#300'; ctx.fillRect(0, 0, W, H); return null; }
  const post = (sc.post && sc.post[sh.id]) || {};
  const [bs, br, bt] = post.bloom || [0.6, 0.5, 0.9]; bloom.enabled = !q.get('nobloom'); bloom.strength = bs; bloom.radius = br; bloom.threshold = bt;
  renderer.toneMappingExposure = post.exposure ?? 1;
  const g = post.grade || {};
  grade.uniforms.uTint.value.set(...(g.tint || [1, 1, 1])); grade.uniforms.uLift.value.set(...(g.lift || [0, 0, 0]));
  grade.uniforms.uSat.value = g.sat ?? 1.05; grade.uniforms.uCon.value = g.con ?? 1.06; grade.uniforms.uCA.value = g.ca ?? 0.0015;
  const N = +(q.get('mb') || sh.mb || 1); const shutter = (sh.shutter ?? 0.5) / FPS;
  let info = null;
  for (let k = 0; k < N; k++) {
    const tk = N === 1 ? t : t + shutter * (k / (N - 1) - 0.5);
    const lt = tk - sh.t0;
    info = sc.shots[sh.id](lt, tk, sh) || info;
    renderPass.scene = sc.scene; renderPass.camera = sc.camera;
    sc.camera.aspect = W / H; sc.camera.updateProjectionMatrix();
    composer.render();
    ctx.globalAlpha = 1 / (k + 1); ctx.drawImage(glc, 0, 0); ctx.globalAlpha = 1;
  }
  // flares + overlays evaluated at the centre time
  const lt = t - sh.t0;
  if (N > 1) info = sc.shots[sh.id](lt, t, sh) || info;
  if (!q.get('noflare') && sc.flares && sc.flares[sh.id]) for (const f of sc.flares[sh.id](lt, t)) drawFlare(sc.camera, f);
  if (sc.overlay && sc.overlay[sh.id]) sc.overlay[sh.id](ctx, lt, t, (v) => project(sc.camera, v), { W, H, BAR });
  return info;
}

function project(cam, v) { const c = v.clone().applyMatrix4(cam.matrixWorldInverse); if (c.z > -0.1) return { x: 0, y: 0, z: 2, vis: false }; const p = v.clone().project(cam); return { x: (p.x * 0.5 + 0.5) * W, y: (-p.y * 0.5 + 0.5) * H, z: p.z, vis: p.z < 1 && p.z > -1 }; }

function drawFlare(cam, f) {
  const s = project(cam, f.pos); if (!s.vis) return;
  const I = f.i ?? 1; if (I <= 0.01) return;
  const col = f.color || [255, 210, 160];
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  // anamorphic streak
  const len = W * (f.len ?? 0.9);
  const g = ctx.createLinearGradient(s.x - len / 2, 0, s.x + len / 2, 0);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.5, `rgba(${col[0]},${col[1]},${col[2]},${0.55 * I})`); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; const hh = (f.thick ?? 3) * (H / 1080);
  ctx.fillRect(s.x - len / 2, s.y - hh, len, hh * 2);
  ctx.globalAlpha = 0.5; ctx.fillRect(s.x - len / 2, s.y - hh * 3, len, hh * 6); ctx.globalAlpha = 1;
  // core bloom
  const r = (f.core ?? 90) * (H / 1080);
  const rg = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, r);
  rg.addColorStop(0, `rgba(${col[0]},${col[1]},${col[2]},${0.5 * I})`); rg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = rg; ctx.fillRect(s.x - r, s.y - r, r * 2, r * 2);
  // ghosts along the axis through centre
  if (f.ghosts !== false) {
    const cx = W / 2, cy = H / 2;
    [[-0.4, 30, [120, 170, 255]], [-0.8, 60, [255, 160, 90]], [0.35, 18, [150, 255, 200]], [-1.25, 110, [120, 140, 255]]].forEach(([k, rad, c]) => {
      const x = cx + (s.x - cx) * k, y = cy + (s.y - cy) * k; const rr = rad * (H / 1080);
      const gg = ctx.createRadialGradient(x, y, rr * 0.5, x, y, rr);
      gg.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},${0.05 * I})`); gg.addColorStop(0.9, `rgba(${c[0]},${c[1]},${c[2]},${0.09 * I})`); gg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(x, y, rr, 0, 6.283); ctx.fill();
    });
  }
  ctx.restore();
}

function drawMontage(sh, t) {
  const n = sh.images.length; const d = (sh.t1 - sh.t0) / n; const i = Math.min(n - 1, Math.floor((t - sh.t0) / d)); const u = (t - sh.t0 - i * d) / d;
  const it = sh.images[i]; const im = images.get(it.src);
  const base = Math.max(W / im.width, H / im.height);
  const z = base * lerp(1.1, 1.2, u) * (sh.night ? 1.04 : 1);
  const dx = (i % 2 ? -1 : 1) * lerp(-18, 18, u) * (W / 1920);
  const fx = it.fx * im.width, fy = it.fy * im.height;
  ctx.save();
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  ctx.filter = sh.night ? 'contrast(1.12) saturate(1.2) brightness(1.02)' : 'contrast(1.1) saturate(1.12)';
  ctx.drawImage(im, W / 2 - fx * z + dx, H / 2 - fy * z, im.width * z, im.height * z);
  ctx.filter = 'none';
  // punch-in flash on each cut
  const cutA = (1 - smooth(0, 0.18, u)) * 0.22; if (cutA > 0.003) { ctx.fillStyle = `rgba(255,255,255,${cutA})`; ctx.fillRect(0, 0, W, H); }
  ctx.restore();
  // captions
  if (it.label) {
    const a = smooth(0.02, 0.18, u) * (1 - smooth(0.88, 1, u));
    const S = H / 1080;
    ctx.save(); ctx.globalAlpha = a; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.font = `${Math.round(46 * S)}px Archivo`; ctx.letterSpacing = `${Math.round(10 * S)}px`;
    ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 18 * S; ctx.fillStyle = '#f4f1ea';
    const x = 110 * S + lerp(0, 22, u) * S; const y = H - BAR - 70 * S;
    ctx.fillText(it.label, x, y);
    ctx.fillStyle = '#7fd8e6'; ctx.fillRect(x, y + 20 * S, 60 * S, 4 * S);
    ctx.restore();
  }
  const S = H / 1080;
  ctx.save(); ctx.globalAlpha = 0.7; ctx.font = `${Math.round(15 * S)}px "DejaVu Sans Mono"`; ctx.letterSpacing = `${Math.round(4 * S)}px`; ctx.fillStyle = '#f4f1ea'; ctx.textAlign = 'right';
  ctx.fillText('IN-GAME CAPTURE', W - 110 * S, BAR + 44 * S); ctx.restore();
}

function drawText(tx, t) {
  if (t < tx.t0 || t > tx.t1) return;
  const S = H / 1080; const u = (t - tx.t0) / (tx.t1 - tx.t0);
  const aIn = smooth(tx.t0, tx.t0 + 0.45, t), aOut = 1 - smooth(tx.t1 - 0.4, tx.t1, t);
  const a = aIn * aOut; if (a <= 0.001) return;
  const size = (tx.size || 60) * S;
  ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `${Math.round(size)}px Archivo`;
  ctx.letterSpacing = `${(0.14 + 0.08 * u) * size}px`;
  const blur = (1 - aIn) * 10 * S;
  const lh = size * 1.35; const y0 = H / 2 - (tx.lines.length - 1) * lh / 2 + (tx.dy || 0) * S;
  tx.lines.forEach((line, i) => {
    const y = y0 + i * lh;
    ctx.globalAlpha = a;
    ctx.filter = blur > 0.2 ? `blur(${blur.toFixed(1)}px)` : 'none';
    ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 24 * S; ctx.fillStyle = '#f4f1ea';
    ctx.fillText(line, W / 2, y);
    ctx.shadowColor = 'rgba(160,220,255,0.35)'; ctx.shadowBlur = 30 * S; ctx.globalAlpha = a * 0.5; ctx.fillText(line, W / 2, y);
  });
  ctx.restore();
}

function drawStamp(st, t) {
  if (t < st.t0 || t > st.t1) return;
  const S = H / 1080; const a = smooth(st.t0, st.t0 + 0.3, t) * (1 - smooth(st.t1 - 0.3, st.t1, t));
  const n = Math.floor(clamp((t - st.t0) / 0.9) * st.text.length); // typewriter
  ctx.save(); ctx.globalAlpha = a * 0.85; ctx.font = `${Math.round(17 * S)}px "DejaVu Sans Mono"`; ctx.letterSpacing = `${Math.round(3 * S)}px`;
  ctx.fillStyle = '#7fd8e6'; ctx.fillRect(110 * S, H - BAR - 58 * S, 4 * S, 22 * S);
  ctx.fillStyle = '#f4f1ea'; ctx.textBaseline = 'middle'; ctx.fillText(st.text.slice(0, n), 128 * S, H - BAR - 47 * S);
  ctx.restore();
}

function finishing(t, sh) {
  // flashes on hits
  for (const f of TL.flashes) { const d = t - f.t; if (d >= 0 && d < 0.5) { ctx.fillStyle = `rgba(255,250,240,${f.a * Math.exp(-d * 9)})`; ctx.fillRect(0, 0, W, H); } }
  // shot fades
  if (sh.fadeIn) { const a = 1 - smooth(sh.t0, sh.t0 + sh.fadeIn, t); if (a > 0) { ctx.fillStyle = `rgba(0,0,0,${a})`; ctx.fillRect(0, 0, W, H); } }
  if (sh.flashIn) { const a = 1 - smooth(sh.t0, sh.t0 + sh.flashIn, t); if (a > 0) { ctx.fillStyle = `rgba(255,252,245,${a * 0.9})`; ctx.fillRect(0, 0, W, H); } }
  // grain + vignette
  ctx.save(); ctx.globalCompositeOperation = 'overlay'; ctx.globalAlpha = 0.09; ctx.imageSmoothingEnabled = true;
  const gi = Math.floor(t * FPS) % grains.length; ctx.drawImage(grains[gi], 0, 0, W, H); ctx.restore();
  ctx.drawImage(vignette, 0, 0);
  // letterbox
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, BAR); ctx.fillRect(0, H - BAR, W, BAR);
}

async function renderFrame(i, { quality = 0.94 } = {}) {
  const t = i / FPS; const sh = shotAt(t);
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  if (sh.scene === 'montage') drawMontage(sh, t);
  else if (sh.scene !== 'black') drawGL(sh, t);
  for (const st of TL.stamps || []) drawStamp(st, t);
  for (const tx of TL.texts) drawText(tx, t);
  if (sh.scene === 'sky' && sh.id === 'logo' && scenes.sky.logo) scenes.sky.logo(ctx, t - sh.t0, { W, H, BAR });
  finishing(t, sh);
  return out.toDataURL('image/jpeg', quality);
}

window.T = { renderFrame, TL, W, H, FPS, frames: Math.round(TL.duration * FPS), renderer, composer, scenes, grade, bloom, glc, THREE };
window.ready = true;
