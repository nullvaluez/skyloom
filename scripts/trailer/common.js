// Skyloom trailer — shared helpers: math, paths, sky shader, the Vector
// fighter rig (the game's house jet, public/models/player-jet.glb), ribbons.
import * as THREE from 'three';

export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
export const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOut = (t) => 1 - Math.pow(1 - clamp(t), 3);
export const easeIn = (t) => Math.pow(clamp(t), 3);
export const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
export function noise1(x) { const i = Math.floor(x); const f = x - i; const u = f * f * (3 - 2 * f); return lerp(hash(i), hash(i + 1), u) * 2 - 1; }
export function fbm1(x, o = 3) { let v = 0, a = 0.5, f = 1; for (let i = 0; i < o; i++) { v += a * noise1(x * f + i * 17.3); a *= 0.5; f *= 2.1; } return v; }
export function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ---- time-keyed Catmull-Rom path (non-uniform knots, C1) -------------------
export class Path {
  constructor(keys) { this.k = keys.map(([t, x, y, z]) => ({ t, p: new THREE.Vector3(x, y, z) })); this.m = this.k.map((_, i) => this._tan(i)); }
  _tan(i) {
    const k = this.k; const n = k.length;
    const a = k[Math.max(0, i - 1)], b = k[Math.min(n - 1, i + 1)];
    return b.p.clone().sub(a.p).divideScalar(Math.max(1e-6, b.t - a.t));
  }
  pos(t, out = new THREE.Vector3()) {
    const k = this.k; const n = k.length;
    if (t <= k[0].t) return out.copy(k[0].p).addScaledVector(this.m[0], t - k[0].t);
    if (t >= k[n - 1].t) return out.copy(k[n - 1].p).addScaledVector(this.m[n - 1], t - k[n - 1].t);
    let i = 0; while (i < n - 2 && t > k[i + 1].t) i++;
    const a = k[i], b = k[i + 1]; const h = b.t - a.t; const s = (t - a.t) / h;
    const s2 = s * s, s3 = s2 * s;
    const h00 = 2 * s3 - 3 * s2 + 1, h10 = s3 - 2 * s2 + s, h01 = -2 * s3 + 3 * s2, h11 = s3 - s2;
    return out.set(0, 0, 0).addScaledVector(a.p, h00).addScaledVector(this.m[i], h10 * h).addScaledVector(b.p, h01).addScaledVector(this.m[i + 1], h11 * h);
  }
  vel(t, out = new THREE.Vector3()) { const e = 0.02; return out.copy(this.pos(t + e, _v1)).sub(this.pos(t - e, _v2)).divideScalar(2 * e); }
  acc(t, out = new THREE.Vector3()) { const e = 0.06; const a = this.pos(t + e, _v1); const b = this.pos(t, _v2); const c = this.pos(t - e, _v3); return out.copy(a).add(c).addScaledVector(b, -2).divideScalar(e * e); }
}
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();

// Coordinated-turn pose: nose along velocity, bank from lateral accel.
export function pathPose(path, t, opt = {}) {
  const p = path.pos(t, new THREE.Vector3());
  const fwd = path.vel(t, new THREE.Vector3()).normalize();
  const a = path.acc(t, new THREE.Vector3());
  const wup = new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3().crossVectors(fwd, wup).normalize();
  const up0 = new THREE.Vector3().crossVectors(right, fwd).normalize();
  const bankG = opt.bankGain ?? 1;
  let bank = Math.atan2(a.dot(right), 9.81 + a.dot(wup)) * bankG;
  bank = clamp(bank, -(opt.maxBank ?? 1.45), opt.maxBank ?? 1.45) + (opt.roll ? opt.roll(t) : 0);
  const up = up0.clone().multiplyScalar(Math.cos(bank)).addScaledVector(right, Math.sin(bank));
  const x = new THREE.Vector3().crossVectors(up, fwd).normalize();
  const m = new THREE.Matrix4().makeBasis(x, up, fwd);
  if (opt.pitch) { m.multiply(new THREE.Matrix4().makeRotationX(-opt.pitch(t))); }
  const q = new THREE.Quaternion().setFromRotationMatrix(m);
  return { p, q, fwd, up, g: a.length() / 9.81, bank };
}

