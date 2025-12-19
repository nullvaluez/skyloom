/**
 * Fetch aircraft within a radius of a point
 * @param {number} lat - Center latitude
 * @param {number} lon - Center longitude
 * @param {number} dist - Distance in nautical miles (default 250)
 * @returns {Promise<Object>} - API response with aircraft array
 */
export async function fetchAircraftByLocation(lat, lon, dist = 250) {
  const response = await fetch(
    `/api/aircraft?lat=${lat}&lon=${lon}&dist=${dist}`
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch aircraft: ${response.status}`);
  }

  return response.json();
}

/**
 * Fetch aircraft by ICAO hex code
 * @param {string} hex - ICAO 24-bit address
 * @returns {Promise<Object>} - Aircraft details
 */
export async function fetchAircraftByHex(hex) {
  const response = await fetch(`/api/aircraft/${hex}`);

  if (!response.ok) {
    throw new Error(`Failed to fetch aircraft ${hex}: ${response.status}`);
  }

  return response.json();
}

/**
 * Fetch all military aircraft
 * @returns {Promise<Object>} - API response with military aircraft
 */
export async function fetchMilitaryAircraft() {
  const response = await fetch('/api/aircraft/military');

  if (!response.ok) {
    throw new Error(`Failed to fetch military aircraft: ${response.status}`);
  }

  return response.json();
}

/**
 * Search aircraft by query
 * @param {string} query - Search query
 * @param {string} field - Field to search (callsign, registration, type, all)
 * @returns {Promise<Object>} - Search results
 */
export async function searchAircraft(query, field = 'all') {
  const response = await fetch(
    `/api/aircraft/search?q=${encodeURIComponent(query)}&field=${field}`
  );

  if (!response.ok) {
    throw new Error(`Search failed: ${response.status}`);
  }

  return response.json();
}

/**
 * Fetch aircraft photo from Planespotters
 * @param {string} hex - ICAO 24-bit address
 * @returns {Promise<Object|null>} - Photo data or null if not found
 */
export async function fetchAircraftPhoto(hex) {
  try {
    const response = await fetch(`/api/aircraft/${hex}/photo`);

    if (!response.ok) {
      return null;
    }

    const data = await response.json();

    if (data.photos && data.photos.length > 0) {
      return data.photos[0];
    }

    return null;
  } catch (error) {
    console.error('Error fetching aircraft photo:', error);
    return null;
  }
}

/**
 * Fetch aircraft in viewport bounds
 * @param {Object} bounds - Leaflet LatLngBounds object
 * @returns {Promise<Object>} - API response with aircraft array
 */
export async function fetchAircraftInBounds(bounds) {
  const center = bounds.getCenter();
  const ne = bounds.getNorthEast();

  // Calculate approximate distance in nautical miles
  const latDiff = Math.abs(ne.lat - center.lat);
  const lonDiff = Math.abs(ne.lng - center.lng);
  const maxDiff = Math.max(latDiff, lonDiff);

  // Convert degrees to nautical miles (rough approximation)
  const distNm = Math.ceil(maxDiff * 60);

  // Clamp distance to reasonable range
  const clampedDist = Math.min(Math.max(distNm, 50), 500);

  return fetchAircraftByLocation(center.lat, center.lng, clampedDist);
}
