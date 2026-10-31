// Integration gate for operator paint. Exercises the real fleet, shaders and
// GPU-resource ownership in node; rendered appearance is a separate browser
// check. Run: node scripts/verify-operator-render.mjs
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./_node-resolve.mjs', import.meta.url);

// Keep this gate about aircraft paint; live shadow policy is independently
// certified and does not change between the two operator-paint arms.
globalThis.window = { __flyTrafficShadowsOverride: { enabled: false } };
const THREE = await import('three');
const { OPERATOR_LIVERIES: FLAG } = await import('../lib/fly/fly-constants.js');
const { OPERATOR_LIVERIES: SCHEMES, liveryForAircraft } = await import('../lib/fly/operator-liveries.mjs');
const { FLEET_FAMILIES, FAMILY_INDEX } = await import('../lib/fly/fleet-types.js');
const { DetailedTraffic } = await import('../lib/fly/detailed-traffic.js');
const { buildLiveAirframe } = await import('../lib/fly/live-aircraft-geometry.js');
const { buildPaletteData, createFleetShared, createFleetMaterial, paletteRow } = await import('../lib/fly/fleet-material.js');
const { buildOperatorPaletteData, resolveTrackLivery, retainOperatorResources } = await import('../lib/fly/operator-livery-render.js');
const { createTrafficNavMaterial } = await import('../lib/fly/world-material-factories.js');
const { createTrafficOperatorPaint, attachTrafficOperatorPaint, detachTrafficOperatorPaint, bindTrafficOperatorGeometry, writeTrafficOperatorPaint } = await import('../lib/fly/traffic-operator-paint.js');

let checks = 0;
function check(name, fn) {
  fn();
  checks++;
  console.log(`PASS ${name}`);
}
const enable = (enabled) => { window.__flyOperatorLiveriesOverride = { enabled }; };
const expected = (flight, palette = 'civil') => (liveryForAircraft({ flight }, palette)?.index ?? -1) + 1;
const neutral = buildPaletteData();
const flight = { pos: { x: 0, y: 100, z: 0 } };
const origin = { anchor: { x: 0, z: 0 } };
const camera = new THREE.PerspectiveCamera(58, 16 / 9, 1, 500000);
camera.updateProjectionMatrix();
const context = { camera, heightPx: 1080, modelRangeM: 60000, dt: 1 / 60, now: 10 };
function track(flightId, distance = 1000, type = 'B738', n = 0) {
  return { hex: `e${n.toString(16).padStart(5, '0')}`, meta: { t: type, flight: flightId, r: `N${n + 100}OP` },
    archetype: 0, opacity: 1, distM: distance, flags: 0,
    rx: distance, rz: 0, ry: 2500, ryd: 2500, scaleK: 1, yaw: 0, bank: 0,
    fix1: { vE: 170, vN: 0, vUp: 0, latRad: 0.7 } };
}
function ready() {
  const renderer = new DetailedTraffic();
  while (!renderer.prepare()) { /* real up-front build queue */ }
  // In node there is no Canvas2D registration atlas; emulate a valid lease
  // to exercise the existing registration + variant float packing too.
  renderer.atlas.slot = () => 3;
  return renderer;
}
function update(renderer, items, ctx = context) {
  renderer.update(items, flight, origin, 'high', null, true, 10, ctx);
}
function drawn(renderer) {
  return renderer.group.children.filter((mesh) => mesh.isInstancedMesh && mesh.count > 0);
}
function snapshot(renderer) {
  return drawn(renderer).map((mesh) => ({
    name: mesh.name, count: mesh.count,
    a: Array.from(mesh.userData.fleetA.array.slice(0, mesh.count * 4)),
    b: Array.from(mesh.userData.fleetB.array.slice(0, mesh.count * 4)),
    matrices: Array.from(mesh.instanceMatrix.array.slice(0, mesh.count * 16)),
    tint: Array.from(mesh.instanceColor.array.slice(0, mesh.count * 3)),
  })).sort((a, b) => a.name.localeCompare(b.name));
}
function compile(material, physical = true) {
  const base = physical ? THREE.ShaderLib.physical : THREE.ShaderLib.standard;
  const shader = { vertexShader: base.vertexShader, fragmentShader: base.fragmentShader, uniforms: {} };
  material.onBeforeCompile(shader, {});
  return shader;
}

