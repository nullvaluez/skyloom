'use client';
// Observation lounge — mounts the room (lib/fly/airport-lounge.js) while an
// airport observation is open. OUTSIDE worldRoot: the group subtracts the
// origin anchor itself, carries rotation.y = the room heading and scale
// (k, 1, k), so room-local metres land in scene units.
//
// Per frame (-40, after FlyScene's -50 camera update): place the room, run the
// interior lighting model (room-shading.js), ease the lounge exposure bias,
// redraw the boards (<= 1 Hz), drive the glass and steam overlays, publish
// the room's inverse transform for the indoor fixes (rain cull, cloud-shadow
// exclusion, N8AO sizing), prewarm the programs once the cascade rig has
// adopted the materials, and refresh the interior reflection probe when the
// light changes enough to show.
//
// StrictMode-safe (effects run twice in dev): the resource is created in
// useMemo, every effect undoes exactly what it did, and dispose() releases GPU
// resources only (R3F owns the parenting through <primitive>).
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Matrix4, Scene, Vector3, WebGLRenderTarget } from 'three';
import { useFlyStore } from '@/stores/fly-store';
import { createAirportLounge } from '@/lib/fly/airport-lounge';
import { bakeRoomTextures } from '@/lib/fly/lounge/room-textures';
import { loadBake } from '@/lib/fly/lounge/room-ao';
import { updateRoomShading } from '@/lib/fly/lounge/room-shading';
import { InteriorProbe } from '@/lib/fly/lounge/lounge-probe';
import { registerSkyOverlay } from '@/lib/fly/sky-overlay-pass';
import { getR25Sky } from '@/lib/fly/r25-sky';
import { toSceneDir } from '@/lib/fly/true-scale';
import { LOUNGE_ROOM, ROOM_LOOK } from '@/lib/fly/observation-config';

const _key = new Vector3();
const _view = new Vector3();
const _eye = new Vector3();
const ease = (from, to, dt, sec) => from + (to - from) * (1 - Math.exp(-Math.max(0, dt) / sec));
const smooth = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

/** The overlay pass compiles against a lightless holder: warm the same key. */
let _overlayWarm = null;
function overlayWarmScene() {
  _overlayWarm ??= new Scene();
  return _overlayWarm;
}

