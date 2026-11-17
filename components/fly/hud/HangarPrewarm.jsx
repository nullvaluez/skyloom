'use client';
import { createContext, useContext, useEffect, useLayoutEffect, useRef } from 'react';
import { Environment, useEnvironment } from '@react-three/drei';
import { useStore, useThree } from '@react-three/fiber';
import { createHangarPrewarm } from '@/lib/fly/hangar-prewarm';
import { createHangarFrameGate } from '@/lib/fly/hangar-frame-gate';

export const HangarWarmContext = createContext(null);
export function createHangarWarmSignal() {
  let listener = null;
  return {
    invalidate() { listener?.(); },
    subscribe(next) { listener = next; return () => { if (listener === next) listener = null; }; },
  };
}

/** Async material attachment does not emit Object3D.childadded. Notify in
 * the layout commit, before any reflected or main render can first-use it. */
export function useHangarShaderChange(value) {
  const signal = useContext(HangarWarmContext);
  useLayoutEffect(() => { signal?.invalidate(); }, [signal, value]);
}

export function HangarEnvironment({ files, ...props }) {
  const texture = useEnvironment({ files });
  useHangarShaderChange(texture);
  // Preserve EnvironmentCube's existing ownership when using EnvironmentMap
  // to receive the explicit layout-commit readiness notification.
  useEffect(() => () => texture.dispose(), [texture]);
  return <Environment map={texture} {...props} />;
}

export function HangarPrewarm({ signal, preparing, modelReady, changeKey, onPrepared }) {
  const gl = useThree(s => s.gl), scene = useThree(s => s.scene), camera = useThree(s => s.camera);
  const store = useStore(), advance = useThree(s => s.advance), clock = useThree(s => s.clock);
  const controller = useRef(null), active = useRef(preparing), notify = useRef(onPrepared);
  useLayoutEffect(() => { active.current = preparing; notify.current = onPrepared; }, [preparing, onPrepared]);

  useLayoutEffect(() => {
    // In R3F's never mode delta = timestamp - clock.elapsedTime. Using the
    // current stored elapsed time also guarantees dt=0 on later re-arms.
    const warm = createHangarPrewarm(gl, scene, camera, (_timestamp, effects) => advance(clock.elapsedTime, effects));
    const gate = createHangarFrameGate(store);
    warm.state.frameGate = gate.state;
    const watched = new Set();
    let frame = 0, disposed = false, readyGeneration = -1;
    const owner = { resume() { return gate.release(readyGeneration); } };
    controller.current = owner;
    const tick = () => {
      frame = 0;
      if (disposed || !active.current) return;
      // Wait for the React commit that sets ContactShadows frames=Infinity.
      // No Drei useFrame callback runs before that commit during preparation.
      if (warm.prepare()) {
        readyGeneration = gate.state.generation;
        notify.current(true);
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    const request = () => {
      if (disposed) return;
      gate.hold(); warm.invalidate(); notify.current(false);
      if (!frame) frame = requestAnimationFrame(tick);
    };
    const add = object => {
      if (watched.has(object)) return;
      watched.add(object); object.addEventListener('childadded', added); object.addEventListener('childremoved', removed);
      for (const child of object.children) add(child);
    };
    const remove = object => {
      if (!watched.delete(object)) return;
      object.removeEventListener('childadded', added); object.removeEventListener('childremoved', removed);
      for (const child of object.children) remove(child);
    };
    const added = event => { add(event.child); request(); }, removed = event => { remove(event.child); request(); };
    add(scene);
    const lost = () => { gate.hold(); warm.invalidate(true); notify.current(false); if (!frame) frame = requestAnimationFrame(tick); };
    const restored = () => { warm.invalidate(true); request(); };
    gl.domElement.addEventListener('webglcontextlost', lost);
    gl.domElement.addEventListener('webglcontextrestored', restored);
    const unsubscribe = signal.subscribe(request);
    request();
    return () => {
      disposed = true; cancelAnimationFrame(frame); remove(scene);
      unsubscribe();
      gl.domElement.removeEventListener('webglcontextlost', lost);
      gl.domElement.removeEventListener('webglcontextrestored', restored);
      gate.dispose(); warm.dispose();
      if (controller.current === owner) controller.current = null;
    };
  }, [gl, scene, camera, advance, clock, store, signal]);

  useLayoutEffect(() => { signal.invalidate(); }, [signal, changeKey]);
  useLayoutEffect(() => {
    // The final React commit also restores ContactShadows frames=1. Only
    // after it commits may the normal root loop execute that one real capture.
    // A child asset/layout commit may have invalidated the batch earlier in
    // this same commit. Only the still-current ready generation can resume.
    if (!preparing) controller.current?.resume();
    else signal.invalidate();
  }, [preparing, modelReady, signal]);
  return null;
}
