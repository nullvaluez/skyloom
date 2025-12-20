'use client';

import { useMemo, memo } from 'react';
import { Marker, Tooltip } from 'react-leaflet';
import L from 'leaflet';
import { renderToString } from 'react-dom/server';
import { useAircraftStore } from '@/stores/aircraft-store';
import { useMapStore } from '@/stores/map-store';
import { useUIStore } from '@/stores/ui-store';
import { AircraftIcon } from '@/components/aircraft/AircraftIcon';
import { classifyAircraft, getAircraftColor, getAircraftIconType, isEmergency } from '@/lib/classify';
import { formatAltitude, formatSpeed, formatCallsign } from '@/lib/format';

/**
 * Individual aircraft marker component
 */
export const AircraftMarker = memo(function AircraftMarker({ aircraft }) {
  const { selectedAircraftId, selectAircraft } = useAircraftStore();
  const { getIconSize } = useMapStore();
  const { openDetailPanel } = useUIStore();

  const isSelected = selectedAircraftId === aircraft.hex;
  const classification = classifyAircraft(aircraft);
  const physicalType = getAircraftIconType(aircraft);
  
  // Determine the best icon shape, prioritizing classification over physical type for better variety
  const iconType = useMemo(() => {
    // Always prioritize special classifications that should have unique icons
    switch (classification) {
      case 'military':
        return 'military';
      case 'cargo':
        return 'cargo';
      case 'helicopter':
        return 'helicopter';
      case 'private':
        // Use physical type if it's prop/jet, otherwise default to prop
        return (physicalType === 'prop' || physicalType === 'jet') ? physicalType : 'prop';
      case 'government':
        return 'jet';
      case 'special':
        return 'jet';
      case 'commercial':
        // For commercial, use the physical type to get airliner/jet distinction
        if (physicalType === 'airliner' || physicalType === 'jet' || physicalType === 'prop') {
          return physicalType;
        }
        return 'airliner';
      default:
        // For unknown classification, use physical type
        return physicalType;
    }
  }, [physicalType, classification]);

  const color = getAircraftColor(aircraft, isSelected); // Color based on classification
  const size = getIconSize();
  const rotation = aircraft.track || 0;
  const emergency = isEmergency(aircraft);

  // Create custom icon
  const icon = useMemo(() => {
    const iconHtml = renderToString(
      <div className={emergency ? 'aircraft-emergency' : ''}>
        <AircraftIcon
          type={iconType}
          color={color}
          size={size}
          rotation={rotation}
        />
      </div>
    );

    return L.divIcon({
      html: iconHtml,
      className: 'aircraft-marker',
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
    });
  }, [iconType, color, size, rotation, emergency]);

  // Handle marker click - stop propagation so map click doesn't also fire
  const handleClick = (e) => {
    L.DomEvent.stopPropagation(e);
    selectAircraft(aircraft.hex);
    openDetailPanel();
  };

  if (!aircraft.lat || !aircraft.lon) {
    return null;
  }

  return (
    <Marker
      position={[aircraft.lat, aircraft.lon]}
      icon={icon}
      eventHandlers={{
        click: handleClick,
      }}
      bubblingMouseEvents={false}
    >
      <Tooltip
        direction="top"
        offset={[0, -size / 2]}
        opacity={0.95}
        className="aircraft-tooltip"
      >
        <div className="text-sm font-medium">
          {formatCallsign(aircraft.flight) || aircraft.hex}
        </div>
        <div className="text-xs text-muted-foreground">
          {formatAltitude(aircraft.alt_baro)} • {formatSpeed(aircraft.gs)}
        </div>
        {aircraft.t && (
          <div className="text-xs text-muted-foreground">
            {aircraft.t}
          </div>
        )}
      </Tooltip>
    </Marker>
  );
});
