/**
 * TRUE EARTH Phase 1 — verify-true-scale: TRUE_SCALE's anisotropic camera
 * (lib/fly/true-scale.js, installed in components/fly/FlyCanvas.jsx, k0 set
 * per frame in components/fly/FlyScene.jsx).
 *
 * THE DEFECT. Scene X/Z are Mercator units (true metres × k, k = 1/cos lat)
 * and Y is metres, so everything rendered squashed by cos(lat).
 *
 * THE CONTRACT. With S = diag(1, k, 1), rendering the SCENE with the installed
 * camera must equal rendering S·scene with an ordinary rigid camera at S·p —
 * which is a uniformly scaled, true-proportioned copy of the real world —
 * while every scene-space reader keeps working:
 *  (1)  flag off: nothing is installed, k0 stays 1, three's chunks untouched;
 *  (2)  flag on, k0 = 1: the matrices are three's own, bit for bit;
 *  (3)  flag on, k0 = k: the view of x equals a rigid S-space camera's view of
 *       S·x (zero roll), and with roll the S-space view stays rigid, looks at
 *       the target and keeps screen-up;
 *  (4)  project/unproject round-trips; getWorldPosition/getWorldDirection
 *       still answer in scene space;
 *  (5)  the scene-space frustum (three's culling) keeps exactly the points the
 *       S-space camera sees;
 *  (6)  the player's model matrix (projectModelMatrix, horizontal × k) renders
 *       as a similarity — no shear, no squash — at any attitude;
 *  (7)  toSceneDir: a TRUE light direction reaches the view as that direction;
 *  (8)  the env-map helpers (JS mirror of the GLSL) return TRUE world
 *       directions, while the unpatched shadow-bias path keeps the scene normal;
 *  (9)  the ShaderChunk patch applies once, all-or-nothing;
 *  (10) faceCameraInto: billboards render square and screen-aligned;
 *  (11) wiring: installed in FlyCanvas onCreated, k0 published at the top of
 *       the main frame, before any camera rig runs.
 *
 * Run: node scripts/verify-true-scale.mjs
 */
import { register } from 'node:module';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const legArg = process.argv.find((a) => a.startsWith('--leg='));

// Deterministic poses: a small LCG, no Math.random.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

