// Above the cloud deck: dawn glide, the Vector reveal, the live-traffic
// formation and the title card background.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import {
  SKY_GLSL, NOISE_GLSL, skyUniforms, makeSkyDome, buildJet, placeRig, pathPose, Path, Ribbon, trailPoints, JET,
  clamp, lerp, smooth, easeInOut, easeOut, rng, aim, shake, fbm1, glowSprite, smoother, FnPath,
} from './common.js';

const PRESETS = {
  dawn: {
    sky: { zenith: [0.035, 0.07, 0.18], horizon: [0.62, 0.34, 0.2], below: [0.3, 0.2, 0.2], sunGlow: [1.0, 0.52, 0.26], sunDir: [0.55, 0.06, -1], glow: 1.0, disk: 1 },
    lit: [1.05, 0.64, 0.4], shade: [0.3, 0.24, 0.3], gap: [0.1, 0.09, 0.13], fog: 2.3e-5,
    sun: [1.0, 0.7, 0.48], sunI: 2.6, hemi: [[0.35, 0.4, 0.6], [0.45, 0.28, 0.22], 0.7], env: 'dawn',
  },
  day: {
    sky: { zenith: [0.03, 0.09, 0.3], horizon: [0.34, 0.42, 0.55], below: [0.3, 0.34, 0.4], sunGlow: [0.9, 0.82, 0.7], sunDir: [0.75, 0.5, 0.25], glow: 0.55, disk: 1 },
    lit: [0.72, 0.72, 0.76], shade: [0.2, 0.24, 0.32], gap: [0.05, 0.09, 0.14], fog: 1.8e-5,
    sun: [1.0, 0.96, 0.9], sunI: 3.0, hemi: [[0.5, 0.6, 0.85], [0.6, 0.6, 0.62], 0.9], env: 'day',
  },
  night: {
    sky: { zenith: [0.0015, 0.003, 0.011], horizon: [0.035, 0.03, 0.06], below: [0.015, 0.015, 0.03], sunGlow: [0.35, 0.16, 0.1], sunDir: [-0.3, 0.55, -1], glow: 0.0, disk: 0, stars: 1.1 },
    lit: [0.09, 0.1, 0.15], shade: [0.02, 0.022, 0.04], gap: [0.004, 0.005, 0.01], fog: 3.0e-5,
    sun: [0.5, 0.6, 0.9], sunI: 0.5, hemi: [[0.08, 0.1, 0.22], [0.04, 0.03, 0.05], 0.45], env: 'dusk',
  },
};

async function loadEnv(renderer, file) {
  const tex = await new HDRLoader().loadAsync(file); tex.mapping = THREE.EquirectangularReflectionMapping;
  const pm = new THREE.PMREMGenerator(renderer); const env = pm.fromEquirectangular(tex).texture; tex.dispose(); pm.dispose(); return env;
}

