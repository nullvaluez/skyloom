// Observation lounge — the room gate (node; no GPU).
//
// RE-BASELINED by workstream A (ROOM) for the overhauled lounge. The W0 gate
// held a placeholder room to "six merged draws or fewer", "under 30k
// triangles" and "under 5 MB of geometry". The room is now a designed
// interior: nine material buckets plus the boards, the glass and the coffee
// steam (12 draws), ~120k triangles of modelled furniture, fixtures and frame.
// The draw / triangle / texture budgets checked here are the shared
// contract's (LOUNGE_BUDGETS.room in lib/fly/observation-config.js: <= 14
// draws, <= 160k triangles, <= 24 MiB of textures); geometry memory is held
// under 8 MB; the W0 finiteness and complete-disposal checks are kept.
//
// What it proves:
//   1. budgets: draws, triangles, geometry bytes and texture bytes (baked maps
//      + reflection probe + boards + floor AO);
//   2. finite geometry: every attribute of every mesh is finite;
//   3. the room stays inside LOUNGE_ROOM.envelope (the airport set leaves
//      that volume empty) and the glazing sits exactly on the contract
//      (front plane, cant, x extent, roof strip, side returns);
//   4. the interior lighting patch applies to three's real shader sources,
//      keeps the anchors the cinema cascades patch after it, and adds few
//      fragment uniform vectors (the fixture lists live in a float texture:
//      WebGL2 only guarantees 224 vectors and three's lighting needs its share);
//   5. the offline AO bake matches the room geometry (a geometry change
//      without `node scripts/build-lounge-ao.mjs` fails here);
//   6. the boards draw the experience runtime's board() rows and the
//      snapshot fallback, with the FIDS status words;
//   7. disposal releases every geometry, material and texture the room owns.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';

// The app's modules use extensionless and '@/' specifiers that webpack
// resolves (the boards share the HUD's clock, which reaches the sun model);
// resolve them the same way here, as the other airport gates do.
registerHooks({
  resolve(s, c, next) {
    if (s.startsWith('@/')) s = new URL('../' + s.slice(2), import.meta.url).href;
    if (s.startsWith('.') || s.startsWith('file:')) {
      const u = new URL(s, c.parentURL);
      if (!fs.existsSync(fileURLToPath(u)) && fs.existsSync(fileURLToPath(u) + '.js')) return next(u.href + '.js', c);
    }
    return next(s, c);
  },
});
const { ShaderLib } = await import('three');
const { createAirportLounge } = await import('../lib/fly/airport-lounge.js');
const { LOUNGE_ROOM, LOUNGE_PIER_ROOM, LOUNGE_BUDGETS, ROOM_LOOK } = await import('../lib/fly/observation-config.js');
const { roomMapBytes } = await import('../lib/fly/lounge/room-textures.js');
const { BOARD_CANVAS, status } = await import('../lib/fly/lounge/lounge-board.js');
const { probeBytes } = await import('../lib/fly/lounge/lounge-probe.js');
const { decodeBake, geometrySignature, applyVertexAO, FLOOR_RECT, UPPER_FLOOR_RECT, AO_URL } = await import('../lib/fly/lounge/room-ao.js');
const { MAX_LIGHTS, MAX_SHADOWS, FIXTURE_TABLE } = await import('../lib/fly/lounge/room-shading.js');

// A 2D canvas stand-in: every call is a no-op; gradients and text metrics exist.
const ctx2d = () => new Proxy({}, {
  get: (o, k) => o[k] ?? ((k === 'createLinearGradient' || k === 'createRadialGradient') ? () => ({ addColorStop() {} }) : k === 'measureText' ? () => ({ width: 10 }) : () => {}),
  set: (o, k, v) => ((o[k] = v), true),
});
const doc = { createElement: () => ({ getContext: ctx2d }) };

let checks = 0;
const check = (name, fn) => { fn(); checks++; console.log('PASS ' + name); };
const MiB = 1024 * 1024;
const variant = process.argv.includes('--pier') ? 'pier' : 'classic';
const B = variant === 'pier' ? { ...LOUNGE_BUDGETS.room, triangles: 140000 } : LOUNGE_BUDGETS.room;

