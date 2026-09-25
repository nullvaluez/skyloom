// Paris at 23:00 — the Eiffel Tower sparkling, the Vector threading past it,
// then a vertical afterburner climb into the stars.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import {
  SKY_GLSL, NOISE_GLSL, skyUniforms, makeSkyDome, buildJet, placeRig, pathPose, Path, Ribbon, trailPoints, JET, makeCityMaterial, makeCity,
  clamp, lerp, smooth, easeInOut, rng, aim, shake, normalizeToHeight, glowTexture,
} from './common.js';

const MOON = new THREE.Vector3(0.45, 0.32, -0.83).normalize();
const RES = +(new URLSearchParams(location.search).get('h') || 1080) / 1080;

export async function createParis(renderer) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 16 / 9, 1, 200000);
  const U = skyUniforms({ zenith: [0.0015, 0.003, 0.011], horizon: [0.07, 0.042, 0.035], below: [0.02, 0.015, 0.012], sunGlow: [0.22, 0.25, 0.32], sunDir: MOON.toArray(), glow: 0.1, disk: 0.12, stars: 1.1 });
  scene.add(makeSkyDome(U));
  scene.fog = new THREE.FogExp2(new THREE.Color(0.07, 0.042, 0.035), 6e-5);

  const hdr = await new HDRLoader().loadAsync('/public/hdri/qwantani_night_puresky_1k.hdr'); hdr.mapping = THREE.EquirectangularReflectionMapping;
  const pm = new THREE.PMREMGenerator(renderer); const env = pm.fromEquirectangular(hdr).texture; pm.dispose();
  const moon = new THREE.DirectionalLight(new THREE.Color(0.55, 0.65, 0.9), 0.35); scene.add(moon, moon.target);
  scene.add(new THREE.HemisphereLight(new THREE.Color(0.05, 0.07, 0.14), new THREE.Color(0.35, 0.2, 0.09), 0.7));
  const towerLight = new THREE.PointLight(new THREE.Color(1.0, 0.62, 0.25), 90000, 1400, 1.6); towerLight.position.set(0, 140, 0); scene.add(towerLight);

  // ---- the city's lights, procedurally, on one ground plane --------------
  const GU = { ...U, uFogDen: { value: 6e-5 } };
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(120000, 120000).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
    uniforms: GU,
    vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
    fragmentShader: `${SKY_GLSL} ${NOISE_GLSL} uniform float uFogDen; varying vec3 vW;
      float river(float x){ return -330.0 + 420.0*sin(x/2600.0 + 0.4) + 120.0*sin(x/900.0); }
      float line(float d, float w, float fw){ float we = max(w, fw*1.2); return exp(-d*d/(we*we)) * (w/we); }
      void main(){
        vec2 p = vW.xz;
        vec2 fwv = fwidth(p); float fw = max(fwv.x, fwv.y);
        vec2 wp = p + 90.0*vec2(fbm3(p/1100.0), fbm3(p/1100.0 + 7.3));
        float c = cos(0.52), s = sin(0.52);
        vec2 g = mat2(c,-s,s,c) * wp;
        vec2 cellA = g / vec2(95.0, 140.0);
        vec2 dA = abs(fract(cellA) - 0.5) * vec2(95.0, 140.0);
        float streets = line(47.5 - dA.x, 4.0, fw) + line(70.0 - dA.y, 4.0, fw);
        // grand avenues radiating from the tower and the Etoile
        float r = length(p); float th = atan(p.y, p.x);
        float av = 0.0;
        for (int k = 0; k < 6; k++) { float a = float(k) * 0.5236 + 0.26; av += line(abs(sin(th - a)) * r, 7.0, fw) * smoothstep(250.0, 400.0, r); }
        vec2 q = p - vec2(-2600.0, -2100.0); float rq = length(q); float tq = atan(q.y, q.x);
        for (int k = 0; k < 12; k++) { float a = float(k) * 0.5236; av += line(abs(sin(tq - a)) * rq, 7.0, fw) * smoothstep(140.0, 260.0, rq) * exp(-rq/5000.0) * 1.2; }
        av += line(abs(rq - 120.0), 5.0, fw) * 1.5;
        // lamps along the streets (dotted), sodium orange
        float lamps = (0.55 + 0.45 * step(0.6, fract(dot(g, vec2(0.02, 0.028)))));
        float light = (streets * 0.9 + av * 1.1) * lamps;
        // district density falls off with distance from the centre
        float dens = 0.35 + 0.65 * exp(-r / 9000.0);
        vec3 col = vec3(0.012, 0.009, 0.007);
        col += vec3(1.0, 0.55, 0.2) * light * 1.9 * dens;
        // window specks
        vec2 wc = floor(p / 14.0); float h = fract(sin(dot(wc, vec2(12.9898, 78.233))) * 43758.5453);
        float speck = step(0.93, h) * (1.0 - smoothstep(6.0, 22.0, fw));
        col += vec3(1.0, 0.78, 0.5) * speck * 0.35 * dens + vec3(1.0,0.7,0.4) * 0.015 * smoothstep(6.0, 30.0, fw) * dens;
        // the Seine: dark water with light reflections
        float rd = abs(p.y - river(p.x));
        float w = 1.0 - smoothstep(70.0, 85.0, rd);
        vec3 water = vec3(0.004, 0.006, 0.012) + vec3(1.0, 0.6, 0.25) * 0.25 * pow(fbm(vec2(p.x/30.0, p.y/6.0)), 4.0);
        col = mix(col, water, w);
        col += vec3(1.0, 0.6, 0.25) * line(rd - 82.0, 3.0, fw) * 2.5; // quay lamps
        // Champ de Mars: dark lawn, lit paths
        vec2 cm = abs(vec2(p.x - 90.0, p.y - 700.0)) - vec2(120.0, 520.0);
        float inCM = step(max(cm.x, cm.y), 0.0);
        col = mix(col, vec3(0.006, 0.01, 0.006) + vec3(1.0,0.6,0.25) * (line(abs(p.x-90.0) - 60.0, 2.5, fw) * 1.2), inCM);
        // golden pool under the tower
        col += vec3(1.0, 0.6, 0.22) * 0.9 * exp(-r*r/(160.0*160.0));
        vec3 V = normalize(vW - cameraPosition);
        float d = length(vW - cameraPosition); float fog = 1.0 - exp(-d * uFogDen);
        col = mix(col, skyColor(normalize(vec3(V.x, 0.0, V.z)), false), fog);
        gl_FragColor = vec4(col, 1.0);
      }`,
  }));
  scene.add(ground);

  // Haussmann blocks near the tower + La Défense on the horizon
  const r = rng(77); const list = []; const river = (x) => -330 + 420 * Math.sin(x / 2600 + 0.4) + 120 * Math.sin(x / 900);
  const pal = [[0.6, 0.55, 0.46], [0.55, 0.5, 0.42], [0.5, 0.47, 0.42]];
  for (let i = 0; i < 5200; i++) {
    const rr = 220 + Math.pow(r(), 0.7) * 3800, th = r() * Math.PI * 2; const x = Math.cos(th) * rr, z = Math.sin(th) * rr;
    if (Math.abs(z - river(x)) < 110) continue; if (Math.abs(x - 90) < 150 && Math.abs(z - 700) < 560) continue;
    list.push({ x, z, w: 25 + r() * 30, d: 18 + r() * 25, h: 17 + r() * 12 + (r() < 0.03 ? 25 : 0), rot: 0.52 + (r() < 0.2 ? r() : 0), color: pal[Math.floor(r() * 3)] });
  }
  for (let i = 0; i < 70; i++) list.push({ x: -5600 + r() * 900, z: -4200 + r() * 900, w: 30 + r() * 30, d: 30 + r() * 30, h: 60 + Math.pow(r(), 1.5) * 170, rot: 0.3, color: [0.35, 0.4, 0.48] });
  scene.add(makeCity(list, makeCityMaterial(U, { night: 1, fogDen: 6e-5, sunCol: [0.25, 0.3, 0.45], amb: [0.08, 0.07, 0.08], winCol: [0.5, 0.34, 0.18] })));

  // ---- the tower -----------------------------------------------------------
  const gl = new GLTFLoader();
  const tower = normalizeToHeight((await gl.loadAsync('/public/models/monument-eiffel-detail-v1.glb')).scene, 330);
  const towerMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: `varying float vH; varying vec3 vN; varying vec3 vW; varying vec3 vC; void main(){
        #ifdef USE_COLOR
        vC = color;
        #else
        vC = vec3(0.7);
        #endif
        vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; vH = w.y; vN = normalize(mat3(modelMatrix)*normal); gl_Position = projectionMatrix*viewMatrix*w; }`,
    fragmentShader: `uniform float uTime; varying float vH; varying vec3 vN; varying vec3 vW; varying vec3 vC;
      void main(){ float h = clamp(vH/330.0, 0.0, 1.0);
        vec3 V = normalize(cameraPosition - vW); float f = (0.3 + 0.7*abs(dot(normalize(vN), V))) * (0.35 + 0.9*dot(vC, vec3(0.3,0.5,0.2)));
        vec3 gold = vec3(1.0, 0.56, 0.2);
        float k = mix(0.95, 0.42, h) * f;
        float floors = exp(-pow((h-0.175)/0.012,2.0)) + exp(-pow((h-0.35)/0.01,2.0));
        gl_FragColor = vec4(gold * (k + floors * 1.1), 1.0); }`,
  });
  tower.traverse((o) => { if (o.isMesh) { const m = towerMat.clone(); m.uniforms = towerMat.uniforms; m.vertexColors = !!o.geometry.attributes.color; o.material = m; } });
  scene.add(tower);
  // sparkle: the hourly strobe, from real vertices of the model
  const sp = []; tower.updateMatrixWorld(true);
  tower.traverse((o) => { if (!o.isMesh) return; const a = o.geometry.attributes.position; const v = new THREE.Vector3(); for (let i = 0; i < a.count; i += 23) { v.fromBufferAttribute(a, i).applyMatrix4(o.matrixWorld); sp.push(v.x * 1.01, v.y, v.z * 1.01); } });
  const spg = new THREE.BufferGeometry(); spg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  const seeds = new Float32Array(sp.length / 3).map((_, i) => (i * 0.6180339) % 1); spg.setAttribute('seed', new THREE.BufferAttribute(seeds, 1));
  const sparkle = new THREE.Points(spg, new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uTex: { value: glowTexture() } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `attribute float seed; uniform float uTime; varying float vA; void main(){ float f = floor(uTime*16.0 + seed*97.0); float on = step(0.86, fract(sin((seed*311.0 + f)*12.9898)*43758.5453)); vA = on; vec4 mv = modelViewMatrix*vec4(position,1.0); gl_PointSize = clamp(2000.0/-mv.z, 1.5, 6.0) * ${RES.toFixed(3)}; gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `uniform sampler2D uTex; varying float vA; void main(){ float a = texture2D(uTex, gl_PointCoord).a * vA; gl_FragColor = vec4(vec3(0.9,0.95,1.0) * a * 2.0, 1.0); }`,
  }));
  sparkle.frustumCulled = false; scene.add(sparkle);
  // rotating beacon
  const beamGeo = new THREE.CylinderGeometry(2, 55, 5200, 24, 1, true); beamGeo.translate(0, 2600, 0); beamGeo.rotateZ(-Math.PI / 2);
  const beamMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: `varying float vL; varying vec3 vN; varying vec3 vW; void main(){ vL = position.x/5200.0; vec4 w = modelMatrix*vec4(position,1.0); vW=w.xyz; vN = normalize(mat3(modelMatrix)*normal); gl_Position = projectionMatrix*viewMatrix*w; }`,
    fragmentShader: `varying float vL; varying vec3 vN; varying vec3 vW; void main(){ vec3 V = normalize(cameraPosition - vW); float f = pow(abs(dot(normalize(vN), V)), 2.0); float a = f * (1.0 - vL) * exp(-vL*3.0) * 0.05 * smoothstep(0.0, 0.01, vL); gl_FragColor = vec4(vec3(1.0,0.9,0.7)*a, 1.0); }` });
  const beacon = new THREE.Group(); beacon.position.set(0, 318, 0);
  const b1 = new THREE.Mesh(beamGeo, beamMat), b2 = new THREE.Mesh(beamGeo, beamMat); b2.rotation.y = Math.PI; beacon.add(b1, b2); beacon.rotation.z = 0.02; scene.add(beacon);
  const topGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color(1, 0.85, 0.6).multiplyScalar(1.4), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })); topGlow.position.set(0, 320, 0); topGlow.scale.setScalar(26); scene.add(topGlow);

  // the Vector
  const jet = buildJet(await gl.loadAsync('/public/models/player-jet.glb'), env); scene.add(jet.root);
  jet.model.traverse((o) => { if (o.isMesh) o.material.envMapIntensity = 0.6; });
  const trailA = new Ribbon(180, { color: 0xff9a55, additive: true }), trailB = new Ribbon(180, { color: 0xffc27a, additive: true });
  const vapL = new Ribbon(40, { opacity: 0.35 }), vapR = new Ribbon(40, { opacity: 0.35 });
  scene.add(trailA.mesh, trailB.mesh, vapL.mesh, vapR.mesh);

  const pathA = new Path([[1.5, 1500, 360, -2300], [3.5, 900, 320, -1150], [5.0, 480, 280, -420], [6.25, 170, 250, 150], [7.0, 20, 240, 450]]);
  const pathB = new Path([[-0.5, 820, 175, 960], [0, 560, 165, 620], [0.65, 282, 158, 238], [1.5, -55, 150, 45], [2.4, -380, 180, -330], [3.8, -760, 270, -760]]);
  const pathC = new Path([[0, -900, 120, 1500], [1.0, -420, 140, 700], [1.8, -120, 220, 200], [2.5, -20, 520, 20], [3.3, 0, 1100, -40], [4.3, 10, 1900, -80], [5.0, 15, 2600, -100], [6, 20, 3500, -120]]);
  const poseA = (t) => pathPose(pathA, t, { bankGain: 1 });
  const poseB = (t) => pathPose(pathB, t, { bankGain: 1, roll: (x) => easeInOut(smooth(0.95, 2.1, x)) * Math.PI * 2 });
  const poseC = (t) => pathPose(pathC, t, { bankGain: 0.6, roll: (x) => easeInOut(smooth(2.4, 4.2, x)) * Math.PI * 2.5 });

  function common(t) {
    U.uTime.value = t; towerMat.uniforms.uTime.value = t; sparkle.material.uniforms.uTime.value = t;
    beacon.rotation.y = t * 0.55;
    moon.position.copy(camera.position).addScaledVector(MOON, 3000); moon.target.position.copy(camera.position);
  }
  const burnTrail = (poseFn, lt, fade) => {
    for (const [rib, nz, wm] of [[trailA, JET.nozzles[0], 1], [trailB, JET.nozzles[1], 1]]) {
      const pts = trailPoints(180, 0.018, lt, poseFn, nz);
      rib.update(pts, camera.position, (i, f) => (0.6 + f * 2.8) * wm, (i, f) => Math.pow(1 - f, 1.5) * fade * smooth(25, 140, pts[Math.min(i, pts.length - 1)].distanceTo(camera.position)));
    }
  };
  const noTrail = () => { trailA.mesh.visible = trailB.mesh.visible = false; };

  const shots = {
    eiffelA(lt, gt) {
      beacon.visible = true;
      jet.root.visible = lt > 1.5; noTrail(); vapL.mesh.visible = vapR.mesh.visible = false;
      if (jet.root.visible) { placeRig(jet, poseA(lt)); jet.set(gt, { throttle: 1, burnerScale: 1.3 }); }
      const k = easeInOut(lt / 6.25);
      const cam = new THREE.Vector3(lerp(-1500, -1250, k), lerp(95, 130, k), lerp(1650, 1400, k));
      aim(camera, cam, new THREE.Vector3(lerp(60, 120, k), lerp(185, 200, k), 0), 0.0, 30);
      shake(camera, gt, 0.0012, 1.2);
      common(gt);
    },
    eiffelB(lt, gt) {
      beacon.visible = true;
      jet.root.visible = true; trailA.mesh.visible = trailB.mesh.visible = true; vapL.mesh.visible = vapR.mesh.visible = true;
      const pose = poseB(lt); placeRig(jet, pose); jet.set(gt, { throttle: 1, burnerScale: 1.0 });
      const cam = new THREE.Vector3(262, 146, 206);
      const look = poseB(Math.max(-0.5, lt - 0.05)).p;
      const pre = new THREE.Vector3(560, 160, 620);
      const tgt = pre.lerp(look, smooth(0.0, 0.4, lt)).lerp(new THREE.Vector3(-40, 170, 20), 0.35 * smooth(1.2, 2.6, lt));
      aim(camera, cam, tgt, 0, lerp(36, 46, smooth(0.4, 0.8, lt)));
      shake(camera, gt, 0.003 + 0.035 * Math.exp(-Math.pow((lt - 0.65) / 0.16, 2)), 15);
      burnTrail(poseB, lt, 0.5);
      for (const [rib, tip] of [[vapL, JET.tipL], [vapR, JET.tipR]]) rib.update(trailPoints(40, 0.015, lt, poseB, tip), camera.position, (i, f) => 0.15 + f, (i, f) => (1 - f) * 0.4);
      common(gt);
    },
    climb(lt, gt) {
      jet.root.visible = true; trailA.mesh.visible = trailB.mesh.visible = true; vapL.mesh.visible = vapR.mesh.visible = false;
      const pose = poseC(lt); placeRig(jet, pose); jet.set(gt, { throttle: 1, burnerScale: 1.5 });
      beacon.visible = false;
      const cam = new THREE.Vector3(-640, 40, 1020);
      const look = poseC(Math.max(0, lt - 0.08)).p;
      const tgt = new THREE.Vector3(0, 190, 0).lerp(look, 0.55 * smooth(0.6, 1.6, lt) + 0.35 * smooth(2.4, 4.5, lt));
      aim(camera, cam, tgt, lerp(0.0, 0.06, smooth(2, 5, lt)), lerp(44, 36, smooth(2.0, 5.0, lt)));
      shake(camera, gt, 0.002 + 0.02 * Math.exp(-Math.pow((lt - 1.4) / 0.3, 2)), 12);
      burnTrail(poseC, lt, 1.0);
      common(gt);
    },
  };
  const post = {
    eiffelA: { bloom: [0.7, 0.5, 0.75], exposure: 1.0, grade: { tint: [1.02, 0.98, 1.0], sat: 1.12, con: 1.12, ca: 0.002 } },
    eiffelB: { bloom: [0.7, 0.5, 0.75], exposure: 1.0, grade: { tint: [1.02, 0.98, 1.0], sat: 1.12, con: 1.12, ca: 0.003 } },
    climb: { bloom: [0.75, 0.55, 0.75], exposure: 1.0, grade: { tint: [1.02, 0.98, 1.0], sat: 1.12, con: 1.12, ca: 0.003 } },
  };
  const bf = (i) => (jet.root.visible ? JET.nozzles.map((nz) => ({ pos: jet.world(nz), i, color: [255, 170, 110], len: 0.55, thick: 1.4, core: 40, ghosts: false })) : []);
  const flares = {
    eiffelA: () => [{ pos: new THREE.Vector3(0, 320, 0), i: 0.35, color: [255, 220, 170], len: 0.4, thick: 1, core: 30, ghosts: false }, ...bf(0.4)],
    eiffelB: () => bf(0.35),
    climb: () => bf(0.7),
  };
  return { scene, camera, shots, post, flares };
}
