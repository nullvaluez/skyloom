'use client';
import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { createLayerState, installLayerCensus } from '@/lib/fly/render-census';
import { memoryCensus } from '@/lib/fly/census';
import { noteFrameHeap } from '@/lib/fly/stall-census';

/**
 * SHIP PASS FRAME (FR-4) — closes each frame's draw/triangle census and rolls
 * the upload-time counter. Mounted by FlyCanvas only when censusWanted()
 * (lib/fly/program-census.js); renders nothing and adds no object or draw.
 *
 * Priority -1001: ahead of DiagFrameTotals (-1000), which resets gl.info when
 * it owns the counters, so `glCalls` here still holds the previous frame's
 * whole-frame totals for the 2% cross-check (FR-4 acceptance).
 */
export function CensusRig() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const sceneRef = useRef(scene);
  const layerRef = useRef(null);
  useEffect(() => {
    sceneRef.current = scene;
  }, [scene]);
  useEffect(() => {
    const census = ((window.__flyStats ??= {}).census ??= {});
    const state = createLayerState();
    census.layers = state;
    const ctl = installLayerCensus(gl, state, () => sceneRef.current);
    layerRef.current = ctl;
    return () => {
      ctl?.uninstall();
      layerRef.current = null;
      if (census.layers === state) delete census.layers;
    };
  }, [gl]);
  useFrame(() => {
    layerRef.current?.tick(gl.info.autoReset === false);
    memoryCensus()?.frame();
    noteFrameHeap();
  }, -1001);
  return null;
}
