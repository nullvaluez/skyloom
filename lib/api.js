// Client-side timeout for API calls (12 seconds, slightly longer than server timeout)
const CLIENT_TIMEOUT_MS = 12000;

// In-flight request cache for deduplication
const inFlightRequests = new Map();

// Route data cache (callsign -> { data, timestamp })
const routeCache = new Map();
const ROUTE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Airline data cache (IATA/ICAO code -> airline info)
const airlineCache = new Map();
const AIRLINE_CACHE_TTL = 60 * 60 * 1000; // 1 hour

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
 * Build a fetch error that carries HTTP status for React Query retry logic
 */
function httpError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

/**
 * Fetch aircraft within a radius of a point
 * @param {number} lat - Center latitude
 * @param {number} lon - Center longitude
 * @param {number} dist - Distance in nautical miles (default 250)
 * @returns {Promise<Object>} - API response with aircraft array
 */
export async function fetchAircraftByLocation(lat, lon, dist = 250) {
  // Round to 0.05° (~5 km) — matches the proxy cache grid so fly/map polls
  // reuse the same URL instead of minting a new upstream hit every km.
  const qLat = Math.round(Number(lat) * 20) / 20;
  const qLon = Math.round(Number(lon) * 20) / 20;
  const url = `/api/aircraft?lat=${qLat}&lon=${qLon}&dist=${dist}`;

  try {
    const response = await fetchWithDedup(url);

    if (!response.ok) {
      // Soft-fail upstream/proxy outages — never wipe the map; dead reckoning
      // + placeholderData keep the last good frame on screen.
      if (response.status === 504 || response.status === 503 || response.status === 502) {
        console.warn(`Aircraft fetch ${response.status}, returning empty data`);
        return { ac: [], error: 'unavailable' };
      }
      // Legacy 429 path (proxy now soft-fails rate limits as 200 + error)
      if (response.status === 429) {
        console.warn('Aircraft API rate limited (429)');
        throw httpError('rate_limited', 429);
      }
      throw httpError(`Failed to fetch aircraft: ${response.status}`, response.status);
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

/**
 * Parse callsign to extract airline code and flight number
 * @param {string} callsign - Flight callsign (e.g., "UAL123", "BAW456")
 * @returns {Object|null} - { airlineCode, flightNumber } or null
 */
export function parseCallsign(callsign) {
  if (!callsign || typeof callsign !== 'string') return null;
  
  const trimmed = callsign.trim().toUpperCase();
  if (trimmed.length < 4) return null;
  
  // Match pattern: 2-3 letter airline code + flight number
  const match = trimmed.match(/^([A-Z]{2,3})(\d{1,4}[A-Z]?)$/);
  if (match) {
    return {
      airlineCode: match[1],
      flightNumber: match[2],
      fullFlightNumber: `${match[1]}${match[2]}`,
    };
  }
  
  return null;
}

/**
 * Check if route data is cached and still valid
 * @param {string} cacheKey - Cache key (callsign or hex)
 * @returns {Object|null} - Cached route data or null
 */
function getCachedRoute(cacheKey) {
  const cached = routeCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < ROUTE_CACHE_TTL) {
    return cached.data;
  }
  routeCache.delete(cacheKey);
  return null;
}

/**
 * Cache route data
 * @param {string} cacheKey - Cache key (callsign or hex)
 * @param {Object} data - Route data to cache
 */
function setCachedRoute(cacheKey, data) {
  routeCache.set(cacheKey, {
    data,
    timestamp: Date.now(),
  });
  
  // Clean up old cache entries periodically
  if (routeCache.size > 100) {
    const now = Date.now();
    for (const [key, value] of routeCache.entries()) {
      if (now - value.timestamp > ROUTE_CACHE_TTL) {
        routeCache.delete(key);
      }
    }
  }
}

/**
 * Fetch flight route information
 * Uses server-side API route to avoid CORS issues
 * @param {string} callsign - Flight callsign
 * @param {string} hex - ICAO hex code (fallback identifier)
 * @returns {Promise<Object|null>} - Route data or null
 */
export async function fetchFlightRoute(callsign, hex) {
  const cacheKey = callsign || hex;
  if (!cacheKey) return null;
  
  // Check cache first
  const cached = getCachedRoute(cacheKey);
  if (cached) return cached;
  
  try {
    const params = new URLSearchParams();
    if (callsign) params.set('callsign', callsign.trim());
    if (hex) params.set('hex', hex);
    
    const response = await fetch(`/api/aircraft/${hex}/route?${params.toString()}`);
    
    if (!response.ok) {
      // Cache null result to avoid repeated failed requests
      setCachedRoute(cacheKey, null);
      return null;
    }
    
    const data = await response.json();
    setCachedRoute(cacheKey, data);
    return data;
  } catch (error) {
    console.error('Error fetching flight route:', error);
    return null;
  }
}

/**
 * Fetch airline information by ICAO or IATA code
 * @param {string} code - Airline ICAO (3-letter) or IATA (2-letter) code
 * @returns {Promise<Object|null>} - Airline info or null
 */
export async function fetchAirlineInfo(code) {
  if (!code) return null;
  
  const upperCode = code.toUpperCase();
  
  // Check cache first
  const cached = airlineCache.get(upperCode);
  if (cached && Date.now() - cached.timestamp < AIRLINE_CACHE_TTL) {
    return cached.data;
  }
  
  // For now, return from local database (will be implemented in lib/airlines.js)
  // This avoids external API calls for airline data
  try {
    const { getAirlineByCode } = await import('./airlines.js');
    const airline = getAirlineByCode(upperCode);
    
    airlineCache.set(upperCode, {
      data: airline,
      timestamp: Date.now(),
    });
    
    return airline;
  } catch (error) {
    console.error('Error fetching airline info:', error);
    return null;
  }
}

/**
 * Calculate great circle distance between two points
 * @param {number} lat1 - Start latitude
 * @param {number} lon1 - Start longitude
 * @param {number} lat2 - End latitude
 * @param {number} lon2 - End longitude
 * @returns {number} - Distance in nautical miles
 */
export function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 3440.065; // Earth radius in nautical miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Calculate estimated time of arrival
 * @param {number} distanceNm - Distance remaining in nautical miles
 * @param {number} groundSpeedKts - Ground speed in knots
 * @returns {Date|null} - Estimated arrival time or null
 */
export function calculateETA(distanceNm, groundSpeedKts) {
  if (!distanceNm || !groundSpeedKts || groundSpeedKts <= 0) return null;
  
  const hoursRemaining = distanceNm / groundSpeedKts;
  const msRemaining = hoursRemaining * 60 * 60 * 1000;
  
  return new Date(Date.now() + msRemaining);
}

/**
 * Generate great circle path between two points
 * @param {number} lat1 - Start latitude
 * @param {number} lon1 - Start longitude
 * @param {number} lat2 - End latitude
 * @param {number} lon2 - End longitude
 * @param {number} numPoints - Number of points to generate (default 50)
 * @returns {Array<[number, number]>} - Array of [lon, lat] coordinates
 */
export function generateGreatCirclePath(lat1, lon1, lat2, lon2, numPoints = 50) {
  const points = [];
  
  const lat1Rad = lat1 * Math.PI / 180;
  const lon1Rad = lon1 * Math.PI / 180;
  const lat2Rad = lat2 * Math.PI / 180;
  const lon2Rad = lon2 * Math.PI / 180;
  
  for (let i = 0; i <= numPoints; i++) {
    const f = i / numPoints;
    
    // Great circle interpolation
    const d = Math.acos(
      Math.sin(lat1Rad) * Math.sin(lat2Rad) +
      Math.cos(lat1Rad) * Math.cos(lat2Rad) * Math.cos(lon2Rad - lon1Rad)
    );
    
    if (d === 0) {
      points.push([lon1, lat1]);
      continue;
    }
    
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    
    const x = A * Math.cos(lat1Rad) * Math.cos(lon1Rad) + B * Math.cos(lat2Rad) * Math.cos(lon2Rad);
    const y = A * Math.cos(lat1Rad) * Math.sin(lon1Rad) + B * Math.cos(lat2Rad) * Math.sin(lon2Rad);
    const z = A * Math.sin(lat1Rad) + B * Math.sin(lat2Rad);
    
    const lat = Math.atan2(z, Math.sqrt(x * x + y * y)) * 180 / Math.PI;
    const lon = Math.atan2(y, x) * 180 / Math.PI;
    
    points.push([lon, lat]);
  }
  
  return points;
}
