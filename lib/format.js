/**
 * Format altitude in feet with commas
 * @param {number|string} altitude - Altitude in feet
 * @returns {string} - Formatted altitude string
 */
export function formatAltitude(altitude) {
  if (altitude === undefined || altitude === null) return 'N/A';
  if (altitude === 'ground') return 'Ground';

  const num = typeof altitude === 'string' ? parseInt(altitude, 10) : altitude;
  if (isNaN(num)) return 'N/A';

  return `${num.toLocaleString()} ft`;
}

/**
 * Format speed in knots
 * @param {number} speed - Speed in knots
 * @returns {string} - Formatted speed string
 */
export function formatSpeed(speed) {
  if (speed === undefined || speed === null) return 'N/A';

  const num = Math.round(speed);
  return `${num.toLocaleString()} kts`;
}

/**
 * Format vertical rate with arrow indicator
 * @param {number} rate - Vertical rate in ft/min
 * @returns {string} - Formatted rate with direction indicator
 */
export function formatVerticalRate(rate) {
  if (rate === undefined || rate === null) return 'N/A';

  const absRate = Math.abs(rate);
  const formatted = absRate.toLocaleString();

  if (rate > 100) {
    return `↗ +${formatted} ft/min`;
  } else if (rate < -100) {
    return `↘ -${formatted} ft/min`;
  } else {
    return `→ Level`;
  }
}

/**
 * Format heading/track in degrees with cardinal direction
 * @param {number} heading - Heading in degrees
 * @returns {string} - Formatted heading with cardinal direction
 */
export function formatHeading(heading) {
  if (heading === undefined || heading === null) return 'N/A';

  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const index = Math.round(heading / 45) % 8;
  const cardinal = directions[index];

  return `${Math.round(heading)}° ${cardinal}`;
}

/**
 * Format coordinates
 * @param {number} lat - Latitude
 * @param {number} lon - Longitude
 * @returns {Object} - Formatted latitude and longitude strings
 */
export function formatCoordinates(lat, lon) {
  if (lat === undefined || lon === undefined) {
    return { lat: 'N/A', lon: 'N/A' };
  }

  const latDir = lat >= 0 ? 'N' : 'S';
  const lonDir = lon >= 0 ? 'E' : 'W';

  return {
    lat: `${Math.abs(lat).toFixed(4)}° ${latDir}`,
    lon: `${Math.abs(lon).toFixed(4)}° ${lonDir}`,
  };
}

/**
 * Format "time since" in human-readable form
 * @param {number} seconds - Seconds since event
 * @returns {string} - Human-readable time string
 */
export function formatTimeSince(seconds) {
  if (seconds === undefined || seconds === null) return 'N/A';

  if (seconds < 60) {
    return `${Math.round(seconds)}s ago`;
  } else if (seconds < 3600) {
    const mins = Math.floor(seconds / 60);
    return `${mins}m ago`;
  } else {
    const hours = Math.floor(seconds / 3600);
    return `${hours}h ago`;
  }
}

/**
 * Format squawk code
 * @param {string} squawk - 4-digit squawk code
 * @returns {string} - Formatted squawk with meaning if special
 */
export function formatSquawk(squawk) {
  if (!squawk) return 'N/A';

  const specialSquawks = {
    '7500': '7500 (Hijack)',
    '7600': '7600 (Radio Failure)',
    '7700': '7700 (Emergency)',
    '1200': '1200 (VFR)',
    '7777': '7777 (Military Intercept)',
  };

  return specialSquawks[squawk] || squawk;
}

/**
 * Format message count
 * @param {number} count - Number of messages
 * @returns {string} - Formatted message count
 */
