'use client';

import { useMemo } from 'react';
import { horizonFillOn } from '@/lib/fly/horizon-fill';

/**
 * HORIZON FILL (FLY_HORIZON_FILL.md): the procedural far-field building layer.
 *
 * Mounted by FlyScene inside worldRoot, after SatSkylineLayer, in satellite
 * only. The latched reader decides once per mount whether anything exists:
 * off (the shipped default, Medium / Low, phones, stand-ins off) this
 * component renders null and creates no worker, no engine, no draw and no
 * global.
 *
 * W0 scaffold: stream B (CARPET) replaces HorizonFillCarpet below with the real
 * layer (its own fill worker, the carpet engine, the frame loop).
 */
export function HorizonFillLayer({ runtime, flight }) {
  const on = useMemo(() => horizonFillOn('carpet'), []);
  if (!on) return null;
  return <HorizonFillCarpet runtime={runtime} flight={flight} />;
}

function HorizonFillCarpet({ runtime, flight }) {
  return null;
}
