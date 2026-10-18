import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildLoungeRoom, GLOW, SURF } from '../lib/fly/lounge/room-build.js';
import { roomVariant, HALF_X, ROOF_Z1 } from '../lib/fly/lounge/room-plan.js';
import { clearance, onFloorPlate } from '../lib/fly/lounge/room-walk.mjs';
import { CHART_PANELS, DRESSING } from '../lib/fly/lounge/upper-dressing.mjs';
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
check('finished floors and every tread stay above their structural faces', () => {
  const timber = buildTriBvh({ wood: room.buckets.wood });
  const structure = buildTriBvh({ plaster: room.buckets.plaster });
  const stone = buildTriBvh({ stone: room.buckets.stone });
  const fabric = buildTriBvh({ fabric: room.buckets.fabric });
  const topAt = (mesh, x, z, fromY) => fromY - mesh.cast(x, fromY, z, 0, -1, 0, 10);
  // Sample both the main upper plate and the occupied landing, not a
  // computed parameter: these are the actual rendered material buckets.
  for (const [x,z] of [[5,10],[-10,12]]) {
    const finish = topAt(timber,x,z,u.floorY+0.3), below = topAt(structure,x,z,u.floorY+0.3);
    assert.ok(Math.abs(finish-u.floorY)<1e-5, `finished floor height ${x},${z}`);
    assert.ok(finish-below>=0.035, `timber/structure separation ${x},${z}: ${finish-below}`);
  }
  const tread = (st.z1-st.z0)/st.steps, rise=st.rise/st.steps;
  for(let i=0;i<st.steps;i++) for(const x of [st.x0+0.25,(st.x0+st.x1)/2,st.x1-0.25]) {
    const z=st.z0+(i+0.5)*tread, expected=(i+1)*rise;
    const finish=topAt(timber,x,z,expected+0.1), below=topAt(stone,x,z,expected+0.1);
    assert.ok(Math.abs(finish-expected)<1e-5, `tread ${i} preserves finished rise`);
    assert.ok(finish-below>=0.025, `tread ${i} has no coplanar stone face: ${finish-below}`);
  }
  // The rug is a distinct raised finish: its field and border tops have
  // separate heights, and neither is coplanar with the walking timber.
  for(const [x,z,minRise] of [[0,10.95,0.013],[3.88,10.95,0.011]]) {
    const rug=topAt(fabric,x,z,u.floorY+0.1), finish=topAt(timber,x,z,u.floorY+0.1);
    assert.ok(rug-finish>=minRise, `rug finish separated from timber ${x},${z}`);
  }
});
check('upper solids publish vertical bounds while classic remains single level', () => {
  assert.equal(roomVariant('classic').upper, null);
  const ids = new Set(room.blockers.filter((b) => b.floorId === 'upper' && b.seatId).map((b) => b.seatId));
  assert.deepEqual([...ids].sort(), plan.vantage.filter((v) => v.floorId === 'upper').map((v) => v.id).sort());
  assert.deepEqual([...ids].sort(), ['upper-back', 'upper-east', 'upper-front', 'upper-nook']);
  for (const b of room.blockers.filter((b) => b.floorId === 'upper')) { assert.equal(b.y0, u.floorY); assert.ok(b.y1 > b.y0); }
  assert.ok(room.blockers.some((b) => b.kind === 'stair-plinth' && b.floorId === 'lower'));
});
check('safe-channel lighting covers the upper walking floor when decoration is dimmed', () => {
  const fixtures = room.practicals.filter((l) => l.type === 'line' && l.group === GLOW.ENTRANCE && l.a[1] > u.floorY && l.b[1] > u.floorY);
  assert.ok(fixtures.length, 'a circulation source exists above the upper floor');
  for (const [x, z] of [[-10,12], [-5.6,11], [0,11], [5.6,11], [10.5,12]]) {
    const covered = fixtures.some((l) => {
      const d = l.b.map((v,i) => v-l.a[i]), p = [x,u.floorY,z], q = p.map((v,i) => v-l.a[i]);
      const t = Math.max(0,Math.min(1,q.reduce((sum,v,i) => sum+v*d[i],0)/d.reduce((sum,v) => sum+v*v,0)));
      return Math.hypot(...q.map((v,i) => v-t*d[i])) < l.range * 0.8;
    });
    assert.ok(covered, `circulation ${x},${z} lies inside the useful light range`);
  }
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

// --- Second-level pass (FURNISH): the dressing, the stair finish, the lower roof ---
const vert = function* (names = Object.keys(room.buckets)) {
  for (const name of names) {
    const g = room.buckets[name], p = g.attributes.position.array, f = g.attributes.aSurf.array;
    for (let i = 0, v = 0; i < p.length; i += 3, v++) yield { name, x: p[i], y: p[i + 1], z: p[i + 2], flag: Math.round(f[v * 4 + 3]) };
  }
};
check('the dressing is built in full and the seats it adds sit, see and stand clear', () => {
  for (const id of Object.values(DRESSING)) assert.ok(room.dressing.includes(id), `built ${id}`);
  for (const id of ['upper-nook', 'upper-east']) {
    const seat = plan.vantage.find((v) => v.id === id);
    const dir = seat.faces === 'back' ? 1 : -1, zGlass = dir > 0 ? u.glazing.backZ : u.glazing.frontZ;
    // seated: straight out, and across the look span's middle third
    for (const yaw of [-0.35, 0, 0.35]) {
      const a = seat.look.centre + yaw, dx = -Math.sin(a), dz = -Math.cos(a), d = Math.abs((zGlass - seat.eye[2]) / dz);
      assert.ok(bvh.cast(...seat.eye, dx, 0, dz, d + 0.05) >= d - 0.12, `${id} sees out at yaw ${yaw}`);
    }
    assert.ok(bvh.distance(...seat.eye, 0.3) >= 0.14, `${id} head clear of the chair, lamp and cushion`);
  }
});
check('library, models, coffee station and plants stay out of the six standing sightlines (three heights, two offsets)', () => {
  for (const x of [-6.72, 0, 6.72]) for (const [z, dir] of [[8.7, -1], [13.2, 1]]) {
    const d = Math.abs((dir > 0 ? u.glazing.backZ : u.glazing.frontZ) - z);
    for (const y of [5.5, 5.78, 6.25]) for (const dx of [-0.04, 0.04]) {
      // the reserved rail and station heads sit on the front corridor's line at x 0 (instruments, not room geometry)
      assert.ok(bvh.cast(x + dx, y, z, 0, 0, dir, d + 0.05) >= d - 0.12, `sightline ${x + dx},${y},${z}`);
    }
  }
});
check('stair finish: one continuous stringer 50 mm proud, a seam trim 24 mm proud, frames off the wall', () => {
  const tread = (st.z1 - st.z0) / st.steps, rise = st.rise / st.steps, nosing = (z) => (z - (st.z0 - 0.02)) * rise / tread + rise;
  let samples = 0;
  const stone = buildTriBvh({ stone: room.buckets.stone }); // the stringer and the plinth (the balusters stand 7 mm off its face)
  for (let z = st.z0 + 0.05; z < st.z1 - 0.05; z += 0.1) {
    const top = Math.min(nosing(z) + 0.05, u.floorY + 0.05);
    for (let y = 0.06; y <= top; y += 0.13) {
      const t = stone.cast(st.x1 + 0.4, y, z, -1, 0, 0, 1);
      assert.ok(Math.abs(st.x1 + 0.4 - t - (st.x1 + 0.05)) < 1e-4, `stringer face at z ${z.toFixed(2)} y ${y.toFixed(2)}: ${st.x1 + 0.4 - t}`);
      samples++;
    }
  }
  assert.ok(samples > 500, 'stringer samples');
  for (let z = 4.45; z < 12.8; z += 0.25) {
    const t = bvh.cast(-10.6, u.floorY + 0.005, z, -1, 0, 0, 1), hit = -10.6 - t;
    assert.ok(hit - -HALF_X >= 0.02 && hit - -HALF_X < 0.03, `seam trim face at z ${z.toFixed(2)}: ${hit}`);
  }
  for (const p of CHART_PANELS) {
    // every visible face of a print, its slip and frame is >= 20 mm off the wall and the dado trim (face x -11.185)
    for (const [dz, dy] of [[0, 0], [p.w / 2 + 0.006, 0], [p.w / 2 + 0.03, 0], [0, p.h / 2 + 0.03]]) {
      const t = bvh.cast(-10.9, p.yc + dy, p.zc + dz, -1, 0, 0, 1), hit = -10.9 - t;
      assert.ok(hit - -11.185 >= 0.02, `${p.id} face at +${dz},+${dy}: ${hit}`);
    }
  }
});
check('lower roof: the finish stands >= 20 mm over the deck and stays under every upper front seat\'s line to the runway', () => {
  const deckTop = 4.66;
  for (const [x, z] of [[-6, 4], [0, 6.5], [6, 3.4], [10, 7.5], [-10, 2.9]]) {
    const t1 = bvh.cast(x, 6, z, 0, -1, 0, 3), top = 6 - t1;
    const t2 = bvh.cast(x, top - 0.001, z, 0, -1, 0, 1), below = top - 0.001 - t2;
    assert.ok(top - deckTop >= 0.02 - 1e-5 && top - below >= 0.02 - 1e-5, `roof finish at ${x},${z}: top ${top}, next face below ${below}`);
  }
  // 7 degrees below the horizontal from each front-facing upper eye: the lower
  // glass head sits at ~6 degrees, the runway higher still.
  const eyes = plan.vantage.filter((v) => v.floorId === 'upper' && v.faces === 'runway').map((v) => v.eye);
  let n = 0;
  for (const v of vert()) {
    if (v.z < ROOF_Z1 - 0.05 || v.z > u.glazing.frontZ - 0.07 || v.y < 4.661 || v.y > 6 || Math.abs(v.x) > HALF_X + 0.25) continue;
    if (v.x < u.well.x1 + 0.07 && v.z > u.well.z0 - 0.07) continue; // the stairwell enclosure itself
    n++;
    for (const e of eyes) assert.ok(v.y <= e[1] - Math.tan(7 * Math.PI / 180) * (e[2] - v.z), `${v.name} roof vertex ${v.x.toFixed(2)},${v.y.toFixed(3)},${v.z.toFixed(2)} rises into the view from ${e}`);
  }
  assert.ok(n > 500, `roof finish vertices ${n}`);
});
check('upper planting stays under the ceiling and inside the glazing; the nook rug is a raised finish', () => {
  let leaves = 0;
  for (const v of vert(['small', 'foliage'])) {
    if (v.flag !== SURF.LEAF || v.y < u.floorY || v.z < u.glazing.frontZ) continue;
    leaves++;
    assert.ok(v.y < u.roofY - 0.1 && v.x > -HALF_X + 0.1 && v.x < HALF_X - 0.12 && v.z > u.glazing.frontZ + 0.12 && v.z < u.glazing.backZ - 0.12, `leaf at ${v.x.toFixed(2)},${v.y.toFixed(2)},${v.z.toFixed(2)}`);
  }
  assert.ok(leaves > 300, `upper leaves ${leaves}`);
  const fabric = buildTriBvh({ fabric: room.buckets.fabric }), timber = buildTriBvh({ wood: room.buckets.wood });
  for (const [x, z, minRise] of [[-6.0, 10.1, 0.013], [-8.2, 9.8, 0.011]]) {
    const rug = u.floorY + 0.1 - fabric.cast(x, u.floorY + 0.1, z, 0, -1, 0, 1), finish = u.floorY + 0.1 - timber.cast(x, u.floorY + 0.1, z, 0, -1, 0, 1);
    assert.ok(rug - finish >= minRise, `nook rug finish separated from timber at ${x},${z}: ${rug - finish}`);
  }
});
check('the inspectable pieces stay inside their contract bounds where those face the room', () => {
  // A slab just outside each box's room-facing side (and over its top) holds no
  // geometry: the library ends at x -10.8 and y 6.85, the model display at x
  // 10.3 and y 5.95, the coffee station at y 5.85 over the credenza.
  const empty = (label, min, max) => {
    for (const v of vert()) {
      if (v.x > min[0] && v.x < max[0] && v.y > min[1] && v.y < max[1] && v.z > min[2] && v.z < max[2]) assert.fail(`${label}: ${v.name} vertex at ${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`);
    }
  };
  empty('library front', [-10.8, u.floorY + 0.05, 12.86], [-10.7, u.floorY + 2.4, 14.04]);
  empty('library top', [-11.19, u.floorY + 2.25, 12.86], [-10.8, u.floorY + 2.45, 14.04]);
  empty('model display front', [10.2, u.floorY + 0.05, 9.86], [10.3, u.floorY + 1.4, 11.94]);
  empty('model display top', [10.3, u.floorY + 1.35, 9.86], [10.95, u.floorY + 1.6, 11.94]);
  empty('coffee station top', [8.39, u.floorY + 1.25, 10.41], [9.41, u.floorY + 1.5, 12.24]);
});
check('everything on the upper floor at body height has a walk footprint', () => {
  // As verify-lounge-pier.mjs does for the lower floor: a vertex between 3 cm
  // and 2 m above the upper floor, over the upper plate outside the stair
  // void, lies within 6 mm of a blocker (any floor's: a stair rail's footprint
  // reaches over the landing).
  const plate = { ...u.plate, holes: [u.well] };
  let n = 0;
  for (const v of vert()) {
    if (v.y <= u.floorY + 0.03 || v.y >= u.floorY + 2 || !onFloorPlate(v.x, v.z, plate)) continue;
    n++;
    assert.ok(clearance(room.blockers, v.x, v.z) < 0.006, `${v.name} ${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)} has no footprint`);
  }
  assert.ok(n > 10000, `upper body-height vertices ${n}`);
});
for (const g of Object.values(room.buckets)) g.dispose();
console.log(`PASS upper lounge geometry: ${count} checks`);
