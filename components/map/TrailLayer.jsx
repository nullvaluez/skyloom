'use client';

import { PathLayer } from '@deck.gl/layers';
import { TRAIL_CONFIG } from '@/lib/constants';

// Convert hex color to RGBA array
function hexToRgba(hex, alpha = 255) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return [59, 130, 246, alpha]; // Default blue
  return [
    parseInt(result[1], 16),
    parseInt(result[2], 16),
    parseInt(result[3], 16),
    alpha,
  ];
}

/**
 * Create Deck.gl PathLayer for flight trails
 * @param {Object} params - Layer parameters
 * @param {Array} params.trail - Array of trail points [{lat, lon, timestamp}]
 * @param {string|null} params.selectedId - Currently selected aircraft hex
 * @returns {PathLayer|null} Deck.gl PathLayer instance or null if no trail
 */
export function createTrailLayer({ trail, selectedId }) {
  if (!trail || trail.length < 2 || !selectedId) {
    return null;
  }

  // Convert trail points to path format [lon, lat]
  const path = trail.map((point) => [point.lon, point.lat]);

  // Calculate opacity gradient based on age
  const now = Date.now();
  const getOpacityForSegment = (startIdx) => {
    const point = trail[startIdx];
    if (!point?.timestamp) return 180;
    
    const age = now - point.timestamp;
    const maxAge = TRAIL_CONFIG.maxPositions * TRAIL_CONFIG.positionInterval;
    const normalizedAge = Math.min(age / maxAge, 1);
    
    // Fade from 255 to 50 based on age
    return Math.round(255 - normalizedAge * 205);
  };

  // Create segments with gradient colors
  const segments = [];
  for (let i = 0; i < path.length - 1; i++) {
    segments.push({
      path: [path[i], path[i + 1]],
      opacity: getOpacityForSegment(i),
      index: i,
    });
  }

  const baseColor = hexToRgba(TRAIL_CONFIG.color);

  return new PathLayer({
    id: 'trail-layer',
    data: segments,
    pickable: false,
    
    // Path configuration
    getPath: (d) => d.path,
    getWidth: TRAIL_CONFIG.weight * 2,
    
    // Color with gradient opacity based on age
    getColor: (d) => {
      return [...baseColor.slice(0, 3), d.opacity];
    },
    
    // Rendering settings
    widthUnits: 'pixels',
    widthMinPixels: 1,
    widthMaxPixels: 6,
    jointRounded: true,
    capRounded: true,
    miterLimit: 2,
    
    // Smooth transitions for new points
    transitions: {
      getPath: {
        duration: 500,
        easing: (t) => t,
      },
    },
    
    // Update triggers
    updateTriggers: {
      getColor: [now], // Update colors as trail ages
      getPath: [trail.length], // Update when trail length changes
    },
  });
}

/**
 * Create a gradient trail using multiple path layers
 * This provides smoother gradient effect
 */
export function createGradientTrailLayers({ trail, selectedId }) {
  if (!trail || trail.length < 2 || !selectedId) {
    return [];
  }

  const path = trail.map((point) => [point.lon, point.lat]);
  const baseColor = hexToRgba(TRAIL_CONFIG.color);
  const now = Date.now();

  // Create multiple layers with decreasing opacity for gradient effect
  const layers = [];
  const numLayers = Math.min(TRAIL_CONFIG.fadeSteps, 5);

  for (let layer = 0; layer < numLayers; layer++) {
    const startIdx = Math.floor((trail.length / numLayers) * layer);
    const endIdx = layer === numLayers - 1 ? trail.length : Math.floor((trail.length / numLayers) * (layer + 1)) + 1;
    
    if (endIdx - startIdx < 2) continue;

    const segmentPath = path.slice(startIdx, endIdx);
    const opacity = Math.round(255 * (1 - layer / numLayers) * 0.8);

    layers.push(
      new PathLayer({
        id: `trail-layer-${layer}`,
        data: [{ path: segmentPath }],
        pickable: false,
        getPath: (d) => d.path,
        getWidth: TRAIL_CONFIG.weight * 2,
        getColor: [...baseColor.slice(0, 3), opacity],
        widthUnits: 'pixels',
        widthMinPixels: 1,
        widthMaxPixels: 6,
        jointRounded: true,
        capRounded: true,
      })
    );
  }

  return layers;
}

export default createTrailLayer;