export async function createSky(renderer) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.5, 250000);
  const envs = {
    dawn: await loadEnv(renderer, '/public/hdri/qwantani_dawn_puresky_1k.hdr'),
    day: await loadEnv(renderer, '/public/hdri/kloofendal_48d_partly_cloudy_puresky_2k.hdr'),
    dusk: await loadEnv(renderer, '/public/hdri/qwantani_night_puresky_1k.hdr'),
  };
  const gl = new GLTFLoader();
  const jetG = await gl.loadAsync('/public/models/player-jet.glb');
  const linerG = await gl.loadAsync('/public/models/traffic-airliner.glb');

  const U = skyUniforms(PRESETS.dawn.sky);
  const dome = makeSkyDome(U); scene.add(dome);

  // ---- cloud deck --------------------------------------------------------
  const deckU = { ...U, uLit: { value: new THREE.Color() }, uShade: { value: new THREE.Color() }, uGap: { value: new THREE.Color() }, uFogDen: { value: 4e-5 }, uOff: { value: new THREE.Vector2() }, uCover: { value: 0.3 } };
  const deck = new THREE.Mesh(new THREE.PlaneGeometry(400000, 400000, 1, 1).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
    uniforms: deckU, depthWrite: true,
    vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
    fragmentShader: `${SKY_GLSL} ${NOISE_GLSL}
      uniform vec3 uLit; uniform vec3 uShade; uniform vec3 uGap; uniform float uFogDen; uniform vec2 uOff; uniform float uCover; varying vec3 vW;
      float H(vec2 p){ vec2 q = vec2(fbm3(p*0.45 + uTime*0.004), fbm3(p*0.45 + 5.2 - uTime*0.003)); return fbm(p + q*1.6); }
      void main(){
        vec2 p = vW.xz * 0.00042 + uOff + uTime * vec2(0.0035, -0.0015);
        float dist0 = length(vW - cameraPosition);
        float h = H(p); float e = 0.035;
        float hx = H(p + vec2(e,0.0)), hz = H(p + vec2(0.0,e));
        vec3 n = normalize(vec3((h-hx)*15.0, 1.0, (h-hz)*15.0));
        vec3 V = normalize(vW - cameraPosition);
        float ndl = dot(n, uSunDir);
        float top = smoothstep(0.3, 0.8, h);
        vec3 col = mix(uShade, uLit, clamp(ndl*0.75 + 0.35, 0.0, 1.0)) * (0.7 + 0.45*top);
        float fine = fbm3(p * 9.0 + uTime * vec2(0.02, 0.01));
        col *= 1.0 + (fine - 0.5) * 0.55 * (1.0 - smoothstep(900.0, 7000.0, dist0));
        float fs = pow(max(dot(V, uSunDir), 0.0), 10.0);
        col += uSunGlow * fs * 0.35 * (1.0 - top);
        float cov = smoothstep(uCover - 0.04, uCover + 0.22, h);
        col = mix(uGap * (0.8 + 0.4*fbm3(p*6.0)), col, cov);
        float d = length(vW - cameraPosition);
        float fog = 1.0 - exp(-d * uFogDen);
        vec3 fc = skyColor(normalize(vec3(V.x, 0.0, V.z)), false);
        gl_FragColor = vec4(mix(col, fc, fog), 1.0);
      }`,
  }));
  scene.add(deck);

  // ---- cumulus towers: sphere-traced soft volumes ------------------------
  // Each instance is a sphere. A camera-facing quad just covers its silhouette;
  // the fragment intersects the view ray with the sphere, measures the chord
  // (thickness) and erodes it with 3D noise anchored in WORLD space, so the
  // detail parallaxes correctly, billows over time and never shows a quad edge.
  // Alpha fades softly where a cloud meets the deck (no hard intersection line).
  const MAXP = 1400;
  const pg = new THREE.InstancedBufferGeometry(); const quad = new THREE.PlaneGeometry(2, 2);
  pg.index = quad.index; pg.setAttribute('position', quad.getAttribute('position'));
  const iPos = new THREE.InstancedBufferAttribute(new Float32Array(MAXP * 3), 3);
  const iSize = new THREE.InstancedBufferAttribute(new Float32Array(MAXP), 1);
  const iSeed = new THREE.InstancedBufferAttribute(new Float32Array(MAXP), 1);
  const iDens = new THREE.InstancedBufferAttribute(new Float32Array(MAXP), 1);
  pg.setAttribute('iPos', iPos); pg.setAttribute('iSize', iSize); pg.setAttribute('iSeed', iSeed); pg.setAttribute('iDens', iDens);
  const puffU = { ...U, uLit: deckU.uLit, uShade: deckU.uShade, uFogDen: deckU.uFogDen, uOpacity: { value: 1 } };
  const puffs = new THREE.Mesh(pg, new THREE.ShaderMaterial({
    uniforms: puffU, transparent: true, depthWrite: false,
    vertexShader: `attribute vec3 iPos; attribute float iSize; attribute float iSeed; attribute float iDens;
      varying vec3 vWorld; varying vec3 vC; varying float vR; varying float vSeed; varying float vDens;
      void main(){
        vC = iPos; vR = iSize; vSeed = iSeed; vDens = iDens;
        vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        vec3 fwd = -vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
        float d = length(iPos - cameraPosition);
        if (d > iSize * 1.02) {
          float k = min(d / sqrt(d*d - iSize*iSize), 3.0) * 1.04;
          vWorld = iPos + (right * position.x + up * position.y) * iSize * k;
        } else {
          vWorld = cameraPosition + fwd + (right * position.x + up * position.y) * 6.0;
        }
        gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
      }`,
    fragmentShader: `${SKY_GLSL}
      uniform vec3 uLit; uniform vec3 uShade; uniform float uFogDen; uniform float uOpacity;
      varying vec3 vWorld; varying vec3 vC; varying float vR; varying float vSeed; varying float vDens;
      float h31(vec3 p){ p = fract(p*0.3183099 + 0.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
      float vn3(vec3 x){ vec3 i = floor(x), f = fract(x); f = f*f*(3.0-2.0*f);
        return mix(mix(mix(h31(i), h31(i+vec3(1,0,0)), f.x), mix(h31(i+vec3(0,1,0)), h31(i+vec3(1,1,0)), f.x), f.y),
                   mix(mix(h31(i+vec3(0,0,1)), h31(i+vec3(1,0,1)), f.x), mix(h31(i+vec3(0,1,1)), h31(i+vec3(1,1,1)), f.x), f.y), f.z); }
      float fbm3d(vec3 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a*vn3(p); p = p*2.03 + vec3(3.1,1.7,5.3); a *= 0.5; } return v; }
      void main(){
        vec3 ro = cameraPosition; vec3 rd = normalize(vWorld - ro);
        vec3 oc = ro - vC; float b = dot(oc, rd); float c = dot(oc, oc) - vR*vR; float h = b*b - c;
        if (h <= 0.0) discard;
        h = sqrt(h); float tN = max(-b - h, 0.0); float tF = -b + h;
        if (tF <= 0.0) discard;
        // short raymarch through the sphere: lumpy, eroded cumulus density
        const int STEPS = 7;
        float dt = (tF - tN) / float(STEPS);
        vec3 seedv = vec3(vSeed*3.1, vSeed*1.7, vSeed*2.3) + vec3(0.035, 0.07, 0.02) * uTime;
        float T = 1.0; vec3 acc = vec3(0.0);
        float dc = length(vC - ro);
        float near = mix(0.3, 1.0, smoothstep(vR*0.4, vR*1.3, dc));
        for (int i = 0; i < STEPS; i++) {
          vec3 p = ro + rd * (tN + (float(i) + 0.5) * dt);
          vec3 q = (p - vC) / vR;
          float r = length(q);
          float n = fbm3d(q * 2.1 + seedv);
          float d = (1.0 - r) * 2.0 - 0.18 + (n - 0.5) * 1.9;
          d *= smoothstep(1.0, 0.78, r);
          d *= smoothstep(-0.75, -0.3, q.y + (n - 0.5) * 0.4);
          d *= smoothstep(0.0, 70.0, p.y);
          d = max(d, 0.0) * vDens * near;
          if (d <= 0.0) continue;
          float sigma = d * dt / vR * 5.5;
          float lit = clamp(0.5 + 0.62 * dot(q, uSunDir) + (n - 0.5) * 1.1, 0.0, 1.0);
          float hgt = smoothstep(-0.9, 0.9, q.y);
          vec3 c = mix(uShade, uLit, clamp(lit * 0.7 + hgt * 0.3, 0.0, 1.0));
          float ab = 1.0 - exp(-sigma);
          acc += T * ab * c; T *= 1.0 - ab;
          if (T < 0.02) break;
        }
        float a = 1.0 - T;
        if (a < 0.004) discard;
        vec3 col = acc / a;
        float fs = pow(max(dot(rd, uSunDir), 0.0), 6.0);
        col += uSunGlow * fs * (1.0 - a) * 1.6;
        float fog = 1.0 - exp(-length(ro + rd * tN - ro) * uFogDen);
        col = mix(col, skyColor(normalize(vec3(rd.x, 0.0, rd.z)), false), fog);
        gl_FragColor = vec4(col, a * uOpacity);
      }`,
  }));
  puffs.frustumCulled = false; scene.add(puffs);
  let puffList = [];
  let wind = new THREE.Vector3();
  // A cumulus tower = a vertical stack of shrinking spheres + a few side lobes.
  function tower(r, x, z, y0, R, dens = 1) {
    const stack = 1 + Math.floor(r() * 3);
    for (let k = 0; k < stack; k++) {
      const rk = R * (1 - k * 0.2);
      puffList.push({ p: new THREE.Vector3(x + (r() - 0.5) * R * 0.5, y0 + R * 0.5 + k * R * 0.62, z + (r() - 0.5) * R * 0.5), s: rk, seed: r() * 10, dens });
    }
    const lobes = 2 + Math.floor(r() * 3);
    for (let k = 0; k < lobes; k++) {
      const a = r() * Math.PI * 2, rr = R * (0.45 + r() * 0.25);
      puffList.push({ p: new THREE.Vector3(x + Math.cos(a) * R * 0.75, y0 + rr * 0.55 + r() * R * 0.3, z + Math.sin(a) * R * 0.75), s: rr, seed: r() * 10, dens });
    }
  }
  function layoutPuffs(seed, region) {
    const r = rng(seed); puffList = [];
    for (const g of region) {
      for (let i = 0; i < g.n; i++) {
        let x = lerp(g.x[0], g.x[1], r());
        if (g.clearX && Math.abs(x) < g.clearX) x = Math.sign(x || 1) * (g.clearX + r() * 200);
        const z = lerp(g.z[0], g.z[1], r());
        const R = g.size[0] + (g.size[1] - g.size[0]) * Math.pow(r(), 2);
        tower(r, x, z, g.y, R, g.dens ?? 1);
      }
    }
  }
  function uploadPuffs(camPos, t) {
    const off = wind.clone().multiplyScalar(t);
    const list = puffList.map((p) => { const q = p.p.clone().add(off); return { ...p, q, d: q.distanceToSquared(camPos) }; }).sort((a, b) => b.d - a.d).slice(-MAXP);
    list.forEach((p, i) => { iPos.setXYZ(i, p.q.x, p.q.y, p.q.z); iSize.setX(i, p.s); iSeed.setX(i, p.seed); iDens.setX(i, p.dens ?? 1); });
    pg.instanceCount = list.length; iPos.needsUpdate = true; iSize.needsUpdate = true; iSeed.needsUpdate = true; iDens.needsUpdate = true;
  }

  // ---- lights + actors ---------------------------------------------------
  const sun = new THREE.DirectionalLight(0xffffff, 3); scene.add(sun); scene.add(sun.target);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x888888, 1); scene.add(hemi);
  const jet = buildJet(jetG, envs.dawn); scene.add(jet.root);
  const liner = new THREE.Group();
  {
    const m = linerG.scene.clone(true); const b = new THREE.Box3().setFromObject(m); const sz = b.getSize(new THREE.Vector3()); const c = b.getCenter(new THREE.Vector3());
    const k = 57 / Math.max(sz.x, sz.y, sz.z); m.scale.setScalar(k); m.position.copy(c).multiplyScalar(-k);
    m.traverse((o) => { if (o.isMesh) { const src = o.material; o.material = new THREE.MeshPhysicalMaterial({ color: src.color, map: src.map, vertexColors: !!o.geometry.attributes.color, metalness: 0.3, roughness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.2, envMapIntensity: 1.0, flatShading: true }); } });
    liner.add(m); liner.userData.size = sz.clone().multiplyScalar(k);
  }
  scene.add(liner);
  const vapL = new Ribbon(60, { color: 0xffffff, opacity: 0.55 }), vapR = new Ribbon(60, { color: 0xffffff, opacity: 0.55 });
  const conL = new Ribbon(90, { color: 0xffffff, opacity: 0.9 }), conR = new Ribbon(90, { color: 0xffffff, opacity: 0.9 });
  const lightTrail = new Ribbon(160, { color: 0xffb070, additive: true, opacity: 1 });
  const lightTrail2 = new Ribbon(160, { color: 0x7fd8ff, additive: true, opacity: 1 });
  for (const r of [vapL, vapR, conL, conR, lightTrail, lightTrail2]) scene.add(r.mesh);

  let cur = null;
  function usePreset(name) {
    if (cur === name) return; cur = name; const P = PRESETS[name];
    U.uZenith.value.setRGB(...P.sky.zenith); U.uHorizon.value.setRGB(...P.sky.horizon); U.uBelow.value.setRGB(...P.sky.below); U.uSunGlow.value.setRGB(...P.sky.sunGlow);
    U.uSunDir.value.set(...P.sky.sunDir).normalize(); U.uGlow.value = P.sky.glow; U.uDisk.value = P.sky.disk; U.uStars.value = P.sky.stars || 0;
    deckU.uLit.value.setRGB(...P.lit); deckU.uShade.value.setRGB(...P.shade); deckU.uGap.value.setRGB(...P.gap); deckU.uFogDen.value = P.fog;
    sun.color.setRGB(...P.sun); sun.intensity = P.sunI; hemi.color.setRGB(...P.hemi[0]); hemi.groundColor.setRGB(...P.hemi[1]); hemi.intensity = P.hemi[2];
    const env = envs[P.env]; jet.model.traverse((o) => { if (o.isMesh) o.material.envMap = env; }); liner.traverse((o) => { if (o.isMesh) { o.material.envMap = env; o.material.needsUpdate = true; } });
    jet.model.traverse((o) => { if (o.isMesh) o.material.needsUpdate = true; });
    scene.environment = null;
  }
  function frameCommon(t, lt = 0) {
    U.uTime.value = t;
    const sd = U.uSunDir.value; sun.position.copy(camera.position).addScaledVector(sd, 5000); sun.target.position.copy(camera.position);
    deck.position.set(Math.round(camera.position.x / 1000) * 1000, 0, Math.round(camera.position.z / 1000) * 1000);
    camera.updateMatrixWorld();
    uploadPuffs(camera.position, lt);
  }
  const hideAll = () => { jet.root.visible = false; liner.visible = false; for (const r of [vapL, vapR, conL, conR, lightTrail, lightTrail2]) r.mesh.visible = false; };

  // ---- choreography -------------------------------------------------------
  // dawn glide: camera cruises toward the rising sun
  const DAWN_V = 235;
  const dawnCam = (t) => new THREE.Vector3(Math.sin(t * 0.55) * 22, 300 + Math.sin(t * 0.8) * 10, -DAWN_V * t);
  function layoutDawn() {
    const r = rng(11); puffList = [];
    // near corridor: towers slide past on both sides of the flight line
    for (let i = 0; i < 18; i++) { const side = i % 2 ? 1 : -1; tower(r, side * (230 + r() * 600), 150 - i * 95 - r() * 60, 0, 90 + r() * 110); }
    // mid and far fields
    for (let i = 0; i < 46; i++) { const x = (r() - 0.5) * 9000; tower(r, Math.abs(x) < 650 ? Math.sign(x || 1) * (650 + r() * 400) : x, -800 - r() * 7000, 0, 140 + Math.pow(r(), 2) * 260); }
    for (let i = 0; i < 34; i++) tower(r, (r() - 0.5) * 26000, -7000 - r() * 16000, 0, 300 + r() * 420);
  }
  // reveal: the Vector bursts out of a cumulus tower, straight at camera
  const revealPath = new Path([
    [0.0, 40, 128, -760], [1.0, 30, 132, -480], [2.0, 16, 146, -190], [2.5, 10, 152, -12], [3.0, 2, 176, 150], [3.6, -6, 250, 300], [4.4, -12, 400, 470], [5.2, -16, 600, 640],
  ]);
  const revealRoll = (t) => easeInOut(smooth(3.0, 4.4, t)) * Math.PI * 2;
  const revealPose = (t) => pathPose(revealPath, t, { roll: revealRoll, bankGain: 0.4 });
  // formation: jet slides onto the airliner's right wing
  const LINER_V = 235;
  const linerPos = (t) => new THREE.Vector3(0, 1400, -LINER_V * t);
  const jetRel = (t) => { const e = smoother((t + 1.2) / 6.6); return new THREE.Vector3(lerp(112, 64, e), lerp(-34, 4, e) + Math.sin(t * 1.3) * 0.6, lerp(200, 20, e)); };
  const formPath = new FnPath((t) => linerPos(t).add(jetRel(t)));
  // logo: jet crosses the frame trailing light
  const logoPath = new Path([[0, -2600, 420, -1500], [1.5, -700, 470, -1150], [3.0, 1100, 560, -1050], [4.5, 2900, 700, -1200], [6, 4700, 860, -1500]]);

  const shots = {
    dawn(lt, gt) {
      usePreset('dawn'); hideAll(); wind.set(5, 0, 2);
      if (puffList._id !== 'dawn') { layoutDawn(); puffList._id = 'dawn'; }
      deckU.uCover.value = 0.36; deckU.uOff.value.set(0.3, 0.7);
      const cam = dawnCam(lt);
      const ahead = dawnCam(lt + 1.2).add(new THREE.Vector3(-40, -46, 0));
      aim(camera, cam, ahead, Math.sin(lt * 0.55 + 0.4) * 0.05, 44);
      shake(camera, gt, 0.0025, 2.2);
      frameCommon(gt, lt);
    },
    reveal(lt, gt) {
      usePreset('dawn'); hideAll(); wind.set(4, 0, 2); jet.root.visible = true; vapL.mesh.visible = vapR.mesh.visible = true;
      if (puffList._id !== 'reveal') {
        layoutPuffs(23, [{ n: 50, x: [-5000, 5000], z: [-9000, 2500], y: 0, size: [120, 320], clearX: 260 }]);
        // the tower the jet punches out of + near-field puffs for parallax
        puffList.push({ p: new THREE.Vector3(40, 105, -700), s: 120, seed: 1.3 }, { p: new THREE.Vector3(-40, 150, -740), s: 100, seed: 2.9 }, { p: new THREE.Vector3(110, 80, -680), s: 90, seed: 4.2 }, { p: new THREE.Vector3(-110, 70, -660), s: 85, seed: 8.4 }, { p: new THREE.Vector3(20, 200, -760), s: 75, seed: 9.1 });
        puffList.push({ p: new THREE.Vector3(-300, 80, -300), s: 90, seed: 5.1 }, { p: new THREE.Vector3(280, 70, 40), s: 100, seed: 6.6 }, { p: new THREE.Vector3(-220, 60, 220), s: 80, seed: 7.7 });
        puffList._id = 'reveal';
      }
      deckU.uCover.value = 0.36; deckU.uOff.value.set(0.3, 0.7);
      const pose = revealPose(lt); placeRig(jet, pose);
      jet.set(gt, { throttle: lt < 2.6 ? 0.55 : 1.0, nav: 1, strobe: 1 });
      // camera: locked off, then whips to track the jet away into the gold
      const cam = new THREE.Vector3(0, 140, 0);
      const look = revealPose(Math.max(0, lt - 0.06)).p;
      const pre = new THREE.Vector3(10, 150, -800);
      const w = smooth(1.2, 2.2, lt);
      const tgt = pre.clone().lerp(look, w);
      const zoom = lerp(34, 46, smooth(2.2, 2.6, lt)) - 10 * smooth(3.0, 5.0, lt);
      aim(camera, cam, tgt, 0, zoom);
      shake(camera, gt, 0.004 + 0.03 * Math.exp(-Math.pow((lt - 2.55) / 0.18, 2)), 14);
      // vapor off the wingtips in the pull
      const g = pose.g;
      const vis = (t) => clamp((revealPath.acc(t).length() / 9.81 - 1.5) / 3) * smooth(2.85, 3.1, t);
      for (const [rib, tip] of [[vapL, JET.tipL], [vapR, JET.tipR]]) {
        const pts = trailPoints(60, 0.02, lt, revealPose, tip);
        rib.update(pts, camera.position, (i, f) => 0.25 + f * 1.5, (i, f) => (1 - f) * vis(lt - i * 0.02) * 0.5);
      }
      frameCommon(gt, lt);
      return { g };
    },
    formation(lt, gt) {
      usePreset('day'); hideAll(); wind.set(8, 0, 3); jet.root.visible = true; liner.visible = true; conL.mesh.visible = conR.mesh.visible = true;
      if (puffList._id !== 'formation') { layoutPuffs(37, [{ n: 80, x: [-9000, 9000], z: [-14000, 4000], y: 0, size: [150, 460] }]); puffList._id = 'formation'; }
      deckU.uCover.value = 0.42; deckU.uOff.value.set(2.1, 0.4);
      const lp = linerPos(lt);
      const lq = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.sin(lt * 0.5) * 0.01);
      const flip = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
      liner.position.copy(lp); liner.quaternion.copy(flip).multiply(lq); liner.updateMatrixWorld(true);
      const jp = pathPose(formPath, lt, { bankGain: 0.9, maxBank: 0.6 }); placeRig(jet, jp);
      jet.set(gt, { throttle: 0.18, nav: 1, strobe: 1 });
      // contrails from the two engines (liner local nose -Z after the flip)
      for (const [rib, x] of [[conL, 9.5], [conR, -9.5]]) {
        const pts = []; for (let i = 0; i < 90; i++) { const d = 25 + i * i * 0.9; pts.push(new THREE.Vector3(x * (1 + i * 0.002), -1.5 - i * 0.02, 0).applyQuaternion(liner.quaternion).add(lp).add(new THREE.Vector3(0, 0, d))); }
        rib.update(pts, camera.position, (i, f) => 0.9 + f * f * 14, (i, f) => smooth(0, 0.06, f) * (1 - f) * 0.9);
      }
      const mid = lp.clone().lerp(jp.p, 0.45 * smooth(1.5, 4.5, lt));
      const ce = smoother(lt / 7.5); const cam = lp.clone().add(new THREE.Vector3(lerp(150, 118, ce), lerp(34, 16, ce), lerp(150, 95, ce)));
      aim(camera, cam, mid.add(new THREE.Vector3(0, 0, -20)), -0.03, 40);
      shake(camera, gt, 0.0025, 2.2);
      frameCommon(gt, lt);
      return { lp, jp };
    },
    logo(lt, gt) {
      usePreset('night'); hideAll(); wind.set(3, 0, 1); jet.root.visible = true; lightTrail.mesh.visible = lightTrail2.mesh.visible = true;
      if (puffList._id !== 'logo') { layoutPuffs(51, [{ n: 26, x: [-12000, 12000], z: [-16000, -5000], y: 0, size: [180, 420] }]); puffList._id = 'logo'; }
      deckU.uCover.value = 0.3; deckU.uOff.value.set(5.1, 1.4);
      const tt = lt;
      const lpPose = (t) => pathPose(logoPath, t, { bankGain: 1, roll: (x) => easeInOut(smooth(1.6, 2.6, x)) * Math.PI * 2 });
      const pose = lpPose(tt); placeRig(jet, pose); jet.set(gt, { throttle: 1, nav: 1, strobe: 1, burnerScale: 1.2 });
      jet.root.visible = tt < 5.5;
      const cam = new THREE.Vector3(0, 380, 400);
      aim(camera, cam, new THREE.Vector3(0, 560, -1100), 0, 38);
      const n = 160; const dt = 0.03;
      for (const [rib, local, wmul] of [[lightTrail, JET.nozzles[0], 1], [lightTrail2, JET.nozzles[1], 0.6]]) {
        const pts = trailPoints(n, dt, Math.min(tt, 6), lpPose, local);
        rib.update(pts, camera.position, (i, f) => (2.2 + f * 10) * wmul, (i, f) => (1 - f) * (1 - smooth(6, 12, lt)) * 0.9);
      }
      frameCommon(gt, lt);
    },
  };

  const post = {
    dawn: { bloom: [0.35, 0.5, 1.15], exposure: 1.0, grade: { tint: [1.03, 0.99, 0.95], sat: 1.14, con: 1.17 } },
    reveal: { bloom: [0.45, 0.5, 1.1], exposure: 1.0, grade: { tint: [1.03, 0.99, 0.95], sat: 1.1, con: 1.12, ca: 0.003 } },
    formation: { bloom: [0.3, 0.4, 1.2], exposure: 1.0, grade: { tint: [1.0, 1.0, 1.02], sat: 1.08, con: 1.1 } },
    logo: { bloom: [0.8, 0.6, 0.7], exposure: 1.0, grade: { tint: [1.0, 0.98, 1.02], sat: 1.1, con: 1.1 } },
  };
  const sunPos = () => camera.position.clone().addScaledVector(U.uSunDir.value, 20000);
  const flares = {
    dawn: (lt) => [{ pos: sunPos(), i: 0.7, color: [255, 190, 130], len: 1.2, thick: 2.5, core: 110 }],
    reveal: (lt) => {
      const f = [{ pos: sunPos(), i: 0.7 - 0.5 * smooth(1.8, 2.4, lt), color: [255, 190, 130], len: 1.2, thick: 2.5, core: 110 }];
      if (jet.root.visible) for (const nz of JET.nozzles) f.push({ pos: jet.world(nz), i: 0.35 * smooth(0.3, 1.2, lt), color: [255, 170, 110], len: 0.5, thick: 1.5, core: 40, ghosts: false });
      return f;
    },
    formation: () => [{ pos: sunPos(), i: 0.3, color: [255, 240, 220], len: 1.0, thick: 2, core: 90 }],
    logo: (lt) => (jet.root.visible ? JET.nozzles.map((nz) => ({ pos: jet.world(nz), i: 0.6, color: [255, 170, 110], len: 0.6, thick: 1.5, core: 50, ghosts: false })) : []),
  };

  // HUD overlay for the formation (the game's spot/label language)
  const overlay = {
    formation(ctx, lt, gt, project, { W, H }) {
      const S = H / 1080; const sz = liner.userData.size;
      const corners = []; for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz2 of [-1, 1]) corners.push(project(new THREE.Vector3(sx * sz.x / 2, sy * sz.y / 2, sz2 * sz.z / 2).applyMatrix4(liner.matrixWorld)));
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const c of corners) { x0 = Math.min(x0, c.x); y0 = Math.min(y0, c.y); x1 = Math.max(x1, c.x); y1 = Math.max(y1, c.y); }
      const a = smooth(0.8, 1.2, lt) * (1 - smooth(7.2, 7.5, lt)); if (a <= 0) return;
      const pad = 18 * S; x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
      const lock = smooth(1.0, 1.6, lt); const k = lerp(1.5, 1, easeOut(lock));
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2; const hw = (x1 - x0) / 2 * k, hh = (y1 - y0) / 2 * k;
      ctx.save(); ctx.globalAlpha = a; ctx.strokeStyle = '#ffd98f'; ctx.lineWidth = 2.5 * S; const L = 22 * S;
      for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { const px = cx + sx * hw, py = cy + sy * hh; ctx.beginPath(); ctx.moveTo(px - sx * -0, py + sy * -L); ctx.lineTo(px, py); ctx.lineTo(px - sx * L, py); ctx.stroke(); }
      // label chip
      const tx = cx + hw + 16 * S, ty = cy - hh;
      ctx.font = `${Math.round(19 * S)}px "DejaVu Sans Mono"`; ctx.letterSpacing = `${Math.round(1 * S)}px`;
      const lines = ['SKL204  ·  B788', 'FL370  ·  487 KT', 'LIVE ADS-B'];
      const n = Math.floor(clamp((lt - 1.2) / 0.8) * 40);
      ctx.fillStyle = 'rgba(8,14,22,0.72)'; ctx.fillRect(tx, ty, 250 * S, 92 * S);
      ctx.fillStyle = '#ffd98f'; ctx.fillRect(tx, ty, 3 * S, 92 * S);
      lines.forEach((l, i) => { ctx.fillStyle = i === 2 ? '#7fd8e6' : '#f4f1ea'; ctx.fillText(l.slice(0, Math.max(0, n - i * 6)), tx + 16 * S, ty + (28 + i * 26) * S); });
      ctx.restore();
      // spot toast
      const ta = smooth(4.3, 4.6, lt) * (1 - smooth(7.0, 7.4, lt));
      if (ta > 0) {
        const pop = 1 + 0.08 * Math.exp(-(lt - 4.3) * 8);
        ctx.save(); ctx.globalAlpha = ta; const bw = 430 * S * pop, bh = 84 * S * pop; const bx = W / 2 - bw / 2, by = H * 0.2;
        ctx.fillStyle = 'rgba(8,14,22,0.78)'; ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 12 * S); ctx.fill();
        ctx.strokeStyle = 'rgba(255,217,143,0.8)'; ctx.lineWidth = 1.5 * S; ctx.stroke();
        ctx.fillStyle = '#ffd98f'; ctx.font = `${Math.round(16 * S)}px "DejaVu Sans Mono"`; ctx.letterSpacing = `${Math.round(4 * S)}px`; ctx.fillText('NEW SPOT  ·  +150', bx + 26 * S, by + 32 * S);
        ctx.fillStyle = '#f4f1ea'; ctx.font = `${Math.round(24 * S)}px Archivo`; ctx.letterSpacing = `${Math.round(2 * S)}px`; ctx.fillText('BOEING 787-8', bx + 26 * S, by + 64 * S);
        ctx.restore();
      }
    },
  };

  // Title card, drawn over the night flyby
  function logo(ctx, lt, { W, H, BAR }) {
    const S = H / 1080;
    const a = smooth(0.9, 2.2, lt) * (1 - smooth(13.6, 14.6, lt));
    if (a > 0) {
      ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const size = 168 * S; ctx.font = `${Math.round(size)}px Archivo`;
      const sp = lerp(0.42, 0.3, easeOut(clamp((lt - 0.9) / 4))); ctx.letterSpacing = `${sp * size}px`;
      const y = H * 0.44;
      ctx.globalAlpha = a; ctx.shadowColor = 'rgba(255,190,120,0.55)'; ctx.shadowBlur = 60 * S; ctx.fillStyle = '#f7f2e8';
      ctx.fillText('SKYLOOM', W / 2 + sp * size / 2, y);
      // light sweep across the letters
      const sx = lerp(-0.2, 1.2, clamp((lt - 1.6) / 1.6)) * W;
      ctx.globalCompositeOperation = 'source-atop';
      const g = ctx.createLinearGradient(sx - 160 * S, 0, sx + 160 * S, 0); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,236,200,0.95)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.fillText('SKYLOOM', W / 2 + sp * size / 2, y);
      ctx.globalCompositeOperation = 'source-over';
      // rule + tagline
      const ta = smooth(2.8, 3.8, lt) * a;
      ctx.globalAlpha = ta; ctx.shadowBlur = 0; ctx.fillStyle = '#ffd98f'; const rw = lerp(0, 520, easeOut(clamp((lt - 2.6) / 1.2))) * S; ctx.fillRect(W / 2 - rw / 2, y + 110 * S, rw, 3 * S);
      ctx.font = `${Math.round(34 * S)}px Archivo`; ctx.letterSpacing = `${Math.round(14 * S)}px`; ctx.fillStyle = '#f4f1ea'; ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 20 * S;
      ctx.fillText('THE WHOLE SKY IS LIVE', W / 2 + 7 * S, y + 170 * S);
      const pa = smooth(6.0, 7.0, lt) * a;
      ctx.globalAlpha = pa; ctx.font = `${Math.round(24 * S)}px "DejaVu Sans Mono"`; ctx.letterSpacing = `${Math.round(8 * S)}px`; ctx.fillStyle = '#7fd8e6';
      ctx.fillText('PLAY IN YOUR BROWSER', W / 2 + 4 * S, y + 236 * S);
      // credits
      const ca = smooth(7.5, 8.5, lt) * a;
      ctx.globalAlpha = ca * 0.62; ctx.shadowBlur = 0; ctx.font = `${Math.round(12.5 * S)}px "DejaVu Sans"`; ctx.letterSpacing = '0px'; ctx.fillStyle = '#d8d4cc';
      const cy = H - BAR - 44 * S;
      ctx.fillText('Vector fighter model by jeremy (poly.pizza, CC-BY 3.0) · Boeing 787 model by Poly by Google (CC-BY 3.0) · Eiffel Tower by Scott Marshall (CC-BY 3.0)', W / 2, cy);
      ctx.fillText('In-game imagery © Esri, Maxar, Earthstar Geographics · Flight data adsb.lol · Coastlines Natural Earth · HDRIs Poly Haven (CC0) · Cinematic sequences rendered with the game\'s own assets', W / 2, cy + 20 * S);
      ctx.restore();
    }
  }

  return { scene, camera, shots, post, flares, overlay, logo };
}