check('flag ships on; explicit off leaves neutral shaders, uniforms and geometry unchanged', () => {
  assert.equal(FLAG.enabled, true, 'owner requested the enabled shipping default');
  enable(false);
  const off = createFleetShared({ texture: null });
  assert.equal(off.uFleetOperatorMarks, undefined);
  assert.equal(off.disposeOperators, undefined);
  assert.equal(off.uFleetPalette.value.image.width, 8);
  assert.equal(off.uFleetPalette.value.image.height, 256);
  assert.deepEqual(off.uFleetPalette.value.image.data, neutral);
  assert.equal(createTrafficOperatorPaint(), null);

  // Static parked scenery is the unchanged neutral path even when the
  // feature is enabled for live aircraft. Its shader is the off-arm oracle.
  enable(true);
  const parked = createFleetShared(null);
  assert.equal(parked.uFleetOperatorMarks, undefined);
  const f = FLEET_FAMILIES[FAMILY_INDEX.b737];
  const built = buildLiveAirframe(f, 'mid');
  const offMaterial = createFleetMaterial(f, built.parts, off);
  const parkedMaterial = createFleetMaterial(f, built.parts, parked);
  const a = compile(offMaterial), b = compile(parkedMaterial);
  assert.equal(a.vertexShader, b.vertexShader);
  assert.equal(a.fragmentShader, b.fragmentShader);
  assert.equal(offMaterial.customProgramCacheKey(), parkedMaterial.customProgramCacheKey());
  assert.doesNotMatch(a.vertexShader + a.fragmentShader, /aFleetLivery|uFleetOperatorMarks/);
  assert.deepEqual(Object.keys(a.uniforms).sort(), Object.keys(b.uniforms).sort());
  offMaterial.dispose(); parkedMaterial.dispose(); built.hull.dispose();

  enable(false);
  const renderer = ready();
  for (const mesh of renderer.group.children) {
    assert.equal(mesh.geometry?.attributes.aFleetLivery, undefined);
    assert.equal(mesh.userData.fleetLivery, undefined);
  }
  renderer.dispose();
});

check('extended palette preserves all 256 neutral rows and every legacy flag byte', () => {
  const before = neutral.slice();
  const extended = buildOperatorPaletteData(neutral);
  assert.deepEqual(neutral, before, 'the source palette is never mutated');
  assert.equal(extended.length, (256 + SCHEMES.length) * 10 * 4);
  for (let row = 0; row < 256; row++) {
    assert.deepEqual(extended.slice(row * 40, row * 40 + 32), neutral.slice(row * 32, row * 32 + 32), `neutral row ${row}`);
  }
  for (const scheme of SCHEMES) {
    const start = (256 + scheme.index) * 40;
    const rgb = [1, 3, 5].map((i) => parseInt(scheme.colors.body.slice(i, i + 2), 16));
    assert.deepEqual(Array.from(extended.slice(start, start + 4)), [...rgb, 255]);
  }
});

