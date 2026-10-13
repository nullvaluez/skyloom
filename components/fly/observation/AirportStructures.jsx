'use client';
import { useEffect, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Vector2, Vector3 } from 'three';
import { useFlyStore } from '@/stores/fly-store';
import { airportLayout } from '@/lib/fly/airport-layout';
import { planAirportSet, footprintWorld } from '@/lib/fly/airport-set/plan';
import { createAirportSet } from '@/lib/fly/airport-set/index';
import { SetGround } from '@/lib/fly/airport-set/ground';
import { AIRFIELD, FLEET_VIEW } from '@/lib/fly/observation-config';
import { AIRPORT_LANDMARKS } from '@/lib/fly/airport-landmarks';
import { airportById, findAirportSurface } from '@/lib/fly/operations-airports';
import { airportSetRetirement } from '@/lib/fly/operations-scenery';
import { siteToWorld, worldToSite } from '@/lib/fly/lounge-site';

/**
 * The airport set around and below the observation lounge: the terminal pier
 * and the lounge's pavilion base, jet bridges docked at the stands, apron
 * markings, ground support equipment (parked and driving the service roads),
 * flood masts, the control tower, hangars, windsocks and taxiway signs.
 * Owner: AIRFIELD STRUCTURES (FLY_OBSERVATION_LOUNGE.md).
 *
 * Mounted inside worldRoot by ObservationWorld (keyed per airport): the set
 * group carries ABSOLUTE scene coordinates plus the room frame (rotation.y =
 * site.heading, scale (k, 1, k)), so every builder authors room-local metres
 * with y measured up from the apron.
 *
 * Runtime contract (for FLEET / GROUND / integration):
 *   runtime.airportSet = { site, layout, plan, object, setOccupied(standIndex, bool),
 *                          groundAt(lx, lz), apronY(), stats }
 * groundAt() is the height (metres above apronY) everything touching the
 * ground sits on: markings at +AIRFIELD.structures.decalLiftM, vehicles and
 * bridge wheels at +0.
 * Stands default to occupied (bridges docked, turnaround gear out) unless
 * FLEET_VIEW.parkedScenery === false; FLEET may call setOccupied() per stand.
 */
