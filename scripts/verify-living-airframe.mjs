/**
 * LIVING WORLD — verify-living-airframe: the AIRFRAME workstream's gate
 * (VAPOR_FX, AIRFRAME_DETAIL).
 *
 *  (1) Flags OFF: every entry point returns null and touches nothing — on a
 *      real clone of every hangar GLB the materials keep their hooks, program
 *      keys, blending and colours, no mesh is hidden or added; the old wingtip
 *      ribbons keep their strength; PlayerPlane's block is the only edit to
 *      that file.
 *  (2) Flags ON: the survey finds what each hangar aircraft really has (a
 *      bubble canopy and a pilot, flush glazing or none; propellers and their
 *      blade counts; both wings), the finish carries every addition (one
 *      marker per patch, a tagged program key), the gating (Low, Neon,
 *      Classic) keeps today's frame, dispose() puts every material back
 *      exactly, a patch another owner drops (the cinema shadow rig's
 *      restore-what-I-found, on every tier step) is re-seated by update(), and
 *      running lights hanging off the skin (bbox-corner anchors) are seated.
 *  (3) The condensation's physics: the cone lives only in its Mach band and in
 *      humid air, the sheets grow with load, light aircraft and dry or high air
 *      make no tips, a fair-weather 1 g cruise makes nothing on any hangar
 *      aircraft, the ground and taxi speeds make nothing; the effect builds,
 *      runs and disposes cleanly, its ribbons face a rebased eye (the floating
 *      origin), and it takes the wingtip ribbons over.
 *  (4) WebGL2 (the real GPU where there is one; SwiftShader is fine): every
 *      patched program (panels after the livery paint, glass, running lights)
 *      and the four Living programs (prop disc, cone, sheet, tips) compile and
 *      link through three's own WebGLRenderer.
 *
 * Run: node scripts/verify-living-airframe.mjs
 * Legs run in child processes because each flag is a page-load (module-load)
 * decision, exactly as in the app.
 */
import { register } from 'node:module';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const leg = process.argv.find((a) => a.startsWith('--leg='))?.slice(6);
const BEGIN = '// LIVING WORLD AIRFRAME — begin';
const END = '// LIVING WORLD AIRFRAME — end';

// What each hangar aircraft really has (FLY_LIVING_WORLD.md, the AIRFRAME
// survey of the presentation GLBs): canopy kind, propellers [blades].
const EXPECT = {
  fighter: { canopy: 'bubble', props: [] },
  military: { canopy: 'bubble', props: [] },
  'warbird-jet': { canopy: 'bubble', props: [] },
  'warbird-prop': { canopy: 'bubble', props: [4] },
  prop: { canopy: 'flush', props: [2] },
  glider: { canopy: 'bubble', props: [] },
  bizjet: { canopy: 'none', props: [] },
  airliner: { canopy: 'none', props: [] },
  cargo: { canopy: 'none', props: [] },
  'flying-wing': { canopy: 'flush', props: [] },
  f35: { canopy: 'bubble', props: [] },
  c17: { canopy: 'flush', props: [] },
  concorde: { canopy: 'flush', props: [] },
};

function serialUniforms(u) {
  const out = {};
  for (const [k, cell] of Object.entries(u)) {
    const v = cell?.value;
    if (typeof v === 'number') out[k] = 'f';
    else if (v == null) out[k] = 't';
    else if (v.isMatrix4) out[k] = 'm4';
    else if (v.isColor) out[k] = 'c';
    else if (v.isVector3) out[k] = 'v3';
    else if (v.isVector2) out[k] = 'v2';
    else if ('w' in v) out[k] = 'v4';
    else if ('z' in v) out[k] = 'v3';
    else out[k] = 'unknown';
  }
  return out;
}

