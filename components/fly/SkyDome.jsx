'use client';

import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { BackSide, Color, ShaderMaterial, SphereGeometry, Mesh, SRGBColorSpace, Vector3 } from 'three';

// Live horizon dip (round 6): the ground curves away d²k but the dome's
// horizon used to sit at flat eye level — at altitude a black band opened
// between the terrain rim and the sky. FlyScene feeds the dip each frame
// (same pattern as world-bend's setBend); the dome shifts its horizon line
// down to meet the bent rim. Module scope: one dome per scene.
const dipUniform = { value: 0 };
export function setSkyDip(dipY) {
  dipUniform.value = dipY;
}

// Round 13 Phase 1: live per-frame dome atmosphere (satellite time-of-day +
// altitude tint). FlyScene's -50 block writes the interpolated rim/void colors
// here every frame in satellite — the THIRD leg of the rim triple (scene fog +
// tile edge-fade being the other two, all from SKY.altAtmo). Components are
// OUTPUT-space sRGB (0..1); setRGB(...,SRGBColorSpace) converts to the dome's
// linear working space (matching the Color(hex) prop path). horizon = rim so
// the below-horizon band starts on the same tone the sky presents. clearSkyAtmo
// hands the dome back to its declarative props (toy/night keep the prop path).
const atmo = { active: false, rim: new Color(), void: new Color() };
export function setSkyAtmo(rr, rg, rb, vr, vg, vb) {
  atmo.active = true;
  atmo.rim.setRGB(rr, rg, rb, SRGBColorSpace);
  atmo.void.setRGB(vr, vg, vb, SRGBColorSpace);
}
export function clearSkyAtmo() {
  atmo.active = false;
}

// Round 16 "Living World" — the two live NIGHT/WEATHER channels, same
// module-setter pattern as setSkyAtmo above (one dome per scene; the frame
// loop owns the uniforms and always wins over the declarative props).
//
// BYTE IDENTITY, precisely: the star and moon terms are multiplied by
// `uNight × (1 − uOvercast)` and the upper gradient is `mix(up, lid,
// uOvercast)`. When NOTHING drives these channels the frame loop pins
// uNight = 1 and uOvercast = 0, so those become `× 1.0 × (1.0 − 0.0)` and
// `mix(up, lid, 0.0)` — IEEE-exact identities in any evaluation order. Toy
// (which never calls these setters, and whose -50 branch clears them) is
// therefore bit-for-bit the R15 dome, and so is a satellite DAYLIGHT frame
// (nightT resolves to exactly 0 above SKY_LIVE.nightSky.starZeroFrac, and
// baseline weather holds overcastT at exactly 0).
//
// The rimOnly alpha additions are inside `if (uRimOnly > 0.5)` — a branch toy
// never takes at all — and each is a `max(existing, 0.0)` at rest.
const night = { active: false, t: 0, dir: new Vector3(0, 1, 0) };
export function setSkyNight(nightT, mx, my, mz) {
  night.active = true;
  night.t = nightT;
  night.dir.set(mx, my, mz);
}
export function clearSkyNight() {
  night.active = false;
}

const weather = { active: false, t: 0, horizon: new Color(), zenith: new Color() };
export function setSkyWeather(overcastT, hr, hg, hb, zr, zg, zb) {
  weather.active = true;
  weather.t = overcastT;
  weather.horizon.setRGB(hr, hg, hb, SRGBColorSpace);
  weather.zenith.setRGB(zr, zg, zb, SRGBColorSpace);
}
export function clearSkyWeather() {
  weather.active = false;
}

// Round 19 scaffolding (Fable): the golden-hour sun feed for D GOLDENHOUR.
// FlyScene's -50 satellite branch calls this (gated SKY_DUSK.enabled) with
// runtime.sun's az (HOUR ANGLE — negative before local noon, the R16
// convention), el (deg) and frac. No-op stub until D implements the lobe;
// D adds the parameters with the implementation.
export function setSkySun() {}

/**
 * Per-style globe sky (FLY_GLOBE_REWORK): a camera-following gradient dome —
 * horizon glow at the rim, zenith above, and a dark VOID below the horizon
 * line so the curved mini-planet visibly floats in nothing (airloom
 * reference). rimOnly (satellite) renders transparent above the horizon so
 * the HDRI day sky shows through — the dome only supplies the atmosphere
 * band + void under the globe's rim.
 *
 * Round 6 "connected rim": below the (dipped) horizon the dome blends
 * horizon → uRim (the SHARED per-style rim color that scene fog and the
 * ground edge-fade also use) before falling to the deep void — so the
 * terrain melts into exactly the color the sky presents where they meet.
 * Fog is disabled on it (it IS the backdrop); drawn first, no depth write.
 */
