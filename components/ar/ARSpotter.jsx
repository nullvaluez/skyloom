import { create } from 'zustand';
import { TRAIL_CONFIG } from '@/lib/constants';
import { classifyAircraft, getAircraftIconType, getAircraftColor } from '@/lib/classify';

// Maximum age for trail points (5 minutes)
const TRAIL_MAX_AGE_MS = 300000;

// Maximum age for stale aircraft data (2 minutes)
const STALE_AIRCRAFT_AGE_MS = 120000;

// Epsilon for floating-point comparison
const POSITION_EPSILON = 0.00001;

// Cleanup interval timer reference
let cleanupIntervalId = null;

export const useAircraftStore = create((set, get) => ({
  // Aircraft data as a Map for O(1) lookups
  aircraft: new Map(),

  // Selected aircraft hex
  selectedAircraftId: null,

  // Followed aircraft hex (map centers on this aircraft)
  followedAircraftId: null,

  // Flight trails as a Map of hex -> position array
  trails: new Map(),

  // Track when each aircraft was last seen (hex -> timestamp)
  lastSeen: new Map(),

  // Last update timestamp
  lastUpdate: null,

  // Actions
  setAircraft: (aircraftList) => {
    const { selectedAircraftId, trails, lastSeen, aircraft: existingAircraft } = get();
    const now = Date.now();
    const newMap = new Map();
    const newLastSeen = new Map(lastSeen);
    const activeHexes = new Set();

    // Start with cleaned trails (only keep trails for selected aircraft)
    const newTrails = new Map();

    aircraftList.forEach((ac) => {
      if (ac.hex) {
        activeHexes.add(ac.hex);
        
        // Track when this aircraft was last seen
        newLastSeen.set(ac.hex, now);

        // Get existing aircraft data to preserve classification
        const existing = existingAircraft.get(ac.hex);
        
        // Merge with existing data, keeping position updates
        const mergedAc = existing 
          ? { ...existing, ...ac }
          : ac;

        // Calculate classification data if not already cached
        if (!mergedAc._classification) {
          mergedAc._classification = classifyAircraft(mergedAc);
          mergedAc._iconType = getAircraftIconType(mergedAc);
          mergedAc._color = getAircraftColor(mergedAc);
        }

        newMap.set(ac.hex, mergedAc);

        // Update trail for selected aircraft
        if (ac.hex === selectedAircraftId && ac.lat && ac.lon) {
          const currentTrail = trails.get(ac.hex) || [];
          const lastPos = currentTrail[currentTrail.length - 1];

          // Use epsilon comparison for floating point (more reliable than direct comparison)
          const hasChanged = !lastPos ||
            Math.abs(lastPos.lat - ac.lat) > POSITION_EPSILON ||
            Math.abs(lastPos.lon - ac.lon) > POSITION_EPSILON;

          if (hasChanged) {
            // Add new position and limit trail length
            const updatedTrail = [
              ...currentTrail,
              { lat: ac.lat, lon: ac.lon, timestamp: now },
            ].slice(-TRAIL_CONFIG.maxPositions);

            // Filter out old trail points (older than 5 minutes)
            const recentTrail = updatedTrail.filter(p => now - p.timestamp < TRAIL_MAX_AGE_MS);

            if (recentTrail.length > 0) {
              newTrails.set(ac.hex, recentTrail);
            }
          } else {
            // Position hasn't changed, keep existing trail
            const existingTrail = trails.get(ac.hex);
            if (existingTrail && existingTrail.length > 0) {
              // Filter out old trail points
              const recentTrail = existingTrail.filter(p => now - p.timestamp < TRAIL_MAX_AGE_MS);
              if (recentTrail.length > 0) {
                newTrails.set(ac.hex, recentTrail);
              }
            }
          }
        }
      }
    });

    // If there's a selected aircraft but it wasn't in this batch, keep its trail
    if (selectedAircraftId && !newTrails.has(selectedAircraftId)) {
      const existingTrail = trails.get(selectedAircraftId);
      if (existingTrail && existingTrail.length > 0) {
        const recentTrail = existingTrail.filter(p => now - p.timestamp < TRAIL_MAX_AGE_MS);
        if (recentTrail.length > 0) {
          newTrails.set(selectedAircraftId, recentTrail);
        }
      }
    }

    // Clean up stale lastSeen entries for aircraft no longer in view
    for (const [hex, timestamp] of newLastSeen.entries()) {
      if (now - timestamp > STALE_AIRCRAFT_AGE_MS && !activeHexes.has(hex)) {
        newLastSeen.delete(hex);
      }
    }

    set({
      aircraft: newMap,
      trails: newTrails,
      lastSeen: newLastSeen,
      lastUpdate: new Date(),
    });
  },

  selectAircraft: (id) => {
    const { trails, selectedAircraftId: previousId, followedAircraftId, aircraft } = get();

    // If deselecting (id is null), clear the trail and unfollow if following
    if (id === null) {
      const newTrails = new Map(trails);
      if (previousId) {
        newTrails.delete(previousId);
      }

      set({
        selectedAircraftId: null,
        trails: newTrails,
        // Also unfollow if we were following this aircraft
        followedAircraftId: followedAircraftId === previousId ? null : followedAircraftId,
      });
      return;
    }

    // If selecting a new aircraft, clear old trail and initialize new one
    if (id !== previousId) {
      const selectedAircraft = aircraft.get(id);
      const newTrails = new Map();

      // Initialize new aircraft's trail with current position
      if (selectedAircraft && selectedAircraft.lat && selectedAircraft.lon) {
        newTrails.set(id, [
          { lat: selectedAircraft.lat, lon: selectedAircraft.lon, timestamp: Date.now() },
        ]);
      }

      set({
        selectedAircraftId: id,
        trails: newTrails,
      });
      return;
    }

    set({ selectedAircraftId: id });
  },

  followAircraft: (id) => {
    set({ followedAircraftId: id });
  },

  unfollowAircraft: () => {
    set({ followedAircraftId: null });
  },

  updateTrail: (id, position) => {
    const { trails } = get();
    const currentTrail = trails.get(id) || [];

    const newTrail = [
      ...currentTrail,
      { ...position, timestamp: Date.now() },
    ].slice(-TRAIL_CONFIG.maxPositions);

    set((state) => ({
      trails: new Map(state.trails).set(id, newTrail),
    }));
  },

  clearTrail: (id) => {
    set((state) => {
      const newTrails = new Map(state.trails);
      newTrails.delete(id);
      return { trails: newTrails };
    });
  },

  clearAllTrails: () => {
    set({ trails: new Map() });
  },

  // Get selected aircraft object
  getSelectedAircraft: () => {
    const { aircraft, selectedAircraftId } = get();
    if (!selectedAircraftId) return null;
    return aircraft.get(selectedAircraftId) || null;
  },

  // Get followed aircraft object
  getFollowedAircraft: () => {
    const { aircraft, followedAircraftId } = get();
    if (!followedAircraftId) return null;
    return aircraft.get(followedAircraftId) || null;
  },

  // Get trail for selected aircraft
  getSelectedTrail: () => {
    const { trails, selectedAircraftId } = get();
    if (!selectedAircraftId) return [];
    return trails.get(selectedAircraftId) || [];
  },

  // Get aircraft array for rendering
  getAircraftArray: () => {
    return Array.from(get().aircraft.values());
  },

  // Get aircraft count
  getAircraftCount: () => {
    return get().aircraft.size;
  },

  // Get cached classification for an aircraft (uses pre-computed values)
  getAircraftClassification: (hex) => {
    const aircraft = get().aircraft.get(hex);
    if (!aircraft) return null;
    return {
      classification: aircraft._classification,
      iconType: aircraft._iconType,
      color: aircraft._color,
    };
  },

  // Clean up stale trails and data for aircraft not seen recently
  cleanupStaleData: () => {
    const { trails, lastSeen, selectedAircraftId, followedAircraftId } = get();
    const now = Date.now();
    const newTrails = new Map();
    const newLastSeen = new Map();
    let unfollowNeeded = false;

    // Keep only recent lastSeen entries and their associated trails
    for (const [hex, timestamp] of lastSeen.entries()) {
      if (now - timestamp < STALE_AIRCRAFT_AGE_MS) {
        newLastSeen.set(hex, timestamp);
        
        // Keep trail if it exists and aircraft is selected
        if (hex === selectedAircraftId && trails.has(hex)) {
          const trail = trails.get(hex);
          const recentTrail = trail.filter(p => now - p.timestamp < TRAIL_MAX_AGE_MS);
          if (recentTrail.length > 0) {
            newTrails.set(hex, recentTrail);
          }
        }
      } else {
        // Aircraft is stale - if we were following it, we need to unfollow
        if (hex === followedAircraftId) {
          unfollowNeeded = true;
        }
      }
    }

    set({
      trails: newTrails,
      lastSeen: newLastSeen,
      followedAircraftId: unfollowNeeded ? null : followedAircraftId,
    });
  },

  // Start periodic cleanup timer (call once on app mount)
  startCleanupTimer: () => {
    if (cleanupIntervalId) return; // Already running
    
    cleanupIntervalId = setInterval(() => {
      get().cleanupStaleData();
    }, 30000); // Run cleanup every 30 seconds
  },

  // Stop cleanup timer (call on app unmount)
  stopCleanupTimer: () => {
    if (cleanupIntervalId) {
      clearInterval(cleanupIntervalId);
      cleanupIntervalId = null;
    }
  },

  // Check if an aircraft is stale (not seen recently)
  isAircraftStale: (hex) => {
    const { lastSeen } = get();
    const timestamp = lastSeen.get(hex);
    if (!timestamp) return true;
    return Date.now() - timestamp > STALE_AIRCRAFT_AGE_MS;
  },
}));