check('real mixed-carrier instances carry their own livery through hero, mid and far LODs', () => {
  const makeItems = () => [track('SWA100', 100, 'B738', 1), track('DAL200', 900, 'B738', 2),
    track('UAL300', 6000, 'B738', 3), track('AAL400', 1000, 'B738', 4), track('SKW500', 1100, 'B738', 5)];
  enable(false);
  const off = ready(), offItems = makeItems();
  update(off, offItems);
  const neutralSnapshot = snapshot(off), offStats = { draws: off.stats.draws, triangles: off.stats.triangles };
  off.dispose();

  enable(true);
  const renderer = ready(), items = makeItems();
  update(renderer, items);
  assert.deepEqual(items.map((it) => it.fleet.lod), ['hero', 'mid', 'far', 'mid', 'mid']);
  assert.deepEqual(snapshot(renderer), neutralSnapshot, 'geometry poses, registration, variants and animation packing stay unchanged');
  assert.deepEqual({ draws: renderer.stats.draws, triangles: renderer.stats.triangles }, offStats, 'paint adds no draws or triangles');
  assert.equal(renderer.stats.liveries, 4);
  const family = renderer.families[FAMILY_INDEX.b737];
  assert.equal(family.hero.material, family.mid.material, 'hero and mid share the family material');
  assert.deepEqual(Array.from(family.hero.userData.fleetLivery.array.slice(0, family.hero.count)), [expected('SWA100')]);
  assert.deepEqual(Array.from(family.mid.userData.fleetLivery.array.slice(0, family.mid.count)), [expected('DAL200'), expected('AAL400'), 0]);
  const far = renderer.far[family.f.far].mesh;
  assert.deepEqual(Array.from(far.userData.fleetLivery.array.slice(0, far.count)), [expected('UAL300')]);
  const packed = family.hero.userData.fleetB.getX(0), spec = items[0].fleetType.spec;
  assert.equal(packed % 256, paletteRow(family.f.palette, spec.seed));
  assert.equal(Math.floor(packed / 256) % 256, spec.variant);
  assert.equal(Math.floor(packed / 65536) - 1, 3, 'nonzero registration lease survives operator indexing');
  for (const mesh of drawn(renderer)) {
    assert.equal(mesh.geometry.attributes.aFleetLivery, mesh.userData.fleetLivery);
    assert.ok(mesh.userData.fleetLivery.version > 0, 'instance paint is uploaded');
    const shader = compile(mesh.material);
    assert.match(shader.vertexShader, /attribute float aFleetLivery/);
    assert.match(shader.fragmentShader, /vFleetLivery/);
    assert.equal(shader.uniforms.uFleetOperatorMarks.value, renderer.shared.uFleetOperatorMarks.value);
    assert.ok(shader.fragmentShader.indexOf('fleetOperatorMark(uv, false)') < shader.fragmentShader.indexOf('// Cabin windows and doors.'), 'glazing overlays body paint');
  }

  items[2].meta.flight = 'DAL301';
  update(renderer, items);
  assert.equal(far.userData.fleetLivery.getX(0), expected('DAL301'), 'same-object feed update changes paint');
  items[2].meta.flight = '';
  update(renderer, items);
  assert.equal(far.userData.fleetLivery.getX(0), 0, 'cleared identity returns to neutral');
  assert.equal(renderer.stats.liveries, 3);
  renderer.dispose();
});

check('track cache refreshes for every supported identity and military field', () => {
  const withoutMetadata = {};
  assert.equal(resolveTrackLivery(withoutMetadata, 'civil'), null);
  const missingCache = withoutMetadata.operatorLivery;
  assert.equal(resolveTrackLivery(withoutMetadata, 'civil'), null);
  assert.equal(withoutMetadata.operatorLivery, missingCache, 'a missing-metadata track also reuses its cache');
  const it = { meta: { flight: 'UAL1' } };
  assert.equal(resolveTrackLivery(it, 'civil').id, 'united');
  const cached = it.operatorLivery;
  assert.equal(resolveTrackLivery(it, 'civil').id, 'united');
  assert.equal(it.operatorLivery, cached, 'quiet frames reuse the cache');
  it.meta.r = 'UAL1';
  assert.equal(resolveTrackLivery(it, 'civil'), null);
  it.meta.r = 'N12345';
  it.meta.flight = null; it.meta.callsign = 'SWA1';
  assert.equal(resolveTrackLivery(it, 'civil').id, 'southwest');
  it.meta.iconType = 'military';
  assert.equal(resolveTrackLivery(it, 'civil').id, 'military-low-vis');
  it.meta.iconType = 'airliner'; it.meta.military = true;
  assert.equal(resolveTrackLivery(it, 'civil').id, 'military-low-vis');
  it.meta.military = false; it.meta.dbFlags = 1;
  assert.equal(resolveTrackLivery(it, 'civil').id, 'military-low-vis');
  it.meta.dbFlags = 0;
  assert.equal(resolveTrackLivery(it, 'military').id, 'military-low-vis');
  it.meta = { flight: 'RCH123' };
  assert.equal(resolveTrackLivery(it, 'military').id, 'us-air-force');
});

check('specific and unidentified military transports use service or unmarked paint', () => {
  enable(true);
  const renderer = ready();
  const items = [track('RCH101', 900, 'C17', 1), track('', 1000, 'C17', 2), track('DAL123', 1100, 'C17', 3)];
  update(renderer, items);
  const mesh = renderer.families[FAMILY_INDEX.c17].mid;
  assert.deepEqual(Array.from(mesh.userData.fleetLivery.array.slice(0, mesh.count)), [expected('RCH101', 'military'), expected('', 'military'), expected('', 'military')]);
  const generic = liveryForAircraft({}, 'military');
  assert.equal(generic.marking + generic.code, '', 'unknown nationality has no invented insignia');
  renderer.dispose();
});

