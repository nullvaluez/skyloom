'use client';
/* eslint-disable react-hooks/immutability -- Three objects and runtime form an imperative render bus. */
import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { useFlyStore } from '@/stores/fly-store';
import { loungeInstruments } from '@/lib/fly/ops-flags';
import { createObservatoryInstruments } from '@/lib/fly/lounge/observatory-instruments';

function Instruments({ runtime, variant }) {
  const resource = useMemo(() => createObservatoryInstruments(variant), [variant]);
  useEffect(() => () => {
    resource.dispose();
    if (runtime.observatoryRenderStats === resource.stats) delete runtime.observatoryRenderStats;
  }, [runtime, resource]);
  useFrame(() => {
    const w = runtime.airportWatch;
    const fade = runtime.loungeRoom?.opacity ?? 0;
    resource.group.visible = !!w?.active && !!w.observatory && !!runtime.loungeRoom?.shown;
    if (!resource.group.visible) return;
    const anchor = runtime.origin.anchor;
    resource.group.position.set(w.seat.x - anchor.x, w.seat.y, w.seat.z - anchor.z);
    resource.group.rotation.set(0, w.roomHeading, 0);
    resource.group.scale.set(w.frame.k, 1, w.frame.k);
    // Share the room's interior light/shadow material rather than lighting instruments as outdoors.
    if (runtime.loungeRoom?.instrumentMaterial) resource.bodies.material = runtime.loungeRoom.instrumentMaterial;
    resource.displays.material.opacity = fade;
    resource.update(performance.now(), w.observatory.snapshot());
    runtime.observatoryRenderStats = resource.stats;
  });
  return <primitive object={resource.group} dispose={null} />;
}

export function ObservatoryInstruments({ runtime }) {
  const site = useFlyStore((s) => s.airportWatch?.site);
  if (!loungeInstruments().enabled) return null;
  return <Instruments key={site} runtime={runtime} variant={runtime.airportWatch?.site?.variant || 'classic'} />;
}
