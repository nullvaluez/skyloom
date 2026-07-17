'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Object3D, Vector3 } from 'three';
import { Environment } from '@react-three/drei';
import { airDrop, applyBendFade, setBend, setBendEye, setEdgeFade } from '@/lib/fly/toy-world/world-bend';
import { PALETTE } from '@/lib/fly/toy-world/toy-palette';
import { SkyDome } from './SkyDome';
import { PoiLetters } from './PoiLetters';
import { TrafficTracers } from './TrafficTracers';
import { WarpBurst } from './WarpBurst';
import { TerrainEngine } from '@/lib/fly/terrain-engine';
import { createImagerySource, createTerrainSources } from '@/lib/fly/tile-sources';
import { FlightModel } from '@/lib/fly/flight-model';
import { InputController } from '@/lib/fly/input-controller';
import { ChaseCamera } from '@/lib/fly/chase-camera';
import { TrafficEngine, mercatorWorldXZ } from '@/lib/fly/traffic-engine';
import { Targeting } from '@/lib/fly/targeting';
import { Autopilot } from '@/lib/fly/autopilot';
import { mercatorScale } from '@/lib/fly/coords';
import {
  CLOUDS,
  FLIGHT,
  GLOBE,
  NIGHT,
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
import { Contrail } from './Contrail';
import { TrafficLayer } from './TrafficLayer';
import { ToyWorldLayer } from './ToyWorldLayer';

const SPAWN_ALT_M = 800;
const _spotPos = new Vector3();
const _warpPos = new Vector3();

// Per-map-style scene mood (bg/fog/lights). hdriBg: use the HDRI as the
// visible sky; otherwise the flat background color IS the sky.
const MOODS = {
  satellite: {
    bg: SKY.fogColor,
    fog: [SKY.fogColor, SKY.fogDensity],
    hdriBg: true,
    hemi: ['#cfe5ff', '#5a6b53', SKY.hemiIntensity],
    sunColor: '#ffffff',
    sunIntensity: SKY.sunIntensity,
    env: SKY.envIntensity,
  },
  night: {
    bg: NIGHT.background,
    fog: [NIGHT.fogColor, NIGHT.fogDensity],
    hdriBg: false,
    hemi: [NIGHT.hemiSky, NIGHT.hemiGround, NIGHT.hemiIntensity],
    sunColor: NIGHT.sunColor,
    sunIntensity: NIGHT.sunIntensity,
    env: NIGHT.envIntensity,
  },
  toy: {
    bg: TOY.background,
    fog: [TOY.fogColor, TOY.fogDensity],
    hdriBg: false,
    hemi: [TOY.hemiSky, TOY.hemiGround, TOY.hemiIntensity],
    sunColor: TOY.sunColor,
    sunIntensity: TOY.sunIntensity,
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
  const sunTarget = useMemo(() => new Object3D(), []);

  // Built once with the style active at mount; later changes hot-swap via
  // engine.setImagery below (styleRef starts in sync with this).
  const engine = useMemo(
    () => new TerrainEngine(createTerrainSources(useFlyStore.getState().mapStyle)),
    []
  );
  const flight = useMemo(() => new FlightModel(), []);
  const input = useMemo(() => new InputController(), []);
  const chase = useMemo(() => new ChaseCamera(), []);
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

    // Warp: hard-teleport the player behind a live track, matching its
    // heading and roughly its speed. Rebase + camera snap land the cut
    // clean; the WarpFlash overlay masks the tile stream-in beat.
    runtime.warpTo = (hex) => {
      const track = traffic.tracks.get(hex);
      if (!track || !track.fix1) return false;
      const geoT = engine.worldToGeo(_warpPos.set(track.rx, track.ry, track.rz));
      const k = mercatorScale(geoT.y);
      autopilot.disengage();
      flight.pos.set(
        track.rx - Math.sin(track.yaw) * WARP.behindM * k,
        track.ry + WARP.aboveM,
        track.rz + Math.cos(track.yaw) * WARP.behindM * k
      );
      flight.heading = track.yaw;
      flight.pitch = 0;
      flight.bank = 0;
      flight.turnRate = 0;
      flight.pitchRate = 0;
      const tSpeed = Math.hypot(track.fix1.vE, track.fix1.vN);
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
      store.bumpWarpEpoch();
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

    if (process.env.NODE_ENV === 'development') {
      window.__fly = runtime;
      window.__flyStore = useFlyStore; // harnesses drive style/tier switches
      // Harness aim helper: the EXACT aircraft drop the GPU applies (reads
      // the live uniforms) — headless scripts project targets through this
      window.__flyAirDrop = (d, y) => airDrop(d, y);
    }
    return () => {
      runtime.engine = null;
      runtime.flight = null;
      runtime.input = null;
      runtime.origin = null;
      runtime.traffic = null;
      runtime.targeting = null;
      runtime.autopilot = null;
      runtime.camera = null;
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
  useEffect(() => engine.onTileMaterial(applyBendFade), [engine]);

  // World-edge fade band + target color per style (style-change-time only;
  // the color matches the style's fog/void family so the melt is seamless).
  useEffect(() => {
    const fade = WORLD_EDGE.fade[mapStyle] ?? WORLD_EDGE.fade.satellite;
    const color =
      mapStyle === 'toy'
        ? PALETTE.voidFloor
        : mapStyle === 'night'
          ? GLOBE.sky.night.void
          : SKY.fogColor;
    setEdgeFade(fade.startM, fade.endM, color);
  }, [mapStyle]);

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

    // ChaseCamera thinks in absolute coordinates; the camera renders rebased.
    camera.position.x += origin.anchor.x;
    camera.position.z += origin.anchor.z;
    chase.update(dt, flight, camera, cmd.freeLook, mercatorScale(flight.latDeg));
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
    // grounded targets keep the full drop, high targets never sink below us
    setBendEye(flight.pos.y, flight.groundElev);

    // Toon shadow sun rides with the player (small ortho frustum)
    const sun = sunRef.current;
    if (sun && TOY.shadows && flyState.mapStyle === 'toy') {
      sun.position.set(
        rpx + SKY.sunDirection[0] * 2500,
        flight.pos.y + SKY.sunDirection[1] * 2500,
        rpz + SKY.sunDirection[2] * 2500
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
        rimOnly={dome.rimOnly}
        stars={mapStyle !== 'satellite'}
      />

      <hemisphereLight args={mood.hemi} />
      <directionalLight
        ref={sunRef}
        position={SKY.sunDirection}
        intensity={mood.sunIntensity}
        color={mood.sunColor}
        castShadow={mapStyle === 'toy' && TOY.shadows && qualityTier !== 'low'}
        target={sunTarget}
        shadow-mapSize-width={TOY.shadowMapSize}
        shadow-mapSize-height={TOY.shadowMapSize}
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

      {(CLOUDS.byStyle[mapStyle]?.enabled ?? true) && (
        <Suspense fallback={null}>
          <CloudField runtime={runtime} flight={flight} origin={origin} />
        </Suspense>
      )}
      <Contrail flight={flight} origin={origin} />
    </>
  );
}