function Room({ runtime }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const resource = useMemo(() => createAirportLounge(), []);
  const probe = useMemo(() => new InteriorProbe(ROOM_LOOK.probeSize), []);
  const st = useRef(null);
  if (!st.current) {
    st.current = {
      maps: false, warm: 'pending', warmRT: null, exposure: 0, hidden: false, probeAt: -Infinity,
      probeKey: null, probeDirty: true, shade: {}, inverse: new Matrix4(), started: performance.now(),
    };
  }

  // GPU-baked surface maps, attached before the cascade rig or the prewarm
  // ever see the materials.
  useLayoutEffect(() => {
    const baked = bakeRoomTextures(gl);
    resource.attachMaps(baked.maps);
    st.current.maps = true;
    st.current.warm = 'pending';
    st.current.probeDirty = true;
    st.current.textureBytes = baked.bytes;
    return () => baked.dispose();
  }, [gl, resource]);

  // The offline AO bake (fetched once per session).
  useEffect(() => {
    let live = true;
    loadBake().then((bake) => {
      if (!live || !bake) return;
      const ok = resource.attachAO(bake);
      st.current.probeDirty = true;
      if (!ok && process.env.NODE_ENV === 'development') console.warn('[lounge] AO bake does not match the room geometry: run node scripts/build-lounge-ao.mjs');
    });
    return () => { live = false; };
  }, [resource]);

  // Glass and steam draw after the cloud composite.
  useEffect(() => {
    const offGlass = registerSkyOverlay(resource.glass.mesh);
    const offSteam = registerSkyOverlay(resource.steam.mesh);
    return () => { offGlass(); offSteam(); };
  }, [resource]);

  // Indoor fixes read this (PrecipLayer, the cloud composite, the N8AO rig).
  useEffect(() => {
    const publish = { active: false, inverse: st.current.inverse, envelope: LOUNGE_ROOM.envelope, aoRadius: ROOM_LOOK.ao.radius, aoIntensity: ROOM_LOOK.ao.intensity, weight: 0 };
    runtime.loungeRoom = publish;
    return () => {
      if (runtime.loungeRoom === publish) delete runtime.loungeRoom;
      runtime.loungeExposureStops = 0;
    };
  }, [runtime]);

  // GPU resources only.
  useEffect(() => () => {
    resource.dispose();
    probe.dispose();
    st.current.warmRT?.dispose();
    st.current.warmRT = null;
  }, [resource, probe]);

  useFrame((frame, dt) => {
    const s = st.current;
    const w = runtime.airportWatch, seat = w?.seat;
    const group = resource.group;
    const pub = runtime.loungeRoom;
    if (!seat || !w.active) {
      group.visible = false;
      if (pub) pub.active = false;
      return;
    }
    const camera = frame.camera;
    group.position.set(seat.x - runtime.origin.anchor.x, seat.y, seat.z - runtime.origin.anchor.z);
    group.rotation.set(0, w.roomHeading, 0);
    group.scale.set(w.frame.k, 1, w.frame.k);
    group.updateMatrixWorld(true);
    camera.updateMatrixWorld();

    // Binoculars focus at infinity. As the twin-lens mask rises
    // (optics.amount, 0..1, owned by the watch runtime) the room defocuses
    // away — frames, furniture, glass and steam dissolve together — and is
    // hidden outright once the mask is up. Without optics (an older runtime)
    // the field of view stands in, with hysteresis.
    let amount = w.optics?.amount;
    if (!Number.isFinite(amount)) {
      if (camera.fov < ROOM_LOOK.binocularHideFov) s.fovHidden = true;
      else if (camera.fov > ROOM_LOOK.binocularShowFov) s.fovHidden = false;
      amount = s.fovHidden ? 1 : 0;
    }
    const fade = smooth(ROOM_LOOK.optics.fadeFrom, ROOM_LOOK.optics.fadeTo, amount);
    s.hidden = fade >= 0.999;
    const shown = !!w.validated && !s.hidden;
    group.visible = shown;
    resource.uniforms.uLoungeFade.value = fade;
    resource.board.mesh.visible = fade < 0.5; // on the back wall: never in a binocular view

    const env = runtime.cinemaEnvironment;
    if (env?.keyDir) toSceneDir(_key.fromArray(env.keyDir), _key);
    else {
      const sin = runtime.sun?.sinEl ?? 1, az = runtime.sun?.az ?? 0, c = Math.sqrt(Math.max(0, 1 - sin * sin));
      toSceneDir(_key.set(-Math.sin(az) * c, sin, Math.cos(az) * c), _key);
    }
    const time = (performance.now() - s.started) / 1000;
    const shade = updateRoomShading(resource.uniforms, { group, camera, env, sun: runtime.sun, keyScene: _key, time }, s.shade);

    // Exposure: an eased bias so the interior reads while the outside stays
    // bright (SessionRecovery applies runtime.loungeExposureStops).
    const X = ROOM_LOOK.exposure;
    // (the bias is for reading the room: through the binoculars it eases out)
    const target = !w.validated ? 0 : (X.night + (X.day - X.night) * shade.day - (X.day - X.golden) * shade.golden * shade.day) * (1 - fade);
    s.exposure = ease(s.exposure, target, dt, X.easeSec);
    runtime.loungeExposureStops = s.exposure;

    if (pub) {
      pub.active = !!w.validated;
      pub.inverse.copy(group.matrixWorld).invert();
      pub.weight = ease(pub.weight, w.validated ? 1 - fade : 0, dt, 0.6);
    }
    if (!shown) {
      if (runtime.loungeStats) { runtime.loungeStats.hidden = s.hidden; runtime.loungeStats.fade = +fade.toFixed(3); }
      return;
    }

    // Overlays (TRUE-space key -> room-local and view space).
    const sky = getR25Sky();
    const exposure = sky.live && sky.flags.exposure ? sky.exposure : 1;
    const u = resource.uniforms;
    const wx = runtime.weather?.wx;
    const keyColor = env?.keyColor ?? [1, 0.95, 0.85];
    const keyI = (env?.sun ?? 6.2 * shade.day) * (env?.sunVisibility ?? 1);
    const zen = env?.zenith ?? [0.05, 0.1, 0.3], hor = env?.horizon ?? [0.25, 0.4, 0.7];
    resource.glass.update({
      eye: u.uLoungeEye.value,
      sun: u.uLoungeKey.value,
      sunColor: [keyColor[0] * keyI, keyColor[1] * keyI, keyColor[2] * keyI],
      sky: [zen[0] * 0.5 + hor[0] * 0.5, zen[1] * 0.5 + hor[1] * 0.5, zen[2] * 0.5 + hor[2] * 0.5],
      exposure,
      rain: wx?.precip === 'rain' ? Math.min(1, wx.precipT ?? 0) : 0,
      night: shade.night,
      lens: 1 - fade,
      time,
      roomRad: u.uLoungeRoomRad.value,
      probe: probe.texture && s.probeKey ? probe : null,
      probeLod: ROOM_LOOK.probeLod,
    });
    _view.copy(_key).transformDirection(camera.matrixWorldInverse);
    resource.steam.update({
      time, exposure, strength: 1, keyOn: shade.keyI > 0.01 ? 1 : 0, lens: 1 - fade,
      sunView: _view,
      keyColor: [keyColor[0] * keyI, keyColor[1] * keyI, keyColor[2] * keyI],
      ambient: u.uLoungeBounce.value,
    });
    resource.board.update(performance.now(), w, false, runtime.trafficStatus?.state ?? 'live');

    // Prewarm: once the maps are in and the cascade rig (when one runs) has
    // adopted every lit material, compile the room under a render target so
    // the program keys match the composer's (linear, no tone mapping).
    if (s.maps && s.warm === 'pending') {
      const csm = runtime.cinemaShadows?.cascades > 0;
      const adopted = !csm || resource.litMaterials().every((m) => m.customProgramCacheKey().includes('cinema-csm'));
      if (adopted) {
        s.warm = 'running';
        s.warmRT ??= new WebGLRenderTarget(1, 1);
        const prev = gl.getRenderTarget();
        let job;
        try {
          gl.setRenderTarget(s.warmRT);
          job = Promise.all([gl.compileAsync(group, camera, scene), gl.compileAsync(resource.glass.mesh, camera, overlayWarmScene()), gl.compileAsync(resource.steam.mesh, camera, overlayWarmScene())]);
        } finally {
          gl.setRenderTarget(prev);
        }
        job.then(() => { if (st.current === s) s.warm = 'done'; }, () => { if (st.current === s) s.warm = 'done'; });
      }
    }

    // Interior reflection probe: refresh when the light changed enough.
    if (s.warm === 'done') {
      const key = `${Math.round(shade.practical * 25)}|${Math.round(shade.day * 20)}`;
      const now = performance.now();
      if ((s.probeDirty || key !== s.probeKey) && now - s.probeAt > ROOM_LOOK.probeMinMs) {
        _eye.setFromMatrixPosition(camera.matrixWorld);
        const objects = [...resource.meshes, resource.board.mesh];
        probe.capture(gl, scene, group, objects, _eye);
        s.probeAt = now;
        s.probeKey = key;
        s.probeDirty = false;
      }
    }

    if (process.env.NODE_ENV === 'development' || runtime.graphicsReview) {
      runtime.loungeStats = { warm: s.warm, ao: resource.aoApplied, probe: probe.stats, exposureStops: +s.exposure.toFixed(3), practical: +shade.practical.toFixed(3), day: +shade.day.toFixed(3), textureBytes: s.textureBytes ?? 0, hidden: s.hidden, fade: +fade.toFixed(3) };
    }
  }, -40);

  return <primitive object={resource.group} dispose={null} />;
}

export function AirportLounge({ runtime }) {
  const active = useFlyStore((s) => !!s.airportWatch);
  return active ? <Room runtime={runtime} /> : null;
}
