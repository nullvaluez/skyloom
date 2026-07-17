'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Text } from '@react-three/drei';
import { buildPoiList } from '@/lib/fly/poi-data';
import { LETTERS, TOY_WORLD } from '@/lib/fly/fly-constants';
import { bendDrop, getBend } from '@/lib/fly/toy-world/world-bend';
import { useFlyStore } from '@/stores/fly-store';

const FONT = '/fonts/ArchivoBlack-Regular.ttf'; // OFL, self-hosted

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
// 10 slots since the Atlas round added military/hotspot kinds (2 max each);
// the separation declutter keeps the skyline from actually filling all 10.
const SLOTS = 10;
// Bigger kinds pick first; a smaller name that would stand inside a bigger
// one's footprint is dropped (MANHATTAN over TIMES SQUARE).
const KIND_ORDER = ['city', 'airport', 'military', 'landmark', 'hotspot'];

// easeOutBack — the letter pop-in spring (slight overshoot, settles at 1)
function popScale(u) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const t = u - 1;
  return 1 + c3 * t * t * t + c1 * t * t;
}

/**
 * Clean airloom-style POI names (FLY_GLOBE_REWORK §1.3): big white bold
 * letters standing ON the terrain — no outline, no pegs, no sparkles. Every
 * map style gets them (the DOM waypoint chips are gone). Y-billboards toward
 * the camera; follows the mini-planet bend CPU-side via the live uniform
 * (troika text can't ride the vertex patch). Selection re-sorts at 0.5Hz
 * (React state, discrete); positioning is per-frame via refs. Also publishes
 * runtime.nearestPoi for the HUD "where am I" line.
 */
export function PoiLetters({ runtime, flight, origin }) {
  const pois = useMemo(() => buildPoiList(), []);
  const mapStyle = useFlyStore((s) => s.mapStyle);
  const [picked, setPicked] = useState([]);
  const groupRefs = useRef([]);
  const pickedRef = useRef([]);
  pickedRef.current = picked;
  const styleRef = useRef(mapStyle);
  styleRef.current = mapStyle;

  // 0.5Hz selection: nearest per kind, in range
  useEffect(() => {
    const id = setInterval(() => {
      if (!flight) return;
      const px = flight.pos.x;
      const pz = flight.pos.z;
      const byKind = { airport: [], city: [], landmark: [], military: [], hotspot: [] };
      let nearest = null;
      for (const poi of pois) {
        const style = LETTERS[poi.kind];
        if (!style) continue;
        const d = Math.hypot(poi.wx - px, poi.wz - pz);
        if (d > style.rangeM || d < LETTERS.minDistM) continue;
        poi._dist = d;
        byKind[poi.kind].push(poi);
        if (poi.kind !== 'landmark' && (!nearest || d < nearest._dist)) nearest = poi;
      }
      const next = [];
      for (const kind of KIND_ORDER) {
        byKind[kind].sort((a, b) => a._dist - b._dist);
        let taken = 0;
        for (const poi of byKind[kind]) {
          if (taken >= LETTERS[kind].max) break;
          if (
            next.some(
              (p) => Math.hypot(p.wx - poi.wx, p.wz - poi.wz) < LETTERS.separationM
            )
          )
            continue;
          if (poi.elev == null && runtime.engine) {
            const e = runtime.engine.getElevationAt(poi.lon, poi.lat);
            if (e != null) poi.elev = e;
          }
          next.push(poi);
          taken += 1;
        }
      }
      if (nearest) {
        const brg = Math.atan2(nearest.wx - px, -(nearest.wz - pz));
        const dir = COMPASS[Math.round((((brg * 180) / Math.PI + 360) % 360) / 45) % 8];
        const nm = nearest._dist / 1852;
        runtime.nearestPoi = `${nearest.name.toUpperCase()} · ${
          nm < 10 ? nm.toFixed(1) : Math.round(nm)
        }nm ${dir}`;
      }
      // Snapshot for the DOM hover tooltip (LabelCanvas hit-tests these on
      // its existing rAF; positions re-project there with the live bend)
      runtime.poiSlots = next.map((p) => ({
        name: p.name,
        kind: p.kind,
        wx: p.wx,
        wz: p.wz,
        elev: p.elev ?? 0,
        blurb: p.blurb ?? null,
      }));
      setPicked((prev) => {
        const same =
          prev.length === next.length && prev.every((p, i) => p.name === next[i].name);
        return same ? prev : next;
      });
    }, 2000);
    return () => clearInterval(id);
  }, [pois, flight, runtime]);

  // Per-frame: rebased position, Y-billboard, mini-planet drop, pop-in
  useFrame(({ camera }) => {
    const { k } = getBend(); // the live uniform FlyScene writes at -50
    const toy = styleRef.current === 'toy';
    const now = performance.now() / 1000;
    const list = pickedRef.current;
    for (let i = 0; i < SLOTS; i++) {
      const g = groupRefs.current[i];
      if (!g) continue;
      const poi = list[i];
      if (!poi) {
        g.visible = false;
        g.userData.name = null;
        continue;
      }
      g.visible = true;
      // Pop-in spring whenever the slot's name changes
      if (g.userData.name !== poi.name) {
        g.userData.name = poi.name;
        g.userData.popT = now;
      }
      const u = Math.min(1, (now - (g.userData.popT ?? 0)) / LETTERS.popInSec);
      const s = popScale(u);
      g.scale.set(s, s, s);

      const rx = poi.wx - origin.anchor.x;
      const rz = poi.wz - origin.anchor.z;
      const d = Math.hypot(poi.wx - flight.pos.x, poi.wz - flight.pos.z);
      // Toy terrain is exaggerated + lifted; satellite/night stand on true DEM
      const groundY = toy
        ? (poi.elev ?? 0) * TOY_WORLD.terrainExaggeration + TOY_WORLD.groundLift
        : (poi.elev ?? 0);
      g.position.set(rx, groundY - bendDrop(d, k), rz);
      g.rotation.y = Math.atan2(camera.position.x - rx, camera.position.z - rz);
    }
  });

  return (
    <>
      {Array.from({ length: SLOTS }, (_, i) => {
        const poi = picked[i];
        const kind = LETTERS[poi?.kind] ?? LETTERS.city;
        return (
          <group
            key={i}
            ref={(el) => {
              groupRefs.current[i] = el;
            }}
            visible={false}
          >
            {poi && (
              <Text
                font={FONT}
                fontSize={kind.sizeM}
                anchorX="center"
                anchorY="bottom"
                color="#ffffff"
                letterSpacing={0.02}
              >
                {poi.name.toUpperCase()}
              </Text>
            )}
          </group>
        );
      })}
    </>
  );
}
