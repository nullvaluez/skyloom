'use client';
/* eslint-disable react-hooks/immutability -- three.js objects and the shared fly runtime are imperative simulation state, updated in useFrame without React renders. */
import { useEffect, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useFlyStore } from '@/stores/fly-store';
import { airportLayout } from '@/lib/fly/airport-layout';
import { ParkedFleetSet } from '@/lib/fly/fleet-parked';

/**
 * Parked aircraft on airportLayout(site).stands: static scenery, never a live
 * contact. Owner: FLEET (FLY_OBSERVATION_LOUNGE.md); lib/fly/fleet-parked.js
 * holds the plan and the meshes.
 *
 * Mounted inside worldRoot by ObservationWorld (keyed per airport). Each
 * airframe is placed by its own L1 door so the airport set's jet bridges dock
 * at it; stands left empty, or claimed by a real grounded contact, are
 * reported through runtime.airportSet.setOccupied(i, false) so their bridges
 * retract. FLEET_VIEW.parkedScenery switches the whole set off.
 *
 * Runtime: runtime.parkedFleet = { stands, parked, empty, hidden, draws,
 * triangles, families } (the live fleet's draw budget reserves these).
 */
export function ParkedFleet({ runtime }) {
  const airportId = useFlyStore((s) => s.airportWatch?.id ?? null);
  const { gl, camera, scene } = useThree();
  const [fleet, setFleet] = useState(null);
  const [built, setBuilt] = useState(false);

  useEffect(() => {
    const site = runtime.airportWatch?.site;
    if (!site || !airportId) return undefined;
    const layout = runtime.airportSet?.site === site ? runtime.airportSet.layout : airportLayout(site);
    const set = new ParkedFleetSet(site, layout);
    runtime.parkedFleet = set.stats;
    setFleet(set);
    setBuilt(false);
    return () => {
      if (runtime.parkedFleet === set.stats) delete runtime.parkedFleet;
      set.dispose();
      setFleet(null);
    };
  }, [airportId, runtime]);

  // Warm the programs (cinema shadows adopt the materials on their next scene
  // traverse) once every family exists, before the reveal.
  useEffect(() => {
    if (!fleet || !built || !gl.compileAsync) return undefined;
    let cancelled = false;
    const id = requestAnimationFrame(() => requestAnimationFrame(() => {
      if (!cancelled) gl.compileAsync(fleet.group, camera, scene).catch(() => {});
    }));
    return () => { cancelled = true; cancelAnimationFrame(id); };
  }, [fleet, built, gl, camera, scene]);

  useFrame(() => {
    if (!fleet) return;
    const wasReady = fleet.ready;
    fleet.update(runtime, performance.now() / 1000);
    if (!wasReady && fleet.ready) setBuilt(true);
  });

  return fleet ? <primitive object={fleet.group} dispose={null} /> : null;
}
