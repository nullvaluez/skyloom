'use client';

import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { BackSide, Color, ShaderMaterial, SphereGeometry, Mesh } from 'three';

/**
 * Per-style globe sky (FLY_GLOBE_REWORK): a camera-following gradient dome —
 * horizon glow at the rim, zenith above, and a dark VOID below the horizon
 * line so the curved mini-planet visibly floats in nothing (airloom
 * reference). rimOnly (satellite) renders transparent above the horizon so
 * the HDRI day sky shows through — the dome only supplies the atmosphere
 * band + void under the globe's rim.
 * Fog is disabled on it (it IS the backdrop); drawn first, no depth write.
 */
export function SkyDome({ horizon, zenith, voidColor, rimOnly = false, stars = false }) {
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
        uRimOnly: { value: rimOnly ? 1 : 0 },
        uStars: { value: stars ? 1 : 0 },
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
        uniform float uRimOnly;
        uniform float uStars;
        varying vec3 vDir;
        void main() {
          float y = vDir.y;
          vec3 up = mix(uHorizon, uZenith, pow(clamp(y, 0.0, 1.0), 0.55));
          // below the horizon: quick falloff into the void
          vec3 down = mix(uHorizon, uVoid, clamp(-y * 5.0, 0.0, 1.0));
          vec3 col = y >= 0.0 ? up : down;
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
            float star = smoothstep(0.0022, 0.0006, distance(dir, sdir));
            star *= step(0.96, h.x); // ~4% of cells hold a star
            col += star * (0.15 + 0.28 * h.y) * smoothstep(0.04, 0.25, y) * uStars;
          }
          // rimOnly: fade out just above the horizon so the HDRI sky owns
          // the upper hemisphere while the void still swallows the rim
          float alpha = uRimOnly > 0.5 ? smoothstep(0.015, -0.005, y) : 1.0;
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
    u.uRimOnly.value = rimOnly ? 1 : 0;
    u.uStars.value = stars ? 1 : 0;
  }, [mesh, horizon, zenith, voidColor, rimOnly, stars]);

  useEffect(() => {
    return () => {
      mesh.geometry.dispose();
      mesh.material.dispose();
    };
  }, [mesh]);

  // Follow the camera (rebased frame) so the dome never parallaxes
  useFrame(({ camera }) => {
    mesh.position.copy(camera.position);
  });

  return <primitive object={mesh} dispose={null} />;
}
