'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { CircleGeometry, Color, Mesh, ShaderMaterial } from 'three';
import { GLOBE, NIGHT, TOY, WORLD_EDGE } from '@/lib/fly/fly-constants';
import { PALETTE } from '@/lib/fly/toy-world/toy-palette';

/**
 * The void-grid floor (FLY_GLOBE_REWORK §4.3, finally built): a huge dark
 * disc far below the globe's rim carrying a faint world-anchored cross grid
 * that parallaxes as you fly — the bruno-style "confined toy world" seller,
 * visible past the fog bubble where the bent terrain drops away. Dark
 * styles only (FlyScene gates the mount). ONE draw, no per-frame React.
 *
 * Never z-fights terrain: floorY is DERIVED as the bend drop at the edge
 * fade's end distance plus a margin, so ground is already painted 100% void
 * color (world-bend.js applyBendFade) before its geometry can reach the
 * floor plane — the surfaces only meet where both are flat void.
 *
 * Grid stability: the fragment shader never sees absolute world XZ (float32
 * shimmer at |1e7| m). JS computes float64 mod(flight.pos, cell) into an
 * offset uniform while the mesh follows the player (absolute − anchor =
 * rebase-immune), so the lines stay sub-meter stable across rebases.
 */
export function VoidFloor({ flight, origin, mapStyle }) {
  const floorY = useRef(-6000);

  const mesh = useMemo(() => {
    const f = WORLD_EDGE.floor;
    const mat = new ShaderMaterial({
      fog: false, // three's fogExp2 uses VIEW depth; we fog radially (below)
      uniforms: {
        uBase: { value: new Color('#04060d') },
        uGrid: { value: new Color('#3d4a75') },
        uVoid: { value: new Color('#04060d') },
        // Round 8 fix round (dark horizon band): far floor converges toward
        // the style's RIM color with the scene-fog exp2 law — at flying
        // altitudes the floor IS what fills the band between the terrain
        // silhouette and the sky, and fog-free black there buried the rim
        // glow behind a hard dead band.
        uRim: { value: new Color('#1a2246') },
        uRimFogD: { value: 0 },
        uGridOffset: { value: { x: 0, y: 0, isVector2: true } },
        uCell: { value: f.cellM },
        uLinePx: { value: f.lineWidthPx },
        uGridAlpha: { value: 0.4 },
        uFades: {
          value: {
            x: f.gridFadeStartM,
            y: f.gridFadeEndM,
            z: f.edgeFadeStartM,
            w: f.edgeFadeEndM,
            isVector4: true,
          },
        },
      },
      vertexShader: /* glsl */ `
        varying vec2 vLocalXZ;
        void main() {
          vLocalXZ = position.xz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uBase;
        uniform vec3 uGrid;
        uniform vec3 uVoid;
        uniform vec3 uRim;
        uniform float uRimFogD;
        uniform vec2 uGridOffset;
        uniform float uCell;
        uniform float uLinePx;
        uniform float uGridAlpha;
        uniform vec4 uFades; // gridFadeStart, gridFadeEnd, edgeFadeStart, edgeFadeEnd
        varying vec2 vLocalXZ;
        void main() {
          // World-anchored grid: local + float64 mod offset ≡ absolute/cell
          // in fract space → lines are fixed in the world and parallax by.
          vec2 g = (vLocalXZ + uGridOffset) / uCell;
          vec2 d = abs(fract(g - 0.5) - 0.5) / fwidth(g); // px to nearest line
          float line = 1.0 - min(min(d.x, d.y) / uLinePx, 1.0);
          float r = length(vLocalXZ);
          float gridVis = uGridAlpha * (1.0 - smoothstep(uFades.x, uFades.y, r));
          vec3 col = mix(uBase, uGrid, line * gridVis);
          col = mix(col, uVoid, smoothstep(uFades.z, uFades.w, r));
          // Rim haze last (round-8 fix): same exp2 law as scene fog, radial
          // distance from the player — the far floor melts into the SHARED
          // rim tone the terrain fade and sky dome already present, so the
          // horizon band glows instead of hard-cutting to black.
          float rimF = 1.0 - exp(-uRimFogD * uRimFogD * r * r);
          col = mix(col, uRim, rimF);
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }
      `,
    });
    const geo = new CircleGeometry(f.radiusM, 48);
    geo.rotateX(-Math.PI / 2); // baked: local position.xz IS the ground plane
    const m = new Mesh(geo, mat);
    m.frustumCulled = false;
    return m;
  }, []);

  // Style retint + derived floor depth — discrete transitions only.
  useEffect(() => {
    const u = mesh.material.uniforms;
    const isToy = mapStyle === 'toy';
    const base = isToy ? PALETTE.voidFloor : GLOBE.sky.night.void;
    const grid = isToy ? PALETTE.voidGrid : WORLD_EDGE.floor.gridColorNight;
    u.uBase.value.set(base);
    u.uGrid.value.set(grid);
    u.uVoid.value.set(base);
    u.uGridAlpha.value = WORLD_EDGE.floor.gridAlpha[mapStyle] ?? 0.3;
    // Rim haze: the style's shared rim color + fog density (× rimFogScale)
    u.uRim.value.set(GLOBE.rim[mapStyle] ?? GLOBE.rim.toy);
    u.uRimFogD.value =
      (isToy ? TOY.fogDensity : NIGHT.fogDensity) * WORLD_EDGE.floor.rimFogScale;
    const fade = WORLD_EDGE.fade[mapStyle] ?? WORLD_EDGE.fade.toy;
    const bendR = GLOBE.bendRadiusM[mapStyle] ?? GLOBE.bendRadiusM.toy;
    floorY.current = -((fade.endM * fade.endM) / (2 * bendR)) - WORLD_EDGE.floor.marginM;
  }, [mesh, mapStyle]);

  useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
      (window.__flyStats ??= {}).voidFloor = 1;
    }
    return () => {
      if (process.env.NODE_ENV === 'development' && window.__flyStats) {
        window.__flyStats.voidFloor = 0;
      }
    };
  }, []);

  useEffect(() => {
    return () => {
      mesh.geometry.dispose();
      mesh.material.dispose();
    };
  }, [mesh]);

  // Default priority (after FlyScene's -50 writes flight.pos): follow the
  // player in the rebased frame, keep the grid glued to absolute world XZ.
  useFrame(() => {
    const cell = WORLD_EDGE.floor.cellM;
    mesh.position.set(
      flight.pos.x - origin.anchor.x,
      floorY.current,
      flight.pos.z - origin.anchor.z
    );
    const o = mesh.material.uniforms.uGridOffset.value;
    o.x = ((flight.pos.x % cell) + cell) % cell;
    o.y = ((flight.pos.z % cell) + cell) % cell;
  });

  return <primitive object={mesh} dispose={null} />;
}
