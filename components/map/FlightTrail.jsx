'use client';

import { useMemo, memo } from 'react';
import { Polyline } from 'react-leaflet';
import { useAircraftStore } from '@/stores/aircraft-store';
import { TRAIL_CONFIG } from '@/lib/constants';

/**
 * Flight trail polyline for selected aircraft
 */
export const FlightTrail = memo(function FlightTrail() {
  const { getSelectedTrail } = useAircraftStore();

  const trail = getSelectedTrail();

  const positions = useMemo(() => {
    if (!trail || trail.length < 2) {
      return null;
    }

    return trail.map((pos) => [pos.lat, pos.lon]);
  }, [trail]);

  if (!positions) {
    return null;
  }

  return (
    <Polyline
      positions={positions}
      pathOptions={{
        color: TRAIL_CONFIG.color,
        weight: TRAIL_CONFIG.weight,
        opacity: TRAIL_CONFIG.opacity,
        dashArray: TRAIL_CONFIG.dashArray,
      }}
    />
  );
});
