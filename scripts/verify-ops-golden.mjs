/**
 * GATE TO GATE (W0.2) — verify-ops-golden: FlightOperations trajectories are
 * byte-identical across refactors.
 *
 * Seven scripted scenarios (the plan's six plus a catalog runway) drive FlightOperations with the same plain-object
 * flight scripts/verify-flight-operations.mjs uses, at 30/60/120/144 Hz. A
 * deterministic pilot (a pure function of the sim state, evaluated once per
 * frame) supplies the stick. Every 0.5 s of sim time the gate samples the pose,
 * speed, phase and the event types/ids, and hashes the exact doubles. The
 * fixture (scripts/fixtures/ops-golden.json) was recorded on the untouched
 * pre-split tree (lib/fly/flight-operations.js at 4f7fac3); a refactor must
 * reproduce every hash exactly. Event payload fields are deliberately not
 * hashed: W0.4 enriches them by design.
 *
 *   node scripts/verify-ops-golden.mjs            compare against the fixture
 *   node scripts/verify-ops-golden.mjs --record   rewrite the fixture
 *
 * Flags must be off (the shipped state); a feel flag on changes trajectories
 * by design and has its own gates.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { Vector3 } from 'three';
import { FlightOperations } from '../lib/fly/flight-operations.js';
import { airportById, airportFrame, airportPoint, airportLocal, taxiRoute, registerAirport } from '../lib/fly/operations-airports.js';

const ROOT = path.resolve(import.meta.dirname, '..');

/** A catalog (non-authored) runway from the shipped runway DB, registered like ensureAirport does. */
function catalogAirport(ident) {
  const index = JSON.parse(readFileSync(path.join(ROOT, 'public/data/runways/v1/index.json'), 'utf8')).runways;
  const row = index.filter((r) => r.ident === ident).sort((a, b) => (b.length || 0) - (a.length || 0))[0];
  const region = JSON.parse(readFileSync(path.join(ROOT, `public/data/runways/v1/regions/${row.region}.json`), 'utf8'));
  return registerAirport(region.airports.find((a) => a.id === row.id));
}
const FIXTURE = path.join(ROOT, 'scripts/fixtures/ops-golden.json');
const RATES = [30, 60, 120, 144];
const SAMPLE_SEC = 0.5;
const SPARSE_SEC = 10;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const angle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const bearing = (f, p) => Math.atan2(p.x - f.pos.x, -(p.z - f.pos.z));
const steerTo = (f, p, gain = 1.5) => clamp(angle(bearing(f, p) - f.heading) * gain, -1, 1);

function makeFlight(cruise) {
  return { pos: new Vector3(), cfg: { speeds: { cruise } }, speed: 0, turnRate: 0, pitchRate: 0, heading: 0, pitch: 0, bank: 0, latDeg: 40, groundElev: 0, agl: 0 };
}

/** Attitude command toward a target pitch (attitude-hold sim: pitch rate = cmd * 0.22). */
const pitchTo = (f, target) => clamp((target - f.pitch) * 4, -1, 1);

/** Hold a height above the field with gentle pitch. */
function altitudeHold(f, o, aglTarget) {
  const agl = f.pos.y - f.groundElev - (o.profile?.clearance ?? 0);
  return pitchTo(f, clamp((aglTarget - agl) * 0.002, -0.08, 0.14));
}

/** Track the 3° path and the extended centreline of the ops airport. */
function approachPilot(f, o) {
  const a = o.airport;
  const dir = o.reverse ? -1 : 1;
  const local = airportLocal(a, f.pos.x, f.pos.z);
  const aim = airportPoint(a, local.along + dir * 450, 0);
  const g = o.approachGuidance(f);
  const height = f.pos.y - f.groundElev - o.profile.clearance;
  const flare = height < 10;
  // In this sim vertical speed follows sin(pitch) * speed, so the flare targets
  // a gentle sink (0.8 m/s) rather than a nose-up attitude, which balloons.
  const target = flare ? Math.asin(-0.8 / Math.max(1, f.speed)) : -Math.PI / 60 - clamp(g.vertical * 0.01, -0.05, 0.05);
  return { turn: steerTo(f, aim, 2), pitch: pitchTo(f, target), throttle: flare ? 0 : o.profile.approach / f.cfg.speeds.cruise };
}