if (legArg) {
  const on = legArg === '--leg=on';
  if (on) globalThis.window = { location: { search: '' }, __flyTrueScaleOverride: { enabled: true } };
  register('./_node-resolve.mjs', import.meta.url);
  const THREE = await import('three');
  const { Frustum, Matrix4, PerspectiveCamera, Quaternion, Vector3, Euler, ShaderChunk } = THREE;
  const ts = await import('../lib/fly/true-scale.js');
  const { projectModelMatrix } = await import('../lib/fly/render-scale.js');
  const rand = rng(on ? 20261006 : 7);
  const out = { on: ts.trueScaleOn(), envPatch: ts.TRUE_SCALE_ENV_PATCH };

  if (!on) {
    const cam = new PerspectiveCamera(62, 16 / 9, 2.5, 600000);
    const umw = cam.updateMatrixWorld;
    out.installed = ts.installTrueScaleCamera(cam);
    out.methodsUntouched = cam.updateMatrixWorld === umw && !cam.__trueScale;
    ts.setTrueScaleK(1.5);
    out.k0 = ts.getTrueScaleK();
    out.chunksUntouched = !ShaderChunk.common.includes('tsTrue') && !ShaderChunk.envmap_fragment.includes('tsTrue');
    console.log(JSON.stringify(out));
    process.exit(0);
  }

  const S = (v, k) => new Vector3(v.x, v.y * k, v.z);
  const randPose = (cam, k, roll = 0) => {
    const p = new Vector3((rand() - 0.5) * 2e4, 50 + rand() * 12000, (rand() - 0.5) * 2e4);
    const dir = new Vector3(rand() - 0.5, (rand() - 0.7) * 0.9, rand() - 0.5).normalize();
    const target = p.clone().addScaledVector(dir, 30 + rand() * 3000);
    cam.position.copy(p);
    cam.up.set(0, 1, 0);
    cam.lookAt(target);
    if (roll) cam.rotateZ(roll);
    cam.updateMatrixWorld();
    return { p, target };
  };
  const rigid = new PerspectiveCamera(62, 16 / 9, 2.5, 600000);
  const cam = new PerspectiveCamera(62, 16 / 9, 2.5, 600000);
  out.installed = ts.installTrueScaleCamera(cam);
  out.installedTwice = ts.installTrueScaleCamera(cam);

  // (2) k0 = 1: three's own matrices, bit for bit
  ts.setTrueScaleK(1);
  {
    let same = true;
    for (let i = 0; i < 200; i++) {
      const { target } = randPose(cam, 1, i % 3 ? 0 : rand() - 0.5);
      rigid.position.copy(cam.position);
      rigid.quaternion.copy(cam.quaternion);
      rigid.updateMatrixWorld();
      for (let j = 0; j < 16; j++) {
        if (!Object.is(cam.matrixWorld.elements[j], rigid.matrixWorld.elements[j])) same = false;
        if (!Object.is(cam.matrixWorldInverse.elements[j], rigid.matrixWorldInverse.elements[j])) same = false;
      }
      void target;
    }
    out.k1Identity = same;
  }

  const KS = [1.0003, 1.3054, 1.5557, 2.0, 2.9238];
  const res = { viewErr: 0, rollRigidErr: 0, rollAim: true, rollUp: true, roundTrip: 0, worldPos: 0, worldDir: 0, frustumMismatch: 0, frustumTested: 0, simErr: 0, lightErr: 0, envNormalErr: 0, envRayErr: 0, shadowNormalErr: 0, billboardErr: 0, invErr: 0 };
  const camS = new PerspectiveCamera(62, 16 / 9, 2.5, 600000);
  const frA = new Frustum();
  const frB = new Frustum();
  const m = new Matrix4();
  for (const k of KS) {
    ts.setTrueScaleK(k);
    for (let i = 0; i < 120; i++) {
      // (3) zero roll: equals a rigid camera at S·p looking at S·target
      const { p, target } = randPose(cam, k);
      camS.position.copy(S(p, k));
      camS.up.set(0, 1, 0);
      camS.lookAt(S(target, k));
      camS.updateMatrixWorld();
      for (let j = 0; j < 6; j++) {
        const x = new Vector3((rand() - 0.5) * 4e4, rand() * 9000, (rand() - 0.5) * 4e4);
        const a = x.clone().applyMatrix4(cam.matrixWorldInverse);
        const b = S(x, k).applyMatrix4(camS.matrixWorldInverse);
        res.viewErr = Math.max(res.viewErr, a.distanceTo(b) / Math.max(1, b.length()));
      }
      // inverse consistency
      m.multiplyMatrices(cam.matrixWorld, cam.matrixWorldInverse);
      for (let j = 0; j < 16; j++) res.invErr = Math.max(res.invErr, Math.abs(m.elements[j] - (j % 5 === 0 ? 1 : 0)));
      // (4) round trip + scene-space world position/direction
      for (let j = 0; j < 6; j++) {
        const x = p.clone().add(new Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).multiplyScalar(4000));
        const v = x.clone().applyMatrix4(cam.matrixWorldInverse);
        if (v.z > -5) continue;
        const back = x.clone().project(cam).unproject(cam);
        res.roundTrip = Math.max(res.roundTrip, back.distanceTo(x) / x.distanceTo(p));
      }
      res.worldPos = Math.max(res.worldPos, cam.getWorldPosition(new Vector3()).distanceTo(p));
      const fwd = target.clone().sub(p).normalize();
      res.worldDir = Math.max(res.worldDir, cam.getWorldDirection(new Vector3()).distanceTo(fwd));
      // (5) culling: three's scene-space frustum keeps what the S-space camera sees
      frA.setFromProjectionMatrix(m.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
      frB.setFromProjectionMatrix(new Matrix4().multiplyMatrices(camS.projectionMatrix, camS.matrixWorldInverse));
      for (let j = 0; j < 25; j++) {
        const x = p.clone().add(new Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).multiplyScalar(30000));
        const sx = S(x, k);
        const margin = Math.min(...frB.planes.map((pl) => Math.abs(pl.distanceToPoint(sx))));
        if (margin < 1e-3) continue;
        res.frustumTested++;
        if (frA.containsPoint(x) !== frB.containsPoint(sx)) res.frustumMismatch++;
      }
      // (7) a TRUE light direction reaches the view as the true direction
      const dTrue = new Vector3(rand() - 0.5, rand(), rand() - 0.5).normalize();
      const viaScene = ts.toSceneDir(dTrue).transformDirection(cam.matrixWorldInverse);
      const expect = dTrue.clone().transformDirection(camS.matrixWorldInverse);
      res.lightErr = Math.max(res.lightErr, viaScene.distanceTo(expect));
      // (8) env helpers, mirrored from the GLSL
      const V = cam.matrixWorldInverse.elements;
      const kView = Math.hypot(V[4], V[5], V[6]);
      const vView = new Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize();
      const wT = new Vector3(V[0] * vView.x + V[1] * vView.y + V[2] * vView.z, V[4] * vView.x + V[5] * vView.y + V[6] * vView.z, V[8] * vView.x + V[9] * vView.y + V[10] * vView.z);
      const trueNormal = new Vector3(wT.x, wT.y / kView, wT.z).normalize();
      const trueExpect = vView.clone().transformDirection(camS.matrixWorld);
      res.envNormalErr = Math.max(res.envNormalErr, trueNormal.distanceTo(trueExpect));
      const x = new Vector3((rand() - 0.5) * 4e4, rand() * 9000, (rand() - 0.5) * 4e4);
      const sceneRay = x.clone().sub(p);
      const trueRay = new Vector3(sceneRay.x, sceneRay.y * kView, sceneRay.z).normalize();
      res.envRayErr = Math.max(res.envRayErr, trueRay.distanceTo(S(x, k).sub(camS.position).normalize()));
      // the shadow-bias path (unpatched transpose) must return the SCENE normal
      const nScene = new Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize();
      const nViewMat = new Matrix4().copy(cam.matrixWorldInverse).invert().transpose();
      const nView = nScene.clone().transformDirection(nViewMat);
      const back = new Vector3(V[0] * nView.x + V[1] * nView.y + V[2] * nView.z, V[4] * nView.x + V[5] * nView.y + V[6] * nView.z, V[8] * nView.x + V[9] * nView.y + V[10] * nView.z).normalize();
      res.shadowNormalErr = Math.max(res.shadowNormalErr, back.distanceTo(nScene));
      // (10) billboards: view-linear · billboard-linear = s·I
      const bb = new Matrix4();
      const placed = ts.faceCameraInto(bb, cam, x, 7.5);
      const mv = new Matrix4().multiplyMatrices(cam.matrixWorldInverse, bb).elements;
      if (!placed) res.billboardErr = Infinity;
      for (const [r, c] of [[0, 0], [1, 1], [2, 2]]) res.billboardErr = Math.max(res.billboardErr, Math.abs(mv[c * 4 + r] - 7.5));
      for (const [r, c] of [[0, 1], [0, 2], [1, 0], [1, 2], [2, 0], [2, 1]]) res.billboardErr = Math.max(res.billboardErr, Math.abs(mv[c * 4 + r]));
      // (6) the player matrix renders as a similarity
      const q = new Quaternion().setFromEuler(new Euler((rand() - 0.5) * 3, (rand() - 0.5) * 6, (rand() - 0.5) * 3, 'YXZ'));
      const pm = projectModelMatrix(new Matrix4().compose(x, q, new Vector3(1, 1, 1)), k).elements;
      const cols = [0, 4, 8].map((o) => new Vector3(pm[o], pm[o + 1] * k, pm[o + 2]));
      const len = cols.map((c) => c.length());
      res.simErr = Math.max(
        res.simErr,
        Math.abs(len[0] - k) / k, Math.abs(len[1] - k) / k, Math.abs(len[2] - k) / k,
        Math.abs(cols[0].dot(cols[1])) / k ** 2, Math.abs(cols[0].dot(cols[2])) / k ** 2, Math.abs(cols[1].dot(cols[2])) / k ** 2,
      );
    }
    // (3) with roll: the S-space view stays rigid, aims at the target, keeps screen-up
    for (let i = 0; i < 60; i++) {
      const roll = (rand() - 0.5) * 1.2;
      const { p, target } = randPose(cam, k, roll);
      const Ve = cam.matrixWorldInverse.elements;
      // V·S⁻¹ must be a rotation: columns of V_lin·S⁻¹ orthonormal
      const c0 = new Vector3(Ve[0], Ve[1], Ve[2]);
      const c1 = new Vector3(Ve[4], Ve[5], Ve[6]).multiplyScalar(1 / k);
      const c2 = new Vector3(Ve[8], Ve[9], Ve[10]);
      res.rollRigidErr = Math.max(res.rollRigidErr, Math.abs(c0.length() - 1), Math.abs(c1.length() - 1), Math.abs(c2.length() - 1), Math.abs(c0.dot(c1)), Math.abs(c0.dot(c2)), Math.abs(c1.dot(c2)));
      const t = target.clone().applyMatrix4(cam.matrixWorldInverse);
      if (!(Math.hypot(t.x, t.y) < 1e-6 * Math.abs(t.z) && t.z < 0)) res.rollAim = false;
      // screen-up: the rig's (rolled) up axis is exactly screen-up — roll is kept
      const upScene = new Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
      const u = p.clone().add(upScene).applyMatrix4(cam.matrixWorldInverse);
      if (!(u.y > 0 && Math.abs(u.x) < 1e-9 * u.length())) res.rollUp = false;
    }
  }
  out.res = res;
  out.chunkPatched = ShaderChunk.common.includes('tsTrueNormalByInverseViewMatrix') && ShaderChunk.envmap_physical_pars_fragment.includes('tsTrueNormalByInverseViewMatrix') && !ShaderChunk.shadowmap_vertex.includes('tsTrue');
  {
    // A second patch of the live (already patched) chunks is refused; a set
    // whose third anchor is missing is left untouched.
    const fresh = { ...ShaderChunk };
    const synthetic = {
      common: 'bool isPerspectiveMatrix( mat4 m ) {',
      envmap_physical_pars_fragment: 'vec3 worldNormal = transformNormalByInverseViewMatrix( normal, viewMatrix );\nreflectVec = transformDirectionByInverseViewMatrix( reflectVec, viewMatrix );',
      envmap_fragment: 'nothing here',
      envmap_vertex: '',
      lights_pars_begin: '',
    };
    const before = JSON.stringify(synthetic);
    out.allOrNothing = ts.patchEnvChunks(synthetic) === 'miss:envmap_fragment' && JSON.stringify(synthetic) === before;
    out.alreadyIdempotent = ts.patchEnvChunks(fresh) === 'already';
  }
  ts.setTrueScaleK(1);
  out.billboardK1 = ts.faceCameraInto(new Matrix4(), cam, new Vector3(), 2) === false;
  console.log(JSON.stringify(out));
  process.exit(0);
}

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}
const leg = (name) =>
  JSON.parse(
    execFileSync(process.execPath, [fileURLToPath(import.meta.url), `--leg=${name}`], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })
      .trim()
      .split('\n')
      .pop(),
  );
