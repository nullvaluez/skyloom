'use client';

import { useMemo, memo, useRef, useEffect } from 'react';
import { Marker, Tooltip } from 'react-leaflet';
import L from 'leaflet';
import { useAircraftStore } from '@/stores/aircraft-store';
import { useMapStore } from '@/stores/map-store';
import { useUIStore } from '@/stores/ui-store';
import { isEmergency } from '@/lib/classify';
import { formatAltitude, formatSpeed, formatCallsign } from '@/lib/format';
import { AIRCRAFT_ICON_DEFINITIONS, ICON_COLORS } from '@/lib/aircraft-icons';

/**
 * Generate SVG HTML string for aircraft icon
 * This is a pure function that doesn't require React rendering
 * @param {Object} params - Icon parameters
 * @returns {string} SVG HTML string
 */
function generateIconSvg({ iconType, color, size, rotation, emergency, selected }) {
  const iconDef = AIRCRAFT_ICON_DEFINITIONS[iconType] || AIRCRAFT_ICON_DEFINITIONS.unknown;
  const iconColor = selected ? ICON_COLORS.selected : (emergency ? ICON_COLORS.emergency : color);

  const paths = iconDef.paths.map((path, index) => {
    if (path.stroke && !path.fill) {
      return `<path
        d="${path.d}"
        fill="none"
        stroke="${iconColor}"
        stroke-width="${path.strokeWidth || 1.5}"
        stroke-linecap="round"
        stroke-linejoin="round"
        opacity="${path.opacity || 1}"
      />`;
    }
    return `<path
      d="${path.d}"
      fill="${path.fill ? iconColor : 'none'}"
      stroke="${path.stroke ? iconColor : 'none'}"
      stroke-width="${path.strokeWidth || 0}"
      opacity="${path.opacity || 1}"
    />`;
  }).join('');

  const emergencyClass = emergency ? 'aircraft-icon-v2--emergency' : '';
  const selectedClass = selected ? 'aircraft-icon-v2--selected' : '';
  const animateClass = iconDef.animate ? `aircraft-icon-v2--${iconDef.animate}` : '';

  // Apply rotation directly to the group transform (CSS variables don't work reliably in HTML strings)
  // Get viewBox center for transform-origin
  const [, , vbWidth, vbHeight] = iconDef.viewBox.split(' ').map(Number);
  const centerX = vbWidth / 2;
  const centerY = vbHeight / 2;

  return `
    <svg
      viewBox="${iconDef.viewBox}"
      width="${size}"
      height="${size}"
      class="aircraft-icon-v2 ${emergencyClass} ${selectedClass} ${animateClass}"
      style="--aircraft-color: ${iconColor};"
    >
      <g transform="rotate(${rotation} ${centerX} ${centerY})">
        ${paths}
      </g>
    </svg>
  `;
}

/**
 * Generate the full marker HTML with icon and callsign label
 */
function generateMarkerHtml({ iconType, color, size, rotation, emergency, selected, callsign }) {
  const iconSvg = generateIconSvg({ iconType, color, size, rotation, emergency, selected });
  const iconColor = selected ? ICON_COLORS.selected : (emergency ? ICON_COLORS.emergency : color);

  // Only show label if there's a callsign
  const labelHtml = callsign ? `
    <div class="aircraft-label" style="color: ${iconColor};">
      ${callsign}
    </div>
  ` : '';

  return `
    <div class="aircraft-marker-container">
      ${iconSvg}
      ${labelHtml}
    </div>
  `;
}

/**
 * Individual aircraft marker component
 * Optimized to avoid renderToString by using pure SVG string generation
 */
export const AircraftMarker = memo(function AircraftMarker({ aircraft }) {
  const { selectedAircraftId, selectAircraft } = useAircraftStore();
  const { getIconSize } = useMapStore();
  const { openDetailPanel } = useUIStore();

  const isSelected = selectedAircraftId === aircraft.hex;
  const emergency = isEmergency(aircraft);
  const size = getIconSize();
  const rotation = aircraft.track || 0;

  // Use pre-computed classification from store (memoized during setAircraft)
  const classification = aircraft._classification || 'unknown';
  const physicalType = aircraft._iconType || 'unknown';
  const color = aircraft._color || ICON_COLORS.unknown;

  // Determine the best icon shape
  const iconType = useMemo(() => {
    switch (classification) {
      case 'military':
        return 'military';
      case 'cargo':
        return 'cargo';
      case 'helicopter':
        return 'helicopter';
      case 'private':
        return (physicalType === 'prop' || physicalType === 'jet') ? physicalType : 'prop';
      case 'government':
        return 'government';
      case 'special':
        return 'jet';
      case 'commercial':
        if (physicalType === 'airliner' || physicalType === 'jet' || physicalType === 'prop') {
          return physicalType;
        }
        return 'airliner';
      default:
        return physicalType;
    }
  }, [physicalType, classification]);

  // Get callsign for label display
  const callsign = aircraft.flight?.trim() || '';

  // Create custom icon using pure HTML string (no renderToString)
  const icon = useMemo(() => {
    const iconHtml = generateMarkerHtml({
      iconType,
      color,
      size,
      rotation,
      emergency,
      selected: isSelected,
      callsign,
    });

    // Increase icon container size to accommodate label
    const containerWidth = callsign ? Math.max(size, 60) : size;
    const containerHeight = callsign ? size + 16 : size;

    return L.divIcon({
      html: iconHtml,
      className: 'aircraft-marker',
      iconSize: [containerWidth, containerHeight],
      iconAnchor: [containerWidth / 2, size / 2],
    });
  }, [iconType, color, size, rotation, emergency, isSelected, callsign]);

  // Handle marker click
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

export default AircraftMarker;
