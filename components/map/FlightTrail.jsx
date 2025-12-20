'use client';

import { useMemo, memo } from 'react';
import { Polyline, CircleMarker } from 'react-leaflet';
import { useAircraftStore } from '@/stores/aircraft-store';
import { TRAIL_CONFIG } from '@/lib/constants';

/**
 * Flight trail polyline for selected aircraft
 * Uses direct Zustand selectors for reactive updates when trails change
 * Shows a circle marker for single position, polyline for multiple positions
 */
export const FlightTrail = memo(function FlightTrail() {
  // Subscribe directly to state for reactive updates
  const selectedAircraftId = useAircraftStore((state) => state.selectedAircraftId);
  const trails = useAircraftStore((state) => state.trails);

  const { positions, hasTrail } = useMemo(() => {
    if (!selectedAircraftId) {
      return { positions: null, hasTrail: false };
    }
    
    const trail = trails.get(selectedAircraftId);
    if (!trail || trail.length === 0) {
      return { positions: null, hasTrail: false };
    }

    return {
      positions: trail.map((pos) => [pos.lat, pos.lon]),
      hasTrail: true,
    };
  }, [selectedAircraftId, trails]);

  if (!hasTrail || !positions) {
    return null;
  }

  // Single position - show a circle marker to indicate tracking has started
  if (positions.length === 1) {
    return (
      <CircleMarker
        center={positions[0]}
        radius={6}
        pathOptions={{
          color: TRAIL_CONFIG.color,
          fillColor: TRAIL_CONFIG.color,
          fillOpacity: 0.8,
          weight: 2,
        }}
      />
    );
  }

  // Multiple positions - show the trail polyline
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
