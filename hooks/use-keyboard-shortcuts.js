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
};

/**
 * Hook for keyboard shortcuts throughout the application
 * @returns {Object} SHORTCUTS - Object containing shortcut keys and descriptions
 */
export function useKeyboardShortcuts() {
  const { toggleSidebar, closeDetailPanel } = useUIStore();
  const { resetView, geolocate, mapRef } = useMapStore();
  const { selectAircraft, unfollowAircraft } = useAircraftStore();

  const handleKeyDown = useCallback((e) => {
    // Fly mode owns the keyboard (WASD, F, Escape, 1/2/3) — these global
    // shortcuts would hijack flight controls. (arModeOpen would benefit from
    // the same guard; left unchanged to avoid altering AR behavior here.)
    if (useUIStore.getState().flyModeOpen) {
      return;
    }

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

      default:
        break;
    }
  }, [toggleSidebar, closeDetailPanel, selectAircraft, unfollowAircraft, resetView, geolocate, mapRef]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return SHORTCUTS;
}

export default useKeyboardShortcuts;
