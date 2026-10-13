'use client';
import { useFlyStore } from '@/stores/fly-store';
import { AirfieldGround } from './observation/AirfieldGround';
import { AirportStructures } from './observation/AirportStructures';
import { ParkedFleet } from './observation/ParkedFleet';

/**
 * The observed airport's set piece: ground, airfield lighting, terminal,
 * stands and parked aircraft around the lounge. Mounted inside worldRoot, so
 * children place ABSOLUTE scene coordinates on their objects and keep vertex
 * data local (worldRoot carries the -anchor rebase).
 *
 * One file per workstream (FLY_OBSERVATION_LOUNGE.md): AirfieldGround and
 * AirportStructures belong to AIRFIELD, ParkedFleet to FLEET. Each reads
 * runtime.airportWatch.site and airportLayout(site); the key remounts the
 * whole set on an airport change — or a seat move (`site` counts them: a
 * seat chosen from the airport's OSM data lands after the transfer) — so
 * nothing carries over between sites.
 */
export function ObservationWorld({ runtime }) {
  const key = useFlyStore((s) => (s.airportWatch ? `${s.airportWatch.id}#${s.airportWatch.site ?? 0}` : null));
  if (!key) return null;
  return (
    <group name="observation-world" key={key}>
      <AirfieldGround runtime={runtime} />
      <AirportStructures runtime={runtime} />
      <ParkedFleet runtime={runtime} />
    </group>
  );
}
