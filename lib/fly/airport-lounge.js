// Observation lounge — the room as one resource: geometry, materials, glass,
// steam, boards and the shared lighting uniforms. Pure (no renderer, no DOM
// unless one is passed for the boards' canvas): scripts/verify-airport-lounge.mjs
// builds it in node to check budgets, finiteness and disposal.
//
// The pieces live in lib/fly/lounge/:
//   room-plan.js       dimensions derived from the shared LOUNGE_ROOM contract
//   geometry-kit.js    primitives and the bucket builder
//   room-build.js      the room, its practical lights and shadow proxies
//   room-ao.js         the offline AO bake (format, signature, apply)
//   room-shading.js    the interior lighting model (material patch + uniforms)
//   room-textures.js   GPU-baked procedural surface maps
//   lounge-glass.js    the glazing (sky overlay)
//   lounge-steam.js    coffee steam (sky overlay)
//   lounge-board.js    the flight information boards
//   lounge-probe.js    the interior reflection probe
// components/fly/AirportLounge.jsx mounts it.
//
// Draws: 9 room buckets + boards + glass + steam = 12 (budget 14).
import { Group, Mesh } from 'three';
import { buildLoungeRoom } from './lounge/room-build.js';
import { applyVertexAO, floorAOTexture } from './lounge/room-ao.js';
import { createRoomMaterials, createRoomUniforms, writeRoomFixtures } from './lounge/room-shading.js';
import { createLoungeGlass } from './lounge/lounge-glass.js';
import { createLoungeSteam } from './lounge/lounge-steam.js';
import { createLoungeBoard } from './lounge/lounge-board.js';

/** Draw order inside the room: near furniture first, the big shell last
 *  (three sorts opaque draws by renderOrder, then by distance). */
export const ROOM_BUCKETS = ['leather', 'small', 'foliage', 'metal', 'fabric', 'wood', 'stone', 'plaster', 'emissive'];

export function createAirportLounge({ variant = 'classic', document: doc = typeof document !== 'undefined' ? document : null } = {}) {
  const room = buildLoungeRoom({ variant });
  const uniforms = createRoomUniforms();
  const fixtures = writeRoomFixtures(uniforms, room);
  let materials = createRoomMaterials(uniforms, {}, variant);
  const group = new Group();
  group.name = 'airport-lounge';
  group.visible = false;
  const meshes = ROOM_BUCKETS.filter((name) => room.buckets[name]).map((name, i) => {
    const mesh = new Mesh(room.buckets[name], materials[name]);
    mesh.name = `lounge:${name}`;
    mesh.frustumCulled = false; // the room surrounds the camera
    mesh.renderOrder = i - 20; // before the world: early-Z rejects what it hides
    mesh.castShadow = false;
    mesh.receiveShadow = false; // the key light is masked analytically
    group.add(mesh);
    return mesh;
  });
  const glass = createLoungeGlass(variant);
  const steam = createLoungeSteam(room.practicals.steam);
  const board = createLoungeBoard(doc);
  board.mesh.renderOrder = -12;
  group.add(board.mesh, glass.mesh, steam.mesh);
  let floorAO = floorAOTexture(null);
  uniforms.uLoungeFloorAO.value = floorAO;
  let aoOk = false;

  return {
    room,
    uniforms,
    fixtures,
    group,
    meshes,
    glass,
    steam,
    board,
    get materials() { return materials; },
    get aoApplied() { return aoOk; },
    /** Every texture the resource owns (the baked surface maps belong to their baker). */
    get textures() { return [floorAO, board.texture, uniforms.uLoungeFix.value].filter(Boolean); },
    /** The lit room materials (what the cinema shadow rig patches and the prewarm compiles). */
    litMaterials() { return meshes.map((m) => m.material).filter((m) => m.userData.loungeRoom); },
    /** Swap in the GPU-baked surface maps (room-textures.js). */
    attachMaps(maps) {
      const next = createRoomMaterials(uniforms, maps, variant);
      for (const m of meshes) m.material = next[m.name.slice(7)];
      for (const m of Object.values(materials)) m.dispose();
      materials = next;
    },
    /** Apply the offline AO bake. Returns false when the bake is stale. */
    attachAO(bake) {
      aoOk = applyVertexAO(room.buckets, bake);
      floorAO.dispose();
      floorAO = floorAOTexture(aoOk ? bake : null);
      uniforms.uLoungeFloorAO.value = floorAO;
      return aoOk;
    },
    /** GPU resources only: the objects stay usable (a later draw re-uploads). */
    dispose() {
      for (const g of Object.values(room.buckets)) g.dispose();
      for (const m of Object.values(materials)) m.dispose();
      floorAO.dispose();
      uniforms.uLoungeFix.value.dispose();
      glass.dispose();
      steam.dispose();
      board.dispose();
    },
  };
}