export function SkyDome({
  horizon,
  zenith,
  voidColor,
  rim,
  rimOnly = false,
  stars = false,
  midColor = null,
  midFrac = 0.3,
  moon = null,
}) {
  const mesh = useMemo(() => {
    const mat = new ShaderMaterial({
      side: BackSide,
      depthWrite: false,
      transparent: true,
      fog: false,
      uniforms: {
        uHorizon: { value: new Color(horizon) },
        uZenith: { value: new Color(zenith) },
        uVoid: { value: new Color(voidColor) },
        uRim: { value: new Color(rim ?? voidColor) },
        uRimOnly: { value: rimOnly ? 1 : 0 },
        uStars: { value: stars ? 1 : 0 },
        uDipY: dipUniform,
        // Round 8 (P4): optional three-stop upper gradient (toy passes
        // PALETTE.skyMid). Absent → uHasMid 0 → the original two-stop blend.
        uMid: { value: new Color(midColor ?? horizon) },
        uMidFrac: { value: midFrac },
        uHasMid: { value: midColor ? 1 : 0 },
        // Round 13 P5 (toy): moon disc on TOY.moonDirection. uMoon 0 → no disc.
        uMoon: { value: moon ? 1 : 0 },
        uMoonDir: { value: new Vector3(...(moon?.dir ?? [0, 1, 0])).normalize() },
        uMoonColor: { value: new Color(moon?.color ?? '#ffffff') },
        // (angularR, glowR, brightness, glowStrength)
        uMoonParams: {
          value: [moon?.angularR ?? 0.05, moon?.glowR ?? 0.16, moon?.brightness ?? 0.6, moon?.glowStrength ?? 0.18],
        },
        // Round 16: live night weight (1 = "the stars/moon are at the strength
        // the props asked for" — the R15 behaviour, hence the default) and the
        // overcast lid (0 = no lid at all). See the setter comments above.
        uNight: { value: 1 },
        uOvercast: { value: 0 },
        uOverH: { value: new Color(0, 0, 0) },
        uOverZ: { value: new Color(0, 0, 0) },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uHorizon;
        uniform vec3 uZenith;
        uniform vec3 uVoid;
        uniform vec3 uRim;
        uniform float uRimOnly;
        uniform float uStars;
        uniform float uDipY;
        uniform vec3 uMid;
        uniform float uMidFrac;
        uniform float uHasMid;
        uniform float uMoon;
        uniform vec3 uMoonDir;
        uniform vec3 uMoonColor;
        uniform vec4 uMoonParams;
        uniform float uNight;
        uniform float uOvercast;
        uniform vec3 uOverH;
        uniform vec3 uOverZ;
        varying vec3 vDir;
        void main() {
          // Dipped horizon: y = 0 where the bent terrain rim sits, not at
          // flat eye level — the gradient hugs the world's actual edge.
          float y = vDir.y + uDipY;
          // Upper hemisphere: the original two-stop horizon→zenith, or (toy)
          // a three-stop horizon→mid→zenith with the knee at uMidFrac for a
          // richer night band.
          float yy = pow(clamp(y, 0.0, 1.0), 0.55);
          vec3 up = uHasMid > 0.5
            ? ( yy < uMidFrac
                  ? mix(uHorizon, uMid, yy / max(1e-4, uMidFrac))
                  : mix(uMid, uZenith, (yy - uMidFrac) / max(1e-4, 1.0 - uMidFrac)) )
            : mix(uHorizon, uZenith, yy);
          // Round 16: the OVERCAST LID. A real overcast sky is a dim grey
          // ceiling, not a blue sky seen through cloud — so the upper
          // hemisphere is replaced (not tinted) by a horizon→zenith grey ramp
          // that FlyScene feeds from the already grey-mixed rim triple. At
          // uOvercast 0 this is mix(up, lid, 0.0) = up, exactly.
          up = mix(up, mix(uOverH, uOverZ, yy), uOvercast);
          // below the horizon: settle on the shared rim tone first (where
          // terrain fades out), then fall into the deep void underneath
          vec3 down = mix(uHorizon, uRim, clamp(-y * 2.5, 0.0, 1.0));
          down = mix(down, uVoid, smoothstep(0.22, 0.65, -y));
          vec3 col = y >= 0.0 ? up : down;
          // How much light the dome ADDS above the horizon (stars + moon).
          // In rimOnly (satellite) the dome is transparent up there, so this
          // is also what its alpha has to carry or the night sky is invisible.
          float nightLuma = 0.0;
          // Restrained star field (dark styles): a few hundred pinprick
          // stars, dim enough to stay under the bloom threshold — presence
          // for the ink sky without turning it into a blizzard.
          if (uStars > 0.5 && y > 0.0) {
            vec3 dir = normalize(vDir);
            vec3 cell = floor(dir * 110.0);
            vec3 h = fract(
              sin(vec3(
                dot(cell, vec3(127.1, 311.7, 74.7)),
                dot(cell, vec3(269.5, 183.3, 246.1)),
                dot(cell, vec3(113.5, 271.9, 124.6))
              )) * 43758.5453
            );
            vec3 sdir = normalize((cell + 0.2 + 0.6 * h) / 110.0);
            // Round 13 P5: per-star SIZE (h.z) + brightness (h.y) variation — a
            // few brighter/bigger stars among the pinpricks (still under bloom).
            float sz = 0.0009 + 0.0016 * h.z;
            float star = smoothstep(sz, sz * 0.3, distance(dir, sdir));
            star *= step(0.955, h.x); // ~4.5% of cells hold a star
            // Round 16: × uNight (they come out as the sun goes down) and
            // × (1 − uOvercast) (a lid hides them). Both are exactly 1.0 at
            // rest, so the toy star field is unchanged to the bit.
            float sAdd = star * (0.13 + 0.30 * h.y) * smoothstep(0.04, 0.25, y) * uStars
              * uNight * (1.0 - uOvercast);
            col += sAdd;
            nightLuma += sAdd;
          }
          // Round 13 P5: toy moon disc on TOY.moonDirection — a soft-edged disc
          // + a gentle halo. Value-only (cool ICE white). Upper hemisphere only.
          if (uMoon > 0.5) {
            float ad = distance(normalize(vDir), normalize(uMoonDir));
            float disc = smoothstep(uMoonParams.x, uMoonParams.x * 0.6, ad);
            float glow = smoothstep(uMoonParams.y, 0.0, ad);
            vec3 mAdd = uMoonColor * (disc * uMoonParams.z + glow * glow * uMoonParams.w)
              * uNight * (1.0 - uOvercast);
            col += mAdd;
            nightLuma += max(mAdd.r, max(mAdd.g, mAdd.b));
          }
          // rimOnly: fade out just above the (dipped) horizon so the HDRI
          // sky owns the upper hemisphere while the void swallows the rim
          float alpha = uRimOnly > 0.5 ? smoothstep(0.015, -0.005, y) : 1.0;
          if (uRimOnly > 0.5) {
            // Round 16 (satellite): the dome has to become VISIBLE up there
            // for the two things it now draws — the night sky it just added,
            // and the overcast lid that has to cover the HDRI to read as a
            // ceiling. Both are max(existing, 0.0) at rest, so a satellite
            // DAYLIGHT frame keeps exactly the R15 rim-only alpha.
            alpha = max(alpha, min(1.0, nightLuma));
            alpha = max(alpha, uOvercast * smoothstep(0.0, 0.06, y));
          }
          gl_FragColor = vec4(col, alpha);
          #include <colorspace_fragment>
        }
      `,
    });
    const m = new Mesh(new SphereGeometry(450000, 32, 24), mat);
    m.renderOrder = -100;
    m.frustumCulled = false;
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Style changes just retint the live uniforms — no material rebuild
  useEffect(() => {
    const u = mesh.material.uniforms;
    u.uHorizon.value.set(horizon);
    u.uZenith.value.set(zenith);
    u.uVoid.value.set(voidColor);
    u.uRim.value.set(rim ?? voidColor);
    u.uRimOnly.value = rimOnly ? 1 : 0;
    u.uStars.value = stars ? 1 : 0;
    u.uMid.value.set(midColor ?? horizon);
    u.uMidFrac.value = midFrac;
    u.uHasMid.value = midColor ? 1 : 0;
    u.uMoon.value = moon ? 1 : 0;
    if (moon) {
      u.uMoonDir.value.set(moon.dir[0], moon.dir[1], moon.dir[2]).normalize();
      u.uMoonColor.value.set(moon.color);
      u.uMoonParams.value = [moon.angularR, moon.glowR, moon.brightness, moon.glowStrength];
    }
  }, [mesh, horizon, zenith, voidColor, rim, rimOnly, stars, midColor, midFrac, moon]);

  useEffect(() => {
    return () => {
      mesh.geometry.dispose();
      mesh.material.dispose();
    };
  }, [mesh]);

  // Follow the camera (rebased frame) so the dome never parallaxes; in
  // satellite the -50 block feeds live time-of-day/altitude atmosphere colors.
  useFrame(({ camera }) => {
    mesh.position.copy(camera.position);
    const u = mesh.material.uniforms;
    if (atmo.active) {
      u.uHorizon.value.copy(atmo.rim);
      u.uRim.value.copy(atmo.rim);
      u.uVoid.value.copy(atmo.void);
    }
    // Round 16: the live night + overcast channels. When a channel is not
    // being driven (toy, or before satellite's first day-cycle tick) it is
    // pinned to its identity value — so a style switch out of satellite can
    // never strand the dome at someone else's night weight.
    if (night.active) {
      u.uNight.value = night.t;
      u.uMoonDir.value.copy(night.dir);
    } else if (u.uNight.value !== 1) {
      u.uNight.value = 1;
    }
    if (weather.active) {
      u.uOvercast.value = weather.t;
      u.uOverH.value.copy(weather.horizon);
      u.uOverZ.value.copy(weather.zenith);
    } else if (u.uOvercast.value !== 0) {
      u.uOvercast.value = 0;
    }
  });

  return <primitive object={mesh} dispose={null} />;
}
