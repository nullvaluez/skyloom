'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { 
  fetchFlightRoute, 
  parseCallsign, 
  calculateDistance, 
  calculateETA,
  generateGreatCirclePath 
} from '@/lib/api';
import { getAirport, findNearestAirport, getCountryFlag as getAirportCountryFlag } from '@/lib/airports';
import { getAirlineFromCallsign, parseFlightNumber, getAirlineLogo, getCountryFlag as getAirlineCountryFlag } from '@/lib/airlines';

/**
 * Hook to fetch and compute route information for an aircraft
 * Combines data from route API, airports, and airlines databases
 * 
 * @param {Object} aircraft - Aircraft object with callsign, hex, lat, lon, etc.
 * @returns {Object} - Route data including origin, destination, airline, progress, ETA
 */
export function useRoute(aircraft) {
  const callsign = aircraft?.flight?.trim();
  const hex = aircraft?.hex;
  const lat = aircraft?.lat;
  const lon = aircraft?.lon;
  const groundSpeed = aircraft?.gs;
  const track = aircraft?.track;
  
  // Fetch route from API
  const { data: routeData, isLoading: routeLoading, error: routeError } = useQuery({
    queryKey: ['route', callsign, hex],
    queryFn: () => fetchFlightRoute(callsign, hex),
    enabled: !!(callsign || hex),
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 30 * 60 * 1000, // 30 minutes
    retry: 1,
    refetchOnWindowFocus: false,
  });
  
  // Compute comprehensive route info
  const routeInfo = useMemo(() => {
    if (!aircraft) return null;
    
    // Parse callsign for airline info
    const flightInfo = parseFlightNumber(callsign);
    const airline = flightInfo?.airline || getAirlineFromCallsign(callsign);
    
    // Get origin and destination from route data or estimate
    let origin = null;
    let destination = null;
    
    if (routeData?.origin) {
      origin = getAirport(routeData.origin) || {
        icao: routeData.origin,
        iata: routeData.originIata,
        name: routeData.originName || routeData.origin,
        city: routeData.originCity,
        country: routeData.originCountry,
        lat: routeData.originLat,
        lon: routeData.originLon,
      };
    }
    
    if (routeData?.destination) {
      destination = getAirport(routeData.destination) || {
        icao: routeData.destination,
        iata: routeData.destinationIata,
        name: routeData.destinationName || routeData.destination,
        city: routeData.destinationCity,
        country: routeData.destinationCountry,
        lat: routeData.destinationLat,
        lon: routeData.destinationLon,
      };
    }
    
    // Calculate distances and progress if we have origin/destination
    let totalDistance = null;
    let distanceFlown = null;
    let distanceRemaining = null;
    let progress = null;
    let eta = null;
    let flightPath = null;
    
    if (origin?.lat && origin?.lon && destination?.lat && destination?.lon && lat && lon) {
      totalDistance = calculateDistance(origin.lat, origin.lon, destination.lat, destination.lon);
      distanceFlown = calculateDistance(origin.lat, origin.lon, lat, lon);
      distanceRemaining = calculateDistance(lat, lon, destination.lat, destination.lon);
      
      // Calculate progress (clamped to 0-100%)
      if (totalDistance > 0) {
        progress = Math.min(100, Math.max(0, (distanceFlown / totalDistance) * 100));
      }
      
      // Calculate ETA based on remaining distance and ground speed
      if (groundSpeed && distanceRemaining) {
        eta = calculateETA(distanceRemaining, groundSpeed);
      }
      
      // Generate great circle path for visualization
      flightPath = generateGreatCirclePath(
        origin.lat, origin.lon,
        destination.lat, destination.lon,
        50 // 50 points for smooth curve
      );
    } else if (destination?.lat && destination?.lon && lat && lon && groundSpeed) {
      // If we only have destination, calculate distance remaining and ETA
      distanceRemaining = calculateDistance(lat, lon, destination.lat, destination.lon);
      eta = calculateETA(distanceRemaining, groundSpeed);
    }
    
    // Format flight time remaining
    let timeRemaining = null;
    if (eta) {
      const now = Date.now();
      const msRemaining = eta.getTime() - now;
      if (msRemaining > 0) {
        const hours = Math.floor(msRemaining / (1000 * 60 * 60));
        const minutes = Math.floor((msRemaining % (1000 * 60 * 60)) / (1000 * 60));
        if (hours > 0) {
          timeRemaining = `${hours}h ${minutes}m`;
        } else {
          timeRemaining = `${minutes}m`;
        }
      }
    }
    
    // Estimate departure/arrival times if available
    let departureTime = routeData?.departureTime ? new Date(routeData.departureTime) : null;
    let scheduledArrival = routeData?.arrivalTime ? new Date(routeData.arrivalTime) : null;
    
    return {
      // Airline information
      airline: airline ? {
        name: airline.name,
        icao: airline.icao,
        iata: airline.iata,
        country: airline.country,
        flag: getAirlineCountryFlag(airline.country),
        logo: getAirlineLogo(airline.iata),
        callsignPrefix: airline.callsignPrefix,
      } : null,
      
      // Flight number info
      flightNumber: flightInfo?.displayFlightNumber || callsign,
      icaoFlightNumber: flightInfo?.icaoFlightNumber,
      
      // Origin airport
      origin: origin ? {
        icao: origin.icao,
        iata: origin.iata,
        name: origin.name,
        city: origin.city,
        country: origin.country,
        flag: getAirportCountryFlag(origin.country),
        lat: origin.lat,
        lon: origin.lon,
      } : null,
      
      // Destination airport  
      destination: destination ? {
        icao: destination.icao,
        iata: destination.iata,
        name: destination.name,
        city: destination.city,
        country: destination.country,
        flag: getAirportCountryFlag(destination.country),
        lat: destination.lat,
        lon: destination.lon,
      } : null,
      
      // Distance and progress
      totalDistanceNm: totalDistance ? Math.round(totalDistance) : null,
      distanceFlownNm: distanceFlown ? Math.round(distanceFlown) : null,
      distanceRemainingNm: distanceRemaining ? Math.round(distanceRemaining) : null,
      progressPercent: progress ? Math.round(progress) : null,
      
      // Time estimates
      departureTime,
      scheduledArrival,
      eta,
      timeRemaining,
      
      // Path for visualization
      flightPath,
      
      // Waypoints if available
      waypoints: routeData?.waypoints || null,
      
      // Raw route data for debugging
      _raw: routeData,
    };
  }, [aircraft, callsign, lat, lon, groundSpeed, routeData]);
  
  return {
    route: routeInfo,
    isLoading: routeLoading,
    error: routeError,
    hasRoute: !!(routeInfo?.origin || routeInfo?.destination),
    hasFullRoute: !!(routeInfo?.origin && routeInfo?.destination),
  };
}

