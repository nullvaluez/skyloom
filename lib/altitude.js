/**
 * Altitude conversion utilities for 3D aircraft rendering
 * 
 * Aircraft altitudes are in feet and are heavily exaggerated for 
 * dramatic 3D visualization. This creates a clear vertical separation
 * between aircraft at different flight levels.
 * 
 * The exaggeration makes the 3D view look almost "flat" when tilted,
 * with aircraft clearly stacked at different altitudes.
 */

// HEAVY exaggeration for dramatic 3D effect
// At 3.0x scale: 35,000 ft = ~32,000 meters (very visible separation!)
// This creates a dramatic vertical stacking effect
const ALTITUDE_SCALE = 3.0;

// Feet to meters conversion factor
const FEET_TO_METERS = 0.3048;

/**
 * Convert aircraft altitude in feet to an exaggerated 3D height in meters
 * 
 * Uses heavy vertical exaggeration to create dramatic altitude separation
 * visible when tilting the map view.
 * 
 * @param {number|string} altFeet - Altitude in feet (typically alt_baro from ADS-B data)
 * @param {number} pitch - Current map pitch in degrees (0-85)
 *                         Only used to determine if we're in 3D mode (pitch > 0)
 * @returns {number} Heavily exaggerated altitude in meters
 * 
 * @example
 * // Aircraft at 35,000 ft in 3D mode - massive vertical separation!
 * altitudeToMeters(35000, 60) // Returns ~32,000 meters (very high!)
 * 
 * // Aircraft at 5,000 ft - still clearly above ground
 * altitudeToMeters(5000, 60) // Returns ~4,500 meters
 * 
 * // 2D mode (pitch = 0) - flat on map
 * altitudeToMeters(35000, 0) // Returns 0
 */
export function altitudeToMeters(altFeet, pitch) {
  // Return 0 if not in 3D mode (pitch is 0, undefined, or null)
  if (!pitch || pitch <= 0) {
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
  
  // Convert feet to meters with HEAVY exaggeration for dramatic 3D effect
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

