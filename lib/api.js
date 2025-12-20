// Client-side timeout for API calls (12 seconds, slightly longer than server timeout)
const CLIENT_TIMEOUT_MS = 12000;

// In-flight request cache for deduplication
const inFlightRequests = new Map();

/**
 * Fetch with timeout and request deduplication
 * Prevents duplicate requests for the same URL and adds client-side timeout
 */
async function fetchWithDedup(url, options = {}) {
  // Check if there's already an in-flight request for this URL
  if (inFlightRequests.has(url)) {
    return inFlightRequests.get(url);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);

  const requestPromise = (async () => {
    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      return response;
    } finally {
      clearTimeout(timeoutId);
      // Clean up after request completes
      inFlightRequests.delete(url);
    }
  })();

  // Store the promise for deduplication
  inFlightRequests.set(url, requestPromise);

  return requestPromise;
}

/**
 * Fetch aircraft within a radius of a point
 * @param {number} lat - Center latitude
 * @param {number} lon - Center longitude
 * @param {number} dist - Distance in nautical miles (default 250)
 * @returns {Promise<Object>} - API response with aircraft array
 */
export async function fetchAircraftByLocation(lat, lon, dist = 250) {
  const url = `/api/aircraft?lat=${lat}&lon=${lon}&dist=${dist}`;
  
  try {
    const response = await fetchWithDedup(url);

    if (!response.ok) {
      // Return empty array on error to prevent app crash
      if (response.status === 504) {
        console.warn('Aircraft fetch timeout, returning empty data');
        return { ac: [], error: 'timeout' };
      }
      throw new Error(`Failed to fetch aircraft: ${response.status}`);
    }

    return response.json();
  } catch (error) {
    if (error.name === 'AbortError') {
      console.warn('Aircraft fetch aborted (client timeout)');
      return { ac: [], error: 'timeout' };
    }
    throw error;
  }
}

/**
 * Fetch aircraft by ICAO hex code
 * @param {string} hex - ICAO 24-bit address
 * @returns {Promise<Object>} - Aircraft details
 */
export async function fetchAircraftByHex(hex) {
  const url = `/api/aircraft/${hex}`;
  
  try {
    const response = await fetchWithDedup(url);

    if (!response.ok) {
      if (response.status === 504) {
        return { error: 'timeout' };
      }
      throw new Error(`Failed to fetch aircraft ${hex}: ${response.status}`);
    }

    return response.json();
  } catch (error) {
    if (error.name === 'AbortError') {
      return { error: 'timeout' };
    }
    throw error;
  }
}

/**
 * Fetch all military aircraft
 * @returns {Promise<Object>} - API response with military aircraft
 */
export async function fetchMilitaryAircraft() {
  const url = '/api/aircraft/military';
  
  try {
    const response = await fetchWithDedup(url);

    if (!response.ok) {
      if (response.status === 504) {
        return { ac: [], error: 'timeout' };
      }
      throw new Error(`Failed to fetch military aircraft: ${response.status}`);
    }

    return response.json();
  } catch (error) {
    if (error.name === 'AbortError') {
      return { ac: [], error: 'timeout' };
    }
    throw error;
  }
}

/**
 * Search aircraft by query
 * @param {string} query - Search query
 * @param {string} field - Field to search (callsign, registration, type, all)
 * @returns {Promise<Object>} - Search results
 */
export async function searchAircraft(query, field = 'all') {
  const url = `/api/aircraft/search?q=${encodeURIComponent(query)}&field=${field}`;
  
  try {
    const response = await fetchWithDedup(url);

    if (!response.ok) {
      throw new Error(`Search failed: ${response.status}`);
    }

    return response.json();
  } catch (error) {
    if (error.name === 'AbortError') {
      return { results: [], error: 'timeout' };
    }
    throw error;
  }
}

/**
 * Fetch aircraft photo from Planespotters
 * @param {string} hex - ICAO 24-bit address
 * @returns {Promise<Object|null>} - Photo data or null if not found
 */
export async function fetchAircraftPhoto(hex) {
  try {
    // Photos don't need dedup since they're cached
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
