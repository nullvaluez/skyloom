import { create } from 'zustand';
import { TRAIL_CONFIG } from '@/lib/constants';
import { classifyAircraft, getAircraftIconType, getAircraftColor } from '@/lib/classify';

// Maximum age for trail points (5 minutes)
const TRAIL_MAX_AGE_MS = 300000;

// Maximum age for stale aircraft data (2 minutes)
const STALE_AIRCRAFT_AGE_MS = 120000;

// Epsilon for floating-point comparison
const POSITION_EPSILON = 0.00001;

// Maximum number of aircraft to track trails for (performance limit)
const MAX_TRAIL_AIRCRAFT = 50;

// Minimum zoom level to enable trails for all aircraft (performance optimization)
const TRAILS_MIN_ZOOM = 9;

// Cleanup interval timer reference
let cleanupIntervalId = null;

// Padding in degrees for viewport bounds check (approx 11km at equator)
const VIEWPORT_PADDING = 0.1;

/**
 * Check if aircraft data has meaningfully changed (position, altitude, speed)
 * Used for differential updates to avoid reprocessing unchanged aircraft
 * @param {object} oldAc - Previous aircraft data
 * @param {object} newAc - New aircraft data
 * @returns {boolean} True if aircraft has changed enough to warrant update
 */
function hasAircraftChanged(oldAc, newAc) {
  if (!oldAc) return true;
  
  // Position change
  if (Math.abs((oldAc.lat || 0) - (newAc.lat || 0)) > POSITION_EPSILON) return true;
  if (Math.abs((oldAc.lon || 0) - (newAc.lon || 0)) > POSITION_EPSILON) return true;
  
  // Altitude change (>50ft is meaningful)
  const oldAlt = typeof oldAc.alt_baro === 'number' ? oldAc.alt_baro : 0;
  const newAlt = typeof newAc.alt_baro === 'number' ? newAc.alt_baro : 0;
  if (Math.abs(oldAlt - newAlt) > 50) return true;
  
  // Speed change (>5 knots is meaningful)
  if (Math.abs((oldAc.gs || 0) - (newAc.gs || 0)) > 5) return true;
  
  // Track/heading change (>2 degrees is meaningful)
  if (Math.abs((oldAc.track || 0) - (newAc.track || 0)) > 2) return true;
  
  // Squawk change (emergency detection)
  if (oldAc.squawk !== newAc.squawk) return true;
  
  return false;
}

/**
 * Check if a position is within viewport bounds (with optional padding)
 * @param {number} lat - Latitude
 * @param {number} lon - Longitude
 * @param {object} bounds - Viewport bounds { north, south, east, west }
 * @param {number} padding - Padding in degrees (default 0.1)
 * @returns {boolean} True if position is within padded bounds
 */