check('busy mixed liveries stay within the existing 30 draw / 900k triangle fleet budget', () => {
  enable(true);
  const renderer = ready(), items = [];
  const airlines = SCHEMES.filter((s) => s.kind === 'airline');
  let n = 0;
  for (const f of FLEET_FAMILIES) for (const distance of [250, 600, 1500, 3000, 6000, 12000, 25000, 50000]) {
    const prefix = f.palette === 'military' ? ['RCH', 'CNV', 'RRR'][n % 3] : airlines[n % airlines.length].prefixes[0];
    items.push(track(`${prefix}${n % 999 + 1}`, distance, f.codes[0], n++));
  }
  for (const fov of [58, 58 / 20]) {
    camera.fov = fov; camera.updateProjectionMatrix();
    const ctx = { ...context, observing: true };
    for (let pass = 0; pass < 3; pass++) {
      update(renderer, items, ctx);
      while (renderer.queue.length) renderer.prepare();
    }
    assert.equal(renderer.stats.displayed, items.length);
    assert.equal(renderer.stats.liveries, items.length);
    assert.ok(renderer.stats.draws <= 30, `${renderer.stats.draws} draws`);
    assert.ok(renderer.stats.triangles <= 900000, `${renderer.stats.triangles} triangles`);
    for (const mesh of drawn(renderer)) assert.equal(mesh.material.userData.fleetShared, renderer.shared);
  }
  camera.fov = 58; camera.updateProjectionMatrix();
  renderer.dispose();
});

check('detailed and legacy pools retain one palette/atlas until the last owner releases it', () => {
  enable(true);
  const fleet = createFleetShared({ texture: null }), legacy = createTrafficOperatorPaint();
  assert.equal(fleet.uFleetPalette.value, legacy.palette);
  assert.equal(fleet.uFleetOperatorMarks.value, legacy.markings);
  assert.ok(!Object.keys(fleet).includes('disposeOperators'), 'disposal is not passed as a shader uniform');
  let paletteDisposals = 0, markDisposals = 0;
  legacy.palette.addEventListener('dispose', () => paletteDisposals++);
  legacy.markings.addEventListener('dispose', () => markDisposals++);
  fleet.disposeOperators(); fleet.disposeOperators();
  assert.equal(paletteDisposals + markDisposals, 0, 'another active owner keeps both textures');
  legacy.dispose(); legacy.dispose();
  assert.equal(paletteDisposals, 1);
  assert.equal(markDisposals, 1);
  const remount = retainOperatorResources(neutral);
  assert.notEqual(remount.palette, legacy.palette, 'a remount gets fresh undisposed textures');
  remount.dispose();
});

check('legacy military paint survives asynchronous primitive-to-GLB geometry replacement', () => {
  enable(true);
  const resources = createTrafficOperatorPaint();
  const initialGeometry = new THREE.BoxGeometry(20, 5, 50);
  const material = createTrafficNavMaterial(true);
  let priorHooks = 0;
  const originalHook = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => { priorHooks++; originalHook(shader, renderer); };
  const mesh = new THREE.InstancedMesh(initialGeometry, material, 4);
  attachTrafficOperatorPaint(mesh, 4, resources, 4);
  const attribute = mesh.userData.operatorAttribute;
  writeTrafficOperatorPaint(mesh, { meta: { flight: 'RCH50' } }, 0);
  writeTrafficOperatorPaint(mesh, { meta: { flight: 'UNKNOWN' } }, 1);
  assert.equal(attribute.getX(0), expected('RCH50', 'military'));
  assert.equal(attribute.getX(1), expected('', 'military'));
  writeTrafficOperatorPaint(mesh, { meta: { flight: 'RCH50' } }, 2, false);
  assert.equal(attribute.getX(2), 0, 'the caller can suppress paint');
  const shader = compile(material, false);
  assert.equal(priorHooks, 1, 'earlier material patches remain chained');
  assert.equal(shader.uniforms.uOperatorPalette.value, resources.palette);
  assert.match(shader.fragmentShader, /varying vec4 vEmissive/, 'the production nav-light shader supplies the paint mask');
  assert.match(material.customProgramCacheKey(), /operator-archetype/);
  assert.deepEqual(mesh.userData.operatorBounds.value.toArray(), [-25, 50, 2.5, 20]);

  const replacement = new THREE.BoxGeometry(30, 8, 75);
  mesh.geometry = replacement;
  bindTrafficOperatorGeometry(mesh);
  assert.equal(replacement.attributes.aFleetLivery, attribute);
  assert.deepEqual(shader.uniforms.uOperatorBounds.value.toArray(), [-37.5, 75, 4, 30]);
  assert.equal(attribute.getX(0), expected('RCH50', 'military'), 'the replacement keeps existing instance identity');
  writeTrafficOperatorPaint(mesh, { meta: { flight: 'RRR50' } }, 0);
  assert.equal(attribute.getX(0), expected('RRR50', 'military'));
  detachTrafficOperatorPaint(mesh);
  initialGeometry.dispose(); replacement.dispose(); material.dispose(); mesh.dispose(); resources.dispose();
});

