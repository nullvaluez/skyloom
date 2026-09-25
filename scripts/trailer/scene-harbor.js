// Golden hour on the water: low over the lake, a knife-edge turn around the
// CN Tower (the game's detail-v1 model), then a pass between Midtown towers
// under the Empire State Building.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { Water } from 'three/addons/objects/Water.js';
import {
  skyUniforms, makeSkyDome, buildJet, placeRig, pathPose, Path, Ribbon, trailPoints, JET, makeCityMaterial, makeCity,
  clamp, lerp, smooth, easeInOut, rng, aim, shake, normalizeToHeight,
} from './common.js';

const SUN = new THREE.Vector3(-0.86, 0.075, 0.5).normalize();

export async function createHarbor(renderer) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 16 / 9, 1, 200000);
  const U = skyUniforms({ zenith: [0.022, 0.045, 0.13], horizon: [0.6, 0.31, 0.13], below: [0.06, 0.06, 0.08], sunGlow: [1.1, 0.5, 0.18], sunDir: SUN.toArray(), glow: 0.85, disk: 1 });
  scene.add(makeSkyDome(U));
  scene.fog = new THREE.FogExp2(new THREE.Color(0.36, 0.22, 0.15), 3.2e-5);

  const hdr = await new HDRLoader().loadAsync('/public/hdri/qwantani_dusk_1_puresky_1k.hdr'); hdr.mapping = THREE.EquirectangularReflectionMapping;
  const pm = new THREE.PMREMGenerator(renderer); const env = pm.fromEquirectangular(hdr).texture; pm.dispose();

  const sun = new THREE.DirectionalLight(new THREE.Color(1.0, 0.72, 0.46), 3.2); scene.add(sun); scene.add(sun.target);
  scene.add(new THREE.HemisphereLight(new THREE.Color(0.4, 0.45, 0.65), new THREE.Color(0.35, 0.25, 0.2), 0.9));

  // water
  const wn = await new THREE.TextureLoader().loadAsync('/public/textures/waternormals.jpg'); wn.wrapS = wn.wrapT = THREE.RepeatWrapping;
  const water = new Water(new THREE.PlaneGeometry(120000, 120000), { textureWidth: 768, textureHeight: 768, waterNormals: wn, sunDirection: SUN.clone(), sunColor: 0xffc890, waterColor: 0x06141c, distortionScale: 2.6, fog: true });
  water.rotation.x = -Math.PI / 2; water.material.uniforms.size.value = 2.2; scene.add(water);

  // land masses (flat, dark, slightly above water)
  const landMat = new THREE.MeshStandardMaterial({ color: 0x9a8670, roughness: 1, metalness: 0 });
  const addLand = (pts) => { const sh = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z))); const g = new THREE.ShapeGeometry(sh); g.rotateX(-Math.PI / 2); const m = new THREE.Mesh(g, landMat); m.position.y = 1.5; scene.add(m); };
  const A = new THREE.Vector2(600, -2600), B = new THREE.Vector2(2900, -15000);
  const axis = B.clone().sub(A).normalize(); const perp = new THREE.Vector2(-axis.y, axis.x);
  const halfW = (s) => 380 + 1150 * smooth(0, 0.22, s) - 250 * smooth(0.6, 1, s);
  const island = [];
  for (let i = 0; i <= 30; i++) { const s = i / 30; const c = A.clone().lerp(B, s); island.push([c.x + perp.x * halfW(s), c.y + perp.y * halfW(s)]); }
  for (let i = 30; i >= 0; i--) { const s = i / 30; const c = A.clone().lerp(B, s); island.push([c.x - perp.x * halfW(s), c.y - perp.y * halfW(s)]); }
  addLand(island);
  addLand([[-9000, -1200], [-2100, -1400], [-1900, -4000], [-1700, -9000], [-1500, -20000], [-9000, -20000]]); // New Jersey
  addLand([[2600, 3000], [2700, -1500], [3300, -3600], [4200, -9000], [9000, -9000], [9000, 3000]]); // Brooklyn
  addLand([[-9000, 1500], [-3200, 1300], [-2500, 4000], [-3000, 9000], [-9000, 9000]]); // Bayonne
  { // lakefront quay the tower stands on
    const g = new THREE.CircleGeometry(260, 32); g.rotateX(-Math.PI / 2); const m = new THREE.Mesh(g, landMat); m.position.set(-900, 1.8, -60); scene.add(m);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(40, 46, 8, 16), new THREE.MeshStandardMaterial({ color: 0x8a8378, roughness: 0.9 })); base.position.set(-900, 5, 0); scene.add(base); }
  // buildings
  const r = rng(1234); const list = [];
  const pal = [[0.42, 0.4, 0.38], [0.5, 0.46, 0.4], [0.3, 0.33, 0.38], [0.55, 0.5, 0.44], [0.25, 0.27, 0.3], [0.62, 0.58, 0.5]];
  const rot = Math.atan2(axis.x, -axis.y);
  for (let s = 0.004; s < 0.99; s += 0.0034) {
    const c = A.clone().lerp(B, s); const hw = halfW(s) - 40;
    for (let k = -hw; k < hw; k += 55 + r() * 25) {
      if (r() < 0.12) continue;
      const x = c.x + perp.x * k, z = c.y + perp.y * k;
      const down = Math.exp(-Math.pow((s - 0.055) / 0.06, 2)), mid = Math.exp(-Math.pow((s - 0.43) / 0.09, 2));
      const core = Math.max(down, mid) * Math.exp(-Math.pow(k / (hw * 0.75), 2));
      const h = 20 + r() * 55 + core * (110 + Math.pow(r(), 1.3) * 290);
      const w = 22 + r() * 30, d = 22 + r() * 34;
      list.push({ x, z, w, d, h, rot, color: pal[Math.floor(r() * pal.length)] });
    }
  }
  const scatter = (n, x0, x1, z0, z1, hmin, hmax, tall) => { for (let i = 0; i < n; i++) { const h = hmin + Math.pow(r(), tall) * (hmax - hmin); list.push({ x: lerp(x0, x1, r()), z: lerp(z0, z1, r()), w: 20 + r() * 35, d: 20 + r() * 35, h, rot: rot + (r() < 0.3 ? 0.4 : 0), color: pal[Math.floor(r() * pal.length)] }); } };
  scatter(900, -3900, -2150, -9000, -1600, 14, 200, 3); // Jersey City waterfront
  scatter(500, 2900, 7000, -8000, 2500, 10, 45, 2); // Brooklyn
  list.push({ x: 780, z: -3150, w: 62, d: 62, h: 520, rot: rot + 0.785, color: [0.3, 0.38, 0.48] }); // One WTC
  { // keep the Empire State Building's block and the street camera clear
    const ep = A.clone().lerp(B, 0.43); const cam = new THREE.Vector2(ep.x + 210, ep.y + 330);
    for (let i = list.length - 1; i >= 0; i--) { const b = list[i]; const dE = Math.hypot(b.x - ep.x, b.z - ep.y), dC = Math.hypot(b.x - cam.x, b.z - cam.y); const t = clamp(((b.x - cam.x) * (ep.x - cam.x) + (b.z - cam.y) * (ep.y - cam.y)) / ((ep.x - cam.x) ** 2 + (ep.y - cam.y) ** 2)); const dL = Math.hypot(b.x - (cam.x + (ep.x - cam.x) * t), b.z - (cam.y + (ep.y - cam.y) * t)); if (dE < 85 || dC < 70 || dL < 45) list.splice(i, 1); }
  }
  const cityMat = makeCityMaterial(U, { night: 0.12, fogDen: 5.5e-5, sunCol: [1.0, 0.72, 0.46], amb: [0.22, 0.24, 0.34] });
  scene.add(makeCity(list, cityMat));

  // landmarks — the game's own monument models
  const gl = new GLTFLoader();
  const cnTower = normalizeToHeight((await gl.loadAsync('/public/models/monument-cn-tower-high-v1.glb')).scene, 553);
  cnTower.traverse((o) => { if (o.isMesh) { const src = o.material; o.material = new THREE.MeshStandardMaterial({ color: src.color, map: src.map, vertexColors: !!o.geometry.attributes.color, roughness: 0.5, metalness: 0.15, envMap: env, envMapIntensity: 0.8 }); } });
  cnTower.position.set(-900, 2, 0); scene.add(cnTower);
  const podGlow = new THREE.PointLight(0xffc070, 0, 60); scene.add(podGlow);
  const esb = normalizeToHeight((await gl.loadAsync('/public/models/monument-empire-state-detail-v1.glb')).scene, 443);
  esb.traverse((o) => { if (o.isMesh) { const src = o.material; o.material = new THREE.MeshStandardMaterial({ color: src.color, map: src.map, vertexColors: !!o.geometry.attributes.color, roughness: 0.55, metalness: 0.15, envMap: env, envMapIntensity: 0.7 }); } });
  const esbPos = A.clone().lerp(B, 0.43); esb.position.set(esbPos.x, 0, esbPos.y); esb.rotation.y = rot; scene.add(esb);

  // the Vector
  const jet = buildJet(await gl.loadAsync('/public/models/player-jet.glb'), env); scene.add(jet.root);
  const vapL = new Ribbon(50, { opacity: 0.5 }), vapR = new Ribbon(50, { opacity: 0.5 }); scene.add(vapL.mesh, vapR.mesh);

  // ---- choreography
  const LIB = new THREE.Vector3(-900, 0, 0);
  const pathA = new Path([[0, -40, 30, 2050], [1.0, -300, 17, 1110], [2.2, -500, 40, 640], [3.4, -620, 120, 380], [5.0, -690, 270, 140]]);
  const orbit = (t) => { const a = lerp(0.35, 0.35 - 2.7, t / 5); const rr = 250; return new THREE.Vector3(LIB.x + Math.cos(a) * rr, 300 + 12 * Math.sin(t * 0.8), LIB.z + Math.sin(a) * rr); };
  const pathB = new Path(Array.from({ length: 34 }, (_, i) => { const t = -1 + i * 0.25; const p = orbit(t); return [t, p.x, p.y, p.z]; }));
  const E = new THREE.Vector3(esbPos.x, 0, esbPos.y);
  const pathC = new Path([[0, E.x - 900, 260, E.z + 320], [1.0, E.x - 350, 300, E.z + 120], [2.0, E.x + 250, 330, E.z - 90], [3.0, E.x + 850, 380, E.z - 300]]);

  const poseA = (t) => pathPose(pathA, t, { bankGain: 1.2 });
  const poseB = (t) => pathPose(pathB, t, { bankGain: 1, maxBank: 1.4 });
  const poseC = (t) => pathPose(pathC, t, { bankGain: 1, roll: (x) => easeInOut(smooth(0.9, 1.9, x)) * Math.PI * 2 });

  function common(t) {
    U.uTime.value = t; water.material.uniforms.time.value = t * 0.6;
    sun.position.copy(camera.position).addScaledVector(SUN, 3000); sun.target.position.copy(camera.position);
  }
  function vapor(poseFn, lt, k) {
    for (const [rib, tip] of [[vapL, JET.tipL], [vapR, JET.tipR]]) rib.update(trailPoints(50, 0.012, lt, poseFn, tip), camera.position, (i, f) => 0.15 + f * 1.1, (i, f) => (1 - f) * (1 - f) * k * 0.4);
  }

  const shots = {
    harborA(lt, gt) {
      const pose = poseA(lt); placeRig(jet, pose); jet.set(gt, { throttle: 0.85 });
      const cam = new THREE.Vector3(-340, 7, 1135);
      const lib = new THREE.Vector3(-900, 250, 0);
      const follow = smooth(0.6, 1.6, lt);
      const tgt = lib.clone().lerp(pose.p.clone().add(new THREE.Vector3(0, 8, 0)), follow * 0.55);
      aim(camera, cam, tgt, 0, lerp(40, 34, smooth(1, 5, lt)));
      shake(camera, gt, 0.002 + 0.02 * Math.exp(-Math.pow((lt - 1.0) / 0.2, 2)), 12);
      vapor(poseA, lt, 0); common(gt);
    },
    harborB(lt, gt) {
      const pose = poseB(lt); placeRig(jet, pose); jet.set(gt, { throttle: 1 });
      const out = pose.p.clone().sub(LIB).setY(0).normalize();
      const fwd = pose.fwd.clone();
      const cam = pose.p.clone().addScaledVector(out, 60).addScaledVector(fwd, -64).add(new THREE.Vector3(0, 6, 0));
      const tgt = pose.p.clone().lerp(new THREE.Vector3(LIB.x, 330, LIB.z), 0.22);
      aim(camera, cam, tgt, -0.12, 44);
      shake(camera, gt, 0.004, 7);
      vapor(poseB, lt, 1); common(gt);
    },
    skyline(lt, gt) {
      const pose = poseC(lt); placeRig(jet, pose); jet.set(gt, { throttle: 1, burnerScale: 1.1 });
      const cam = E.clone().add(new THREE.Vector3(210, 36, 330));
      const top = E.clone().add(new THREE.Vector3(0, 330, 0));
      const tgt = top.lerp(pose.p, 0.35 * smooth(0.4, 1.2, lt));
      aim(camera, cam, tgt, 0.18, 52);
      shake(camera, gt, 0.003 + 0.012 * Math.exp(-Math.pow((lt - 1.4) / 0.3, 2)), 10);
      vapor(poseC, lt, 0.4); common(gt);
    },
  };
  const sunFar = () => camera.position.clone().addScaledVector(SUN, 20000);
  const post = {
    harborA: { bloom: [0.45, 0.5, 1.0], exposure: 1.0, grade: { tint: [1.03, 0.99, 0.94], sat: 1.12, con: 1.12, ca: 0.0025 } },
    harborB: { bloom: [0.45, 0.5, 1.0], exposure: 1.0, grade: { tint: [1.03, 0.99, 0.94], sat: 1.12, con: 1.12, ca: 0.0025 } },
    skyline: { bloom: [0.5, 0.5, 1.0], exposure: 1.0, grade: { tint: [1.02, 0.99, 0.96], sat: 1.1, con: 1.12, ca: 0.003 } },
  };
  const burnerFlares = (i) => JET.nozzles.map((nz) => ({ pos: jet.world(nz), i, color: [255, 170, 110], len: 0.45, thick: 1.4, core: 36, ghosts: false }));
  const flares = {
    harborA: () => [{ pos: sunFar(), i: 0.8, color: [255, 180, 110], len: 1.2, thick: 2.5, core: 130 }, ...burnerFlares(0.3)],
    harborB: () => [{ pos: sunFar(), i: 0.8, color: [255, 180, 110], len: 1.2, thick: 2.5, core: 130 }, ...burnerFlares(0.4)],
    skyline: () => burnerFlares(0.5),
  };
  return { scene, camera, shots, post, flares };
}
