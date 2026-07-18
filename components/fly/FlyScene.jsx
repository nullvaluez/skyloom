'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Object3D, Vector3 } from 'three';
import { Environment } from '@react-three/drei';
import {
  airDrop,
  applyBendFade,
  applyHillshade,
  getHillshade,
  setBend,
  setBendEye,
  setDepthHaze,
  setEdgeFade,
  setHillDir,
  setHillshade,
} from '@/lib/fly/toy-world/world-bend';
import { PALETTE } from '@/lib/fly/toy-world/toy-palette';
import { SkyDome, setSkyDip } from './SkyDome';
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
import { mercatorScale } from '@/lib/fly/coords';
import {
  CLOUDS,
  FLIGHT,
  GLOBE,
  HILLSHADE,
  SKY,
  TOY,
  TOY_WORLD,
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
import { TrafficLayer } from './TrafficLayer';
import { ToyWorldLayer } from './ToyWorldLayer';

const SPAWN_ALT_M = 800;
const _spotPos = new Vector3();
const _warpPos = new Vector3();

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
  const sunRef = useRef();
  const hemiRef = useRef();
  const sunTarget = useMemo(() => new Object3D(), []);
  const warpEpochForSun = useFlyStore((s) => s.warpEpoch); // re-aim the day-cycle on warps

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
        if (m.map && m.map.anisotropy !== HILLSHADE.anisotropy) {
          m.map.anisotropy = HILLSHADE.anisotropy;
          m.map.needsUpdate = true;
        }
      }),
    [engine]
  );

  // Hillshade style gate (live uniform — no re-patch, survives hot-swaps)
  useEffect(() => {
    setHillshade(mapStyle === 'satellite' ? HILLSHADE.strength : 0);
  }, [mapStyle]);

  // World-edge fade band + target color per style (style-change-time only).
  // Round 6: the fade target is the SHARED GLOBE.rim color — the same tone
  // the fog carries and the SkyDome presents below its horizon — so the
  // terrain, haze and sky agree at the rim (the old void/fog/dome-band
  // three-way mismatch was the "ground and sky feel disconnected" band).
  useEffect(() => {
    const fade = WORLD_EDGE.fade[mapStyle] ?? WORLD_EDGE.fade.satellite;
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
      if (process.env.NODE_ENV === 'development' && typeof window !== 'undefined') {
        (window.__flyStats ??= {}).sunFactor = sunFactor;
        window.__flyHill = { get: getHillshade, set: setHillshade };
      }
    };
    apply();
    const id = setInterval(apply, SKY.dayCycle.refreshSec * 1000);
    return () => clearInterval(id);
  }, [mapStyle, warpEpochForSun, runtime, spawn]);

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

  // Spawn: place the aircraft above the spawn point, pointing north, and
  // drop the floating-origin anchor there.
  useEffect(() => {
    if (!spawn) return;
    flight.pos.copy(engine.geoToWorld(spawn.lon, spawn.lat, SPAWN_ALT_M));
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
    if (frameCount.current++ % 3 === 0) {
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
    // Sky horizon follows the bent rim: dip = depression angle (as vDir.y)
    // of the point where the ground starts melting into the rim color —
    // eye height + bend drop at the fade start, over that distance. The
    // dome's gradient lands exactly where the terrain visually ends.
    const skyFade = WORLD_EDGE.fade[flyState.mapStyle] ?? WORLD_EDGE.fade.satellite;
    const eyeAgl = Math.max(0, flight.pos.y - flight.groundElev);
    const rimDrop = skyFade.startM * skyFade.startM * bendK + eyeAgl;
    setSkyDip(rimDrop / Math.hypot(rimDrop, skyFade.startM));

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
        {/* keyed: drei restores the previous scene.background on unmount */}
        <Environment
          key={mapStyle}
          files={SKY.hdri}
          background={mood.hdriBg}
          environmentIntensity={mood.env}
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

      {/* Round 8 (P5): procedural landmark monuments (toy only, +10 draws) */}
      {mapStyle === 'toy' && (
        <LandmarkMonuments
          flight={flight}
          origin={origin}
          engine={engine}
          qualityTier={qualityTier}
        />
      )}

      {(CLOUDS.byStyle[mapStyle]?.enabled ?? true) && (
        <Suspense fallback={null}>
          <CloudField runtime={runtime} flight={flight} origin={origin} />
        </Suspense>
      )}
      <Contrail flight={flight} origin={origin} />
    </>
  );
}