const e = (v) => (Number.isFinite(v) ? v.toExponential(1) : String(v));

const off = leg('off');
check('(1) flag off: nothing installed, k0 stays 1, three\'s chunks untouched', !off.on && off.installed === false && off.methodsUntouched && off.k0 === 1 && off.envPatch === 'off' && off.chunksUntouched, JSON.stringify(off));

const on = leg('on');
const r = on.res;
check('(2) flag on, k0 = 1: three\'s own matrices, bit for bit', on.on && on.installed === true && on.installedTwice === false && on.k1Identity);
check(
  '(3) the view of x equals a rigid camera at S·p viewing S·x; with roll it stays rigid, aimed and upright',
  r.viewErr < 1e-9 && r.invErr < 1e-9 && r.rollRigidErr < 1e-9 && r.rollAim && r.rollUp,
  `view ${e(r.viewErr)}, inverse ${e(r.invErr)}, roll-rigid ${e(r.rollRigidErr)}, aim ${r.rollAim}, up ${r.rollUp}`,
);
check('(4) project/unproject round-trips; world position and direction stay in scene space', r.roundTrip < 1e-9 && r.worldPos < 1e-9 && r.worldDir < 1e-9, `round-trip ${e(r.roundTrip)}, pos ${e(r.worldPos)}, dir ${e(r.worldDir)}`);
check('(5) three\'s scene-space frustum keeps exactly what the S-space camera sees', r.frustumTested > 2000 && r.frustumMismatch === 0, `${r.frustumMismatch} of ${r.frustumTested} points disagree`);
check('(6) the player model matrix renders as a similarity (no shear, no squash)', r.simErr < 1e-9, `worst ${e(r.simErr)}`);
check('(7) toSceneDir: a true light direction reaches the view unchanged', r.lightErr < 1e-9, `worst ${e(r.lightErr)}`);
check(
  '(8) env helpers return true world directions; the shadow-bias transpose keeps the scene normal',
  r.envNormalErr < 1e-9 && r.envRayErr < 1e-9 && r.shadowNormalErr < 1e-9,
  `normal ${e(r.envNormalErr)}, ray ${e(r.envRayErr)}, shadow ${e(r.shadowNormalErr)}`,
);
check('(9) the ShaderChunk patch applies once, all-or-nothing, and spares shadowmap_vertex', on.envPatch === 'patched' && on.chunkPatched && on.allOrNothing && on.alreadyIdempotent, `status ${on.envPatch}`);
check('(10) faceCameraInto renders square and screen-aligned; writes nothing at k0 = 1', r.billboardErr < 1e-9 && on.billboardK1, `worst ${e(r.billboardErr)}`);
{
  const canvas = readFileSync(path.join(ROOT, 'components/fly/FlyCanvas.jsx'), 'utf8');
  const scene = readFileSync(path.join(ROOT, 'components/fly/FlyScene.jsx'), 'utf8');
  const set = scene.indexOf('setTrueScaleK(cinemaOn(flyState) ? mercatorScale(flight.latDeg) : 1);');
  const rig = scene.indexOf('chase.update(dt, flight, camera');
  const ok = /onCreated=\{\(\{ gl, camera \}\) => \{[\s\S]{0,1600}installTrueScaleCamera\(camera\);/.test(canvas) && set > 0 && rig > set;
  check('(11) installed in FlyCanvas onCreated; k0 published before any camera rig runs', ok);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
