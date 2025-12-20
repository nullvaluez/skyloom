'use client';

import { useState, useEffect, useCallback } from 'react';

/**
 * Hook to get user's geolocation
 */
export function useGeolocation(options = {}) {
  const [location, setLocation] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const getLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setError(new Error('Geolocation is not supported'));
      return;
    }

    setLoading(true);
    setError(null);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocation({
          lat: position.coords.latitude,
          lon: position.coords.longitude,
          accuracy: position.coords.accuracy,
          timestamp: position.timestamp,
        });
        setLoading(false);
      },
      (err) => {
        setError(err);
        setLoading(false);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 60000,
        ...options,
      }
    );
  }, [options]);

  // Get location on mount if requested
  useEffect(() => {
    if (options.enableOnMount) {
      getLocation();
    }
  }, [options.enableOnMount, getLocation]);

  return {
    location,
    error,
    loading,
    getLocation,
    isSupported: typeof navigator !== 'undefined' && !!navigator.geolocation,
  };
}