/** Follow the operations' own ground guidance target (route junctions). */
function taxiPilot(f, o) {
  const t = o.guidanceTarget(f);
  return { turn: t ? steerTo(f, t) : 0 };
}

// Each scenario returns { setup(), frame(t) -> cmd, seconds }.
const SCENARIOS = {
  // prop KOSU: apron -> taxi -> line up -> takeoff -> circuit -> retry -> land -> taxi in -> complete
  'prop-kosu-circuit': {
    seconds: 560,
    make() {
      const f = makeFlight(60);
      const o = new FlightOperations();
      if (!o.begin(f, 'prop', 'KOSU')) throw new Error('begin KOSU');
      o.chooseRunway(null);
      o.startTaxi();
      let stage = 'taxi';
      let stageT = 0;
      let parkSet = false;
      const next = (s, t) => {
        stage = s;
        stageT = t;
      };
      return {
        f,
        o,
        frame(t) {
          const since = t - stageT;
          if (stage === 'taxi') {
            if (since > 75) {
              o.lineUp(f);
              o.startTakeoff(f);
              next('takeoff', t);
              return {};
            }
            return taxiPilot(f, o);
          }
          if (stage === 'takeoff') {
            if (o.phase === 'airborne' && since > 20) next('circuit', t);
            return { pitch: o.grounded ? (f.speed >= o.profile.rotate ? 0.7 : 0) : altitudeHold(f, o, 250) };
          }
          if (stage === 'circuit') {
            if (since > 60) {
              o.retry(f);
              next('approach', t);
              return {};
            }
            return { turn: since < 30 ? 0.5 : -0.5, pitch: altitudeHold(f, o, 250) };
          }
          if (stage === 'approach') {
            if (o.grounded) next('rollout', t);
            return approachPilot(f, o);
          }
          if (stage === 'rollout') {
            if (o.phase === 'taxiIn') {
              next('taxiIn', t);
              return { powerPreset: 1 };
            }
            return { brake: 1, throttle: 0 };
          }
          if (stage === 'taxiIn') {
            const stand = airportPoint(o.airport, ...taxiRoute(o.airport)[0]);
            const d = Math.hypot(f.pos.x - stand.x, f.pos.z - stand.z);
            if (d < 10 || since > 260) {
              const cmd = { brake: 1, throttle: 0 };
              if (!parkSet && f.speed < 0.3) {
                parkSet = true;
                cmd.toggleParkingBrake = true;
              }
              return cmd;
            }
            return taxiPilot(f, o);
          }
          return {};
        },
      };
    },
  },
  // airliner KLCK: line up, takeoff, climb out
  'airliner-klck-takeoff': {
    seconds: 80,
    make() {
      const f = makeFlight(240);
      const o = new FlightOperations();
      if (!o.begin(f, 'airliner', 'KLCK')) throw new Error('begin KLCK');
      o.chooseRunway(null);
      o.lineUp(f);
      o.startTakeoff(f);
      return {
        f,
        o,
        frame() {
          if (o.grounded) return { pitch: f.speed >= o.profile.rotate ? 0.7 : 0 };
          return { pitch: altitudeHold(f, o, 300), turn: 0.15 };
        },
      };
    },
  },
  // airliner KCMH: a firm contact bounces once, then rolls out and taxis in
  'airliner-kcmh-bounce': {
    seconds: 70,
    make() {
      const f = makeFlight(240);
      const o = new FlightOperations();
      if (!o.begin(f, 'airliner', 'KCMH')) throw new Error('begin KCMH');
      const a = o.airport;
      const p = airportPoint(a, (a.thresholdA || 0) + 400);
      f.pos.set(p.x, p.y + o.profile.clearance + 0.01, p.z);
      f.heading = airportFrame(a).heading;
      f.speed = o.profile.approach;
      f.pitch = -0.12;
      f.groundElev = p.y;
      o.vy = -3.5;
      o.phase = 'approach';
      o.parkingBrake = false;
      return {
        f,
        o,
        frame() {
          if (!o.grounded) return { throttle: 0.3, pitch: pitchTo(f, 0.02) };
          if (o.phase === 'taxiIn') return { ...taxiPilot(f, o), powerPreset: 1 };
          return { brake: 0.8, throttle: 0 };
        },
      };
    },
  },
  // prop KOSU: taxiing fast off the pavement fails as a runway excursion
  'prop-kosu-excursion': {
    seconds: 6,
    make() {
      const f = makeFlight(60);
      const o = new FlightOperations();
      if (!o.begin(f, 'prop', 'KOSU')) throw new Error('begin KOSU');
      const a = o.airport;
      const p = airportPoint(a, 200, a.taxiOffset - 9.9);
      f.pos.set(p.x, p.y + o.profile.clearance, p.z);
      f.heading = airportFrame(a).heading - Math.PI / 2;
      f.speed = 20;
      o.phase = 'taxiOut';
      o.parkingBrake = false;
      return { f, o, frame: () => ({ throttle: 1, pitch: 1 }) };
    },
  },
  // bizjet KLCK: retry approach, go around at 60 m, climb out
  'bizjet-klck-go-around': {
    seconds: 70,
    make() {
      const f = makeFlight(220);
      const o = new FlightOperations();
      if (!o.begin(f, 'bizjet', 'KLCK')) throw new Error('begin KLCK');
      o.chooseRunway(null);
      o.retry(f);
      let around = false;
      return {
        f,
        o,
        frame() {
          const height = f.pos.y - f.groundElev - o.profile.clearance;
          if (!around && o.phase === 'approach' && height < 60) {
            around = true;
            o.goAround(f);
          }
          if (around) return { pitch: altitudeHold(f, o, 400), turn: 0.2 };
          return approachPilot(f, o);
        },
      };
    },
  },
  // prop at a catalog runway (LOWI): line up, takeoff, circuit, retry, land, stop -> complete on the runway
  'prop-lowi-catalog': {
    seconds: 260,
    make() {
      const a = catalogAirport('LOWI');
      const f = makeFlight(60);
      const o = new FlightOperations();
      if (!o.begin(f, 'prop', a.id)) throw new Error('begin LOWI');
      o.chooseRunway(null);
      o.lineUp(f);
      o.startTakeoff(f);
      let stage = 'takeoff';
      let stageT = 0;
      let parkSet = false;
      return {
        f,
        o,
        frame(t) {
          const since = t - stageT;
          if (stage === 'takeoff') {
            if (o.phase === 'airborne' && since > 30) {
              o.retry(f);
              stage = 'approach';
              stageT = t;
              return {};
            }
            return { pitch: o.grounded ? (f.speed >= o.profile.rotate ? 0.7 : 0) : altitudeHold(f, o, 200) };
          }
          if (stage === 'approach' && !o.grounded) return approachPilot(f, o);
          const cmd = { brake: 1, throttle: 0 };
          if (!parkSet && f.speed < 0.4) {
            parkSet = true;
            cmd.toggleParkingBrake = true;
          }
          return cmd;
        },
      };
    },
  },
  // Free Flight prop near KOSU: the slow funnel enters an approach, then a climb drops it
  'free-kosu-slow-funnel': {
    seconds: 70,
    make() {
      const f = makeFlight(60);
      const o = new FlightOperations();
      const a = airportById('KOSU');
      const p = airportPoint(a, -1500);
      f.pos.set(p.x, p.y + 110, p.z);
      f.heading = airportFrame(a).heading;
      f.speed = 32;
      f.pitch = -0.03;
      f.latDeg = a.a.lat;
      f.groundElev = p.y;
      o.phase = 'airborne';
      o.freeAircraftId = 'prop';
      let climbing = false;
      return {
        f,
        o,
        frame(t) {
          if (!o.profile) return { speedPreset: 'slow' };
          if (!climbing && t > 35) {
            climbing = true;
            f.pos.y += 1000;
          }
          if (o.phase === 'approach' && !o.grounded) return { ...approachPilot(f, o), speedPreset: 'slow' };
          if (o.grounded) return { brake: 1, throttle: 0 };
          return { pitch: altitudeHold(f, o, 200) };
        },
      };
    },
  },
};