export function aim(cam, pos, target, roll = 0, fov) {
  cam.position.copy(pos); cam.up.set(0, 1, 0); cam.lookAt(target);
  if (roll) cam.rotateZ(roll);
  if (fov && cam.fov !== fov) { cam.fov = fov; }
  cam.updateProjectionMatrix();
}
export function shake(cam, t, amp, freq = 9) {
  if (!amp) return;
  cam.rotateX(fbm1(t * freq + 3.1) * amp); cam.rotateY(fbm1(t * freq + 71.3) * amp); cam.rotateZ(fbm1(t * freq * 0.7 + 19.7) * amp * 0.6);
}

// ---- GLSL: shared analytic sky so fog == sky exactly -----------------------
export const SKY_GLSL = /* glsl */ `
uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uBelow; uniform vec3 uSunGlow;
uniform vec3 uSunDir; uniform float uGlow; uniform float uDisk; uniform float uStars; uniform float uTime;
float h21(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
vec3 skyColor(vec3 dir, bool withDisk){
  float h = dir.y;
  float s = max(dot(dir, uSunDir), 0.0);
  vec3 hor = mix(uHorizon, uSunGlow, pow(s, 4.0) * 0.55 * uGlow);
  vec3 col = mix(hor, uZenith, pow(smoothstep(-0.01, 0.55, h), 0.55));
  col = mix(col, uBelow, smoothstep(0.0, -0.25, h));
  col += uSunGlow * (pow(s, 14.0) * 0.55 + pow(s, 120.0) * 1.6) * uGlow;
  if (withDisk) col += uSunGlow * 30.0 * smoothstep(0.99955, 0.99985, s) * uDisk;
  if (uStars > 0.0 && h > 0.0) {
    vec3 d = dir / max(max(abs(dir.x), abs(dir.y)), abs(dir.z));
    vec2 g = (abs(dir.y) > 0.6 ? d.xz : (abs(dir.x) > abs(dir.z) ? d.yz : d.xy)) * 380.0;
    vec2 c = floor(g); vec2 f = fract(g) - 0.5;
    float r = h21(c);
    float star = step(0.985, r) * smoothstep(0.32, 0.0, length(f + (vec2(h21(c+1.3), h21(c+7.1)) - 0.5) * 0.5));
    float tw = 0.75 + 0.25 * sin(uTime * (2.0 + r * 5.0) + r * 40.0);
    col += vec3(0.8, 0.88, 1.0) * star * uStars * tw * smoothstep(0.0, 0.25, h) * (0.4 + 3.0 * pow(h21(c+3.3), 6.0));
  }
  return col;
}
`;

const col3 = (v) => (Array.isArray(v) ? new THREE.Color().setRGB(...v) : new THREE.Color(v));
export function skyUniforms(p) {
  return {
    uZenith: { value: col3(p.zenith) }, uHorizon: { value: col3(p.horizon) },
    uBelow: { value: col3(p.below ?? p.horizon) }, uSunGlow: { value: col3(p.sunGlow) },
    uSunDir: { value: new THREE.Vector3(...p.sunDir).normalize() }, uGlow: { value: p.glow ?? 1 },
    uDisk: { value: p.disk ?? 1 }, uStars: { value: p.stars ?? 0 }, uTime: { value: 0 },
  };
}

export function makeSkyDome(uniforms) {
  const m = new THREE.ShaderMaterial({
    uniforms, side: THREE.BackSide, depthWrite: false, depthTest: false,
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize((modelMatrix*vec4(position,0.0)).xyz); vec4 p = projectionMatrix*viewMatrix*vec4(cameraPosition + (modelMatrix*vec4(position,0.0)).xyz, 1.0); gl_Position = p.xyww; }`,
    fragmentShader: `${SKY_GLSL} varying vec3 vDir; void main(){ gl_FragColor = vec4(skyColor(normalize(vDir), true), 1.0); }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1000, 48, 24), m);
  mesh.frustumCulled = false; mesh.renderOrder = -1000;
  return mesh;
}