const room = createAirportLounge({ document: doc, variant });
const drawables = room.group.children.filter((o) => o.isMesh);
const triangles = (g) => (g.index ? g.index.count : g.attributes.position.count) / 3;

// --- 1. budgets -------------------------------------------------------------
const tris = drawables.reduce((s, m) => s + triangles(m.geometry), 0);
let geometryBytes = 0;
for (const m of drawables) {
  for (const a of Object.values(m.geometry.attributes)) geometryBytes += a.array.byteLength;
  if (m.geometry.index) geometryBytes += m.geometry.index.array.byteLength;
}
const textureBytes = roomMapBytes() + probeBytes(ROOM_LOOK.probeSize)
  + BOARD_CANVAS.width * BOARD_CANVAS.height * 4 * (4 / 3) + (FLOOR_RECT.w * FLOOR_RECT.h + (variant === 'pier' ? UPPER_FLOOR_RECT.w * UPPER_FLOOR_RECT.h : 0)) * (4 / 3)
  + FIXTURE_TABLE.width * FIXTURE_TABLE.height * 16;
check(`draws ${drawables.length} <= ${B.draws} (room buckets + boards + glass + steam)`, () => assert.ok(drawables.length <= B.draws));
check(`triangles ${tris} <= ${B.triangles}`, () => assert.ok(tris <= B.triangles));
check(`geometry ${(geometryBytes / 1e6).toFixed(2)} MB <= 8 MB`, () => assert.ok(geometryBytes <= 8e6));
check(`textures ${(textureBytes / MiB).toFixed(2)} MiB <= ${B.textureMiB} MiB`, () => assert.ok(textureBytes <= B.textureMiB * MiB));

// --- 2. finite geometry -------------------------------------------------------
check('every geometry attribute is finite, every bound is real', () => {
  for (const m of drawables) {
    for (const [name, a] of Object.entries(m.geometry.attributes)) {
      for (let i = 0; i < a.array.length; i++) assert.ok(Number.isFinite(a.array[i]), `${m.name}.${name}[${i}]`);
    }
    // (as built: the steam cards are billboarded in the shader and carry an authored radius)
    const bs = m.geometry.boundingSphere;
    assert.ok(bs && bs.radius > 0 && Number.isFinite(bs.radius) && Number.isFinite(bs.center.x + bs.center.y + bs.center.z), m.name);
  }
});

