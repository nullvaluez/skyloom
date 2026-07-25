'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  CanvasTexture,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  ShaderMaterial,
  Vector2,
} from 'three';
import { WEATHER } from '@/lib/fly/fly-constants';
import { useFlyStore } from '@/stores/fly-store';

/**
 * Round 16 "Living World" — rain and snow.
 *
 * ONE InstancedMesh: a single quad, one ShaderMaterial, ~900 instances, and
 * **+1 draw call when it is falling / 0 when it is not** (`visible = false`
 * parks it). The animation is entirely GPU-side — the CPU writes `uTime` and
 * a handful of scalars per frame and never touches an instance, so a heavy
 * shower costs the same CPU as a clear sky.
 *
 * Design notes
 *  • Camera-following cylinder (r 150 m, h 90 m): the mesh origin is pinned to
 *    the camera each frame and every instance wraps inside it, so weather is
 *    always AROUND you and nothing is ever paid for outside that volume. World
 *    curvature is irrelevant at 150 m (the bend drop is millimetres), so this
 *    material stays off the world-bend system entirely — no shader variants,
 *    no cache keys.
 *  • FAIL DARK: the per-instance `aSeed` is the only thing positioning a
 *    streak. If the attribute is ever missing, WebGL hands the shader
 *    (0,0,0) → `vAlive` is 0 → every fragment is discarded. A broken build
 *    shows nothing, never a wall of white quads at the origin.
 *  • Rain streaks are WORLD-VERTICAL (leaned by the wind), not screen-vertical:
 *    the quad's long axis is the wind-leaned up vector transformed into view
 *    space, so rain does not roll when the aircraft banks. Snow blends that
 *    axis toward a full camera-facing billboard and adds a sway.
 *  • Procedural textures (a soft streak, a soft flake) — no assets, no
 *    licensing.
 *  • Tier-gated by COUNT: `WEATHER.precip.countByTier.low === 0` means the
 *    component returns null on the low tier and never mounts a thing (a draw
 *    gate cannot see fill rate — the R13/R15 lesson).
 *
 * MOUNTING (FlyScene, owned by A5): this needs `runtime` for the weather state
 * and `flight` for eye-AGL —
 *   {mapStyle === 'satellite' && WEATHER.enabled && qualityTier !== 'low' &&
 *     <PrecipLayer runtime={runtime} flight={flight} />}
 * Without `runtime` it renders nothing at all (no weather = no precipitation),
 * which is also exactly what happens in toy. Mount it at the SCENE ROOT (the
 * CloudField level): the mesh pins itself to `camera.position`, so a parent
 * with its own transform would offset the whole cylinder.
 */

/** Soft vertical rain streak — white, alpha carries the shape. */
function makeStreakTexture() {
  const c = document.createElement('canvas');
  c.width = 16;
  c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 64);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.85)');
  g.addColorStop(0.85, 'rgba(255,255,255,1)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 16, 64);
  // taper the sides so the streak has no hard vertical edges
  const side = ctx.createLinearGradient(0, 0, 16, 0);
  side.addColorStop(0, 'rgba(0,0,0,1)');
  side.addColorStop(0.5, 'rgba(0,0,0,0)');
  side.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = side;
  ctx.fillRect(0, 0, 16, 64);
  return new CanvasTexture(c);
}

/** Soft round snowflake. */
function makeFlakeTexture() {
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 32;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.75)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 32);
  return new CanvasTexture(c);
}

const VERT = /* glsl */ `
  attribute vec3 aSeed;      // (radiusHash, angleHash, phaseHash) in [0,1)
  uniform float uTime;
  uniform float uRadius;
  uniform float uHeight;
  uniform float uFall;       // fall speed, m/s
  uniform vec2  uSize;       // (width, length) in metres
  uniform vec2  uWindDir;    // wind XZ, normalised-ish (m/s / maxMps)
  uniform float uLean;
  uniform float uSway;
  uniform float uSnow;       // 0 = rain, 1 = snow
  varying vec2 vUv;
  varying float vAlive;

  void main() {
    // Fail dark: a missing aSeed attribute reads (0,0,0) → zero-size quad.
    float alive = step(1e-6, aSeed.x + aSeed.y + aSeed.z);
    vAlive = alive;
    vUv = uv;

    float r = uRadius * sqrt(aSeed.x);
    float th = aSeed.y * 6.2831853;
    vec3 c = vec3(cos(th) * r, 0.0, sin(th) * r);
    // Endless fall: one wrapped phase, so nothing is ever respawned on the CPU
    c.y = fract(aSeed.z - uTime * uFall / uHeight) * uHeight - uHeight * 0.5;
    // Snow wanders; rain does not (uSway is 0 for rain).
    c.x += uSway * uSnow * sin(uTime * 1.7 + aSeed.z * 31.4);
    c.z += uSway * uSnow * cos(uTime * 1.3 + aSeed.x * 27.7);

    // The streak axis is WORLD up, leaned downwind — banking the aircraft must
    // not roll the rain.
    vec3 axis = normalize(vec3(uWindDir.x * uLean, 1.0, uWindDir.y * uLean));
    vec4 mv = modelViewMatrix * vec4(c, 1.0);
    vec3 axisV = normalize((modelViewMatrix * vec4(axis, 0.0)).xyz);
    vec3 viewDir = normalize(-mv.xyz);
    vec3 right = normalize(cross(axisV, viewDir));
    // Snow blends to a full camera-facing billboard (flakes are round).
    vec3 up = normalize(mix(axisV, normalize(cross(viewDir, right)), uSnow));

    mv.xyz += right * (position.x * uSize.x) + up * (position.y * uSize.y);
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec3 uColor;
  uniform float uOpacity;
  varying vec2 vUv;
  varying float vAlive;

  void main() {
    float a = texture2D(uMap, vUv).a * uOpacity * vAlive;
    if (a < 0.002) discard;
    gl_FragColor = vec4(uColor, a);
    #include <colorspace_fragment>
  }
`;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const _precipStat = { kind: 'none', fade: 0, count: 0 }; // dev scratch, no alloc