export const NOISE_GLSL = /* glsl */ `
float hn(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
  return mix(mix(hn(i),hn(i+vec2(1,0)),u.x), mix(hn(i+vec2(0,1)),hn(i+vec2(1,1)),u.x), u.y); }
float fbm(vec2 p){ float v=0.0, a=0.5; mat2 r=mat2(0.8,-0.6,0.6,0.8); for(int i=0;i<6;i++){ v+=a*vnoise(p); p=r*p*2.03+11.7; a*=0.5; } return v; }
float fbm3(vec2 p){ float v=0.0, a=0.5; mat2 r=mat2(0.8,-0.6,0.6,0.8); for(int i=0;i<3;i++){ v+=a*vnoise(p); p=r*p*2.03+11.7; a*=0.5; } return v; }
`;

// ---- glow sprite texture ----------------------------------------------------
let _glowTex = null;
export function glowTexture() {
  if (_glowTex) return _glowTex;
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.15, 'rgba(255,255,255,0.7)'); r.addColorStop(0.4, 'rgba(255,255,255,0.18)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 128, 128);
  _glowTex = new THREE.CanvasTexture(c); _glowTex.colorSpace = THREE.SRGBColorSpace; return _glowTex;
}
export function glowSprite(color, scale, intensity = 1) {
  const m = new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color(color).multiplyScalar(intensity), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false });
  const s = new THREE.Sprite(m); s.scale.setScalar(scale); return s;
}

// ---- camera-facing ribbon (vapor, contrails, light trails) ----------------
export class Ribbon {
  constructor(n, { color = 0xffffff, additive = false, opacity = 1 } = {}) {
    this.n = n;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(n * 2 * 3); this.a = new Float32Array(n * 2); this.u = new Float32Array(n * 2);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3)); g.setAttribute('alpha', new THREE.BufferAttribute(this.a, 1)); g.setAttribute('side', new THREE.BufferAttribute(this.u, 1));
    const idx = []; for (let i = 0; i < n - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } g.setIndex(idx);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity } },
      vertexShader: `attribute float alpha; attribute float side; varying float vA; varying float vS; void main(){ vA=alpha; vS=side; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 uColor; uniform float uOpacity; varying float vA; varying float vS; void main(){ float e = 1.0 - pow(abs(vS), 2.0); gl_FragColor = vec4(uColor, vA * e * uOpacity); }`,
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mesh = new THREE.Mesh(g, this.mat); this.mesh.frustumCulled = false; this.g = g;
  }
  // pts: array of Vector3 (newest first); widthFn(i,f), alphaFn(i,f) with f=i/(n-1)
  update(pts, camPos, widthFn, alphaFn) {
    const n = Math.min(this.n, pts.length); const T = new THREE.Vector3(), V = new THREE.Vector3(), S = new THREE.Vector3();
    for (let i = 0; i < this.n; i++) {
      const j = Math.min(i, n - 1); const p = pts[j];
      const pa = pts[Math.max(0, j - 1)], pb = pts[Math.min(n - 1, j + 1)];
      T.subVectors(pb, pa); if (T.lengthSq() < 1e-8) T.set(0, 0, 1); T.normalize();
      V.subVectors(camPos, p).normalize(); S.crossVectors(T, V); if (S.lengthSq() < 1e-8) S.set(0, 1, 0); S.normalize();
      const f = i / (this.n - 1); const w = i < n ? widthFn(i, f) : 0; const al = i < n ? alphaFn(i, f) : 0;
      this.pos.set([p.x + S.x * w, p.y + S.y * w, p.z + S.z * w], i * 6); this.pos.set([p.x - S.x * w, p.y - S.y * w, p.z - S.z * w], i * 6 + 3);
      this.a[i * 2] = al; this.a[i * 2 + 1] = al; this.u[i * 2] = 1; this.u[i * 2 + 1] = -1;
    }
    this.g.attributes.position.needsUpdate = true; this.g.attributes.alpha.needsUpdate = true; this.g.attributes.side.needsUpdate = true;
  }
}