function isInViewport(lat, lon, bounds, padding = VIEWPORT_PADDING) {
  if (!bounds || lat == null || lon == null) return false;
  
  const { north, south, east, west } = bounds;
  
  // Add padding to bounds
  const paddedNorth = north + padding;
  const paddedSouth = south - padding;
  const paddedEast = east + padding;
  const paddedWest = west - padding;
  
  // Check latitude (simple comparison)
  if (lat < paddedSouth || lat > paddedNorth) return false;
  
  // Check longitude (handle wraparound at +/-180)
  if (paddedWest <= paddedEast) {
    // Normal case: bounds don't cross antimeridian
    return lon >= paddedWest && lon <= paddedEast;
  } else {
    // Bounds cross antimeridian
    return lon >= paddedWest || lon <= paddedEast;
  }
}

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

  // Current zoom level (updated by map component)
  currentZoom: 10,

  // Whether to track trails for all aircraft (based on zoom)
  trailsForAll: true,

  // Viewport bounds for trail culling { north, south, east, west }
  viewportBounds: null,

  // Actions
  setAircraft: (aircraftList) => {
    const { selectedAircraftId, trails, lastSeen, aircraft: existingAircraft, currentZoom, trailsForAll, viewportBounds } = get();
    const now = Date.now();
    const newMap = new Map();
    const newLastSeen = new Map(lastSeen);
    const activeHexes = new Set();

    // Determine if we should track trails for all aircraft (when zoomed in)
    const shouldTrackAll = trailsForAll && currentZoom >= TRAILS_MIN_ZOOM;

    // Start with cleaned trails
    const newTrails = new Map();

    // Keep track of how many trails we're tracking for performance
    let trailCount = 0;
    
    // Differential processing stats (for debugging)
    let unchanged = 0;
    let updated = 0;
    let newAircraft = 0;

    aircraftList.forEach((ac) => {
      if (ac.hex) {
        activeHexes.add(ac.hex);
        
        // Track when this aircraft was last seen
        newLastSeen.set(ac.hex, now);

        // Get existing aircraft data to preserve classification
        const existing = existingAircraft.get(ac.hex);
        
        // Check if aircraft has meaningfully changed (differential processing)
        const changed = hasAircraftChanged(existing, ac);
        
        let mergedAc;
        if (existing && !changed) {
          // Aircraft unchanged - reuse existing object entirely (best performance)
          mergedAc = existing;
          unchanged++;
        } else if (existing) {
          // Aircraft changed - merge new data but preserve classification
          mergedAc = { ...existing, ...ac };
          updated++;
        } else {
          // New aircraft - calculate classification
          mergedAc = ac;
          newAircraft++;
        }

        // Calculate classification data if not already cached
        if (!mergedAc._classification) {
          mergedAc._classification = classifyAircraft(mergedAc);
          mergedAc._iconType = getAircraftIconType(mergedAc);
          mergedAc._color = getAircraftColor(mergedAc);
        }

        newMap.set(ac.hex, mergedAc);

        // Determine if we should track trail for this aircraft
        // Always track selected, or track visible aircraft when zoomed in (up to performance limit)
        const isSelected = ac.hex === selectedAircraftId;
        const isInView = ac.lat && ac.lon && isInViewport(ac.lat, ac.lon, viewportBounds);
        const shouldTrackTrail = isSelected || 
          (shouldTrackAll && isInView && trailCount < MAX_TRAIL_AIRCRAFT);

        if (shouldTrackTrail && ac.lat && ac.lon) {
          const currentTrail = trails.get(ac.hex) || [];
          const lastPos = currentTrail[currentTrail.length - 1];

          // Use epsilon comparison for floating point (more reliable than direct comparison)
          // Also detect significant altitude changes (>100ft) for 3D trail accuracy
          const altChanged = !lastPos ||
            Math.abs((lastPos.alt || 0) - (ac.alt_baro || 0)) > 100;
          const hasChanged = !lastPos ||
            Math.abs(lastPos.lat - ac.lat) > POSITION_EPSILON ||
            Math.abs(lastPos.lon - ac.lon) > POSITION_EPSILON ||
            altChanged;

          if (hasChanged) {
            // Add new position with altitude for 3D trail rendering
            const updatedTrail = [
              ...currentTrail,
              {
                lat: ac.lat,
                lon: ac.lon,
                alt: ac.alt_baro || 0,  // Store altitude for 3D trails
                timestamp: now
              },
            ].slice(-TRAIL_CONFIG.maxPositions);

            // Filter out old trail points (older than 5 minutes)
            const recentTrail = updatedTrail.filter(p => now - p.timestamp < TRAIL_MAX_AGE_MS);

            if (recentTrail.length > 0) {
              newTrails.set(ac.hex, recentTrail);
              trailCount++;
            }
          } else {
            // Position hasn't changed, keep existing trail
            const existingTrail = trails.get(ac.hex);
            if (existingTrail && existingTrail.length > 0) {
              // Filter out old trail points
              const recentTrail = existingTrail.filter(p => now - p.timestamp < TRAIL_MAX_AGE_MS);
              if (recentTrail.length > 0) {
                newTrails.set(ac.hex, recentTrail);
                trailCount++;
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

      // Initialize new aircraft's trail with current position and altitude
      if (selectedAircraft && selectedAircraft.lat && selectedAircraft.lon) {
        newTrails.set(id, [
          {
            lat: selectedAircraft.lat,
            lon: selectedAircraft.lon,
            alt: selectedAircraft.alt_baro || 0,  // Include altitude for 3D trails
            timestamp: Date.now()
          },
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

    // Ensure altitude is included in trail points for 3D rendering
    const newTrail = [
      ...currentTrail,
      {
        lat: position.lat,
        lon: position.lon,
        alt: position.alt || 0,  // Include altitude for 3D trails
        timestamp: Date.now()
      },
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

  // Get all trails as an array of { hex, trail, color } for rendering
  getAllTrails: () => {
    const { trails, aircraft, selectedAircraftId } = get();
    const result = [];
    
    for (const [hex, trail] of trails.entries()) {
      if (trail.length >= 2) {
        const ac = aircraft.get(hex);
        result.push({
          hex,
          trail,
          color: ac?._color || '#9ca3af',
          isSelected: hex === selectedAircraftId,
        });
      }
    }
    
    // Sort so selected trail renders on top
    return result.sort((a, b) => (a.isSelected ? 1 : 0) - (b.isSelected ? 1 : 0));
  },

  // Get trails that intersect with the given viewport bounds
  // Returns array of { hex, trail, color, isSelected } for visible trails only
  getTrailsInBounds: (bounds) => {
    const { trails, aircraft, selectedAircraftId } = get();
    const result = [];
    
    if (!bounds) {
      // If no bounds provided, return all trails (fallback behavior)
      return get().getAllTrails();
    }
    
    for (const [hex, trail] of trails.entries()) {
      if (trail.length < 2) continue;
      
      const ac = aircraft.get(hex);
      const isSelected = hex === selectedAircraftId;
      
      // Always include selected aircraft trail
      if (isSelected) {
        result.push({
          hex,
          trail,
          color: ac?._color || '#9ca3af',
          isSelected: true,
        });
        continue;
      }
      
      // Check if any trail point is within the viewport bounds
      // Use a slightly larger padding for trail visibility
      const trailInView = trail.some(point => 
        isInViewport(point.lat, point.lon, bounds, VIEWPORT_PADDING * 2)
      );
      
      if (trailInView) {
        result.push({
          hex,
          trail,
          color: ac?._color || '#9ca3af',
          isSelected: false,
        });
      }
    }
    
    // Sort so selected trail renders on top
    return result.sort((a, b) => (a.isSelected ? 1 : 0) - (b.isSelected ? 1 : 0));
  },

  // Update current zoom level (called by map component)
  setCurrentZoom: (zoom) => {
    set({ currentZoom: zoom });
  },

  // Update viewport bounds for trail culling (called by map component)
  setViewportBounds: (bounds) => {
    set({ viewportBounds: bounds });
  },

  // Toggle trails for all aircraft
  setTrailsForAll: (enabled) => {
    set({ trailsForAll: enabled });
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
        
        // Keep trail if it exists and has recent points
        if (trails.has(hex)) {
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
