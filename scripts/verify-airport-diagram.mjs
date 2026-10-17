import assert from 'node:assert/strict';
import { airportDiagramFrame } from '../lib/fly/lounge/airport-diagram.mjs';

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('PASS ' + name); };
const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-9, message || `${actual} ≈ ${expected}`);
const runways = Object.freeze([
  Object.freeze({ a: Object.freeze({ x: -1600, z: -1700 }), b: Object.freeze({ x: 1800, z: 1900 }) }),
  Object.freeze({ a: Object.freeze({ x: -1300, z: -2100 }), b: Object.freeze({ x: 2100, z: 1400 }) }),
]);

test('Runway endpoints fit with padding, including diagonal and displaced airports', () => {
  for (const records of [runways, [{ a: { x: 16000, z: 12000 }, b: { x: 19000, z: 15000 } }]]) {
    const frame = airportDiagramFrame(records);
    assert.deepEqual(frame.project({ x: 0, z: 0 }), [180, 139]);
    for (const runway of records) for (const point of [runway.a, runway.b]) {
      const [x, y] = frame.project(point);
      assert.ok(Math.hypot(x - 180, y - 139) <= 112 / 1.15 + 1e-9);
      assert.ok(x >= 68 && x <= 292 && y >= 27 && y <= 251);
      assert.equal(frame.locate(point).offMap, false);
    }
  }
});

test('Empty or unavailable geometry retains a finite, honest airport frame', () => {
  for (const records of [[], null, [{ a: { x: NaN, z: 1 }, b: null }]]) {
    const frame = airportDiagramFrame(records);
    near(frame.extent, 1380); near(frame.scale, 112 / 1380);
    assert.deepEqual(frame.locate({ x: 0, z: 0 }), { point: [180, 139], offMap: false, angleDeg: 0 });
  }
  assert.throws(() => airportDiagramFrame().locate({ x: Infinity, z: 0 }), TypeError);
});

test('Off-map selections preserve cardinal and diagonal bearings at the map edge', () => {
  const frame = airportDiagramFrame(runways);
  for (const [x, z, angle] of [[0, -50000, 0], [50000, 0, 90], [0, 50000, 180], [-50000, 0, 270], [30000, -40000, 36.86989764584402], [-30000, 40000, 216.86989764584402]]) {
    const located = frame.locate({ x, z });
    assert.equal(located.offMap, true); near(located.angleDeg, angle);
    const dx = located.point[0] - 180, dy = located.point[1] - 139;
    near(Math.hypot(dx, dy), 112);
    near(dx / 112, x / Math.hypot(x, z)); near(dy / 112, z / Math.hypot(x, z));
  }
});

test('In-map contacts retain their real positions and map scale is unaffected by distant traffic', () => {
  const frame = airportDiagramFrame(runways), initial = { extent: frame.extent, scale: frame.scale };
  const originRunway = frame.project(runways[0].a), contact = Object.freeze({ x: 450, z: -700, selected: true, distanceM: 830 });
  const before = JSON.stringify({ runways, contact });
  assert.deepEqual(frame.locate(contact).point, frame.project(contact));
  assert.equal(frame.locate(contact).offMap, false);
  frame.locate(Object.freeze({ x: 500000, z: -900000, selected: true }));
  assert.deepEqual({ extent: frame.extent, scale: frame.scale }, initial);
  assert.deepEqual(frame.project(runways[0].a), originRunway);
  assert.equal(JSON.stringify({ runways, contact }), before);
});

console.log(`\nAirport diagram: ${passed} passed, 0 failed.`);