async function runLeg(on) {
  globalThis.window = { location: { search: '', href: 'http://localhost/' }, __flyVaporFxOverride: { enabled: on }, __flyAirframeDetailOverride: { enabled: on } };
  globalThis.self = globalThis.window;
  register('./_node-resolve.mjs', import.meta.url);
  register('./_alias-loader.mjs', import.meta.url);
  const imp = (rel) => import(new URL(`../${rel}`, import.meta.url).href);
  const THREE = await imp('node_modules/three/build/three.module.js');
  const { GLTFLoader } = await imp('node_modules/three/examples/jsm/loaders/GLTFLoader.js');
  const AD = await imp('lib/fly/airframe-detail.js');
  const VX = await imp('lib/fly/vapor-fx.js');
  const LA = await imp('lib/fly/living-airframe.js');
  const AE = await imp('lib/fly/aircraft-effects.js');
  const { PLAYER_AIRCRAFT } = await imp('lib/fly/player-aircraft.js');
  const { aircraftPresentation } = await imp('lib/fly/cinematic-earth.js');
  const { applyFleetLivery } = await imp('lib/fly/fleet-animation.js');
  const { useFlyStore } = await imp('stores/fly-store.js');
  const setLook = (s) => useFlyStore.setState(s);
  setLook({ mapStyle: 'satellite', visuals: 'enhanced', qualityTier: 'high' });

  const loader = new GLTFLoader();
  const glbs = new Map();
  async function cloneOf(id) {
    const aircraft = PLAYER_AIRCRAFT.find((a) => a.id === id);
    const entry = aircraftPresentation({ id, entry: aircraft }, false, { mapStyle: 'satellite', visuals: 'enhanced' });
    if (!glbs.has(entry.url)) {
      const b = fs.readFileSync(path.join(ROOT, 'public', entry.url));
      glbs.set(entry.url, await new Promise((res, rej) => loader.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '', res, rej)));
    }
    // The hangar's own clone: scene.clone(true) and a private material each.
    const root = glbs.get(entry.url).scene.clone(true);
    root.traverse((o) => { if (o.isMesh) o.material = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone(); });
    return { root, entry };
  }
  const snapshot = (root) => {
    const mats = [], meshes = [];
    root.traverse((o) => {
      if (!o.isMesh) return;
      meshes.push(`${o.name}:${o.visible}:${o.castShadow}`);
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        mats.push({ m, hook: m.onBeforeCompile, keyFn: m.customProgramCacheKey, key: m.customProgramCacheKey(), props: [m.transparent, m.blending, m.depthWrite, m.metalness, m.roughness, m.color?.getHexString(), m.clearcoat].join(',') });
      }
    });
    return { mats, meshes: meshes.join('|'), children: root.children.length };
  };
  const sameAs = (a, b) => a.meshes === b.meshes && a.children === b.children && a.mats.length === b.mats.length
    && a.mats.every((x, i) => x.m === b.mats[i].m && x.hook === b.mats[i].hook && x.keyFn === b.mats[i].keyFn && x.key === b.mats[i].key && x.props === b.mats[i].props);
  const compileText = (m) => {
    const lib = m.isPointsMaterial ? THREE.ShaderLib.points : m.isMeshPhysicalMaterial ? THREE.ShaderLib.physical : THREE.ShaderLib.standard;
    const shader = { vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader, uniforms: {} };
    m.onBeforeCompile(shader, null);
    return shader;
  };

  const out = { on, flags: { detail: AD.AIRFRAME_DETAIL_ON, vapor: VX.VAPOR_FX_ON }, fleet: {}, programs: [] };
  const ribbonsFlight = { bank: 0.9, speed: 150, turnRate: 0.3, pitchRate: 0.05, pitch: 0.05, operations: null, pos: { y: 1500 } };
  out.ribbonsBefore = AE.wingVaporStrength(ribbonsFlight);

  for (const id of Object.keys(EXPECT)) {
    const { root, entry } = await cloneOf(id);
    const before = snapshot(root);
    const h = AD.applyAirframeDetail(root, id, { mode: 'flight', canopyMaterial: entry.canopyMaterial });
    const row = { applied: !!h };
    if (!h) {
      row.untouched = sameAs(before, snapshot(root));
    } else {
      row.stats = h.stats;
      row.props = h.survey.props.map((p) => p.blades);
      row.wings = !!(h.survey.wing?.left && h.survey.wing?.right);
      // Every patched material: its program text carries the marker, its key the tag.
      const tags = new Set();
      let panelText = 0, glassText = 0;
      root.traverse((o) => {
        if (!o.isMesh || o.userData.livingAirframe) return;
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          const key = m.customProgramCacheKey();
          if (!/lw-/.test(key)) continue;
          for (const t of key.match(/lw-[a-z-]+-v\d/g)) tags.add(t);
          const s = compileText(m);
          if (key.includes('lw-panels-v1') && s.fragmentShader.includes('LIVING WORLD AIRFRAME_DETAIL: skin panels') && s.vertexShader.includes('vLwPanelP =')) panelText++;
          if (key.includes('lw-glass-v1') && s.fragmentShader.includes('LIVING WORLD AIRFRAME_DETAIL: canopy glass')) glassText++;
        }
      });
      row.tags = [...tags].sort();
      row.panelText = panelText;
      row.glassText = glassText;
      row.hiddenBlades = 0;
      for (const d of h.discs) d.node.traverse((o) => { if (o.isMesh && !o.visible) row.hiddenBlades++; });
      row.cockpit = !!root.getObjectByName('living-cockpit');
      // A 1 g cruise in a fair-weather sky condenses nothing on any airframe.
      const loading = VX.surveyLoading(id, h.survey, h.stats.metresPerUnit);
      const cruise = VX.vaporTargets({ speed: 200, altM: 1500, load: 1, env: { cloudCoverage: 0.45, overcast: 0, fog: 0, cloudBase: 1700, cloudThickness: 1500 }, loading });
      row.cruise = [cruise.cone, cruise.sheet, cruise.tips].map((x) => +x.toFixed(3));
      h.update(1 / 60);
      h.dispose();
      row.restored = sameAs(before, snapshot(root));
      // Hangar mode: the same finish, no discs.
      const hh = AD.applyAirframeDetail(root, id, { mode: 'hangar', canopyMaterial: entry.canopyMaterial });
      row.hangarDiscs = hh?.discs.length ?? -1;
      hh?.dispose();
      row.hangarRestored = sameAs(before, snapshot(root));
    }
    out.fleet[id] = row;
  }

  if (on) {
    // Gating: Low, Neon and Classic keep today's frame.
    const { root } = await cloneOf('fighter');
    const gate = {};
    for (const [name, look] of [['low', { qualityTier: 'low' }], ['neon', { mapStyle: 'toy' }], ['classic', { visuals: 'classic' }]]) {
      setLook({ mapStyle: 'satellite', visuals: 'enhanced', qualityTier: 'high', ...look });
      gate[name] = AD.applyAirframeDetail(root, 'fighter', {}) === null;
    }
    setLook({ mapStyle: 'satellite', visuals: 'enhanced', qualityTier: 'high' });
    out.gate = gate;

    // Heal: an owner wraps after ours and, leaving, puts back what IT found
    // (CinemaShadows.dispose) — ours is dropped; update() re-seats it once.
    const h = AD.applyAirframeDetail(root, 'fighter', { canopyMaterial: 'Canopy glass' });
    let hull = null;
    root.traverse((o) => { if (!hull && o.isMesh && !o.userData.livingAirframe && /lw-panels/.test(o.material.customProgramCacheKey?.() ?? '')) hull = o.material; });
    const ours = hull.onBeforeCompile, oursKey = hull.customProgramCacheKey;
    // Shadow-rig style owner that wrapped BEFORE ours: restore its own previous.
    const theirsPrev = { hook: () => {}, key: () => 'graded' };
    hull.onBeforeCompile = theirsPrev.hook; hull.customProgramCacheKey = theirsPrev.key;
    const dropped = !hull.customProgramCacheKey().includes('lw-panels-v1');
    h.update(1 / 60);
    const healed = hull.customProgramCacheKey().includes('lw-panels-v1') && compileText(hull).fragmentShader.includes('skin panels');
    h.update(1 / 60);
    const once = h.stats.healed;
    // An owner that wraps AFTER ours stays put on dispose; ours turns pass-through.
    const inner = hull.onBeforeCompile, innerKey = hull.customProgramCacheKey;
    hull.onBeforeCompile = (s, r) => { inner.call(hull, s, r); s.fragmentShader += '\n// later owner'; };
    hull.customProgramCacheKey = () => `${innerKey.call(hull)}|later`;
    h.dispose();
    const pass = compileText(hull);
    out.heal = {
      dropped, healed, once,
      passThrough: !pass.fragmentShader.includes('skin panels') && pass.fragmentShader.includes('// later owner') && !hull.customProgramCacheKey().includes('lw-panels') && hull.customProgramCacheKey().endsWith('|later'),
      oursReplaced: ours !== hull.onBeforeCompile && oursKey !== hull.customProgramCacheKey,
    };

    // Livery paint first, then the finish: the program a painted hull compiles.
    const painted = await cloneOf('fighter');
    applyFleetLivery(painted.root, 'fighter', 'earned');
    const hp = AD.applyAirframeDetail(painted.root, 'fighter', { canopyMaterial: painted.entry.canopyMaterial });
    const seen = new Set();
    painted.root.traverse((o) => {
      if (!o.isMesh) return;
      const m = o.material;
      const key = m.customProgramCacheKey?.() ?? '';
      const kind = key.includes('lw-panels') ? 'panels' : key.includes('lw-glass') ? 'glass' : o.name === 'living-cockpit' ? 'cockpit' : null;
      if (!kind || seen.has(kind)) return;
      seen.add(kind);
      const s = kind === 'cockpit' ? null : compileText(m);
      const u = {};
      if (s) Object.assign(u, serialUniforms(s.uniforms));
      out.programs.push({
        name: kind === 'panels' ? 'hull panels (after the livery paint)' : kind === 'glass' ? 'canopy glass' : 'cockpit',
        kind: m.isMeshPhysicalMaterial ? 'physical' : 'standard',
        params: { vertexColors: !!m.vertexColors, transparent: !!m.transparent, clearcoat: m.clearcoat ?? 0, side: m.side, blending: m.blending },
        vertex: s?.vertexShader ?? null, fragment: s?.fragmentShader ?? null, uniforms: u,
      });
    });
    hp.dispose();

    // Prop disc (the warbird's).
    const wp = await cloneOf('warbird-prop');
    const hd = AD.applyAirframeDetail(wp.root, 'warbird-prop', { canopyMaterial: wp.entry.canopyMaterial });
    const disc = hd.discs[0].mesh.material;
    out.programs.push({ name: 'prop disc', kind: 'shader', params: { side: disc.side, transparent: true }, vertex: disc.vertexShader, fragment: disc.fragmentShader, uniforms: serialUniforms(disc.uniforms) });
    hd.dispose();

    // Running lights.
    const pts = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ size: 1.2, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    const lb = snapshot({ traverse: (f) => f({ isMesh: true, name: 'pts', visible: true, castShadow: false, material: pts.material }), children: [] });
    let registered = 0, unregistered = 0;
    const lights = AD.finishRunningLights([pts], () => { registered++; return () => unregistered++; });
    const ls = compileText(pts.material);
    out.lights = {
      count: lights.count, registered,
      key: pts.material.customProgramCacheKey().includes('lw-day-lights-v1'),
      text: ls.vertexShader.includes('gl_PointSize = max( gl_PointSize, uLwLightMinPx );') && ls.vertexShader.includes('uLwLightPull') && ls.fragmentShader.includes('diffuseColor.rgb *= uLwLightGain;'),
    };
    out.programs.push({ name: 'running lights', kind: 'points', params: { vertexColors: true, transparent: true, size: 1.2 }, vertex: ls.vertexShader, fragment: ls.fragmentShader, uniforms: serialUniforms(ls.uniforms) });
    lights.update();
    lights.dispose();
    const la = snapshot({ traverse: (f) => f({ isMesh: true, name: 'pts', visible: true, castShadow: false, material: pts.material }), children: [] });
    out.lights.restored = sameAs(lb, la) && unregistered === registered;

    // Seating: PlayerLights' layout (PlayerPlane.jsx) on the real airframes. The
    // fighter's tail strobe hangs between its twin fins and the airliner's belly
    // beacon under its nacelles; both go onto the skin, and back on dispose.
    const { measureAircraftAnchors } = await imp('lib/fly/aircraft-presentation.js');
    const { computeModelCorrection } = await imp('lib/fly/model-loader.js');
    out.seat = {};
    for (const [id, idx] of [['fighter', 2], ['airliner', 3]]) {
      const { root, entry } = await cloneOf(id);
      const corr = computeModelCorrection(root, entry.targetLenM, entry.yawFixRad ?? null, entry.extraYawRad ?? 0);
      const { box, center: c, tips } = measureAircraftAnchors(root, corr, id);
      const len = box.max.z - box.min.z;
      const pts = [tips[0], tips[1], [0, box.max.y, box.max.z - len * 0.06], [0, box.min.y, c.z], [tips[0][0], tips[0][1], tips[0][2] + 0.25], [tips[1][0], tips[1][1], tips[1][2] + 0.25], [c.x - 0.6, c.y - 0.35, box.min.z + len * 0.16], [c.x + 0.6, c.y - 0.35, box.min.z + len * 0.16]];
      const outer = new THREE.Group(), mid = new THREE.Group(), corrG = new THREE.Group();
      corrG.rotation.y = corr.rotY; corrG.scale.setScalar(corr.scale);
      outer.add(mid); mid.add(corrG); corrG.add(root);
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts.flat()), 3));
      const P = new THREE.Points(geo, new THREE.PointsMaterial({ size: 1 }));
      outer.add(P);
      const L = AD.finishRunningLights([P], null, root);
      const a = geo.attributes.position;
      const moved = (i) => Math.hypot(a.getX(i) - pts[i][0], a.getY(i) - pts[i][1], a.getZ(i) - pts[i][2]);
      const row = { seated: L.seated, target: +moved(idx).toFixed(2), tipsKept: moved(0) < 1e-4 && moved(1) < 1e-4 };
      L.dispose();
      row.restored = pts.every((q, i) => moved(i) < 1e-4);
      out.seat[id] = row;
    }

    // The condensation, built on the real fighter and run through a pull.
    const f = await cloneOf('fighter');
    const rig = new THREE.Group(); rig.matrixAutoUpdate = false;
    const outer = new THREE.Group(); const corr = new THREE.Group();
    rig.add(outer); outer.add(corr); corr.add(f.root);
    const survey = (await imp('lib/fly/airframe-survey.js')).surveyAirframe(f.root, { canopyMaterial: f.entry.canopyMaterial });
    const mpu = 20 / survey.length;
    corr.scale.setScalar(mpu);
    const regs = [];
    const vx = VX.createVaporFx({ root: f.root, outer, survey, mpu, anchors: null, rig, register: (m) => { regs.push(m); return () => regs.splice(regs.indexOf(m), 1); }, aircraftId: 'fighter' });
    const cam = new THREE.PerspectiveCamera(); cam.position.set(0, 4, 30);
    const flight = { latDeg: 0, speed: 260, pos: { y: 900 }, groundElev: 0, pitch: 0.05, bank: 1.2, turnRate: 0, pitchRate: 0.2, operations: null };
    for (let i = 0; i < 90; i++) { rig.position.z -= flight.speed / 60; vx.update(flight, cam, 1 / 60, { allowed: true, held: false }); }
    out.vapor = { built: !!vx, registered: regs.length, names: regs.map((m) => m.material.name).sort(), stats: { ...vx.stats }, groups: [!!f.root.parent.getObjectByName('living-vapor'), !!outer.getObjectByName('living-vapor-tips')] };
    vx.update(flight, cam, 1 / 60, { allowed: false });
    out.vapor.lowDraws = vx.stats.draws;
    for (const m of regs) out.programs.push({ name: m.material.name, kind: 'shader', params: { side: m.material.side, transparent: true }, vertex: m.material.vertexShader, fragment: m.material.fragmentShader, uniforms: serialUniforms(m.material.uniforms) });
    vx.dispose();
    out.vapor.disposed = regs.length === 0 && !f.root.parent.getObjectByName('living-vapor') && !outer.getObjectByName('living-vapor-tips');

    // The floating origin: the rig sits at ABSOLUTE coordinates inside a world
    // root shifted by the anchor, the camera holds REBASED ones. With the eye on
    // the port trail 30 m behind, the ribbon points beside it must fade out
    // (the near fade) — an eye taken as camera − rig is 8 km off and never does.
    {
      const fo = await cloneOf('fighter');
      const worldRoot = new THREE.Group(); worldRoot.position.set(-8000, 0, 0);
      const frig = new THREE.Group(); frig.position.set(8000, 900, 0);
      const fouter = new THREE.Group(), fcorr = new THREE.Group();
      worldRoot.add(frig); frig.add(fouter); fouter.add(fcorr); fcorr.add(fo.root);
      fcorr.scale.setScalar(mpu);
      const fx = VX.createVaporFx({ root: fo.root, outer: fouter, survey, mpu, anchors: null, rig: frig, register: () => () => {}, aircraftId: 'fighter' });
      const fcam = new THREE.PerspectiveCamera();
      const tipX = fx.debug.tipLocal[0].x;
      for (let i = 0; i < 60; i++) {
        frig.position.z -= flight.speed / 60;
        worldRoot.updateMatrixWorld(true);
        fcam.position.set(tipX, 900, frig.position.z + 30);
        fx.update(flight, fcam, 1 / 60, { allowed: true, held: false });
      }
      const rb = fx.debug.ribbons, eye = new THREE.Vector3(tipX, 0, 30);
      let near = 0, nearLit = 0, far = 0;
      for (let i = 0; i < rb.trails[0].length; i++) {
        const sp = rb.trails[0][rb.trails[0].length - 1 - i];
        const a = rb.alpha.getX(i * 2);
        const d = Math.hypot(sp.p.x - eye.x, sp.p.z - eye.z);
        if (d < 3.5) { near++; if (a > 1e-3) nearLit++; } else if (d > 25 && a > 0.05) far++;
      }
      out.vapor.floatingOrigin = { near, nearLit, far };
      fx.dispose();
    }

    // The owner hook: while the condensation owns the tips, the ribbons stand down.
    const release = AE.setWingVaporOwner(() => true);
    out.ribbonsOwned = AE.wingVaporStrength(ribbonsFlight);
    release();
    out.ribbonsReleased = AE.wingVaporStrength(ribbonsFlight);

    // The whole mount, as PlayerPlane calls it.
    const m = await cloneOf('warbird-prop');
    const mrig = new THREE.Group(); mrig.matrixAutoUpdate = false;
    const mouter = new THREE.Group(), mcorr = new THREE.Group();
    mrig.add(mouter); mouter.add(mcorr); mcorr.add(m.root);
    mouter.add(new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial()));
    const mb = snapshot(m.root);
    const mounted = LA.mountLivingAirframe({ flight: { ...flight, playerRig: mrig }, aircraft: { id: 'warbird-prop' }, entry: m.entry, root: m.root, correction: { scale: 10 / survey.length }, anchors: null });
    mounted.update({ camera: cam }, 1 / 60);
    out.mount = { detail: !!mounted.detail, vapor: !!mounted.vapor, discs: mounted.detail?.discs.length ?? 0 };
    mounted.dispose();
    out.mount.restored = sameAs(mb, snapshot(m.root)) && mouter.children.length === 2;
  } else {
    const { root, entry } = await cloneOf('fighter');
    const rig = new THREE.Group(); rig.matrixAutoUpdate = false;
    const outer = new THREE.Group(), corr = new THREE.Group();
    rig.add(outer); outer.add(corr); corr.add(root);
    const before = snapshot(root);
    out.mountNull = LA.mountLivingAirframe({ flight: { playerRig: rig }, aircraft: { id: 'fighter' }, entry, root, correction: { scale: 1 }, anchors: null }) === null;
    out.vaporNull = VX.createVaporFx({ root, outer, survey: { length: 1 }, mpu: 1, anchors: null, rig, register: () => () => {}, aircraftId: 'fighter' }) === null;
    out.lightsCount = null;
    out.mountUntouched = sameAs(before, snapshot(root)) && outer.children.length === 1;
  }
  out.ribbonsAfter = AE.wingVaporStrength(ribbonsFlight);

  // Physics (pure; the same functions both legs, compared in the parent).
  const L = (id, span, area) => VX.airframeLoading(id, span, area);
  const humid = { cloudCoverage: 0.8, overcast: 0.3, fog: 0, cloudBase: 1500, cloudThickness: 1500 };
  const dry = { cloudCoverage: 0, overcast: 0, fog: 0, cloudBase: 3000, cloudThickness: 500 };
  const fighter = L('fighter', 13, 50), prop = L('prop', 11, 16), airliner = L('airliner', 60, 360);
  const a1000 = VX.isaAir(1000).a;
  const T = (o) => VX.vaporTargets({ altM: 1000, groundM: 0, env: humid, loading: fighter, load: 1, ...o });
  out.physics = {
    machBand: [0.7, 0.95, 1.25].map((M) => +T({ speed: M * a1000 }).cone.toFixed(3)),
    coneDry: +VX.vaporTargets({ speed: 0.95 * VX.isaAir(11500).a, altM: 11500, env: dry, loading: fighter }).cone.toFixed(3),
    sheetLoad: [1, 2, 6].map((n) => +T({ speed: 230, load: n }).sheet.toFixed(3)),
    tipsFighter: +T({ speed: 150, load: 7 }).tips.toFixed(3),
    tipsProp: +T({ speed: 60, load: 3, loading: prop }).tips.toFixed(3),
    tipsDry: +VX.vaporTargets({ speed: 200, altM: 1000, env: dry, loading: fighter, load: 1.5 }).tips.toFixed(3),
    airlinerCruise: (() => { const t = VX.vaporTargets({ speed: 0.8 * VX.isaAir(11000).a, altM: 11000, env: humid, loading: airliner, load: 1 }); return [t.cone, t.sheet, t.tips].map((x) => +x.toFixed(3)); })(),
    grounded: (() => { const t = T({ speed: 0.95 * a1000, load: 6, grounded: true }); return t.cone + t.sheet + t.tips; })(),
    taxi: (() => { const t = T({ speed: 20, load: 6 }); return t.cone + t.sheet + t.tips; })(),
    levelLoad: +VX.loadFactor({ speed: 200, pitch: 0, turnRate: 0, pitchRate: 0 }).toFixed(4),
    turn60: +VX.loadFactor({ speed: 200, pitch: 0, turnRate: (9.80665 * Math.tan(Math.PI / 3)) / 200, pitchRate: 0 }).toFixed(4),
  };
  return out;
}