const num = (v) => (typeof v === 'number' ? v : null);

function runScenario(name, hz) {
  const spec = SCENARIOS[name];
  const run = spec.make();
  const { f, o } = run;
  const dt = 1 / hz;
  const frames = Math.round(spec.seconds * hz);
  const every = Math.round(SAMPLE_SEC * hz);
  const sparseEvery = Math.round(SPARSE_SEC * hz);
  const hash = createHash('sha256');
  const sparse = [];
  const phases = [];
  let lastPhase = null;
  let seenEvent = 0;
  const eventLog = [];
  for (let i = 0; i < frames; i++) {
    const t = i * dt;
    const cmd = run.frame(t) || {};
    o.advance(dt, f, cmd);
    if (o.phase !== lastPhase) {
      phases.push([Math.round((i + 1) * dt * 1000) / 1000, o.phase]);
      lastPhase = o.phase;
    }
    for (const e of o.events) {
      if (e.id > seenEvent) {
        seenEvent = e.id;
        eventLog.push(`${e.id}:${e.type}`);
      }
    }
    if ((i + 1) % every === 0) {
      const row = [f.pos.x, f.pos.y, f.pos.z, f.heading, f.pitch, num(f.bank), f.speed, num(o.vy), num(o.throttle), num(o.gear), o.phase, o.routeIndex, eventLog.length ? eventLog.at(-1) : ''];
      hash.update(JSON.stringify(row));
      if ((i + 1) % sparseEvery === 0) sparse.push(row);
    }
  }
  return {
    hash: hash.digest('hex'),
    final: { phase: o.phase, reason: o.reason ?? null, takeoffs: o.takeoffs, contacts: o.contactCount, touchdown: o.lastTouchdown?.quality ?? null },
    events: eventLog,
    phases,
    sparse,
  };
}