// --- 3. envelope and glazing contract -------------------------------------------
check('the room stays inside its variant envelope', () => {
  const e = variant === 'pier' ? LOUNGE_PIER_ROOM.envelope : LOUNGE_ROOM.envelope;
  for (const m of drawables) {
    m.geometry.computeBoundingBox();
    const { min, max } = m.geometry.boundingBox;
    assert.ok(min.x >= e.minX && max.x <= e.maxX && min.y >= e.minY && max.y <= e.maxY && min.z >= e.minZ && max.z <= e.maxZ, `${m.name} ${JSON.stringify({ min, max })}`);
  }
});
check('the glazing sits on the contract (front plane, cant, extent, roof strip, side returns)', () => {
  const G = LOUNGE_ROOM.glass, cant = Math.tan((G.cantDeg * Math.PI) / 180);
  const geo = room.glass.mesh.geometry;
  const p = geo.attributes.position, kind = geo.attributes.aKind;
  const seen = new Set();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = kind.getX(i);
    seen.add(k);
    if (variant === 'pier' && y >= LOUNGE_PIER_ROOM.upper.glazing.y0 - 0.006) {
      const u = LOUNGE_PIER_ROOM.upper.glazing;
      assert.ok(y >= u.y0 - 0.006 && y <= u.y1 + 0.006, 'upper glazing height');
      if (k === 2) assert.ok(Math.abs(x - u.halfWidth) < 0.006 && z >= u.frontZ - 0.006 && z <= u.backZ + 0.006, 'upper east glass');
      else if (z > 14) assert.ok(Math.abs(z - u.backZ) < 0.006 && Math.abs(Math.abs(x) - u.halfWidth) < 0.006, 'upper rear glass');
      else assert.ok(Math.abs(z - u.frontZ) < 0.006 && (Math.abs(x - u.frontX0) < 0.006 || Math.abs(x - u.frontX1) < 0.006), 'upper front glass');
    } else if (variant === 'pier' && z > 14) {
      assert.ok(Math.abs(z - LOUNGE_PIER_ROOM.backGlass.z) < 0.006);
      assert.ok(Math.abs(Math.abs(x) - LOUNGE_PIER_ROOM.backGlass.halfWidth) < 0.006);
    } else if (k === 0) {
      // front: z + y * cant = baseZ + baseY * cant (the pane sits <= 5 mm outside the fins)
      assert.ok(Math.abs(z + y * cant - (G.baseZ + G.baseY * cant)) < 0.006, `front plane ${x},${y},${z}`);
      assert.ok(Math.abs(Math.abs(x) - G.halfWidth) < 1e-6 && y >= G.baseY - 1e-6 && y <= G.topY + 1e-6, `front extent ${x},${y}`);
    } else if (k === 1) {
      assert.ok(Math.abs(y - G.topY) < 0.006 && z <= LOUNGE_ROOM.roofGlass.z1 + 1e-6 && Math.abs(Math.abs(x) - G.halfWidth) < 1e-6, `roof ${x},${y},${z}`);
    } else {
      assert.ok(Math.abs(Math.abs(x) - LOUNGE_ROOM.side.x) < 0.006 && z <= LOUNGE_ROOM.side.z1 + 1e-6 && y >= G.baseY - 1e-6 && y <= G.topY + 1e-6, `side ${x},${y},${z}`);
    }
  }
  assert.deepEqual([...seen].sort(), [0, 1, 2]);
});
check(`fixtures fit the shader: ${room.fixtures.lights} practicals <= ${MAX_LIGHTS}, ${room.fixtures.shadows} shadow boxes <= ${MAX_SHADOWS}`, () => {
  assert.ok(room.room.practicals.length <= MAX_LIGHTS && room.room.shadows.length <= MAX_SHADOWS);
  const e = variant === 'pier' ? LOUNGE_PIER_ROOM.envelope : LOUNGE_ROOM.envelope;
  for (const l of room.room.practicals) {
    const p = l.type === 'line' ? l.a : l.p;
    assert.ok(p[0] > e.minX && p[0] < e.maxX && p[1] > 0 && p[1] < e.maxY && p[2] > e.minZ && p[2] < e.maxZ, JSON.stringify(l));
  }
});

// --- 4. the interior lighting patch on three's real sources ------------------------
let roomSlots = 0;
check('the room patch applies to three\'s shader sources, keeps the cascade anchors, adds <= 32 uniform vectors', () => {
  for (const m of room.meshes) {
    const material = m.material;
    const lib = material.isMeshBasicMaterial ? ShaderLib.basic : ShaderLib.physical;
    const shader = { vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader, uniforms: {} };
    material.onBeforeCompile(shader, {});
    assert.ok(shader.fragmentShader.includes('uLoungeFade'), `${m.name}: binocular defocus`);
    if (material.isMeshBasicMaterial) continue;
    assert.ok(shader.fragmentShader.includes('THE INTERIOR'), `${m.name}: interior lighting`);
    for (const anchor of ['#include <lights_pars_begin>', '#include <lights_fragment_begin>']) assert.ok(shader.fragmentShader.includes(anchor), `${m.name} keeps ${anchor}`);
    assert.ok(material.customProgramCacheKey().includes('lounge-room'), `${m.name}: program key`);
    // The room's own fragment uniforms, in vec4 slots (arrays: one per element).
    const SLOTS = { float: 1, vec2: 1, vec3: 1, vec4: 1, mat3: 3, mat4: 4, sampler2D: 0, samplerCube: 0 };
    let slots = 0;
    for (const u of shader.fragmentShader.matchAll(/uniform\s+(?:highp\s+|mediump\s+|lowp\s+)?(\w+)\s+(uLounge\w+)\s*(?:\[\s*(\d+)\s*\])?\s*;/g)) {
      assert.ok(u[1] in SLOTS, `${m.name}: unexpected uniform type ${u[1]}`);
      slots += SLOTS[u[1]] * (u[3] ? Number(u[3]) : 1);
    }
    // (> 8: the scan found the room's own uniforms, so the bound is not vacuous)
    assert.ok(slots > 8 && slots <= 32, `${m.name}: the room adds ${slots} fragment uniform vectors`);
    roomSlots = Math.max(roomSlots, slots);
  }
});

