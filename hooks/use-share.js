'use client';

import { useCallback } from 'react';
import { useAircraftStore } from '@/stores/aircraft-store';
import { useMapStore } from '@/stores/map-store';

/**
 * Hook for sharing flight tracking links
 * Supports native sharing API and clipboard fallback
 */
export function useShare() {
  const selectedAircraft = useAircraftStore(s => s.getSelectedAircraft());
  const { center, zoom } = useMapStore();

  /**
   * Generate a shareable URL with current map state
   */
  const generateShareUrl = useCallback(() => {
    const params = new URLSearchParams();

    if (selectedAircraft) {
      params.set('hex', selectedAircraft.hex);
      if (selectedAircraft.flight) {
        params.set('flight', selectedAircraft.flight.trim());
      }
    }

    params.set('lat', center[0].toFixed(4));
    params.set('lon', center[1].toFixed(4));
    params.set('z', zoom.toString());

    return `${window.location.origin}${window.location.pathname}?${params.toString()}`;
  }, [selectedAircraft, center, zoom]);

  /**
   * Copy the share URL to clipboard
   */
  const copyToClipboard = useCallback(async () => {
    const url = generateShareUrl();
    try {
      await navigator.clipboard.writeText(url);
      return { success: true, url };
    } catch (error) {
      console.error('Failed to copy:', error);
      return { success: false, error };
    }
  }, [generateShareUrl]);

  /**
   * Share using native sharing API or fallback to clipboard
   */
  const shareNative = useCallback(async () => {
    const url = generateShareUrl();

    if (navigator.share) {
      try {
        await navigator.share({
          title: selectedAircraft
            ? `Tracking ${selectedAircraft.flight?.trim() || selectedAircraft.hex}`
            : 'ShadowADSB - Live Flight Tracking',
          text: selectedAircraft
            ? `Check out this flight: ${selectedAircraft.flight?.trim() || selectedAircraft.hex}`
            : 'Real-time aircraft tracking',
          url,
        });
        return { success: true, method: 'native' };
      } catch (error) {
        if (error.name !== 'AbortError') {
          console.error('Share failed:', error);
        }
        return { success: false, error };
      }
    } else {
      // Fallback to clipboard
      return copyToClipboard();
    }
  }, [generateShareUrl, selectedAircraft, copyToClipboard]);

  return {
    generateShareUrl,
    copyToClipboard,
    shareNative,
    canShare: typeof navigator !== 'undefined' && !!navigator.share,
  };
}

export default useShare;
