'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Object3D, Vector3, SRGBColorSpace } from 'three';
import { Environment } from '@react-three/drei';
import {
  airDrop,
  applyBendFade,
  applyHillshade,
  getEdgeFade,
  getHillshade,
  groundHorizonTargetM,
  horizonFade,
  setBend,
  setBendEye,
  setDepthHaze,
  setDepthHazeRGB,
  setEdgeFade,
  setEdgeFadeRGB,
  setHillDir,
  setHillshade,
  setHillV2,
  setMicroDetail,
} from '@/lib/fly/toy-world/world-bend';
import { PALETTE } from '@/lib/fly/toy-world/toy-palette';
import { SkyDome, setSkyDip, setSkyAtmo, clearSkyAtmo } from './SkyDome';
import { PoiLetters } from './PoiLetters';
import { TrafficTracers } from './TrafficTracers';
import { WarpBurst } from './WarpBurst';
import { TerrainEngine } from '@/lib/fly/terrain-engine';
import { createImagerySource, createTerrainSources } from '@/lib/fly/tile-sources';
import { FlightModel } from '@/lib/fly/flight-model';
import { InputController } from '@/lib/fly/input-controller';
import { ChaseCamera } from '@/lib/fly/chase-camera';
import { CinemaCamera } from '@/lib/fly/cinema-camera';
import { TrafficEngine, mercatorWorldXZ } from '@/lib/fly/traffic-engine';
import { registerRuntimeActions, clearRuntimeActions } from '@/lib/fly/runtime-bus';
import { Targeting } from '@/lib/fly/targeting';
import { Autopilot } from '@/lib/fly/autopilot';
import { expApproach, mercatorScale } from '@/lib/fly/coords';
import {
  CLOUDS,
  FLIGHT,
  GLOBE,
  HILLSHADE,
  SAT_BUILDINGS,
  SKY,
  TOY,
  TOY_WORLD,
  TRAFFIC_HORIZON,
  WARP,
  WORLD,
  WORLD_EDGE,
} from '@/lib/fly/fly-constants';
import { useFlyStore } from '@/stores/fly-store';
import { usePassportStore } from '@/stores/passport-store';
import { PlayerPlane } from './PlayerPlane';
import { CloudField } from './CloudField';
import { VoidFloor } from './VoidFloor';
import { TownGlow } from './TownGlow';
import { LandmarkMonuments } from './LandmarkMonuments';
import { Contrail } from './Contrail';
import { PlayerGroundShadow } from './PlayerGroundShadow';
import { TrafficLayer } from './TrafficLayer';
import { ToyWorldLayer } from './ToyWorldLayer';
import { SatBuildingLayer } from './SatBuildingLayer';

const SPAWN_ALT_M = 800;
const _spotPos = new Vector3();
const _warpPos = new Vector3();

// Round 13 Phase 1: satellite atmosphere (the rim triple). Precompute the
// SKY.altAtmo time-of-day keyframes as sRGB 0..1 triples once (SKY is a
// constant import); the -50 block interpolates them by runtime.sun.frac and
// cool-shifts toward the high-altitude blue by the smoothed eye-AGL term.
const _hex2rgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};
const _ATMO_TOD = SKY.altAtmo.tod.map((k) => ({
  frac: k.frac,
  rim: _hex2rgb(k.rim),
  void: _hex2rgb(k.void),
}));
const _ATMO_HI_RIM = _hex2rgb(SKY.altAtmo.highAltRim);
const _ATMO_HI_VOID = _hex2rgb(SKY.altAtmo.highAltVoid);
const _atmoRim = [0, 0, 0];
const _atmoVoid = [0, 0, 0];

// Fill _atmoRim/_atmoVoid (sRGB 0..1) for the current sun fraction + smoothed
// altitude term. No allocation (writes the module scratch triples). dayness
// gates the cool-shift so night stays dark at altitude, not lifted to blue.
function computeSatAtmo(frac, altT) {
  const kf = _ATMO_TOD;
  let i = 0;
  while (i < kf.length - 1 && frac > kf[i + 1].frac) i++;
  const a = kf[i];
  const b = kf[Math.min(i + 1, kf.length - 1)];
  const span = b.frac - a.frac;
  const t = span > 1e-6 ? Math.min(1, Math.max(0, (frac - a.frac) / span)) : 0;
  const dayness = Math.min(1, Math.max(0, frac / SKY.altAtmo.daynessFrac));
  const shift = altT * dayness;
  for (let c = 0; c < 3; c++) {
    const rim = a.rim[c] + (b.rim[c] - a.rim[c]) * t;
    const vd = a.void[c] + (b.void[c] - a.void[c]) * t;
    _atmoRim[c] = rim + (_ATMO_HI_RIM[c] - rim) * shift;
    _atmoVoid[c] = vd + (_ATMO_HI_VOID[c] - vd) * shift;
  }
}

// Per-map-style scene mood (bg/fog/lights). hdriBg: use the HDRI as the
// visible sky; otherwise the flat background color IS the sky. Round 8
// (P4): lightDir is the per-style KEY-light direction — the directional
// light AND the shadow-follow rig read it, so toy gets its high-NW moon
// (long NE shadows) while satellite keeps the day sun.
const MOODS = {
  satellite: {
    bg: SKY.fogColor,
    fog: [SKY.fogColor, SKY.fogDensity],
    hdriBg: true,
    hemi: ['#cfe5ff', '#5a6b53', SKY.hemiIntensity],
    sunColor: '#ffffff',
    sunIntensity: SKY.sunIntensity,
    lightDir: SKY.sunDirection,
    env: SKY.envIntensity,
  },
  // (round 7: the 'night' mood was retired with the style — Neon is the
  // night look; NIGHT constants remain in fly-constants as documented dead
  // values in case a dark-raster style ever returns)
  toy: {
    bg: TOY.background,
    fog: [TOY.fogColor, TOY.fogDensity],
    hdriBg: false,
    hemi: [TOY.hemiSky, TOY.hemiGround, TOY.hemiIntensity],
    sunColor: TOY.sunColor,
    sunIntensity: TOY.sunIntensity,
    lightDir: TOY.moonDirection, // round 8: cool moonlight key
    env: TOY.envIntensity,
  },
};