export function PrecipLayer({ runtime, flight }) {
  const qualityTier = useFlyStore((s) => s.qualityTier);
  const cfg = WEATHER.precip;
  const count = cfg.countByTier[qualityTier] ?? cfg.countByTier.high;
  const camera = useThree((s) => s.camera);
  const kindRef = useRef('rain');

  const built = useMemo(() => {
    if (!count) return null;
    const geo = new InstancedBufferGeometry();
    // unit quad, centred — scaled to metres in the vertex shader
    geo.setAttribute(
      'position',
      new Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3)
    );
    geo.setAttribute('uv', new Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    const seeds = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      // Never exactly 0 on all three — that is the fail-dark sentinel.
      seeds[i * 3] = 1e-4 + Math.random() * 0.9999;
      seeds[i * 3 + 1] = Math.random();
      seeds[i * 3 + 2] = Math.random();
    }
    geo.setAttribute('aSeed', new InstancedBufferAttribute(seeds, 3));
    geo.instanceCount = count;
    geo.boundingSphere = null;

    const streak = makeStreakTexture();
    const flake = makeFlakeTexture();
    const mat = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uRadius: { value: cfg.radiusM },
        uHeight: { value: cfg.heightM },
        uFall: { value: cfg.rain.fallMps },
        uSize: { value: new Vector2(cfg.rain.widthM, cfg.rain.lenM) },
        uWindDir: { value: new Vector2(0, 0) },
        uLean: { value: cfg.rain.leanK },
        uSway: { value: cfg.rain.sway },
        uSnow: { value: 0 },
        uMap: { value: streak },
        uColor: { value: new Color(cfg.rain.color) },
        uOpacity: { value: 0 },
      },
    });
    const mesh = new Mesh(geo, mat);
    mesh.frustumCulled = false; // it is always exactly around the camera
    mesh.renderOrder = 5; // over the terrain, under the HUD-ish overlays
    mesh.visible = false; // 0 draws until it actually rains
    return { mesh, streak, flake };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count]);

  useEffect(() => {
    if (!built) return undefined;
    // A rebuild (quality-tier change) resets the uniforms to the rain defaults,
    // so the kind latch has to agree or a live snowfall would keep rain's.
    kindRef.current = 'rain';
    if (process.env.NODE_ENV === 'development' && typeof window !== 'undefined') {
      // verify-weather asserts the +1-draw law on the mesh itself.
      window.__precipMesh = built.mesh;
    }
    return () => {
      built.mesh.geometry.dispose();
      built.mesh.material.dispose();
      built.streak.dispose();
      built.flake.dispose();
      if (process.env.NODE_ENV === 'development' && typeof window !== 'undefined') {
        // A stale stat after unmount reads as "mounted on the low tier" to the
        // harness — the handle and the telemetry leave WITH the mesh.
        if (window.__precipMesh === built.mesh) delete window.__precipMesh;
        if (window.__flyStats?.precip) delete window.__flyStats.precip;
      }
    };
  }, [built]);

  useFrame((state) => {
    if (!built) return;
    const mesh = built.mesh;
    const wx = runtime?.weather?.wx;
    if (!wx || wx.precipT <= cfg.showAbove) {
      mesh.visible = false;
      return;
    }
    // You fly out of the top of the weather.
    const agl = flight ? Math.max(0, flight.pos.y - flight.groundElev) : 0;
    const altFade = 1 - clamp01((agl - cfg.fadeOutAglM) / cfg.fadeSpanM);
    const fade = wx.precipT * altFade;
    if (fade <= cfg.showAbove) {
      mesh.visible = false;
      return;
    }

    const kind = wx.precip === 'snow' ? 'snow' : 'rain';
    const k = kind === 'snow' ? cfg.snow : cfg.rain;
    const u = mesh.material.uniforms;
    if (kindRef.current !== kind) {
      kindRef.current = kind;
      u.uFall.value = k.fallMps;
      u.uSize.value.set(k.widthM, k.lenM);
      u.uLean.value = k.leanK;
      u.uSway.value = k.sway;
      u.uSnow.value = kind === 'snow' ? 1 : 0;
      u.uMap.value = kind === 'snow' ? built.flake : built.streak;
      u.uColor.value.set(k.color);
    }
    u.uTime.value = state.clock.elapsedTime;
    u.uOpacity.value = k.opacity * fade;
    const inv = 1 / WEATHER.wind.maxMps;
    u.uWindDir.value.set(wx.windX * inv, wx.windZ * inv);
    // Ride the camera: the cylinder is the only place precipitation exists.
    mesh.position.copy(camera.position);
    mesh.visible = true;

    if (process.env.NODE_ENV === 'development' && window.__flyStats) {
      _precipStat.kind = kind;
      _precipStat.fade = fade;
      _precipStat.count = count;
      window.__flyStats.precip = _precipStat;
    }
  });

  if (!built) return null; // low tier: never mounts
  return <primitive object={built.mesh} dispose={null} />;
}