if (leg) {
  const res = await runLeg(leg === 'on');
  process.stdout.write(JSON.stringify(res));
  process.exit(0);
}

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { (ok ? pass++ : fail++); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`); };
const run = (l) => JSON.parse(execFileSync(process.execPath, ['--no-warnings', fileURLToPath(import.meta.url), `--leg=${l}`], { cwd: ROOT, maxBuffer: 256 << 20 }).toString());
const off = run('off');
const on = run('on');
const ids = Object.keys(EXPECT);

// (1) off
check('(1a) flags off: both blocks read off', !off.flags.detail && !off.flags.vapor);
check('(1b) flags off: applyAirframeDetail is null and every hangar clone is untouched', ids.every((id) => !off.fleet[id].applied && off.fleet[id].untouched), ids.filter((id) => off.fleet[id].applied || !off.fleet[id].untouched).join(', '));
check('(1c) flags off: the mount and the condensation are null; nothing added or patched', off.mountNull && off.vaporNull && off.mountUntouched);
check('(1d) flags off: the wingtip ribbons keep their strength', off.ribbonsBefore > 0 && off.ribbonsAfter === off.ribbonsBefore && on.ribbonsBefore === off.ribbonsBefore, `${off.ribbonsBefore}`);
{
  const src = fs.readFileSync(path.join(ROOT, 'components/fly/PlayerPlane.jsx'), 'utf8');
  const begins = src.split(BEGIN).length - 1, ends = src.split(END).length - 1;
  let headSrc = null;
  try {
    // The newest committed PlayerPlane.jsx WITHOUT the block (the file before this workstream).
    const log = execFileSync('git', ['log', '--format=%H', '--', 'components/fly/PlayerPlane.jsx'], { cwd: ROOT }).toString().trim().split('\n');
    for (const sha of log) {
      const text = execFileSync('git', ['show', `${sha}:components/fly/PlayerPlane.jsx`], { cwd: ROOT, maxBuffer: 64 << 20 }).toString();
      if (!text.includes(BEGIN)) { headSrc = text; break; }
    }
  } catch { /* not a checkout */ }
  const norm = (s) => s.replace(/\r\n/g, '\n');
  const a = norm(src), i = a.indexOf(BEGIN), j = a.indexOf(END);
  const lineStart = a.lastIndexOf('\n', i) + 1, lineEnd = a.indexOf('\n', j) + 1;
  const stripped = a.slice(0, lineStart) + a.slice(lineEnd);
  check('(1e) PlayerPlane.jsx: one marked block, and the file outside it is the previous file byte for byte',
    begins === 1 && ends === 1 && i < j && headSrc != null && stripped === norm(headSrc), headSrc == null ? 'no pre-block history found' : `${begins}/${ends} markers`);
}

// (2) on
check('(2a) flags on: both blocks read on', on.flags.detail && on.flags.vapor);
{
  const bad = [];
  for (const id of ids) {
    const r = on.fleet[id], e = EXPECT[id];
    const s = r.stats ?? {};
    const want = e.canopy;
    const ok = r.applied && s.canopy === want && s.pilot === (want === 'bubble') && r.cockpit === (want === 'bubble')
      && JSON.stringify(r.props) === JSON.stringify(e.props) && s.propDiscs === e.props.length && r.wings
      && s.panels.materials > 0 && r.panelText === s.panels.materials
      && (want === 'bubble' ? r.glassText > 0 : r.glassText === 0)
      && (e.props.length ? r.hiddenBlades > 0 : r.hiddenBlades === 0);
    if (!ok) bad.push(`${id}: ${JSON.stringify({ canopy: s.canopy, pilot: s.pilot, props: r.props, wings: r.wings, panels: s.panels?.materials, panelText: r.panelText, glassText: r.glassText, blades: r.hiddenBlades })}`);
  }
  check('(2b) the survey finds each aircraft\'s canopy, pilot, propellers and wings; every patch is in its program', !bad.length, bad.join(' | ') || `${ids.length} aircraft`);
}
check('(2c) dispose() restores every hangar clone exactly (hooks, keys, blending, colours, visibility, children)', ids.every((id) => on.fleet[id].restored && on.fleet[id].hangarRestored), ids.filter((id) => !on.fleet[id].restored || !on.fleet[id].hangarRestored).join(', '));
check('(2d) hangar mode: the same finish, no propeller discs', ids.every((id) => on.fleet[id].hangarDiscs === 0));
check('(2e) Low, Neon and Classic keep today\'s frame', on.gate.low && on.gate.neon && on.gate.classic, JSON.stringify(on.gate));
check('(2f) a patch another owner drops is re-seated once by update()', on.heal.dropped && on.heal.healed && on.heal.once === 1, JSON.stringify(on.heal));
check('(2g) dispose under a later owner: ours turns pass-through, theirs stays', on.heal.passThrough && on.heal.oursReplaced);
check('(2h) running lights: patched, moved to the sky overlays, restored', on.lights.count === 1 && on.lights.registered === 1 && on.lights.key && on.lights.text && on.lights.restored, JSON.stringify(on.lights));
check('(2h2) floating lights seat on the skin (the fighter tail strobe, the airliner belly beacon), the wingtips stay, dispose restores', Object.values(on.seat).every((r) => r.seated >= 1 && r.target > 0.5 && r.tipsKept && r.restored), JSON.stringify(on.seat));
check('(2i) the whole mount: finish + discs + condensation, then a clean dispose', on.mount.detail && on.mount.vapor && on.mount.discs === 1 && on.mount.restored, JSON.stringify(on.mount));

// (3) physics + the effect
const p = on.physics;
check('(3a) physics is the same function in both legs', JSON.stringify(p) === JSON.stringify(off.physics));
check('(3b) the cone lives in its Mach band only (M0.7 / 0.95 / 1.25)', p.machBand[0] === 0 && p.machBand[1] > 0.5 && p.machBand[2] === 0, JSON.stringify(p.machBand));
check('(3c) no cone in dry air at altitude', p.coneDry < 0.02, `${p.coneDry}`);
check('(3d) the over-wing sheets grow with load (1 g / 2 g / 6 g)', p.sheetLoad[0] < 0.05 && p.sheetLoad[0] < p.sheetLoad[1] && p.sheetLoad[1] < p.sheetLoad[2] && p.sheetLoad[2] > 0.5, JSON.stringify(p.sheetLoad));
check('(3e) tips: a pulling fighter in humid air yes; a light single, or a gentle turn in dry air, no', p.tipsFighter > 0.3 && p.tipsProp < 0.02 && p.tipsDry < 0.02, `${p.tipsFighter} / ${p.tipsProp} / ${p.tipsDry}`);
check('(3f) an airliner cruising at FL360 makes nothing', p.airlinerCruise.every((x) => x < 0.02), JSON.stringify(p.airlinerCruise));
check('(3g) on the ground and at taxi speed nothing', p.grounded === 0 && p.taxi === 0);
check('(3g2) a fair-weather 1 g cruise condenses nothing on any of the hangar aircraft', ids.every((id) => on.fleet[id].cruise.every((x) => x < 0.05)), ids.filter((id) => !on.fleet[id].cruise.every((x) => x < 0.05)).map((id) => `${id} ${on.fleet[id].cruise}`).join(', ') || 'all 13');
check('(3h) load factor: level 1 g, a coordinated 60° turn 2 g', Math.abs(p.levelLoad - 1) < 1e-3 && Math.abs(p.turn60 - 2) < 1e-3, `${p.levelLoad} / ${p.turn60}`);
const v = on.vapor;
check('(3i) the condensation builds (cone, sheet, tips), registers as sky overlays and runs', v.built && v.registered === 3 && JSON.stringify(v.names) === '["lw-vapor-cone","lw-vapor-sheet","lw-vapor-tips"]' && v.groups.every(Boolean) && v.stats.sheet > 0.3 && v.stats.tips > 0.1 && v.stats.draws >= 2, JSON.stringify(v.stats));
check('(3j) not allowed (Low) draws nothing; dispose unregisters and removes', v.lowDraws === 0 && v.disposed);
check('(3j2) floating origin: the ribbons fade beside a rebased eye (8 km anchor) and show away from it', v.floatingOrigin.near > 0 && v.floatingOrigin.nearLit === 0 && v.floatingOrigin.far > 0, JSON.stringify(v.floatingOrigin));
check('(3k) while the condensation owns the tips the old ribbons stand down, and come back', on.ribbonsOwned === 0 && on.ribbonsReleased === on.ribbonsBefore);

// (4) compile + link through three's own renderer
const { chromium } = await import('playwright');
const linuxExe = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const win = process.platform === 'win32';
const browser = await chromium.launch({
  executablePath: fs.existsSync(linuxExe) ? linuxExe : undefined,
  headless: true,
  args: win ? ['--use-angle=d3d11', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
try {
  const page = await browser.newPage();
  const files = { 'three.module.js': 'node_modules/three/build/three.module.js', 'three.core.js': 'node_modules/three/build/three.core.js' };
  await page.route('http://gate.local/**', (r) => {
    const name = r.request().url().split('/').pop();
    if (files[name]) return r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(ROOT, files[name]), 'utf8') });
    return r.fulfill({ contentType: 'text/html', body: '<!doctype html><script type="module">import * as THREE from "http://gate.local/three.module.js"; window.THREE = THREE;</script>' });
  });
  await page.goto('http://gate.local/');
  await page.waitForFunction(() => !!window.THREE);
  const results = await page.evaluate((programs) => {
    const { THREE } = window;
    const canvas = document.createElement('canvas');
    canvas.width = 64; canvas.height = 64;
    const renderer = new THREE.WebGLRenderer({ canvas });
    renderer.shadowMap.enabled = true;
    const errors = [];
    renderer.debug.onShaderError = (gl, program, vs, fs) => errors.push(`${gl.getProgramInfoLog(program)}\n${gl.getShaderInfoLog(vs)}\n${gl.getShaderInfoLog(fs)}`.trim().slice(0, 1500));
    const value = (t) => ({ f: 0, t: null, m4: new THREE.Matrix4(), c: new THREE.Color(), v2: new THREE.Vector2(), v3: new THREE.Vector3(), v4: new THREE.Vector4() }[t]);
    const out = [];
    for (const p of programs) {
      const scene = new THREE.Scene();
      const sun = new THREE.DirectionalLight(0xffffff, 2); sun.castShadow = true; sun.position.set(1, 2, 1);
      scene.add(sun, new THREE.HemisphereLight(0x8899aa, 0x223344, 0.5));
      const uniforms = Object.fromEntries(Object.entries(p.uniforms).map(([k, t]) => [k, { value: value(t) }]));
      let material;
      if (p.kind === 'shader') {
        material = new THREE.ShaderMaterial({ uniforms, vertexShader: p.vertex, fragmentShader: p.fragment, transparent: true, side: p.params.side });
      } else {
        material = p.kind === 'points' ? new THREE.PointsMaterial(p.params) : p.kind === 'physical' ? new THREE.MeshPhysicalMaterial(p.params) : new THREE.MeshStandardMaterial(p.params);
        if (p.vertex) material.onBeforeCompile = (s) => { s.vertexShader = p.vertex; s.fragmentShader = p.fragment; Object.assign(s.uniforms, uniforms); };
        material.customProgramCacheKey = () => `gate-${p.name}`;
      }
      const geometry = new THREE.BoxGeometry(1, 1, 1);
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(geometry.attributes.position.count * 3).fill(0.5), 3));
      const object = p.kind === 'points' ? new THREE.Points(geometry, material) : new THREE.Mesh(geometry, material);
      object.castShadow = p.kind !== 'points' && p.kind !== 'shader';
      scene.add(object);
      const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100); camera.position.set(0, 0, 4);
      const before = errors.length;
      renderer.render(scene, camera);
      const gl = renderer.getContext();
      const info = renderer.properties.get(material).currentProgram;
      const ok = !!info && errors.length === before && (info.diagnostics == null || info.diagnostics.runnable);
      out.push([p.name, ok ? null : (errors.slice(before).join('\n') || 'no program'), gl.getParameter(gl.RENDERER)]);
      material.dispose(); geometry.dispose();
    }
    return out;
  }, on.programs);
  for (const [name, err, gpu] of results) check(`(4) ${name} compiles and links`, !err, err ?? gpu);
  check('(4z) every program was compiled', results.length === on.programs.length && on.programs.length === 8, `${results.length} of ${on.programs.length}`);
} finally {
  await browser.close();
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
