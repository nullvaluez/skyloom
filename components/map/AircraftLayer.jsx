'use client';

import { IconLayer } from '@deck.gl/layers';
import { ICON_COLORS } from '@/lib/aircraft-icons';
import { isEmergency } from '@/lib/classify';

// Pre-rendered icon atlas with all aircraft types
// Each icon is 64x64 pixels in a spritesheet
const ICON_MAPPING = {
  airliner: { x: 0, y: 0, width: 64, height: 64, mask: true },
  jet: { x: 64, y: 0, width: 64, height: 64, mask: true },
  military: { x: 128, y: 0, width: 64, height: 64, mask: true },
  cargo: { x: 192, y: 0, width: 64, height: 64, mask: true },
  helicopter: { x: 256, y: 0, width: 64, height: 64, mask: true },
  prop: { x: 320, y: 0, width: 64, height: 64, mask: true },
  glider: { x: 384, y: 0, width: 64, height: 64, mask: true },
  drone: { x: 448, y: 0, width: 64, height: 64, mask: true },
  government: { x: 512, y: 0, width: 64, height: 64, mask: true },
  unknown: { x: 576, y: 0, width: 64, height: 64, mask: true },
};

// SVG paths for aircraft icons
const ICON_PATHS = {
  airliner: 'M16 2c-1.1 0-2 .9-2 2v7L3 16v3l11-3v8l-4 2.5v2.5l6-2 6 2v-2.5L18 24v-8l11 3v-3L18 11V4c0-1.1-.9-2-2-2z',
  jet: 'M16 3c-.8 0-1.5.7-1.5 1.5V10L4 14.5v2l10.5-2V21l-3.5 2v2l5-1.5 5 1.5v-2l-3.5-2v-6.5l10.5 2v-2L17.5 10V4.5c0-.8-.7-1.5-1.5-1.5z',
  military: 'M16 1l-2 3v6L3 15v2l11-2v7l-4 3v2l6-2 6 2v-2l-4-3v-7l11 2v-2L18 10V4l-2-3z',
  cargo: 'M16 2c-1.1 0-2 .9-2 2v7L3 16v3l11-3v8l-4 2.5v2.5l6-2 6 2v-2.5L18 24v-8l11 3v-3L18 11V4c0-1.1-.9-2-2-2z',
  helicopter: 'M4 7h24v2H4z M15 9h2v4h-2z M10 13h12c2 0 3 1.5 3 3v4c0 1.5-1 3-3 3H10c-2 0-3-1.5-3-3v-4c0-1.5 1-3 3-3z',
  prop: 'M16 4c-.6 0-1 .4-1 1v6L5 14v2l10-2v7l-3 2v2l4-1 4 1v-2l-3-2v-7l10 2v-2L17 11V5c0-.6-.4-1-1-1z',
  glider: 'M16 5c-.3 0-.5.2-.5.5v6L2 14v1.5l13.5-2v6l-3 2v1.5l3.5-1 3.5 1V20.5l-3-2v-6L30 15.5V14L16.5 11.5V5.5c0-.3-.2-.5-.5-.5z',
  drone: 'M8 8m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0 M24 8m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0 M8 24m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0 M24 24m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0 M13 13h6v6h-6z',
  government: 'M16 3c-.8 0-1.5.7-1.5 1.5V10L4 14.5v2l10.5-2V21l-3.5 2v2l5-1.5 5 1.5v-2l-3.5-2v-6.5l10.5 2v-2L17.5 10V4.5c0-.8-.7-1.5-1.5-1.5z',
  unknown: 'M16 8l5 10H11l5-10z',
};

// Cache for generated icon data URLs
const iconCache = new Map();

// Generate a simple SVG-based data URL for an aircraft icon (cached)
function generateIconDataUrl(type) {
  if (iconCache.has(type)) {
    return iconCache.get(type);
  }

  const path = ICON_PATHS[type] || ICON_PATHS.unknown;
  
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="64" height="64">
    <path d="${path}" fill="white"/>
  </svg>`;
  
  const dataUrl = `data:image/svg+xml;base64,${btoa(svg)}`;
  iconCache.set(type, dataUrl);
  return dataUrl;
}

// Create icon atlas as a data URL containing all icons
function createIconAtlas() {
  // For simplicity, we'll use individual icon URLs per type
  // In production, you'd create a proper sprite sheet
  return null;
}

// Convert hex color to RGBA array for Deck.gl
function hexToRgba(hex, alpha = 255) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return [128, 128, 128, alpha];
  return [
    parseInt(result[1], 16),
    parseInt(result[2], 16),
    parseInt(result[3], 16),
    alpha,
  ];
}

/**
 * Create Deck.gl IconLayer for aircraft rendering
 * @param {Object} params - Layer parameters
 * @param {Array} params.aircraft - Array of aircraft objects
 * @param {string|null} params.selectedId - Currently selected aircraft hex
 * @param {number} params.zoom - Current map zoom level
 * @param {Function} params.onClick - Click handler
 * @returns {IconLayer} Deck.gl IconLayer instance
 */
export function createAircraftLayer({ aircraft, selectedId, zoom, onClick }) {
  if (!aircraft || aircraft.length === 0) {
    return null;
  }

  // Calculate base size based on zoom
  const getBaseSize = () => {
    if (zoom < 7) return 24;
    if (zoom <= 10) return 32;
    return 40;
  };

  const baseSize = getBaseSize();

  // Sort aircraft by hex for consistent ordering (enables smooth transitions)
  const sortedAircraft = [...aircraft].sort((a, b) => a.hex.localeCompare(b.hex));

  return new IconLayer({
    id: 'aircraft-layer',
    data: sortedAircraft,
    pickable: true,
    
    // Position
    getPosition: (d) => [d.lon, d.lat],
    
    // Icon configuration - use individual SVG icons with mask for color tinting
    getIcon: (d) => {
      const iconType = d._iconType || 'unknown';
      return {
        url: generateIconDataUrl(iconType),
        width: 64,
        height: 64,
        anchorY: 32,
        mask: true, // Enable color tinting via getColor
      };
    },
    
    // Size based on selection state
    getSize: (d) => {
      if (d.hex === selectedId) return baseSize * 1.5;
      return baseSize;
    },
    
    // Rotation based on aircraft track
    getAngle: (d) => -(d.track || 0),
    
    // Color based on classification
    getColor: (d) => {
      if (d.hex === selectedId) {
        return hexToRgba(ICON_COLORS.selected);
      }
      if (isEmergency(d)) {
        // Pulsing effect for emergency
        const pulse = Math.abs(Math.sin(Date.now() / 250));
        return hexToRgba(ICON_COLORS.emergency, 200 + pulse * 55);
      }
      return hexToRgba(d._color || ICON_COLORS.unknown);
    },
    
    // Rendering settings
    sizeScale: 1,
    sizeUnits: 'pixels',
    sizeMinPixels: 16,
    sizeMaxPixels: 64,
    billboard: false,
    alphaCutoff: 0.05,
    
    // Interactivity
    onClick,
    
    // Smooth transitions (position transitions disabled to prevent jumping on data refresh)
    transitions: {
      getAngle: {
        duration: 300,
      },
      getSize: {
        duration: 200,
      },
    },
    
    // Update triggers
    updateTriggers: {
      getSize: [selectedId, zoom],
      getColor: [selectedId, Date.now()], // Trigger for emergency pulse
      getIcon: [], // Icons are stable
    },
  });
}

export default createAircraftLayer;
