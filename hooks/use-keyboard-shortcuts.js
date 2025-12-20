'use client';

import { useEffect, useCallback } from 'react';
import { useUIStore } from '@/stores/ui-store';
import { useMapStore } from '@/stores/map-store';
import { useAircraftStore } from '@/stores/aircraft-store';

/**
 * Keyboard shortcut definitions
 */
export const SHORTCUTS = {
  'f': 'Toggle filters sidebar',
  'd': 'Toggle detail panel',
  'h': 'Return to home view',
  'l': 'Go to my location',
  'Escape': 'Deselect aircraft',
  '+': 'Zoom in',
  '-': 'Zoom out',
  '?': 'Show keyboard shortcuts',
  'q': 'Rotate bearing left (15°)',
  'e': 'Rotate bearing right (15°)',
  'w': 'Increase pitch (5°)',
  's': 'Decrease pitch (5°)',
  'r': 'Reset bearing to North',
  't': 'Toggle 3D view',
};

/**
 * Hook for keyboard shortcuts throughout the application
 * @returns {Object} SHORTCUTS - Object containing shortcut keys and descriptions
 */
export function useKeyboardShortcuts() {
  const { toggleSidebar, closeDetailPanel } = useUIStore();
  const { 
    resetView, 
    geolocate, 
    mapRef, 
    adjustPitch, 
    adjustBearing, 
    resetBearing,
    pitch,
    setPitch,
    disable3D,
  } = useMapStore();
  const { selectAircraft, unfollowAircraft } = useAircraftStore();

  const handleKeyDown = useCallback((e) => {
    // Ignore if user is typing in an input field
    if (
      e.target.tagName === 'INPUT' ||
      e.target.tagName === 'TEXTAREA' ||
      e.target.isContentEditable
    ) {
      return;
    }

    switch (e.key.toLowerCase()) {
      case 'f':
        e.preventDefault();
        toggleSidebar();
        break;

      case 'd':
        e.preventDefault();
        closeDetailPanel();
        break;

      case 'escape':
        e.preventDefault();
        selectAircraft(null);
        unfollowAircraft();
        closeDetailPanel();
        break;

      case 'h':
        e.preventDefault();
        resetView();
        break;

      case 'l':
        e.preventDefault();
        geolocate();
        break;

      case '+':
      case '=':
        // Let Leaflet handle zoom, but also try programmatic zoom
        if (mapRef) {
          mapRef.zoomIn();
        }
        break;

      case '-':
        if (mapRef) {
          mapRef.zoomOut();
        }
        break;

      case '?':
        e.preventDefault();
        console.log('Keyboard Shortcuts:', SHORTCUTS);
        // Could open a modal here in the future
        break;

      case 'q':
        e.preventDefault();
        adjustBearing(-15);
        break;

      case 'e':
        e.preventDefault();
        adjustBearing(15);
        break;

      case 'w':
        e.preventDefault();
        adjustPitch(5);
        break;

      case 's':
        e.preventDefault();
        adjustPitch(-5);
        break;

      case 'r':
        e.preventDefault();
        resetBearing();
        break;

      case 't':
        e.preventDefault();
        if (pitch > 0) {
          disable3D();
        } else {
          setPitch(60);
        }
        break;

      default:
        break;
    }
  }, [
    toggleSidebar, 
    closeDetailPanel, 
    selectAircraft, 
    unfollowAircraft, 
    resetView, 
    geolocate, 
    mapRef,
    adjustPitch,
    adjustBearing,
    resetBearing,
    pitch,
    setPitch,
    disable3D,
  ]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return SHORTCUTS;
}

export default useKeyboardShortcuts;
