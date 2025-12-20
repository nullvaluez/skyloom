/**
 * Altitude conversion utilities for 3D aircraft rendering
 * 
 * Aircraft altitudes are in feet but need to be converted to meters
 * with dynamic scaling that responds to zoom level and pitch for
 * immersive 3D visualization at all viewing distances.
 */

// Feet to meters conversion factor
const FEET_TO_METERS = 0.3048;

/**
 * Altitude scale configuration
 * These values are tuned to make altitude differences visible and immersive
 * at different zoom levels while avoiding aircraft going off-screen
 */
const ALTITUDE_SCALE_CONFIG = {
  // Base scale at typical viewing zoom (10-12)
  baseScale: 0.25,
  
  // At very zoomed out (zoom 5), altitude needs more exaggeration
  minZoomScale: 0.8,
  
  // At very zoomed in (zoom 14+), less exaggeration needed
  maxZoomScale: 0.15,
  
  // Zoom levels for interpolation
  minZoom: 5,
  midZoom: 10,
  maxZoom: 14,
  
  // Pitch boost factor - steeper angles benefit from more altitude visibility
  pitchBoostMax: 1.4, // At 85° pitch, scale is multiplied by this
};

/**
 * Calculate dynamic altitude scale based on zoom and pitch
 * Lower zoom = more exaggeration (so distant aircraft show altitude separation)
 * Higher pitch = slight boost (steeper viewing angles benefit from more height)
 * 
 * @param {number} zoom - Current map zoom level
 * @param {number} pitch - Current camera pitch in degrees
 * @returns {number} Dynamic scale factor for altitude
 */
export function getAltitudeScale(zoom, pitch) {
  const { baseScale, minZoomScale, maxZoomScale, minZoom, midZoom, maxZoom, pitchBoostMax } = ALTITUDE_SCALE_CONFIG;
  
  // Calculate zoom-based scale using piecewise interpolation
  let zoomScale;
  if (zoom <= minZoom) {
    zoomScale = minZoomScale;
  } else if (zoom <= midZoom) {
    // Interpolate from minZoomScale to baseScale
    const t = (zoom - minZoom) / (midZoom - minZoom);
    zoomScale = minZoomScale + (baseScale - minZoomScale) * t;
  } else if (zoom <= maxZoom) {
    // Interpolate from baseScale to maxZoomScale
    const t = (zoom - midZoom) / (maxZoom - midZoom);
    zoomScale = baseScale + (maxZoomScale - baseScale) * t;
  } else {
    zoomScale = maxZoomScale;
  }
  
  // Apply pitch boost - steeper viewing angles show altitude better with slight boost
  const pitchFactor = Math.sin((pitch * Math.PI) / 180);
  const pitchBoost = 1 + (pitchBoostMax - 1) * pitchFactor;
  
  return zoomScale * pitchBoost;
}

/**
 * Convert aircraft altitude in feet to a visually scaled 3D height in meters
 * Uses dynamic scaling that adapts to zoom level and pitch for immersive viewing
 * 
 * @param {number|string} altFeet - Altitude in feet (typically alt_baro from ADS-B data)
 *                                  Can be 'ground' string for aircraft on ground
 * @param {number} pitch - Current map pitch in degrees (0-85)
 * @param {number} zoom - Current map zoom level (optional, defaults to 10)
 * @returns {number} Scaled altitude in meters for 3D rendering
 * 
 * @example
 * // Aircraft at 35,000 ft at zoom 10, pitch 60
 * altitudeToMeters(35000, 60, 10) // Returns ~3,200 meters (more visible!)
 * 
 * // Aircraft at 35,000 ft at zoom 5 (zoomed out) - more exaggeration
 * altitudeToMeters(35000, 60, 5) // Returns ~9,500 meters
 * 
 * // Aircraft in 2D mode (pitch = 0)
 * altitudeToMeters(35000, 0, 10) // Returns 0 (flat on map)
 */
export function altitudeToMeters(altFeet, pitch, zoom = 10) {
  // Return 0 if not in 3D mode
  if (pitch === 0) {
    return 0;
  }
  
  // Handle 'ground' string value from ADS-B data
  if (altFeet === 'ground' || typeof altFeet !== 'number') {
    return 0;
  }
  
  // Return 0 if no altitude data or ground level
  if (!altFeet || altFeet <= 0) {
    return 0;
  }
  
  // Get dynamic scale based on zoom and pitch
  const scale = getAltitudeScale(zoom, pitch);
  
  // Convert feet to meters with dynamic exaggeration
  return altFeet * FEET_TO_METERS * scale;
}

/**
 * Legacy compatibility - altitudeToMeters with just pitch (uses default zoom)
 * @deprecated Use altitudeToMeters(altFeet, pitch, zoom) instead
 */