export function formatMessageCount(count) {
  if (count === undefined || count === null) return 'N/A';

  if (count >= 1000000) {
    return `${(count / 1000000).toFixed(1)}M`;
  } else if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}K`;
  }

  return count.toLocaleString();
}

/**
 * Format callsign (trim whitespace)
 * @param {string} callsign - Aircraft callsign
 * @returns {string} - Trimmed callsign or N/A
 */
export function formatCallsign(callsign) {
  if (!callsign) return 'N/A';
  return callsign.trim();
}

/**
 * Format registration
 * @param {string} registration - Aircraft registration
 * @returns {string} - Registration or N/A
 */
export function formatRegistration(registration) {
  if (!registration) return 'N/A';
  return registration.toUpperCase();
}

/**
 * Format aircraft type
 * @param {string} type - ICAO type code
 * @returns {string} - Type code or N/A
 */
export function formatAircraftType(type) {
  if (!type) return 'Unknown';
  return type.toUpperCase();
}

/**
 * Format ICAO hex code
 * @param {string} hex - ICAO 24-bit address
 * @returns {string} - Uppercase hex code
 */
export function formatHex(hex) {
  if (!hex) return 'N/A';
  return hex.toUpperCase();
}

/**
 * Get country from ICAO hex prefix
 * @param {string} hex - ICAO 24-bit address
 * @returns {Object} - Country name and flag emoji
 */
export function getCountryFromHex(hex) {
  if (!hex) return { name: 'Unknown', flag: '🏳️' };

  const prefix = hex.substring(0, 2).toUpperCase();

  // Common ICAO prefix to country mapping
  const countries = {
    'A0': { name: 'United States', flag: '🇺🇸' },
    'A1': { name: 'United States', flag: '🇺🇸' },
    'A2': { name: 'United States', flag: '🇺🇸' },
    'A3': { name: 'United States', flag: '🇺🇸' },
    'A4': { name: 'United States', flag: '🇺🇸' },
    'A5': { name: 'United States', flag: '🇺🇸' },
    'A6': { name: 'United States', flag: '🇺🇸' },
    'A7': { name: 'United States', flag: '🇺🇸' },
    'A8': { name: 'United States', flag: '🇺🇸' },
    'A9': { name: 'United States', flag: '🇺🇸' },
    'AA': { name: 'United States', flag: '🇺🇸' },
    'AB': { name: 'United States', flag: '🇺🇸' },
    'AC': { name: 'United States', flag: '🇺🇸' },
    'AD': { name: 'United States', flag: '🇺🇸' },
    'AE': { name: 'United States', flag: '🇺🇸' },
    'AF': { name: 'United States', flag: '🇺🇸' },
    '40': { name: 'United Kingdom', flag: '🇬🇧' },
    '41': { name: 'United Kingdom', flag: '🇬🇧' },
    '42': { name: 'United Kingdom', flag: '🇬🇧' },
    '43': { name: 'United Kingdom', flag: '🇬🇧' },
    '38': { name: 'France', flag: '🇫🇷' },
    '39': { name: 'France', flag: '🇫🇷' },
    '3A': { name: 'France', flag: '🇫🇷' },
    '3C': { name: 'Germany', flag: '🇩🇪' },
    '3D': { name: 'Germany', flag: '🇩🇪' },
    '3E': { name: 'Germany', flag: '🇩🇪' },
    '78': { name: 'China', flag: '🇨🇳' },
    '79': { name: 'China', flag: '🇨🇳' },
    '7A': { name: 'China', flag: '🇨🇳' },
    '7B': { name: 'China', flag: '🇨🇳' },
    '7C': { name: 'Australia', flag: '🇦🇺' },
    '7D': { name: 'Australia', flag: '🇦🇺' },
    'C0': { name: 'Canada', flag: '🇨🇦' },
    'C1': { name: 'Canada', flag: '🇨🇦' },
    'C2': { name: 'Canada', flag: '🇨🇦' },
    'C3': { name: 'Canada', flag: '🇨🇦' },
    '84': { name: 'Japan', flag: '🇯🇵' },
    '85': { name: 'Japan', flag: '🇯🇵' },
    '86': { name: 'Japan', flag: '🇯🇵' },
    '87': { name: 'Japan', flag: '🇯🇵' },
    '71': { name: 'Brazil', flag: '🇧🇷' },
    '72': { name: 'Brazil', flag: '🇧🇷' },
    '73': { name: 'Brazil', flag: '🇧🇷' },
    '74': { name: 'Brazil', flag: '🇧🇷' },
    '0C': { name: 'Mexico', flag: '🇲🇽' },
    '0D': { name: 'Mexico', flag: '🇲🇽' },
    '48': { name: 'Netherlands', flag: '🇳🇱' },
    '49': { name: 'Netherlands', flag: '🇳🇱' },
    '50': { name: 'Russia', flag: '🇷🇺' },
    '51': { name: 'Russia', flag: '🇷🇺' },
    '52': { name: 'Russia', flag: '🇷🇺' },
    '53': { name: 'Russia', flag: '🇷🇺' },
  };

  // Check for 2-character match first
  if (countries[prefix]) {
    return countries[prefix];
  }

  // Check single character for broader regions
  const firstChar = hex.charAt(0).toUpperCase();
  const singlePrefixes = {
    'A': { name: 'United States', flag: '🇺🇸' },
    '4': { name: 'Europe', flag: '🇪🇺' },
    '3': { name: 'Europe', flag: '🇪🇺' },
    '7': { name: 'Asia-Pacific', flag: '🌏' },
    'C': { name: 'Canada', flag: '🇨🇦' },
    '8': { name: 'Asia', flag: '🌏' },
  };

  return singlePrefixes[firstChar] || { name: 'Unknown', flag: '🏳️' };
}
