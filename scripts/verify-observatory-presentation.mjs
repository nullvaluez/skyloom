import assert from 'node:assert/strict';
import fs from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import { listeningGain } from '../lib/fly/lounge/observatory-audio.mjs';
import { Raycaster, Vector3 } from 'three';
import { observatoryStations } from '../lib/fly/lounge/observatory-stations.mjs';
registerHooks({ resolve(s, c, next) {
  if (s.startsWith('@/')) s = new URL('../' + s.slice(2), import.meta.url).href;
  if (s.startsWith('.') || s.startsWith('file:')) {
    const u = new URL(s, c.parentURL);
    if (!fs.existsSync(fileURLToPath(u)) && fs.existsSync(fileURLToPath(u) + '.js')) return next(u.href + '.js', c);
  }
  return next(s, c);
} });
const { createAirportLounge } = await import('../lib/fly/airport-lounge.js');
const { createObservatoryInstruments } = await import('../lib/fly/lounge/observatory-instruments.js');
const { roomMapBytes } = await import('../lib/fly/lounge/room-textures.js');
const { probeBytes } = await import('../lib/fly/lounge/lounge-probe.js');
const { BOARD_CANVAS } = await import('../lib/fly/lounge/lounge-board.js');
const { ROOM_LOOK } = await import('../lib/fly/observation-config.js');
const { FLOOR_RECT, UPPER_FLOOR_RECT } = await import('../lib/fly/lounge/room-ao.js');
const { FIXTURE_TABLE } = await import('../lib/fly/lounge/room-shading.js');

const { LOUNGE_BUDGETS } = await import('../lib/fly/observation-config.js');
// Room + instruments triangle ceilings. The pier rises to the shared room
// contract (LOUNGE_BUDGETS.room, 160k) for the second-level pass
// (FLY_LOUNGE_SECOND_LEVEL.md, W0); the classic room keeps its 140k.
const TRIANGLE_CEILING = { classic: 140000, pier: LOUNGE_BUDGETS.room.triangles };
for (const variant of ['classic', 'pier']) {
  const room = createAirportLounge({ variant, document: null });
  const instruments = createObservatoryInstruments(variant, null);
  const geometries = [];
  room.group.traverse((o) => { if (o.isMesh) geometries.push(o.geometry); });
  let triangles = instruments.stats.triangles;
  for (const g of geometries) triangles += (g.index?.count ?? g.attributes.position.count) / 3;
  assert.equal(geometries.length + instruments.stats.draws, 14);
  assert.ok(triangles <= TRIANGLE_CEILING[variant], `${variant}: ${triangles} triangles > ${TRIANGLE_CEILING[variant]}`);
  assert.equal(instruments.stats.textureBytes, 2 * 1024 * 1024);
  const floorBytes = (FLOOR_RECT.w * FLOOR_RECT.h + (variant === 'pier' ? UPPER_FLOOR_RECT.w * UPPER_FLOOR_RECT.h : 0)) * 4 / 3;
  const bytes = roomMapBytes() + probeBytes(ROOM_LOOK.probeSize) + BOARD_CANVAS.width * BOARD_CANVAS.height * 4 * 4 / 3 + floorBytes + FIXTURE_TABLE.width * FIXTURE_TABLE.height * 16 + instruments.stats.textureBytes;
  assert.ok(bytes <= 24 * 1024 * 1024, `${variant}: ${bytes} texture bytes`);
  assert.ok(triangles > 120000, 'real room geometry is present');
  const screen = instruments.displays.geometry;
  for (const name of ['position', 'normal', 'uv']) assert.ok([...screen.attributes[name].array].every(Number.isFinite));
  for (const name of ['position', 'normal', 'uv', 'color', 'aSurf']) assert.ok([...instruments.bodies.geometry.attributes[name].array].every(Number.isFinite));
  // A real ray toward each display must reach the screen before its housing.
  // This catches the front-face intersection that made text appear as strips.
  instruments.group.updateMatrixWorld(true);
  for (const station of observatoryStations(variant).filter((s) => ['listen', 'compass', 'night'].includes(s.kind))) {
    const [x, y, z] = station.position, sign = station.side === 'back' ? -1 : 1;
    const target = new Vector3(x, y + .0075, z + sign * .136);
    const origin = target.clone().add(new Vector3(0, .35, sign));
    const ray = new Raycaster(origin, target.clone().sub(origin).normalize());
    const hit = ray.intersectObjects([instruments.bodies, instruments.displays], false)[0];
    assert.equal(hit?.object, instruments.displays, `${variant} ${station.id}: housing must not obscure the face`);
    // Inspect the formerly empty 10 cm band below the head, not only the
    // screen. The support must continue all the way into its hinge.
    const stemRay = new Raycaster(new Vector3(x + .8, y - .09, z), new Vector3(-1, 0, 0), 0, .85);
    assert.ok(stemRay.intersectObject(instruments.bodies, false).length, `${variant} ${station.id}: display support must join the head without an air gap`);
  }
  const owned = [instruments.bodies.geometry, instruments.displays.geometry, instruments.bodies.material, instruments.displays.material];
  let disposed = 0;
  for (const resource of owned) resource.addEventListener('dispose', () => disposed++);
  instruments.dispose(); room.dispose();
  assert.equal(disposed, owned.length);
  console.log(`PASS ${variant}: room + instruments 14 draws, ${triangles} triangles, ${(bytes / 1024 / 1024).toFixed(2)} MiB; finite shared-shader attributes and complete disposal`);
}
assert.equal(listeningGain(0, -1000, 0), 1);
assert.equal(listeningGain(0, 1000, 0), 0);
assert.ok(listeningGain(1000, 0, 90) > .999);
assert.ok(listeningGain(1000, -1000, 0) < .13);
assert.equal(listeningGain(NaN, 0, 0), 0);
assert.equal(listeningGain(0, 0, 0), 0);
assert.ok(Math.abs(listeningGain(0, -1000, 360) - listeningGain(0, -1000, 0)) < 1e-9);
console.log('PASS directional microphone: axis, rejection, rolloff, wrapping, invalid inputs');