/**
 * The Fly-mode scene graph + frame loop. Order per frame (useFrame
 * priorities): input/flight/ground/rebase (-50) → chase camera (-50, same
 * pass) → player-plane pose (-30) → contrail emitter (-20) → three-tile LOD
 * (renderer-driven) → render. Per-frame state lives in plain objects on
 * `runtime`; zustand is only touched on discrete transitions.
 *
 * FLOATING ORIGIN: flight, camera logic and every TerrainEngine call speak
 * ABSOLUTE Web-Mercator world units (|pos| ~1e7 at NYC). For rendering, the
 * TileMap + player live inside `worldRoot`, positioned at -anchor, so every
 * mesh matrixWorld the GPU sees stays small (float64 CPU composition cancels
 * the large translations exactly). The camera is NOT in worldRoot: it holds
 * rebased coordinates, and the frame loop shifts it to absolute around the
 * ChaseCamera update. The anchor follows the plane in ~10km steps (X/Z only —
 * world Y is true altitude in both frames).
 */
export function FlyScene({ runtime }) {
  const spawn = useFlyStore((s) => s.spawn);
  const mapStyle = useFlyStore((s) => s.mapStyle);
  const qualityTier = useFlyStore((s) => s.qualityTier);
  const mood = MOODS[mapStyle] ?? MOODS.satellite;
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene); // round 13: live satellite fog color/density
  const sunRef = useRef();
  const hemiRef = useRef();
  const satAltTRef = useRef(null); // round 13: smoothed satellite altitude term
  const sunTarget = useMemo(() => new Object3D(), []);
  const warpEpochForSun = useFlyStore((s) => s.warpEpoch); // re-aim the day-cycle on warps
  // Round 13 Phase 1: satellite time-of-day HDRI bucket. Discrete React state
  // that changes only on a sun-frac bucket crossing (a PMREM re-bake); toy
  // ignores it and stays on the certified noon HDRI.
  const [hdriBucket, setHdriBucket] = useState('day');

  // Built once with the style active at mount; later changes hot-swap via
  // engine.setImagery below (styleRef starts in sync with this).
  const engine = useMemo(
    () => new TerrainEngine(createTerrainSources(useFlyStore.getState().mapStyle)),
    []
  );
  const flight = useMemo(() => new FlightModel(), []);
  const input = useMemo(() => new InputController(), []);
  const chase = useMemo(() => new ChaseCamera(), []);
  const cinema = useMemo(() => new CinemaCamera(), []);
  const traffic = useMemo(() => new TrafficEngine(), []);
  const targeting = useMemo(() => new Targeting(), []);
  const autopilot = useMemo(() => new Autopilot(), []);
  const origin = useMemo(() => ({ anchor: new Vector3(), epoch: 0 }), []);

  const worldRoot = useRef();

  const rebase = useCallback(
    (x, z) => {
      const root = worldRoot.current;
      if (!root) return;
      // The camera lives in the rebased frame: shift it by the anchor delta
      // so its ABSOLUTE position is unchanged across the rebase.
      camera.position.x += origin.anchor.x - x;
      camera.position.z += origin.anchor.z - z;
      origin.anchor.set(x, 0, z);
      engine.setAnchor(origin.anchor);
      root.position.set(-x, 0, -z);
      root.updateMatrixWorld(true);
      origin.epoch += 1;
      useFlyStore.getState().bumpRebaseEpoch();
    },
    [camera, engine, origin]
  );

  // Publish engine handles for the DOM HUD (reads at 10Hz) and later phases.
  useEffect(() => {
    runtime.engine = engine;
    runtime.flight = flight;
    runtime.input = input;
    runtime.origin = origin;
    runtime.traffic = traffic;
    runtime.targeting = targeting;
    runtime.autopilot = autopilot;
    runtime.camera = camera;
    runtime.chaseRig = chase; // round 7: harnesses read _look/_freeAmt
    // Grounded-aircraft pin: quality-gated (a coarse fallback DEM tile
    // "answers" with plateau garbage — planes got pinned mid-air forever),
    // and in toy style pinned to the DRAWN ground (exaggerated + lifted),
    // not the true DEM, so wheels meet the drawn runway. Returning null
    // makes the engine retry on the next fix instead of caching garbage.
    traffic.setElevationSampler((lon, lat) => {
      const s = engine.getGroundAt(lon, lat);
      if (!s || s.tileZ < 11) return null;
      return useFlyStore.getState().mapStyle === 'toy'
        ? s.elev * TOY_WORLD.terrainExaggeration + TOY_WORLD.groundLift
        : s.elev;
    });
    // Round 8.5 (H1): AIRBORNE traffic renders in the DRAWN frame too. Toy
    // draws terrain at elev×exaggeration+groundLift while planes fly TRUE
    // altitude — over relief they read up to 0.7×elev too low against the
    // drawn ground. This sampler returns the lift (drawnGround − trueGround)
    // under a track; the engine adds it (smoothed) to track.ryd, the render
    // Y all visual consumers read. Satellite returns 0 → byte-identical
    // path. Same tileZ quality gate as the pin sampler above (a coarse
    // fallback DEM tile answers with plateau garbage); null = retry later,
    // the track keeps its last lift meanwhile.
    traffic.setRenderLiftSampler((lon, lat) => {
      if (
        !TOY_WORLD.airFrameFollowsDrawnGround ||
        useFlyStore.getState().mapStyle !== 'toy'
      ) {
        return 0;
      }
      const s = engine.getGroundAt(lon, lat);
      if (!s || s.tileZ < 11) return null;
      return s.elev * (TOY_WORLD.terrainExaggeration - 1) + TOY_WORLD.groundLift;
    });

    // Warp: hard-teleport the player behind a live track, matching its
    // heading and roughly its speed. Rebase + camera snap land the cut
    // clean; the WarpFlash overlay masks the tile stream-in beat.
    runtime.warpTo = (hex) => {
      const track = traffic.tracks.get(hex);
      // Round 8.5 (§B): no hard fix1 gate — the position warp only needs
      // rx/ry/rz; fix1 merely fed the arrival speed (cruise fallback below).
      // A fixless track hasn't run the engine update, so yaw/ryd may be
      // unset — default to north / true altitude.
      if (!track) return false;
      const yaw = Number.isFinite(track.yaw) ? track.yaw : 0;
      const geoT = engine.worldToGeo(_warpPos.set(track.rx, track.ry, track.rz));
      const k = mercatorScale(geoT.y);
      autopilot.disengage();
      flight.pos.set(
        track.rx - Math.sin(yaw) * WARP.behindM * k,
        // ryd: spawn above where the target is DRAWN (round 8.5 H1) — the
        // player then physically flies at that (true-frame) altitude.
        (track.ryd ?? track.ry) + WARP.aboveM,
        track.rz + Math.cos(yaw) * WARP.behindM * k
      );
      flight.heading = yaw;
      flight.pitch = 0;
      flight.bank = 0;
      flight.turnRate = 0;
      flight.pitchRate = 0;
      const tSpeed = track.fix1
        ? Math.hypot(track.fix1.vE, track.fix1.vN)
        : FLIGHT.speeds.cruise;
      flight.speed = Math.max(FLIGHT.speeds.slow, tSpeed + WARP.speedPadMps);
      const geo = engine.worldToGeo(flight.pos);
      flight.latDeg = geo.y;
      runtime.geo = geo; // the 1Hz poll key picks the new area up next tick
      flight.groundElev = engine.getElevationAt(geo.x, geo.y) ?? 0;
      rebase(flight.pos.x, flight.pos.z);
      chase.snap();
      const store = useFlyStore.getState();
      store.setInspectHex(null);
      store.bumpWarpEpoch();
      return true;
    };

    // Atlas fast travel: teleport anywhere on Earth. Generalizes warpTo —
    // same self-healing machinery (poll re-centers off runtime.geo, tiles/
    // chunks stream around the new anchor, ribbons hard-cut, letters
    // re-pick). Military/hotspot warps pass offsetM ~4km: spawn OUTSIDE
    // the point, nose toward it (the planes are around a base, not on it).
    runtime.warpToGeo = (lat, lon, opts = {}) => {
      const {
        altM = 800,
        headingRad = 0,
        offsetM = 0,
        offsetBearingRad = 0,
        name = null,
        kind = null,
      } = opts;
      // Classify the hop BEFORE moving: cross-region warps (> farKmThreshold)
      // get the held streak→hold→reveal arrival instead of the bare flash.
      const g0 = engine.worldToGeo(flight.pos);
      const dKmLat = (lat - g0.y) * 111.32;
      const dKmLon = (lon - g0.x) * 111.32 * Math.cos((lat * Math.PI) / 180);
      const farWarp = Math.hypot(dKmLat, dKmLon) > WARP.farKmThreshold;
      autopilot.disengage();
      let lat2 = lat;
      let lon2 = lon;
      let hdg = headingRad;
      if (offsetM > 0) {
        lat2 = lat + (offsetM * Math.cos(offsetBearingRad)) / 111320;
        lon2 =
          lon +
          (offsetM * Math.sin(offsetBearingRad)) /
            (111320 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
        hdg = offsetBearingRad + Math.PI; // face back toward the destination
      }
      flight.pos.copy(engine.geoToWorld(lon2, lat2, altM));
      flight.heading = hdg;
      flight.pitch = 0;
      flight.bank = 0;
      flight.turnRate = 0;
      flight.pitchRate = 0;
      flight.speed = FLIGHT.speeds.cruise;
      const geo = engine.worldToGeo(flight.pos);
      flight.latDeg = geo.y;
      runtime.geo = geo; // the 1Hz poll key picks the new area up next tick
      // DEM for the destination is rarely resident yet — 0 now, the
      // 3rd-frame ground sampler + the flight model's soft floor take over
      // as tiles stream in (high-elevation arrivals ride the floor up).
      flight.groundElev = engine.getElevationAt(geo.x, geo.y) ?? 0;
      rebase(flight.pos.x, flight.pos.z);
      chase.snap();
      const store = useFlyStore.getState();
      store.setInspectHex(null);
      store.setAtlasOpen(false);
      // Far warps (cross-region) get the held arrival treatment — the
      // distance is measured on the PRE-warp position captured above.
      store.bumpWarpEpoch(farWarp ? 'far' : 'local');
      if (name) store.setArrival({ name, kind, at: Date.now() });
      return true;
    };

    // Force-lock + intercept from the inspect modal (any range — the
    // targeting release cone/range is suspended while the autopilot holds).
    runtime.interceptHex = (hex) => {
      const track = traffic.tracks.get(hex);
      if (!track || track.stale === 2) return false;
      targeting.lockedHex = hex;
      targeting.target = track;
      targeting._lockT = performance.now() / 1000;
      autopilot.engage('intercept');
      return true;
    };

    // Round 8.5 (§B): mirror the action handles onto the module-scope bus
    // and flip runtimeReady — overlays resolve these AT CALL TIME, so a
    // FlyScene remount re-registers here and heals any captured nulls.
    registerRuntimeActions({
      warpTo: runtime.warpTo,
      warpToGeo: runtime.warpToGeo,
      interceptHex: runtime.interceptHex,
    });
    useFlyStore.getState().setRuntimeReady(true);

    if (process.env.NODE_ENV === 'development') {
      window.__fly = runtime;
      window.__flyStore = useFlyStore; // harnesses drive style/tier switches
      // Remount tripwire: the runtime handles are nulled on cleanup, so a
      // FlyScene remount (Suspense/error-boundary trip) briefly dead-arms
      // every overlay button. 0 on first mount; anything higher during a
      // session means the scene subtree bounced — chase THAT, not the UI.
      const stats = (window.__flyStats ??= {});
      stats.sceneRemounts = (stats.sceneRemounts ?? -1) + 1;
      // Harness aim helper: the EXACT aircraft drop the GPU applies (reads
      // the live uniforms) — headless scripts project targets through this
      window.__flyAirDrop = (d, y) => airDrop(d, y);
      // Round 11: the same live-uniform horizon fade TrafficLayer stamps on
      // every track — harnesses probe controlled (d, alt) pairs through it.
      window.__flyHorizonFade = (d, y) => horizonFade(d, y, TRAFFIC_HORIZON);
    }
    return () => {
      // Dead window opens here (until the next mount re-registers): the bus
      // goes null-safe and runtimeReady disarms the overlay buttons loudly
      // instead of leaving them clickable-but-dead.
      useFlyStore.getState().setRuntimeReady(false);
      clearRuntimeActions();
      runtime.engine = null;
      runtime.flight = null;
      runtime.input = null;
      runtime.origin = null;
      runtime.traffic = null;
      runtime.targeting = null;
      runtime.autopilot = null;
      runtime.camera = null;
      runtime.chaseRig = null;
      runtime.warpTo = null;
      runtime.warpToGeo = null;
      runtime.interceptHex = null;
      traffic.dispose();
      engine.dispose();
    };
  }, [runtime, engine, flight, input, origin, traffic, targeting, autopilot, camera, chase, rebase]);

  useEffect(() => {
    input.attach(gl.domElement);
    return () => input.detach();
  }, [input, gl]);

  // Mini-planet curvature: patch every tile material (now + as tiles
  // stream); strength rides a live uniform (0 in flat styles) so the patch
  // is style-agnostic and survives imagery hot-swaps. Tiles are GROUND —
  // they get the fade variant so the rim melts into the void (no facets).
  // Round 7: + DEM-normal hillshade (strength-gated to satellite via a live
  // uniform — the SAME hook patches toy's solid-tan tiles) and anisotropic
  // imagery sampling (low-pass smearing fix; bandwidth only, zero draws).
  useEffect(
    () =>
      engine.onTileMaterial((m) => {
        applyBendFade(m);
        applyHillshade(m, HILLSHADE);
        // Round 11: tier-aware aniso, read imperatively so NEW tiles pick up
        // a live tier change without re-uploading the streamed field (no
        // degrade hitch; the field converges as tiles stream).
        const aniso =
          HILLSHADE.anisotropyByTier[useFlyStore.getState().qualityTier] ??
          HILLSHADE.anisotropy;
        if (m.map && m.map.anisotropy !== aniso) {
          m.map.anisotropy = aniso;
          m.map.needsUpdate = true;
        }
      }),
    [engine]
  );

  // Hillshade style gate (live uniform — no re-patch, survives hot-swaps).
  // Round 11: tier-aware strength (uniform flip, free on degrade).
  useEffect(() => {
    const sat = mapStyle === 'satellite';
    setHillshade(
      sat ? (HILLSHADE.strengthByTier[qualityTier] ?? HILLSHADE.strength) : 0
    );
    // Round 13 (P4): hillshade v2 (slope AO + slope saturation) rides the same
    // tier/style gate; both live INSIDE the uHillStrength envelope so the
    // verify-sat-depth strength-0 A/B toggle captures them and toy stays 0.
    setHillV2(
      sat ? (HILLSHADE.aoByTier[qualityTier] ?? 0) : 0,
      sat ? (HILLSHADE.satByTier[qualityTier] ?? 0) : 0
    );
  }, [mapStyle, qualityTier]);

  // World-edge fade band + target color per style. Round 6: the fade target
  // is the SHARED GLOBE.rim color — the same tone the fog carries and the
  // SkyDome presents below its horizon — so the terrain, haze and sky agree
  // at the rim (the old void/fog/dome-band three-way mismatch was the
  // "ground and sky feel disconnected" band). Round 12: for static styles
  // this effect is still the ONLY writer; in toy it seeds the band and the
  // per-frame altitude-horizon writer (the -50 block) takes over from the
  // same values — edgeFadeEndRef restarts the smoothing at the static end
  // on every style switch so a toy re-entry never inherits a stale band.
  const edgeFadeEndRef = useRef(null);
  useEffect(() => {
    const fade = WORLD_EDGE.fade[mapStyle] ?? WORLD_EDGE.fade.satellite;
    edgeFadeEndRef.current = fade.endM;
    setEdgeFade(fade.startM, fade.endM, GLOBE.rim[mapStyle] ?? GLOBE.rim.satellite);
    // Round 8 (P4): depth haze — toy's distant ground recedes toward a cool
    // haze tone BEFORE the rim fade (its 13km end sits under the 14km fade
    // start so the round-6 rim gates hold). max 0 = off in every other style.
    const haze = TOY.haze;
    setDepthHaze(haze.startM, haze.endM, haze.color, mapStyle === 'toy' ? haze.max : 0);
  }, [mapStyle]);

  // Day-style local-time light (round 6, Phase G): the sun/hemi intensity
  // lerps with the destination's coarse solar elevation (UTC + lon/15 —
  // the atlas's "exactness doesn't matter" stance). Satellite only; the
  // authored night/toy moods and all colors stay untouched. Recomputes on
  // style change, warps, and a slow interval — never per frame.
  useEffect(() => {
    const apply = () => {
      if (useFlyStore.getState().mapStyle !== 'satellite') return;
      const lon = runtime.geo?.x ?? spawn?.lon ?? 0;
      const t =
        (typeof window !== 'undefined' && window.__flySunOverride) || Date.now();
      const d = new Date(t);
      const localH = (d.getUTCHours() + d.getUTCMinutes() / 60 + lon / 15 + 24) % 24;
      const sunFactor = Math.max(0, Math.cos(((localH - 12) / 12) * Math.PI));
      const frac =
        SKY.dayCycle.minSunFrac + (1 - SKY.dayCycle.minSunFrac) * sunFactor;
      if (sunRef.current) sunRef.current.intensity = SKY.sunIntensity * frac;
      if (hemiRef.current) hemiRef.current.intensity = SKY.hemiIntensity * frac;
      // Round 7: hillshade sun direction from the same coarse local time —
      // east in the morning, west in the evening, elevation clamped so
      // relief never flattens (noon) nor drops below the graze floor (night).
      const az = ((localH - 12) / 12) * Math.PI;
      const el = Math.min(
        HILLSHADE.maxElRad,
        Math.max(HILLSHADE.minElRad, Math.asin(Math.max(0, sunFactor)))
      );
      setHillDir(-Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
      // Round 11: publish the sun state for discrete low-frequency consumers
      // (CloudField tints its unlit puffs from this on a ~10s cadence).
      // Same 60s recompute cadence — zero per-frame cost.
      runtime.sun = { frac: sunFactor, az, el };
      if (process.env.NODE_ENV === 'development' && typeof window !== 'undefined') {
        (window.__flyStats ??= {}).sunFactor = sunFactor;
        window.__flyHill = { get: getHillshade, set: setHillshade };
      }
    };
    apply();
    const id = setInterval(apply, SKY.dayCycle.refreshSec * 1000);
    return () => clearInterval(id);
  }, [mapStyle, warpEpochForSun, runtime, spawn]);

  // Round 13 Phase 1: satellite time-of-day HDRI sky. Reads the SAME runtime.sun
  // the day cycle publishes and buckets it into day / dawn / dusk / night (dawn
  // vs dusk splits on az sign). setState only on a bucket CHANGE, so the drei
  // <Environment> (keyed by the bucket) remounts + re-bakes PMREM at most once
  // per crossing — never per frame. Toy never enters here (its noon HDRI is
  // certified). Re-picks on warp (warpEpochForSun) so a fast-travel to another
  // timezone swaps the sky on arrival, matching the day-cycle light.
  useEffect(() => {
    if (mapStyle !== 'satellite') {
      setHdriBucket('day');
      return;
    }
    const hc = SKY.hdriCycle;
    const pick = () => {
      const frac = runtime.sun?.frac ?? 1;
      const az = runtime.sun?.az ?? 0;
      let b;
      if (frac >= hc.dayFrac) b = 'day';
      else if (frac < hc.nightFrac) b = 'night';
      else b = az < 0 ? 'dawn' : 'dusk';
      setHdriBucket((prev) => (prev === b ? prev : b));
      if (process.env.NODE_ENV === 'development' && typeof window !== 'undefined') {
        (window.__flyStats ??= {}).hdriBucket = b;
      }
    };
    pick();
    const id = setInterval(pick, 5000);
    return () => clearInterval(id);
  }, [mapStyle, warpEpochForSun, runtime]);

  // Round 13 Phase 2 (P1 handoff): cool the directional KEY + hemi-sky COLOR per
  // HDRI bucket in satellite (moonlit blue at night, warm at dawn/dusk). Discrete
  // — same cadence as the bucket swap. COLOR only; INTENSITY stays on the day
  // cycle (verify-sun's noon/midnight intensity gates are untouched). Fixes the
  // "night ground reads as dimmed daylight" gap: the night HDRI dimmed env/bg but
  // the key stayed white. Non-satellite styles keep their JSX mood colors (the
  // directional/hemi color props reset on the style swap).
  useEffect(() => {
    if (mapStyle !== 'satellite') return;
    const kc = SKY.hdriCycle.keyColor[hdriBucket] ?? SKY.hdriCycle.keyColor.day;
    const hc = SKY.hdriCycle.hemiSky[hdriBucket] ?? SKY.hdriCycle.hemiSky.day;
    if (sunRef.current) sunRef.current.color.set(kc);
    if (hemiRef.current) hemiRef.current.color.set(hc);
  }, [mapStyle, hdriBucket]);

  // Map style hot-swap: replace the imagery provider in place — the DEM,
  // quadtree and every coordinate stay untouched; tiles refetch lazily.
  // Grounded pins are style-dependent (toy exaggeration) — resample them.
  const styleRef = useRef(mapStyle);
  useEffect(() => {
    if (styleRef.current === mapStyle) return;
    styleRef.current = mapStyle;
    engine.setImagery(createImagerySource(mapStyle));
    traffic.clearGroundCache();
  }, [mapStyle, engine, traffic]);

  // Round 13 fix: set true by the spawn effect; gates the frame loop's
  // runtime.geo publisher (see the comment at the sample block below).
  const spawnPlacedRef = useRef(false);

  // Spawn: place the aircraft above the spawn point, pointing north, and
  // drop the floating-origin anchor there.
  useEffect(() => {
    if (!spawn) return;
    flight.pos.copy(engine.geoToWorld(spawn.lon, spawn.lat, SPAWN_ALT_M));
    spawnPlacedRef.current = true; // runtime.geo may publish from here on
    flight.latDeg = spawn.lat;
    flight.heading = 0;
    flight.pitch = 0;
    flight.groundElev = 0;
    if (process.env.NODE_ENV === 'development') {
      // The worker projects traffic with a replicated mercator formula —
      // it must agree with three-tile's frame to sub-meter.
      const { x, z } = mercatorWorldXZ(spawn.lon, spawn.lat);
      const dx = Math.abs(flight.pos.x - x);
      const dz = Math.abs(flight.pos.z - z);
      if (dx > 0.5 || dz > 0.5) {
        console.error(`[fly] worker projection mismatch: dx=${dx.toFixed(3)} dz=${dz.toFixed(3)}`);
      } else {
        console.info('[fly] worker projection matches engine.geoToWorld');
      }
    }
    rebase(flight.pos.x, flight.pos.z);
  }, [spawn, engine, flight, rebase]);

  const frameCount = useRef(0);
  // Round 13 fix (live-caught "night at noon" boot): the frame loop can tick
  // BEFORE React flushes the spawn-placement effect below, so the first geo
  // samples came from the UNPLACED flight.pos at the world origin — publishing
  // runtime.geo = (0, 0) ("null island"). The day cycle's first run then read
  // lon 0 and, at the wrong UTC hour, stamped runtime.sun.frac ≈ 0 — and every
  // R13 night consumer (HDRI bucket, moonlit key, altAtmo rim, white balance)
  // faithfully rendered NIGHT at a daytime spawn for up to a 60s cadence tick
  // (a style toggle/warp also healed it, which is how it was reported). Gate
  // the sample block until the spawn effect has actually placed the aircraft —
  // the day cycle's `runtime.geo?.x ?? spawn?.lon` fallback then reads the real
  // spawn longitude on its first run. (Pre-R13 the same latch existed but only
  // dimmed intensity through the 0.35 floor — satellite's new real night made
  // it visible.)
  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    const flyState = useFlyStore.getState();
    const paused = flyState.phase === 'paused';
    // Inspect modal / Atlas count as a soft pause for the stick: the world
    // (and your plane) keep flying, but the cursor belongs to the overlay.
    if (paused || flyState.inspectHex || flyState.atlasOpen) input.neutralize();
    const cmd = input.read();

    // Terrain raycasts are ~fractions of a ms but not free — sample the
    // ground under the aircraft every 3rd frame.
    if (spawnPlacedRef.current && frameCount.current++ % 3 === 0) {
      const geo = engine.worldToGeo(flight.pos);
      flight.latDeg = geo.y;
      const elev = engine.getElevationAt(geo.x, geo.y);
      if (elev != null) flight.groundElev = elev;
      runtime.geo = geo; // Vector3(lon, lat, altM) — HUD/polling read this
    }

    // --- Phase 5: targeting + autopilot (uses traffic items from the
    // previous frame's update at -45 — 16ms of staleness is immaterial) ---
    const store = useFlyStore.getState();
    const transition = targeting.update(
      performance.now() / 1000,
      flight,
      traffic.items,
      autopilot.mode !== 'off'
    );
    if (transition === 'acquired') {
      // First-sight passport spot (store dedups per hex for an hour)
      const t = targeting.target;
      if (t?.meta) {
        const geo = engine.worldToGeo(_spotPos.set(t.rx, t.ry, t.rz));
        usePassportStore.getState().logSpot({
          hex: t.hex,
          flight: t.meta.flight,
          r: t.meta.r,
          t: t.meta.t,
          category: t.meta.category,
          lat: geo.y,
          lon: geo.x,
          _classification: t.meta.iconType,
        });
      }
    } else if (transition === 'released' && autopilot.mode !== 'off') {
      autopilot.disengage();
    }

    // F engages intercept on a soft lock; F again (or hard stick) releases
    if (!paused && input.consumePress('f')) {
      if (autopilot.mode !== 'off') autopilot.disengage();
      else if (targeting.lockedHex) autopilot.engage('intercept');
    }
    // T opens the inspect modal on the locked target — the zero-precision
    // path to warp/intercept (clicking a moving 30px label is fiddly)
    if (!paused && input.consumePress('t') && targeting.lockedHex) {
      store.setInspectHex(targeting.lockedHex);
    }
    // M opens the Atlas (closing is the Atlas's own key handler — while it
    // is open, neutralize() above eats every press before it lands here)
    if (!paused && !flyState.inspectHex && input.consumePress('m')) {
      store.setAtlasOpen(true);
    }
    // C toggles the cinema (wing) camera while the autopilot is flying an
    // intercept/formation — the visible payoff of a CHASE order.
    if (!paused && input.consumePress('c') && autopilot.mode !== 'off') {
      const mode = store.cameraMode === 'cinema' ? 'chase' : 'cinema';
      store.setCameraMode(mode);
      (mode === 'cinema' ? cinema : chase).snap();
    }
    // Auto-revert when the chase ends (lock lost / disengaged / hard stick)
    if (flyState.cameraMode === 'cinema' && (autopilot.mode === 'off' || !targeting.target)) {
      store.setCameraMode('chase');
      chase.snap();
    }
    const apCmd = autopilot.update(dt, flight, targeting.target, cmd);

    // Sync lock state to the store only when it actually changes
    const lockState =
      autopilot.mode === 'intercept'
        ? 'intercepting'
        : autopilot.mode === 'formation'
          ? 'formation'
          : targeting.lockedHex
            ? 'soft'
            : 'none';
    if (store.lockedHex !== targeting.lockedHex || store.lockState !== lockState) {
      if (targeting.lockedHex) store.setLock(targeting.lockedHex, lockState);
      else store.clearLock();
    }

    flight.step(dt, apCmd ?? cmd);

    // Floating origin: rebase when the plane strays far from the anchor.
    const dx = flight.pos.x - origin.anchor.x;
    const dz = flight.pos.z - origin.anchor.z;
    if (dx * dx + dz * dz > WORLD.rebaseDistance * WORLD.rebaseDistance) {
      const t0 = performance.now();
      rebase(flight.pos.x, flight.pos.z);
      if (process.env.NODE_ENV === 'development') {
        // The 60-frame stats block may have created __flyStats without
        // these fields — seed them or the counters go NaN.
        const stats = (window.__flyStats ??= {});
        stats.rebases = (stats.rebases ?? 0) + 1;
        stats.maxRebaseMs = Math.max(stats.maxRebaseMs ?? 0, performance.now() - t0);
      }
    }

    // Camera rigs think in absolute coordinates; the camera renders rebased.
    camera.position.x += origin.anchor.x;
    camera.position.z += origin.anchor.z;
    if (flyState.cameraMode === 'cinema' && targeting.target) {
      cinema.update(
        dt,
        flight,
        targeting.target,
        camera,
        mercatorScale(flight.latDeg),
        flight.groundElev
      );
    } else {
      chase.update(dt, flight, camera, cmd.freeLook, mercatorScale(flight.latDeg));
    }
    camera.position.x -= origin.anchor.x;
    camera.position.z -= origin.anchor.z;

    // Mini-planet bend follows the player (rebased frame) — EVERY style is
    // a globe now (per-style radius; FLY_GLOBE_REWORK §1.1). The bend
    // flattens smoothly with altitude (GLOBE.altFlatten): the confined-toy
    // curve at low level, a believable earth-from-cruise above — without
    // it, chasing/warping to someone at FL300 opened a giant void band
    // between the rim and the sky.
    const rpx = flight.pos.x - origin.anchor.x;
    const rpz = flight.pos.z - origin.anchor.z;
    const bendR = GLOBE.bendRadiusM[flyState.mapStyle] ?? GLOBE.bendRadiusM.satellite;
    let bendK = 1 / (2 * bendR);
    const flat = GLOBE.altFlatten;
    if (flat) {
      const over = Math.max(0, flight.pos.y - flat.startAltM);
      bendK *= Math.max(flat.minKFrac, Math.pow(2, -over / flat.halfAltM));
    }
    setBend(rpx, rpz, bendK);
    // The aircraft bend variant caps drops against the player's eye level —
    // grounded targets keep the full drop, high targets never sink below us.
    // Round 8.5 (H1) decision: groundElev stays TRUE-frame here even in toy
    // (the alternative was passing the drawn ground so the shader's AGL cap
    // blend matches the render frame — we picked the track-Y transform
    // instead, ONE approach only). Both args must stay in the PLAYER's true
    // frame: uEyeY caps drops against the player's actual eye, and the CPU
    // mirror (airDrop) reads the SAME uniforms, so stems/labels stay glued
    // to the GPU either way. Residual: lifted traffic near the drawn ground
    // reads as "more airborne" by the local lift (≤ 0.7×elev) inside the
    // 150–900m blend band — second-order next to the 420m-at-600m-elev bug
    // the ryd transform fixes.
    setBendEye(flight.pos.y, flight.groundElev);

    // Round 12 "Neon Planet": in toy the ground fade band BREATHES with
    // altitude — END chases sqrt(eyeAGL/k)·frac (floored at the static band
    // so the certified low-altitude look is byte-identical), START trails at
    // startGrow of the extension, and the round-8 haze end rides START at
    // its 13/14 ratio so the rim gates hold at every altitude. One damped
    // write into the LIVE uEdgeFade uniform — every consumer (sky dip below,
    // ultra ring, VoidFloor, TownGlow, clouds) reads it via getEdgeFade().
    // Static styles never enter here; their style effect stays the writer.
    const skyFade = WORLD_EDGE.fade[flyState.mapStyle] ?? WORLD_EDGE.fade.satellite;
    const ah = WORLD_EDGE.altHorizon;
    const ahOn = ah?.enabled && ah.byStyle[flyState.mapStyle];
    if (ahOn && flyState.mapStyle === 'satellite') {
      // Round 13 Phase 1: satellite time-of-day + altitude ATMOSPHERE — the
      // rim triple from ONE source (SKY.altAtmo). The edge-fade band stays the
      // static round-11 60/120km (the sky dip below reads its start); only the
      // COLOR, the aerial haze and the fog density move with time-of-day/alt.
      // The altitude term is expApproach-smoothed so a dive can't pop the band;
      // tod tracks slowly (runtime.sun updates on the 60s cadence + on warp).
      const aa = SKY.altAtmo;
      const eyeAgl = Math.max(0, flight.pos.y - flight.groundElev);
      const targetAltT = Math.min(
        1,
        Math.max(0, (eyeAgl - aa.aglStartM) / (aa.aglFullM - aa.aglStartM))
      );
      const altT = (satAltTRef.current = expApproach(
        satAltTRef.current ?? targetAltT,
        targetAltT,
        1 / aa.smoothSec,
        dt
      ));
      computeSatAtmo(runtime.sun?.frac ?? 1, altT);
      // (1) scene fog, (2) tile edge-fade + aerial haze target, (3) SkyDome
      // band — all the same rim color; fog density FALLS with altitude to kill
      // the FL300 "wet mirror" murk band.
      scene.fog?.color.setRGB(_atmoRim[0], _atmoRim[1], _atmoRim[2], SRGBColorSpace);
      if (scene.fog) {
        scene.fog.density =
          aa.fogDensityBase + (aa.fogDensityHigh - aa.fogDensityBase) * altT;
      }
      setEdgeFadeRGB(skyFade.startM, skyFade.endM, _atmoRim[0], _atmoRim[1], _atmoRim[2]);
      setDepthHazeRGB(
        SKY.haze.startM,
        SKY.haze.endM,
        _atmoRim[0],
        _atmoRim[1],
        _atmoRim[2],
        SKY.haze.max
      );
      setSkyAtmo(_atmoRim[0], _atmoRim[1], _atmoRim[2], _atmoVoid[0], _atmoVoid[1], _atmoVoid[2]);
    } else if (ahOn) {
      // Round 12 "Neon Planet" (TOY): the ground fade band BREATHES with
      // altitude — END chases sqrt(eyeAGL/k)·frac (floored at the static band
      // so the certified low-altitude look is byte-identical), START trails at
      // startGrow of the extension, and the round-8 haze end rides START at its
      // 13/14 ratio so the rim gates hold at every altitude. One damped write
      // into the LIVE uEdgeFade uniform — every consumer (sky dip below, ultra
      // ring, VoidFloor, TownGlow, clouds) reads it via getEdgeFade(). UNCHANGED
      // from R12 (satellite takes its own branch above); clearSkyAtmo hands the
      // dome back to its PALETTE props.
      clearSkyAtmo();
      const target = groundHorizonTargetM(ah, skyFade.endM, ah.maxM);
      const endM = (edgeFadeEndRef.current = expApproach(
        edgeFadeEndRef.current ?? skyFade.endM,
        target,
        1 / ah.smoothSec,
        dt
      ));
      const startM = skyFade.startM + (endM - skyFade.endM) * ah.startGrow;
      setEdgeFade(startM, endM, GLOBE.rim[flyState.mapStyle] ?? GLOBE.rim.toy);
      setDepthHaze(
        TOY.haze.startM,
        (startM * TOY.haze.endM) / skyFade.startM,
        TOY.haze.color,
        TOY.haze.max
      );
    } else {
      clearSkyAtmo();
    }

    // Sky horizon follows the bent rim: dip = depression angle (as vDir.y)
    // of the point where the ground starts melting into the rim color —
    // eye height + bend drop at the fade start, over that distance. The
    // dome's gradient lands exactly where the terrain visually ends.
    // Round 12: reads the LIVE band (altitude-extended in toy; the static
    // style constants elsewhere — identical output there). The >1e8 guard
    // covers the pre-style-effect boot frame (uniform boots "disabled").
    const liveFadeStart = getEdgeFade().startM;
    const dipStartM = liveFadeStart > 1e8 ? skyFade.startM : liveFadeStart;
    const eyeAgl = Math.max(0, flight.pos.y - flight.groundElev);
    const rimDrop = dipStartM * dipStartM * bendK + eyeAgl;
    setSkyDip(rimDrop / Math.hypot(rimDrop, dipStartM));

    // Round 13 (P4): low-AGL ground micro-detail. The noise-grain uniform fades
    // IN below HILLSHADE.micro.inAglM and OUT by outAglM (satellite only; the
    // SKY.altAtmo eyeAgl pattern), tier-gated (low → 0). Pure uniform write —
    // 0 above the band / off-satellite compiles the term to a ×1.0 no-op.
    const mc = HILLSHADE.micro;
    const microMax =
      flyState.mapStyle === 'satellite'
        ? (mc.strengthByTier[flyState.qualityTier] ?? 0)
        : 0;
    let mt = Math.min(1, Math.max(0, (eyeAgl - mc.inAglM) / (mc.outAglM - mc.inAglM)));
    mt = mt * mt * (3 - 2 * mt);
    let microStrength = microMax * (1 - mt);
    // Dev A/B handle (like __flySunOverride): pin micro-detail strength for the
    // off/on evidence pair. Ignored in production.
    if (
      process.env.NODE_ENV === 'development' &&
      typeof window !== 'undefined' &&
      window.__flyMicroOverride != null
    ) {
      microStrength = window.__flyMicroOverride;
    }
    setMicroDetail(microStrength);

    // Toon shadow sun rides with the player (small ortho frustum). Round 8:
    // it follows the style's KEY light (MOODS lightDir) — toy's moon, not
    // the day sun — so shadows agree with the moonlit shading.
    const sun = sunRef.current;
    if (sun && TOY.shadows && flyState.mapStyle === 'toy') {
      const dir = (MOODS[flyState.mapStyle] ?? MOODS.satellite).lightDir;
      sun.position.set(
        rpx + dir[0] * 2500,
        flight.pos.y + dir[1] * 2500,
        rpz + dir[2] * 2500
      );
      sunTarget.position.set(rpx, flight.pos.y, rpz);
      sunTarget.updateMatrixWorld();
    }

    // Discrete store sync only when the preset actually changes.
    if (store.speedPreset !== cmd.speedPreset) store.setSpeedPreset(cmd.speedPreset);

    if (process.env.NODE_ENV === 'development') {
      // The EffectComposer's per-pass renders reset gl.info mid-frame —
      // accumulate manually so calls/triangles cover the WHOLE frame.
      if (gl.info.autoReset) gl.info.autoReset = false;
      if (frameCount.current % 60 === 0) {
        const stats = (window.__flyStats ??= {});
        stats.drawCalls = gl.info.render.calls; // previous frame's totals
        stats.triangles = gl.info.render.triangles;
        stats.traffic = traffic.size;
        stats.bendK = bendK; // EFFECTIVE k — harnesses project like LabelCanvas
        // Round 12: the LIVE (smoothed) ground fade band — verify-neon-alt
        // gates on these (static 14000/26000 at spawn; ~47k/82k at cruise).
        const ef = getEdgeFade();
        stats.edgeFadeStartM = ef.startM;
        stats.groundHorizonM = ef.endM;
      }
      gl.info.reset();
    }
  }, -50);

  // Per-style globe sky: satellite = HDRI day + void under the rim;
  // night/toy = full gradient dome (toy colors live in the user's palette)
  const dome =
    mapStyle === 'toy'
      ? {
          horizon: PALETTE.skyHorizon,
          mid: PALETTE.skyMid, // round 8: three-stop night band (toy only)
          zenith: PALETTE.skyZenith,
          void: PALETTE.voidFloor,
          rimOnly: false,
        }
      : (GLOBE.sky[mapStyle] ?? GLOBE.sky.satellite);

  return (
    <>
      {/* Pre-HDRI fallback; the SkyDome is the real sky in every style */}
      <color attach="background" args={[mood.bg]} />
      {/* Aerial haze doubles as the horizon cap that bounds tile loads */}
      <fogExp2 attach="fog" args={mood.fog} />
      <Suspense fallback={null}>
        {/* keyed: drei restores the previous scene.background on unmount.
            Round 13 Phase 1: satellite swaps the visible sky HDRI on discrete
            sun-frac buckets (dawn/dusk/night purskies) — the key carries the
            bucket so each crossing remounts + re-bakes PMREM once. Toy keeps
            the certified noon HDRI unconditionally (key 'toy', never rebakes). */}
        <Environment
          key={mapStyle === 'satellite' ? `sat:${hdriBucket}` : mapStyle}
          files={mapStyle === 'satellite' ? SKY.hdriCycle[hdriBucket] ?? SKY.hdri : SKY.hdri}
          background={mood.hdriBg}
          environmentIntensity={
            mapStyle === 'satellite'
              ? SKY.hdriCycle.intensity[hdriBucket]?.env ?? mood.env
              : mood.env
          }
          backgroundIntensity={
            mapStyle === 'satellite'
              ? SKY.hdriCycle.intensity[hdriBucket]?.bg ?? 1
              : 1
          }
        />
      </Suspense>

      <SkyDome
        horizon={dome.horizon}
        zenith={dome.zenith}
        voidColor={dome.void}
        rim={GLOBE.rim[mapStyle] ?? GLOBE.rim.satellite}
        rimOnly={dome.rimOnly}
        stars={mapStyle !== 'satellite'}
        midColor={dome.mid ?? null}
      />

      <hemisphereLight ref={hemiRef} args={mood.hemi} />
      {/* Round 8: position follows the style's key light (toy = moon) and
          the shadow map is tier-gated — 2048 is a HIGH-only luxury (P7). */}
      <directionalLight
        ref={sunRef}
        position={mood.lightDir}
        intensity={mood.sunIntensity}
        color={mood.sunColor}
        castShadow={mapStyle === 'toy' && TOY.shadows && qualityTier !== 'low'}
        target={sunTarget}
        shadow-mapSize-width={TOY.shadowMapSize[qualityTier] ?? TOY.shadowMapSize.medium}
        shadow-mapSize-height={TOY.shadowMapSize[qualityTier] ?? TOY.shadowMapSize.medium}
        shadow-camera-left={-TOY.shadowRadiusM}
        shadow-camera-right={TOY.shadowRadiusM}
        shadow-camera-top={TOY.shadowRadiusM}
        shadow-camera-bottom={-TOY.shadowRadiusM}
        shadow-camera-near={1}
        shadow-camera-far={8000}
        shadow-bias={-0.0002}
        shadow-normalBias={4}
      />
      <primitive object={sunTarget} />

      <group ref={worldRoot}>
        <primitive object={engine.object} />
        {/* Toy World vector chunks drape over the (flat-tan) tile ground */}
        {mapStyle === 'toy' && <ToyWorldLayer runtime={runtime} flight={flight} />}
        {/* Round 13 Phase 3 CENTERPIECE: 3D extruded buildings in satellite,
            fed by the same vector worker (lean 'sat-buildings' mode). Inside
            worldRoot so chunk meshes ride the -anchor rebase like the toy chunks
            (anchor-bend uBendCenter frame stays in sync). Gated satellite +
            enabled + tier≥medium → byte-noop (no worker/engine/draws) elsewhere. */}
        {mapStyle === 'satellite' && SAT_BUILDINGS.enabled && qualityTier !== 'low' && (
          <SatBuildingLayer runtime={runtime} flight={flight} />
        )}
        <PlayerPlane flight={flight} />
      </group>

      {/* Traffic writes rebased instance matrices — must stay OUTSIDE worldRoot */}
      <TrafficLayer runtime={runtime} flight={flight} origin={origin} />

      {/* Clean airloom 3D letters at POIs — world objects, ALL styles.
          OWN Suspense: troika suspends on font load, and letting that reach
          FlyCanvas's boundary hides+cleans the WHOLE scene (engine.dispose
          mid-flight — the disposed-TileMap spawn bug). */}
      <Suspense fallback={null}>
        <PoiLetters runtime={runtime} flight={flight} origin={origin} />
      </Suspense>
      {/* Neon altitude tracers (airloom signature) — every style */}
      <TrafficTracers runtime={runtime} flight={flight} origin={origin} />
      {/* One-shot neon confetti burst masking the warp cut */}
      <WarpBurst flight={flight} origin={origin} />

      {/* Void-grid floor past the rim (dark styles) — the confined-world seller */}
      {WORLD_EDGE.floor.byStyle[mapStyle] && (
        <VoidFloor flight={flight} origin={origin} mapStyle={mapStyle} />
      )}

      {/* Round 7: distant town glow-domes on the horizon (toy only, +1 draw) */}
      {mapStyle === 'toy' && <TownGlow flight={flight} origin={origin} engine={engine} />}

      {/* Round 8 (P5): procedural landmark monuments, +10 draws. Round 11:
          satellite mounts them too (daylight restyle, raw-DEM ground) — the
          key remounts cleanly on a style switch so materials never hot-swap */}
      <LandmarkMonuments
        key={mapStyle}
        flight={flight}
        origin={origin}
        engine={engine}
        qualityTier={qualityTier}
        mapStyle={mapStyle}
      />

      {(CLOUDS.byStyle[mapStyle]?.enabled ?? true) && (
        <Suspense fallback={null}>
          <CloudField runtime={runtime} flight={flight} origin={origin} />
        </Suspense>
      )}
      <Contrail flight={flight} origin={origin} />
      {/* Round 13 Phase 2: satellite player ground-contact disc (1 draw, low
          AGL only). Toy keeps its real cast shadow via the player's castShadow. */}
      {mapStyle === 'satellite' && <PlayerGroundShadow flight={flight} origin={origin} />}
    </>
  );
}