function runAll() {
  const out = {};
  for (const name of Object.keys(SCENARIOS)) {
    out[name] = {};
    for (const hz of RATES) out[name][hz] = runScenario(name, hz);
  }
  return out;
}

const results = runAll();
if (process.argv.includes('--record')) {
  mkdirSync(path.dirname(FIXTURE), { recursive: true });
  writeFileSync(FIXTURE, `${JSON.stringify({ recordedOn: 'pre-split flight-operations.js (4f7fac3)', rates: RATES, sampleSec: SAMPLE_SEC, scenarios: results }, null, 1)}\n`);
  for (const [name, byRate] of Object.entries(results)) {
    for (const [hz, r] of Object.entries(byRate)) console.log(`RECORD ${name} @${hz}Hz  ${r.hash.slice(0, 12)}  ${JSON.stringify(r.final)}  events=${r.events.map((e) => e.split(':')[1]).join(',')}`);
  }
  process.exit(0);
}

const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8'));
let pass = 0;
let fail = 0;
for (const [name, byRate] of Object.entries(fixture.scenarios)) {
  for (const [hz, want] of Object.entries(byRate)) {
    const got = results[name]?.[hz];
    const ok = !!got && got.hash === want.hash && JSON.stringify(got.events) === JSON.stringify(want.events);
    if (ok) pass++;
    else fail++;
    let detail = `${want.final.phase}, ${want.events.length} events`;
    if (!ok && got) {
      const at = want.sparse.findIndex((row, i) => JSON.stringify(row) !== JSON.stringify(got.sparse[i]));
      const firstEvent = want.events.findIndex((e, i) => e !== got.events[i]);
      detail = `hash ${got.hash.slice(0, 12)} != ${want.hash.slice(0, 12)}; first sparse divergence at ${at < 0 ? 'none (sub-10 s)' : `${(at + 1) * SPARSE_SEC}s`}; first event divergence ${firstEvent}; final ${JSON.stringify(got.final)}`;
    }
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} @${hz}Hz  — ${detail}`);
  }
}
console.log(`\nverify-ops-golden: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