// ---- the Vector fighter -----------------------------------------------------
// Raw GLB (normalised to 20 m): nose +Z, tail nozzles at (±1.28, -0.8, -9.45),
// wingtips at x = ±9, z ≈ -5..-9. Left wing is +X.
export const JET = { nozzles: [[1.28, -0.8, -9.5], [-1.28, -0.8, -9.5]], tipL: [8.95, -0.25, -8.4], tipR: [-8.95, -0.25, -8.4] };

export function buildJet(gltf, env, { canopyTint = 0x7fd8e6 } = {}) {
  const root = new THREE.Group();
  const model = gltf.scene.clone(true);
  const b = new THREE.Box3().setFromObject(model); const sz = b.getSize(new THREE.Vector3()); const c = b.getCenter(new THREE.Vector3());
  const k = 20 / Math.max(sz.x, sz.y, sz.z);
  model.scale.setScalar(k); model.position.copy(c).multiplyScalar(-k);
  model.traverse((o) => {
    if (!o.isMesh) return;
    const name = o.material.name; const col = o.material.color.clone();
    if (name === '80DEEA') {
      o.material = new THREE.MeshPhysicalMaterial({ color: canopyTint, metalness: 0.6, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.02, envMap: env, envMapIntensity: 1.6, flatShading: true });
    } else {
      o.material = new THREE.MeshPhysicalMaterial({ color: col, metalness: name === '1A1A1A' ? 0.6 : 0.42, roughness: name === '1A1A1A' ? 0.5 : 0.34, clearcoat: 0.7, clearcoatRoughness: 0.18, envMap: env, envMapIntensity: 1.1, flatShading: true });
    }
  });
  root.add(model);

  // afterburners
  const burners = [];
  const coneGeo = new THREE.CylinderGeometry(0.62, 0.08, 1, 24, 1, true); coneGeo.translate(0, -0.5, 0); coneGeo.rotateX(-Math.PI / 2); // extends toward -Z
  for (const [x, y, z] of JET.nozzles) {
    const mat = new THREE.ShaderMaterial({
      uniforms: { uT: { value: 0 }, uI: { value: 1 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      vertexShader: `varying vec3 vN; varying vec3 vV; varying float vZ; void main(){ vZ = -position.z; vec4 mv = modelViewMatrix*vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`,
      fragmentShader: `uniform float uT; uniform float uI; varying vec3 vN; varying vec3 vV; varying float vZ;
        void main(){ float f = pow(abs(dot(normalize(vN), normalize(vV))), 1.4);
          float z = clamp(vZ, 0.0, 1.0);
          float diamonds = 0.65 + 0.35 * cos(z * 34.0 - uT * 50.0);
          vec3 core = mix(vec3(0.75,0.85,1.0), vec3(1.0,0.55,0.18), smoothstep(0.05, 0.45, z));
          vec3 col = core * (1.0 - smoothstep(0.35, 1.0, z)) * diamonds * f * uI * 3.2;
          gl_FragColor = vec4(col, 1.0); }`,
    });
    const cone = new THREE.Mesh(coneGeo, mat); cone.position.set(x, y, z); cone.frustumCulled = false; root.add(cone);
    const glow = glowSprite(0xff8a3a, 5, 1.2); glow.position.set(x, y, z - 0.6); root.add(glow);
    const hot = glowSprite(0xbfd8ff, 1.5, 1.6); hot.position.set(x, y, z - 0.1); root.add(hot);
    burners.push({ cone, mat, glow, hot });
  }
  // nav lights + strobes
  const red = glowSprite(0xff2a2a, 1.3, 1.6); red.position.set(JET.tipL[0], JET.tipL[1] + 0.1, -6.8); root.add(red);
  const green = glowSprite(0x2aff6a, 1.3, 1.6); green.position.set(JET.tipR[0], JET.tipR[1] + 0.1, -6.8); root.add(green);
  const strobeL = glowSprite(0xffffff, 2.6, 2.2); strobeL.position.set(JET.tipL[0], JET.tipL[1], -8.6); root.add(strobeL);
  const strobeR = glowSprite(0xffffff, 2.6, 2.2); strobeR.position.set(JET.tipR[0], JET.tipR[1], -8.6); root.add(strobeR);

  const rig = {
    root, model, burners, nav: [red, green], strobes: [strobeL, strobeR],
    set(t, { throttle = 1, nav = 1, strobe = 1, burnerScale = 1 } = {}) {
      for (const b of burners) {
        const flick = 0.9 + 0.1 * Math.sin(t * 91 + b.cone.position.x * 7) + 0.06 * Math.sin(t * 57.3);
        const L = (2.2 + 7.5 * throttle) * flick * burnerScale;
        b.cone.scale.set(1, 1, L); b.mat.uniforms.uT.value = t; b.mat.uniforms.uI.value = throttle * flick;
        b.cone.visible = throttle > 0.02;
        b.glow.material.opacity = clamp(throttle * 0.9) * flick; b.glow.scale.setScalar((2 + 3.2 * throttle) * burnerScale);
        b.hot.material.opacity = clamp(throttle * 1.4);
      }
      for (const s of rig.nav) s.material.opacity = nav;
      const ph = (t % 1.2) / 1.2; const fl = (ph < 0.04 || (ph > 0.12 && ph < 0.16)) ? 1 : 0;
      for (const s of rig.strobes) s.material.opacity = fl * strobe;
    },
    world(local, out = new THREE.Vector3()) { return out.set(...local).applyMatrix4(root.matrixWorld); },
  };
  return rig;
}

export function placeRig(rig, pose) { rig.root.position.copy(pose.p); rig.root.quaternion.copy(pose.q); rig.root.updateMatrixWorld(true); }

// Past positions of a local point on a posed-by-path object (for trails).
export function trailPoints(n, dt, t, poseAt, local) {
  const pts = []; const v = new THREE.Vector3(...local); const m = new THREE.Matrix4(); const s = new THREE.Vector3(1, 1, 1);
  for (let i = 0; i < n; i++) {
    const pose = poseAt(t - i * dt);
    m.compose(pose.p, pose.q, s);
    pts.push(v.clone().applyMatrix4(m));
  }
  return pts;
}

// Standard PBR lighting for a scene.
export function addLights(scene, { sunDir, sunColor, sunI, hemiSky, hemiGround, hemiI }) {
  const d = new THREE.DirectionalLight(sunColor, sunI); d.position.set(...sunDir).normalize().multiplyScalar(1000); scene.add(d); scene.add(d.target);
  const h = new THREE.HemisphereLight(hemiSky, hemiGround, hemiI); scene.add(h);
  return { d, h };
}

// Make a model's meshes use nice physical materials, keeping vertex colors/albedo.
export function regrade(obj, env, opts = {}) {
  obj.traverse((o) => {
    if (!o.isMesh) return;
    const src = o.material; const vc = !!o.geometry.attributes.color;
    o.material = new THREE.MeshStandardMaterial({ color: src.color ? src.color.clone() : 0xffffff, map: src.map || null, vertexColors: vc, metalness: opts.metalness ?? 0.1, roughness: opts.roughness ?? 0.7, envMap: env, envMapIntensity: opts.envI ?? 0.8, emissive: opts.emissive ?? 0x000000, emissiveIntensity: opts.emissiveI ?? 1, flatShading: opts.flat ?? false });
  });
}

export function normalizeToHeight(obj, h) {
  const b = new THREE.Box3().setFromObject(obj); const sz = b.getSize(new THREE.Vector3());
  const k = h / sz.y; obj.scale.multiplyScalar(k);
  const b2 = new THREE.Box3().setFromObject(obj); const c = b2.getCenter(new THREE.Vector3());
  obj.position.x -= c.x; obj.position.z -= c.z; obj.position.y -= b2.min.y;
  const wrap = new THREE.Group(); wrap.add(obj); return wrap;
}

// ---- instanced city blocks with facade windows (day glass / night lights) --
export function makeCityMaterial(skyU, { night = 0, fogDen = 6e-5, sunCol = [1, 0.8, 0.6], amb = [0.25, 0.28, 0.35], winCol = [1.0, 0.72, 0.4] } = {}) {
  const uniforms = { ...skyU, uNight: { value: night }, uFogDen: { value: fogDen }, uSunCol: { value: new THREE.Color(...sunCol) }, uAmb: { value: new THREE.Color(...amb) }, uWinCol: { value: new THREE.Color(...winCol) } };
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: `varying vec3 vW; varying vec3 vN; varying vec3 vC; varying float vSeed;
      void main(){ mat4 m = modelMatrix * instanceMatrix; vec4 w = m * vec4(position,1.0); vW = w.xyz; vN = normalize(mat3(m) * normal);
        #ifdef USE_INSTANCING_COLOR
        vC = instanceColor;
        #else
        vC = vec3(0.5);
        #endif
        vSeed = float(gl_InstanceID); gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `${SKY_GLSL}
      float hq(vec2 p){ p = fract(p*vec2(233.34,851.73)); p += dot(p,p+23.45); return fract(p.x*p.y); }
      uniform float uNight; uniform float uFogDen; uniform vec3 uSunCol; uniform vec3 uAmb; uniform vec3 uWinCol;
      varying vec3 vW; varying vec3 vN; varying vec3 vC; varying float vSeed;
      void main(){
        vec3 n = normalize(vN); float side = 1.0 - step(0.5, abs(n.y));
        float u = abs(n.x) > 0.5 ? vW.z : vW.x;
        vec2 g = vec2(u / 4.4, vW.y / 3.9);
        vec2 cell = floor(g); vec2 f = fract(g);
        vec2 fw = fwidth(g);
        vec2 aa = clamp(fw * 1.5, 0.02, 0.5);
        float wx = smoothstep(0.16 - aa.x, 0.16 + aa.x, f.x) * (1.0 - smoothstep(0.84 - aa.x, 0.84 + aa.x, f.x));
        float wy = smoothstep(0.2 - aa.y, 0.2 + aa.y, f.y) * (1.0 - smoothstep(0.8 - aa.y, 0.8 + aa.y, f.y));
        float far = smoothstep(0.35, 0.9, max(fw.x, fw.y));
        float win = mix(wx * wy, 0.4, far) * side * step(3.0, vW.y);
        float r = hq(cell + vec2(vSeed * 0.137, vSeed * 0.071));
        vec3 base = vC;
        float ndl = max(dot(n, uSunDir), 0.0);
        vec3 V = normalize(vW - cameraPosition);
        vec3 lit = base * (uSunCol * ndl + uAmb * (0.55 + 0.45 * n.y));
        vec3 R = reflect(V, n); R.y = abs(R.y);
        vec3 refl = skyColor(R, false);
        float fres = 0.08 + 0.6 * pow(1.0 - max(dot(-V, n), 0.0), 4.0);
        vec3 glass = base * 0.08 + refl * (fres + 0.2) + uSunCol * pow(max(dot(R, uSunDir), 0.0), 300.0) * 4.0 * (1.0 - uNight);
        vec3 col = mix(lit, glass, win * 0.8 * (1.0 - uNight * 0.85));
        float onK = mix(0.12, 0.34, uNight);
        float on = mix(step(1.0 - onK, r), onK, far);
        col += win * on * uWinCol * (0.55 + 0.9 * hq(cell * 1.7 + 3.1)) * mix(0.5, 1.2, uNight);
        // roof lights / aviation reds at night
        col = mix(col, col * 0.6, (1.0 - side) * uNight);
        float d = length(vW - cameraPosition);
        float fog = 1.0 - exp(-d * uFogDen);
        col = mix(col, skyColor(normalize(vec3(V.x, 0.0, V.z)), false), fog);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}

// Box buildings from a list of {x,z,w,d,h,rot,color}
export function makeCity(list, mat) {
  const g = new THREE.BoxGeometry(1, 1, 1); g.translate(0, 0.5, 0);
  const mesh = new THREE.InstancedMesh(g, mat, list.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color(), Y = new THREE.Vector3(0, 1, 0);
  list.forEach((b, i) => { q.setFromAxisAngle(Y, b.rot || 0); s.set(b.w, b.h, b.d); p.set(b.x, b.y || 0, b.z); m.compose(p, q, s); mesh.setMatrixAt(i, m); c.setRGB(...b.color); mesh.setColorAt(i, c); });
  mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true; mesh.frustumCulled = false;
  return mesh;
}