export function altitudeToMetersLegacy(altFeet, pitch) {
  return altitudeToMeters(altFeet, pitch, 10);
}

/**
 * Calculate shadow radius based on altitude
 * Higher aircraft cast larger, more diffuse shadows (simulates perspective)
 * 
 * @param {number|string} altFeet - Altitude in feet (can be 'ground' string)
 * @param {number} zoom - Current map zoom level
 * @returns {number} Shadow radius in meters
 */
export function getShadowRadius(altFeet, zoom = 10) {
  // Base radius scales with zoom - larger at zoomed out views
  const zoomScale = Math.max(0.5, 1 + (10 - zoom) * 0.15);
  const baseRadius = 400 * zoomScale;
  
  // Handle 'ground' string or non-numeric values
  if (altFeet === 'ground' || typeof altFeet !== 'number') {
    return baseRadius;
  }
  
  // Shadow grows significantly with altitude for better depth perception
  // Higher aircraft = larger, more diffuse shadow
  const altitudeContribution = Math.sqrt(altFeet || 0) * 8;
  return baseRadius + altitudeContribution;
}

/**
 * Calculate shadow opacity based on altitude
 * Higher aircraft have fainter shadows (further from ground)
 * 
 * @param {number|string} altFeet - Altitude in feet
 * @returns {number} Shadow opacity (0-255)
 */
export function getShadowOpacity(altFeet) {
  // Base opacity
  const baseOpacity = 80;
  
  // Handle 'ground' string or non-numeric values
  if (altFeet === 'ground' || typeof altFeet !== 'number') {
    return baseOpacity;
  }
  
  // Higher aircraft = fainter shadow (further from ground)
  // At 40,000 ft, shadow is about 40% opacity of base
  const altFactor = Math.max(0.4, 1 - (altFeet || 0) / 60000);
  return Math.round(baseOpacity * altFactor);
}

/**
 * Get altitude stem (vertical line) data for 3D visualization
 * Creates visual connection between aircraft and its shadow on ground
 * 
 * @param {object} aircraft - Aircraft object with lat, lon, alt_baro
 * @param {number} pitch - Current camera pitch
 * @param {number} zoom - Current map zoom level
 * @returns {object|null} Stem path data or null if not applicable
 */
export function getAltitudeStemData(aircraft, pitch, zoom) {
  if (pitch === 0) return null;
  
  const { lat, lon, alt_baro } = aircraft;
  if (!lat || !lon) return null;
  
  // Handle ground or invalid altitude
  if (alt_baro === 'ground' || typeof alt_baro !== 'number' || alt_baro <= 500) {
    return null;
  }
  
  const altitudeMeters = altitudeToMeters(alt_baro, pitch, zoom);
  
  return {
    path: [
      [lon, lat, 0], // Ground position
      [lon, lat, altitudeMeters], // Aircraft position
    ],
    altitude: alt_baro,
    hex: aircraft.hex,
  };
}

/**
 * Calculate altitude stem width based on altitude
 * Thinner stems for higher aircraft (perspective effect)
 * 
 * @param {number} altFeet - Altitude in feet
 * @returns {number} Stem width in pixels
 */
export function getAltitudeStemWidth(altFeet) {
  // Base width
  const baseWidth = 1.5;
  
  // Thinner for higher aircraft
  const altFactor = Math.max(0.5, 1 - (altFeet || 0) / 80000);
  return baseWidth * altFactor;
}

/**
 * Get altitude color intensity factor
 * Higher aircraft appear brighter/more prominent for better visibility
 * 
 * @param {number|string} altFeet - Altitude in feet
 * @returns {number} Intensity factor (0.7 to 1.2)
 */
export function getAltitudeIntensity(altFeet) {
  // Handle ground or invalid altitude
  if (altFeet === 'ground' || typeof altFeet !== 'number') {
    return 0.8;
  }
  
  // Base intensity
  const baseIntensity = 0.75;
  
  // Higher aircraft are brighter (more visible against dark map)
  // Range: 0.75 at ground to 1.15 at 45,000 ft
  const altBoost = Math.min(0.4, (altFeet || 0) / 112500);
  return baseIntensity + altBoost;
}

/**
 * Get altitude band for grouping (useful for layer organization)
 * @param {number|string} altFeet - Altitude in feet
 * @returns {string} Altitude band name
 */
export function getAltitudeBand(altFeet) {
  if (altFeet === 'ground' || typeof altFeet !== 'number' || altFeet < 500) {
    return 'ground';
  }
  if (altFeet < 10000) return 'low';
  if (altFeet < 25000) return 'medium';
  if (altFeet < 35000) return 'high';
  return 'cruise';
}

