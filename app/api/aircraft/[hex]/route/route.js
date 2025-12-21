import { NextResponse } from 'next/server';

// OpenSky Network API for route data (free tier)
const OPENSKY_ROUTE_URL = 'https://opensky-network.org/api/routes';

// Route database fallback (FlightAware, ADS-B Exchange etc)
const ADSBDB_URL = 'https://api.adsbdb.com/v0';

// Timeout for external API calls
const API_TIMEOUT_MS = 5000;

// In-memory route cache (server-side)
const routeCache = new Map();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

/**
 * Fetch with timeout
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = API_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Try to fetch route from OpenSky Network
 */
async function fetchFromOpenSky(callsign) {
  try {
    const response = await fetchWithTimeout(
      `${OPENSKY_ROUTE_URL}?callsign=${encodeURIComponent(callsign)}`
    );
    
    if (!response.ok) return null;
    
    const data = await response.json();
    if (!data?.route?.length) return null;
    
    // OpenSky returns route as array of airport ICAO codes
    const route = data.route;
    if (route.length >= 2) {
      return {
        origin: route[0],
        destination: route[route.length - 1],
        waypoints: route.slice(1, -1),
        source: 'opensky',
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Try to fetch route from ADS-B DB (callsign-based)
 */
async function fetchFromAdsbDb(callsign) {
  try {
    const response = await fetchWithTimeout(
      `${ADSBDB_URL}/callsign/${encodeURIComponent(callsign)}`
    );
    
    if (!response.ok) return null;
    
    const data = await response.json();
    if (!data?.response?.flightroute) return null;
    
    const route = data.response.flightroute;
    return {
      origin: route.origin?.icao_code,
      originIata: route.origin?.iata_code,
      originName: route.origin?.name,
      originCity: route.origin?.municipality,
      originCountry: route.origin?.country_iso_name,
      originLat: route.origin?.latitude,
      originLon: route.origin?.longitude,
      destination: route.destination?.icao_code,
      destinationIata: route.destination?.iata_code,
      destinationName: route.destination?.name,
      destinationCity: route.destination?.municipality,
      destinationCountry: route.destination?.country_iso_name,
      destinationLat: route.destination?.latitude,
      destinationLon: route.destination?.longitude,
      callsign: route.callsign,
      callsignIata: route.callsign_iata,
      callsignIcao: route.callsign_icao,
      airlineName: route.airline?.name,
      airlineIata: route.airline?.iata,
      airlineIcao: route.airline?.icao,
      airlineCountry: route.airline?.country,
      source: 'adsbdb',
    };
  } catch {
    return null;
  }
}

/**
 * Derive route from callsign pattern when API fails
 * Many flights follow predictable patterns
 */
function deriveRouteFromCallsign(callsign) {
  if (!callsign) return null;
  
  // This is a basic placeholder - in production, you'd have 
  // historical route patterns or machine learning model
  return null;
}

/**
 * GET /api/aircraft/[hex]/route
 * Fetch flight route information
 */
export async function GET(request, { params }) {
  const { hex } = await params;
  const { searchParams } = new URL(request.url);
  const callsign = searchParams.get('callsign');

  if (!callsign && !hex) {
    return NextResponse.json(
      { error: 'Missing required parameter: callsign or hex' },
      { status: 400 }
    );
  }

  // Check cache first
  const cacheKey = callsign || hex;
  const cached = routeCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return NextResponse.json(cached.data, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
        'X-Cache': 'HIT',
      },
    });
  }

  try {
    let routeData = null;

    // Try different sources in order of reliability
    if (callsign) {
      // 1. Try ADS-B DB first (most comprehensive)
      routeData = await fetchFromAdsbDb(callsign);
      
      // 2. Try OpenSky Network as fallback
      if (!routeData) {
        routeData = await fetchFromOpenSky(callsign);
      }
      
      // 3. Try to derive from callsign pattern
      if (!routeData) {
        routeData = deriveRouteFromCallsign(callsign);
      }
    }

    if (!routeData) {
      // Return 404 but cache it to avoid repeated requests
      routeCache.set(cacheKey, { 
        data: null, 
        timestamp: Date.now() 
      });
      
      return NextResponse.json(
        { error: 'Route not found', callsign, hex },
        { status: 404 }
      );
    }

    // Cache successful result
    routeCache.set(cacheKey, {
      data: routeData,
      timestamp: Date.now(),
    });

    // Cleanup old cache entries periodically
    if (routeCache.size > 500) {
      const now = Date.now();
      for (const [key, value] of routeCache.entries()) {
        if (now - value.timestamp > CACHE_TTL) {
          routeCache.delete(key);
        }
      }
    }

    return NextResponse.json(routeData, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
        'X-Cache': 'MISS',
      },
    });
  } catch (error) {
    console.error('Error fetching route:', error);
    return NextResponse.json(
      { error: 'Failed to fetch route', details: error.message },
      { status: 500 }
    );
  }
}

