'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { CanvasTexture, CircleGeometry, Color, Mesh, MeshBasicMaterial } from 'three';
import { PLAYER } from '@/lib/fly/fly-constants';
import { applyBend } from '@/lib/fly/toy-world/world-bend';
import { useFlyStore } from '@/stores/fly-store';

/** Soft radial falloff for the contact disc — procedural, no asset. */
function makeShadowTexture() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 3, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.5)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new CanvasTexture(c);
}

/**
 * Round 13 Phase 2 — the player's SATELLITE ground-contact shadow. A ONE-draw
 * soft dark disc riding the DRAWN ground directly under the player, faded out
 * with AGL. This is the sanctioned alternative to flipping the toy ortho rig on
 * for satellite: that rig would need every streaming satellite tile set
 * receiveShadow=true (per-fragment shadow sampling across the whole terrain in
 * the perf-sensitive DEFAULT style — a fill-rate cost the draw gate can't see,
 * plus a recompile on the hot tile path). The disc delivers the ground-contact
 * read at 1 draw with zero tile-pipeline risk. Bend-anchored (drop ≈ 0 at the
 * player's own XZ); tier-gated exactly like the toy rig (low tier sheds it).
 * Mounted satellite-only; toy keeps its real cast shadow (player castShadow).
 */
export function PlayerGroundShadow({ flight, origin }) {
  const qualityTier = useFlyStore((s) => s.qualityTier);
  const ref = useRef();
  const mesh = useMemo(() => {
    const gs = PLAYER.groundShadow;
    const geo = new CircleGeometry(gs.blobRadiusM, 40);
    geo.rotateX(-Math.PI / 2);
    const mat = new MeshBasicMaterial({
      color: new Color(gs.blobColor),
      transparent: true,
      opacity: 0,
      alphaMap: makeShadowTexture(),
      depthWrite: false,
    });
    applyBend(mat); // shares 'world-bend' (0 new variants); drop ≈ 0 under player
    const m = new Mesh(geo, mat);
    m.frustumCulled = false;
    m.renderOrder = -1; // under the puffs/tracers in the transparent pass
    m.visible = false;
    return m;
  }, []);
  useEffect(
    () => () => {
      mesh.geometry.dispose();
      mesh.material.alphaMap?.dispose();
      mesh.material.dispose();
    },
    [mesh]
  );

  useFrame(() => {
    const m = ref.current;
    if (!m) return;
    const gs = PLAYER.groundShadow;
    if (qualityTier === 'low') {
      m.visible = false;
      return;
    }
    const eyeAgl = Math.max(0, flight.pos.y - flight.groundElev);
    const t = Math.min(
      1,
      Math.max(0, (eyeAgl - gs.aglFadeStartM) / (gs.aglFadeEndM - gs.aglFadeStartM))
    );
    const op = gs.blobOpacity * (1 - t);
    if (op <= 0.003) {
      m.visible = false;
      return;
    }
    m.visible = true;
    m.material.opacity = op;
    m.position.set(
      flight.pos.x - origin.anchor.x,
      flight.groundElev + 0.5,
      flight.pos.z - origin.anchor.z
    );
  }, -19); // right after the contrail (-20)

  return <primitive ref={ref} object={mesh} dispose={null} />;
}