/**
 * Hook to find nearest airports to an aircraft
 * @param {Object} aircraft - Aircraft object with lat, lon
 * @param {number} maxDistanceNm - Maximum search radius in nm (default 30)
 * @returns {Object} - Nearest airports and loading state
 */
export function useNearestAirports(aircraft, maxDistanceNm = 30) {
  const lat = aircraft?.lat;
  const lon = aircraft?.lon;
  
  const nearestAirports = useMemo(() => {
    if (!lat || !lon) return null;
    
    const nearest = findNearestAirport(lat, lon, maxDistanceNm);
    return nearest;
  }, [lat, lon, maxDistanceNm]);
  
  return {
    nearestAirport: nearestAirports,
  };
}

/**
 * Hook to get airline info from callsign
 * @param {string} callsign - Flight callsign
 * @returns {Object} - Airline info
 */
export function useAirline(callsign) {
  const airlineInfo = useMemo(() => {
    if (!callsign) return null;
    
    const flightInfo = parseFlightNumber(callsign);
    const airline = flightInfo?.airline || getAirlineFromCallsign(callsign);
    
    if (!airline) return null;
    
    return {
      name: airline.name,
      icao: airline.icao,
      iata: airline.iata,
      country: airline.country,
      flag: getAirlineCountryFlag(airline.country),
      logo: getAirlineLogo(airline.iata),
      flightNumber: flightInfo?.displayFlightNumber,
    };
  }, [callsign]);
  
  return airlineInfo;
}