// --- 5. the AO bake matches the geometry ----------------------------------------------
check('the offline AO bake matches the room geometry (else: node scripts/build-lounge-ao.mjs)', () => {
  const file = fileURLToPath(new URL('../public' + (variant === 'pier' ? '/models/lounge-ao-pier-v1.bin' : AO_URL), import.meta.url));
  const bytes = fs.readFileSync(file);
  const bake = decodeBake(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  assert.ok(bake, 'bake parses');
  assert.equal(bake.signature, geometrySignature(room.room.buckets), 'bake signature');
  assert.ok(applyVertexAO(room.room.buckets, bake), 'per-vertex AO applies');
  assert.ok(room.attachAO(bake), 'the resource attaches the bake');
  if (variant === 'pier') {
    assert.equal(bake.upperFloor?.w, 512); assert.equal(bake.upperFloor?.h, 160);
    const atlas = room.uniforms.uLoungeFloorAO.value;
    assert.equal(atlas.image.width, 512); assert.equal(atlas.image.height, 512);
    assert.equal(atlas.image.data.length, 512 * 512);
  }
});

// --- 6. the boards ---------------------------------------------------------------------
check('the boards draw the runtime board() rows and the snapshot fallback', () => {
  const airport = { id: 'KCMH', ident: 'KCMH', name: 'John Glenn Columbus', a: { lat: 40, lon: -83 } };
  const row = (o) => ({ hex: 'a1b2c3', label: 'AAL123', airline: 'American Airlines', type: 'Airbus A321', typeCode: 'A321', phase: 'final', phaseLabel: 'Final · 28L', category: 'arrival', distanceM: 6000, altM: 600, aglM: 350, speedMs: 72, vsMs: -3.5, etaS: 90, runway: '28L', stale: 0, ...o });
  const board = () => ({
    arrivals: [row(), row({ hex: 'b', etaS: 0, phaseLabel: 'Landed', aglM: 2 })],
    departures: [row({ hex: 'c', category: 'departure', phase: 'climb-out', phaseLabel: 'Climbing out · 10R', etaS: null, runway: '10R' })],
    ground: [row({ hex: 'd', category: 'ground', phase: 'taxi', phaseLabel: 'Taxiing', etaS: null, runway: null })],
    overhead: [], local: [row({ hex: 'e', category: 'local', phase: 'cruise', phaseLabel: 'Cruising', etaS: null, runway: null })], at: 0,
  });
  assert.equal(room.board.update(1000, { active: true, airport, board }, true), true);
  assert.equal(room.board.update(3000, { active: true, airport, snapshot: () => [{ hex: 'f', label: 'N123AB', category: 'approach', distance: 9000, speed: 60 }] }, true), true);
  assert.equal(status(row())[0], 'FINAL 28L');
  assert.equal(status(row({ etaS: 0, phaseLabel: 'Landed' }))[0], 'LANDED');
  assert.equal(status(row({ category: 'departure', phase: 'climb', etaS: null, runway: null }))[0], 'CLIMBING');
  assert.equal(status(row({ category: 'ground', phase: 'parked', etaS: null, runway: null }))[0], 'AT STAND');
});

// --- 7. disposal ---------------------------------------------------------------------------
check('dispose releases every geometry, material and texture the room owns', () => {
  const owned = new Set();
  for (const m of drawables) { owned.add(m.geometry); owned.add(m.material); }
  for (const t of room.textures) owned.add(t);
  let released = 0;
  for (const r of owned) r.addEventListener('dispose', () => released++);
  room.dispose();
  assert.equal(released, owned.size, `released ${released} of ${owned.size}`);
});

console.log(`PASS lounge: ${checks} checks · ${drawables.length} draws · ${tris} triangles · ${(textureBytes / MiB).toFixed(1)} MiB textures · ${room.fixtures.lights} practicals · ${roomSlots} room uniform vectors`);