check('effect cleanup and StrictMode rebind restore base hooks and release every texture lease', () => {
  enable(true);
  const geometry = new THREE.BoxGeometry(20, 5, 50);
  const material = createTrafficNavMaterial(true);
  const mesh = new THREE.InstancedMesh(geometry, material, 4);
  const baseHook = material.onBeforeCompile, baseKey = material.customProgramCacheKey;
  const baseShader = compile(material, false);
  let previousPalette = null;
  for (let mount = 0; mount < 2; mount++) {
    const resources = createTrafficOperatorPaint();
    if (previousPalette) assert.notEqual(resources.palette, previousPalette, 'replay binds a fresh undisposed palette');
    let paletteDisposals = 0, markDisposals = 0;
    resources.palette.addEventListener('dispose', () => paletteDisposals++);
    resources.markings.addEventListener('dispose', () => markDisposals++);
    const version = material.version;
    attachTrafficOperatorPaint(mesh, 4, resources, 4);
    assert.ok(material.version > version, 'binding invalidates the material program');
    writeTrafficOperatorPaint(mesh, { meta: { flight: 'CNV20' } }, 0);
    assert.equal(mesh.geometry.attributes.aFleetLivery.getX(0), expected('CNV20', 'military'));
    const bound = compile(material, false);
    assert.equal(bound.uniforms.uOperatorPalette.value, resources.palette);
    assert.equal(bound.uniforms.uFleetOperatorMarks.value, resources.markings);
    assert.equal((bound.fragmentShader.match(/vec4 fleetOperatorMark\(/g) ?? []).length, 1, 'one paint shader patch after each replay');
    assert.equal((material.customProgramCacheKey().match(/operator-archetype/g) ?? []).length, 1, 'cache keys never accumulate stale wrappers');

    detachTrafficOperatorPaint(mesh);
    detachTrafficOperatorPaint(mesh);
    assert.equal(material.onBeforeCompile, baseHook);
    assert.equal(material.customProgramCacheKey, baseKey);
    assert.equal(mesh.geometry.attributes.aFleetLivery, undefined);
    assert.equal(Object.keys(mesh.userData).filter((key) => key.startsWith('operator')).length, 0, 'all instance uniforms and cached restore hooks are released');
    const restored = compile(material, false);
    assert.equal(restored.vertexShader, baseShader.vertexShader);
    assert.equal(restored.fragmentShader, baseShader.fragmentShader);
    assert.equal(restored.uniforms.uOperatorPalette, undefined);
    writeTrafficOperatorPaint(mesh, { meta: { flight: 'RCH20' } }, 0);
    assert.equal(mesh.geometry.attributes.aFleetLivery, undefined, 'a detached writer is harmless');
    resources.dispose(); resources.dispose();
    assert.equal(paletteDisposals, 1, 'one palette release per completed effect');
    assert.equal(markDisposals, 1, 'one atlas release per completed effect');
    previousPalette = resources.palette;
  }
  geometry.dispose(); material.dispose(); mesh.dispose();
});

delete globalThis.window;
console.log(`\n${checks}/${checks} operator render integration checks passed.`);
