/**
 * Altitude conversion utilities for 3D aircraft rendering
 * 
 * Aircraft altitudes are in feet but need to be converted to meters
 * with a small scale factor for visual clarity in the 3D view.
 */

// Scale factor for altitude visualization
// At 0.1x scale: 35,000 ft = ~1,067 meters (visible in 3D at typical zoom levels)
// This provides good visual separation while keeping aircraft visible on screen
const ALTITUDE_SCALE = 0.1;

// Feet to meters conversion factor
const FEET_TO_METERS = 0.3048;

/**
 * Convert aircraft altitude in feet to a visually scaled 3D height in meters
 * Handles the 'ground' string value from ADS-B data
 * 
 * @param {number|string} altFeet - Altitude in feet (typically alt_baro from ADS-B data)
 *                                  Can be 'ground' string for aircraft on ground
 * @param {number} pitch - Current map pitch in degrees (0-85)
 * @returns {number} Scaled altitude in meters for 3D rendering
 * 
 * @example
 * // Aircraft at 35,000 ft in 3D mode
 * altitudeToMeters(35000, 60) // Returns ~1,067 meters (0.1x scale)
 * 
 * // Aircraft in 2D mode (pitch = 0)
 * altitudeToMeters(35000, 0) // Returns 0 (flat on map)
 * 
 * // Aircraft on ground
 * altitudeToMeters('ground', 60) // Returns 0
 */
export function altitudeToMeters(altFeet, pitch) {
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
  
  // Convert feet to meters with exaggeration for visibility
  return altFeet * FEET_TO_METERS * ALTITUDE_SCALE;
}

/**
 * Calculate shadow radius based on altitude
 * Higher aircraft cast larger shadows (simulates distance perspective)
 * 
 * @param {number|string} altFeet - Altitude in feet (can be 'ground' string)
 * @returns {number} Shadow radius in meters
 */
export function getShadowRadius(altFeet) {
  const baseRadius = 300; // Minimum shadow radius in meters
  
  // Handle 'ground' string or non-numeric values
  if (altFeet === 'ground' || typeof altFeet !== 'number') {
    return baseRadius;
  }
  
  const altitudeContribution = (altFeet || 0) / 100; // Grows with altitude
  return baseRadius + altitudeContribution;
}

