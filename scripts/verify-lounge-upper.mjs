import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildLoungeRoom } from '../lib/fly/lounge/room-build.js';
import { roomVariant } from '../lib/fly/lounge/room-plan.js';
import { geometrySignature, decodeBake, floorAOTexture, UPPER_FLOOR_RECT } from '../lib/fly/lounge/room-ao.js';
import { buildTriBvh } from './_tri-bvh.mjs';

const plan = roomVariant('pier'), u = plan.upper, st = u.stair;
const room = buildLoungeRoom({ variant: 'pier' }), bvh = buildTriBvh(room.buckets);
let count = 0;
const check = (label, fn) => { fn(); console.log('PASS ' + label); count++; };
check('upper room is a genuine second level with comfortable clear height', () => {
  assert.equal(u.floorY, 4.6); assert.ok(u.roofY - u.floorY >= 3.2);
  assert.equal(st.steps, 28); assert.ok(st.rise / st.steps < 0.18);
  assert.ok((st.z1 - st.z0) / st.steps >= 0.26); assert.ok(st.x1 - st.x0 >= 1.8);
  assert.equal(st.rise, u.floorY);
});
check('the real stair geometry has continuous head clearance across its width', () => {
  let closest = Infinity;
  for (let i = 0; i <= 160; i++) {
    const f = i / 160, z = st.z0 + (st.z1 - st.z0) * f, y = u.floorY * f;
    for (const x of [-10.6, -10, -9.4]) {
      const roof = bvh.cast(x, y + 1.65, z, 0, 1, 0, 4);
      assert.ok(roof >= 0.48, `headroom at ${x},${z} = ${roof}`);
      closest = Math.min(closest, bvh.distance(x, y + 1.65, z, 0.4));
    }
  }
  assert.ok(closest >= 0.24, `walking head clearance ${closest}`);
});
check('upper seats and standing approaches see through both real glazed facades', () => {
  for (const seat of plan.vantage.filter((s) => s.floorId === 'upper')) {
    const dir = seat.faces === 'back' ? 1 : -1;
    const zGlass = dir > 0 ? u.glazing.backZ : u.glazing.frontZ;
    const distance = Math.abs(zGlass - seat.eye[2]);
    assert.ok(bvh.cast(...seat.eye, 0, 0, dir, distance + 0.05) >= distance, seat.id);
    assert.ok(bvh.distance(...seat.eye, 0.3) >= 0.14, `${seat.id} head clear of chair`);
  }
  for (const x of [-6.72, 0, 6.72]) for (const [z, dir] of [[8.7, -1], [13.2, 1]]) {
    const distance = Math.abs((dir > 0 ? u.glazing.backZ : u.glazing.frontZ) - z);
    assert.ok(bvh.cast(x, u.floorY + 1.65, z, 0, 0, dir, distance + 0.05) >= distance, `standing ${x},${z}`);
  }
});
check('ceiling opening, occupied landing and lower rear view agree with geometry', () => {
  assert.ok(bvh.cast(-10, 4.45, 9, 0, 1, 0, 3.6) > 3, 'stair opening is not capped by old ceiling');
  assert.ok(bvh.cast(-10, 5.6, 12, 0, -1, 0, 2) < 1.01, 'top landing floor is present');
  assert.ok(bvh.cast(0, 1.65, 13, 0, 0, 1, 1.25) >= 1.2, 'lower rear glazing stays open');
  assert.ok(bvh.cast(0, 3.6, 10, 0, 1, 0, 2) < 1, 'upper slab remains solid over lower room');
});
check('upper solids publish vertical bounds while classic remains single level', () => {
  assert.equal(roomVariant('classic').upper, null);
  const ids = new Set(room.blockers.filter((b) => b.floorId === 'upper' && b.seatId).map((b) => b.seatId));
  assert.deepEqual([...ids].sort(), ['upper-back', 'upper-front']);
  for (const b of room.blockers.filter((b) => b.floorId === 'upper')) { assert.equal(b.y0, u.floorY); assert.ok(b.y1 > b.y0); }
  assert.ok(room.blockers.some((b) => b.kind === 'stair-plinth' && b.floorId === 'lower'));
});
check('both floors have independently baked contact shadows packed into one sampler', () => {
  const bytes = fs.readFileSync(new URL('../public/models/lounge-ao-pier-v1.bin', import.meta.url));
  const bake = decodeBake(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  assert.equal(bake.signature, geometrySignature(room.buckets));
  assert.equal(bake.upperFloor.w, UPPER_FLOOR_RECT.w); assert.equal(bake.upperFloor.h, UPPER_FLOOR_RECT.h);
  assert.ok(bake.upperFloor.data.some((v) => v < 230), 'upper furniture has contact shadows');
  assert.ok(bake.upperFloor.data.some((v) => v > 250), 'open floor is not uniformly dark');
  const texture = floorAOTexture(bake); assert.equal(texture.image.width, 512); assert.equal(texture.image.height, 512); texture.dispose();
});
for (const g of Object.values(room.buckets)) g.dispose();
console.log(`PASS upper lounge geometry: ${count} checks`);