export function AirportStructures({ runtime }) {
  const airportId = useFlyStore((s) => s.airportWatch?.id ?? null);
  const { gl, camera, scene } = useThree();
  const [set, setSet] = useState(null);
  const frame = useRef({ group: null, nextGround: 0, groundDone: false, startedAt: 0, nextSweep: 0, size: new Vector2(), cam: new Vector3(), lastLog: 0, airfieldVersion: 0 });

  // Build the set for this airport. Created inside an effect (not useMemo) so
  // StrictMode's mount/unmount/mount disposes the first copy and keeps the
  // second: BatchedMesh.dispose() releases textures it cannot recreate.
  useEffect(() => {
    if (!AIRFIELD.structures.enabled) return undefined;
    const site = runtime.airportWatch?.site;
    if (!site || !airportId) return undefined;
    const t0 = performance.now();
    const layout = airportLayout(site);
    const runway = airportById(site.runwayId) || null;
    const isPavement = (x, z) => !!findAirportSurface(x, z, 25);
    const plan = planAirportSet(site, layout, { runway, landmark: AIRPORT_LANDMARKS[site.ident] || null, isPavement });
    if (!plan) return undefined;
    const built = createAirportSet(plan, { k: site.k, heading: site.heading });
    built.site = site;
    built.layout = layout;
    built.buildMs = performance.now() - t0;
    // Retire OSM buildings standing inside the set's footprint (reversible).
    const retirement = airportSetRetirement(site, plan.footprint);
    built.retirement = retirement;
    built.footprintWorld = footprintWorld(site, plan);
    // Ground field under everything that touches the apron (markings,
    // vehicles, bridge wheels), sampled progressively once validated.
    const reach = Math.max(layout.apron.x1, ...plan.hangars.map((h) => h.x + h.w / 2 + 12));
    built.ground = new SetGround({ x0: layout.apron.x0 - 10, x1: reach + 10, z0: layout.apron.z0 - 8, z1: layout.terminal.z1 + 8 }, 8);
    built.setGround(built.ground);
    const parked = FLEET_VIEW.parkedScenery !== false;
    plan.stands.forEach((s) => built.setOccupied(s.index, parked));
    runtime.airportSet = {
      site, layout, plan, object: built.group,
      setOccupied: (index, occupied) => built.setOccupied(index, !!occupied),
      // The ground under the set, metres above the apron plane at a room-local
      // point (sampled DEM, or a registered airport surface when one exists).
      // Parked aircraft and apron surfaces should sit on the same field.
      groundAt: (lx, lz) => built.ground.at(lx, lz),
      apronY: () => (runtime.airportWatch?.validated ? runtime.airportWatch.floorY - site.floorM : site.groundY),
      get stats() { return { buildMs: built.buildMs, triangles: built.triangles, atlasMiB: built.atlasBytes / 1048576, retiredVertices: retirement.retired, lights: built.lights.n, groundPasses: built.ground.passes, groundDone: built.ground.done }; },
    };
    setSet(built);
    return () => {
      retirement.restore();
      if (runtime.airportSet?.plan === plan) delete runtime.airportSet;
      built.dispose();
      setSet(null);
    };
  }, [airportId, runtime]);

  // The light set draws after the cloud composite (sky-overlay pass).
  useEffect(() => (set ? set.lights.glow.overlay() : undefined), [set]);

  // Warm the programs once the CSM rig has adopted the materials (it does so
  // on its next scene traverse), before the room is validated and revealed.
  useEffect(() => {
    if (!set || !gl.compileAsync) return undefined;
    let cancelled = false;
    const id = requestAnimationFrame(() => requestAnimationFrame(() => {
      if (!cancelled) gl.compileAsync(set.group, camera, scene).catch(() => {});
    }));
    return () => { cancelled = true; cancelAnimationFrame(id); };
  }, [set, gl, camera, scene]);

  useFrame((state) => {
    const g = frame.current.group;
    const w = runtime.airportWatch;
    if (!g || !set) return;
    if (!w?.active || !w.site) { g.visible = false; return; }
    const site = set.site;
    const f = frame.current;
    g.visible = !!w.validated;
    const apronY = w.validated ? w.floorY - site.floorM : site.groundY;
    g.position.set(site.x, apronY, site.z);
    g.rotation.set(0, site.heading, 0);
    g.scale.set(site.k, 1, site.k);
    if (!g.visible) return;

    const now = performance.now();
    if (!f.startedAt) f.startedAt = now;

    // The airfield ground (AirfieldGround.jsx) answers engine.getGroundAt with its
    // drawn surface and bumps its version when that surface moves (the terrain
    // under it refines to z17-z18 after this field has settled at z16):
    // sample again so markings, vehicles and parked aircraft stay on it.
    const airfieldVersion = runtime.airfieldGround?.version ?? 0;
    if (airfieldVersion !== f.airfieldVersion) {
      f.airfieldVersion = airfieldVersion;
      set.ground.done = false;
      set.ground.passes = 0;
      f.groundDone = false;
      f.startedAt = now;
    }

    // Retire OSM buildings in newly streamed chunks (twice a second).
    if (now >= f.nextSweep) {
      f.nextSweep = now + 500;
      set.retirement.sweep(runtime.satBuildings);
    }

    // Drape onto the sampled ground (a few hundred probes per frame).
    if (runtime.engine && !set.ground.done) {
      set.ground.advance((lx, lz) => {
        const p = siteToWorld(site, lx, lz);
        const geo = runtime.engine.worldToGeo({ x: p.x, y: 0, z: p.z });
        const sample = runtime.engine.getGroundAt(geo.x, geo.y);
        return sample && Number.isFinite(sample.elev) && sample.tileZ >= 12 ? { dy: sample.elev - apronY, zoom: sample.tileZ } : null;
      }, 220);
    }

    // Far fixtures (tower, hangars, signs, windsocks) sit on their own ground:
    // sample the DEM under each until it is refined (or give up after 90 s).
    if (!f.groundDone && now >= f.nextGround && runtime.engine) {
      f.nextGround = now + 600;
      let settled = true;
      set.fixtures.forEach((fx, i) => {
        const p = siteToWorld(site, fx.x, fx.z);
        const geo = runtime.engine.worldToGeo({ x: p.x, y: 0, z: p.z });
        const sample = runtime.engine.getGroundAt(geo.x, geo.y);
        if (!sample || !Number.isFinite(sample.elev) || sample.tileZ < 12) { settled = false; return; }
        if (sample.tileZ < 15) settled = false;
        set.setFixtureGround(i, Math.max(-40, Math.min(40, sample.elev - apronY)));
      });
      if (settled || now - f.startedAt > 90000) f.groundDone = true;
    }

    // Night weight, wind in room-local axes, camera in room-local metres.
    const env = runtime.cinemaEnvironment;
    const night = env ? env.night : 1 - Math.max(0, Math.min(1, ((runtime.sun?.sinEl ?? 1) + 0.08) / 0.16));
    const wx = runtime.weather?.wx?.windX ?? 3, wz = runtime.weather?.wx?.windZ ?? 0;
    const c = Math.cos(site.heading), s = Math.sin(site.heading);
    const wind = [wx * c - wz * s, wx * s + wz * c];
    const anchor = runtime.origin?.anchor;
    const camLocal = worldToSite(site, camera.position.x + (anchor?.x || 0), camera.position.z + (anchor?.z || 0));
    f.cam.set(camLocal.x, camera.position.y - apronY, camLocal.z);
    state.gl.getDrawingBufferSize(f.size);
    set.update({ t: now / 1000, night, wind, cam: f.cam, camera, heightPx: f.size.y });
  }, -30);

  if (!set) return null;
  return (
    <group ref={(o) => { frame.current.group = o; }} name="airport-structures" visible={false}>
      <primitive object={set.group} dispose={null} />
    </group>
  );
}
