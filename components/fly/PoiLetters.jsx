'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Text } from '@react-three/drei';
import { buildPoiList } from '@/lib/fly/poi-data';
import { LETTERS, TOY_WORLD } from '@/lib/fly/fly-constants';
import { letterLiftM } from '@/lib/fly/landmarks-3d';
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

  // 0.5Hz selection: nearest per kind, in range. Round 6 stability pass
  // (user: "POI letters are very intermittent — they should always be
  // visible"): three flicker sources fixed —
  //   1. slots are STABLE: a poi keeps its slot index while selected, so a
  //      membership change no longer shifts every later name to a new slot
  //      (which restarted their pop-in at scale 0 and re-shaped the troika
  //      text — the visible blink);
  //   2. hysteresis: a shown poi keeps its letter to rangeM×1.25 (entry at
  //      rangeM) and down to minDistM×0.55 (entry at minDistM), so the 2s
  //      tick can't flip a boundary poi in and out;
  //   3. sticky sort: shown pois compete with a 0.8× effective distance, so
  //      two near-equal candidates stop alternating for the last quota slot.
  useEffect(() => {
    const id = setInterval(() => {
      if (!flight) return;
      const px = flight.pos.x;
      const pz = flight.pos.z;
      const current = pickedRef.current; // slot-indexed, may hold nulls
      const shown = new Set();
      for (const p of current) if (p) shown.add(p.name);
      const byKind = { airport: [], city: [], landmark: [], military: [], hotspot: [] };
      let nearest = null;
      for (const poi of pois) {
        const style = LETTERS[poi.kind];
        if (!style) continue;
        const d = Math.hypot(poi.wx - px, poi.wz - pz);
        const isShown = shown.has(poi.name);
        const maxD = isShown ? style.rangeM * 1.25 : style.rangeM;
        // Round 8 fix round: a monument-bearing landmark's letter rides high
        // above its monument in toy — let it survive a much closer approach
        // (the flat floor suppressed STATUE OF LIBERTY at the 1.7km framing).
        const nearK =
          styleRef.current === 'toy' && poi.kind === 'landmark' && poi.lm
            ? LETTERS.monumentMinDistK
            : 1;
        const minD = (isShown ? LETTERS.minDistM * 0.55 : LETTERS.minDistM) * nearK;
        if (d > maxD || d < minD) continue;
        poi._dist = d;
        poi._sortD = isShown ? d * 0.8 : d;
        // Minimum hold: a letter shown < 20s ago outranks any newcomer for
        // its kind's quota — a name must never pop in and vanish seconds
        // later just because a slightly closer candidate crossed the ring.
        poi._prio = isShown && Date.now() - (poi._shownAt ?? 0) < 20000 ? 0 : 1;
        byKind[poi.kind].push(poi);
        if (poi.kind !== 'landmark' && (!nearest || d < nearest._dist)) nearest = poi;
      }
      const ideal = [];
      for (const kind of KIND_ORDER) {
        byKind[kind].sort((a, b) => a._prio - b._prio || a._sortD - b._sortD);
        let taken = 0;
        for (const poi of byKind[kind]) {
          if (taken >= LETTERS[kind].max) break;
          // Round 8 fix round: in toy, a monument-bearing landmark's letter
          // floats ABOVE its monument (letterLiftM), so a city/airport name
          // standing on the ground can't visually collide with it — yet the
          // flat separation check let JERSEY CITY (3.2km away) suppress the
          // STATUE OF LIBERTY letter forever (verify-monuments). Such
          // landmarks now only declutter against OTHER landmarks; every
          // grounded letter keeps the round-6 rule (and slot stability /
          // hysteresis are untouched — this only widens candidacy).
          const sepExempt =
            styleRef.current === 'toy' && poi.kind === 'landmark' && !!poi.lm;
          if (
            ideal.some(
              (p) =>
                (!sepExempt || p.kind === 'landmark') &&
                Math.hypot(p.wx - poi.wx, p.wz - poi.wz) < LETTERS.separationM
            )
          )
            continue;
          if (poi.elev == null && runtime.engine) {
            const e = runtime.engine.getElevationAt(poi.lon, poi.lat);
            if (e != null) poi.elev = e;
          }
          ideal.push(poi);
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
      // Reconcile into stable slots: keep survivors where they are, then
      // fill empty slots with the newcomers in selection order.
      const nextSlots = new Array(SLOTS).fill(null);
      const pending = [...ideal];
      for (let i = 0; i < SLOTS; i++) {
        const p = current[i];
        if (!p) continue;
        const j = pending.findIndex((q) => q.name === p.name);
        if (j >= 0) {
          nextSlots[i] = pending[j];
          pending.splice(j, 1);
        }
      }
      for (const q of pending) {
        const i = nextSlots.indexOf(null);
        if (i < 0) break;
        nextSlots[i] = q;
        if (!shown.has(q.name)) q._shownAt = Date.now();
      }
      // Snapshot for the DOM hover tooltip (LabelCanvas hit-tests these on
      // its existing rAF; positions re-project there with the live bend)
      runtime.poiSlots = nextSlots
        .filter(Boolean)
        .map((p) => ({
          name: p.name,
          kind: p.kind,
          wx: p.wx,
          wz: p.wz,
          elev: p.elev ?? 0,
          blurb: p.blurb ?? null,
        }));
      setPicked((prev) => {
        const same =
          prev.length === nextSlots.length &&
          prev.every((p, i) => (p?.name ?? null) === (nextSlots[i]?.name ?? null));
        return same ? prev : nextSlots;
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
      // Round 8 (P5): landmark letters float ABOVE their monument (toy only —
      // monuments mount toy-only); naturals return 0 and stay grounded.
      const lift = toy ? letterLiftM(poi) : 0;
      g.position.set(rx, groundY + lift - bendDrop(d, k), rz);
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
