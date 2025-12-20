import { create } from 'zustand';
import { TRAIL_CONFIG } from '@/lib/constants';

export const useAircraftStore = create((set, get) => ({
  // Aircraft data as a Map for O(1) lookups
  aircraft: new Map(),

  // Selected aircraft hex
  selectedAircraftId: null,

  // Followed aircraft hex (map centers on this aircraft)
  followedAircraftId: null,

  // Flight trails as a Map of hex -> position array
  trails: new Map(),

  // Last update timestamp
  lastUpdate: null,

  // Actions
  setAircraft: (aircraftList) => {
    const { selectedAircraftId, trails } = get();
    const newMap = new Map();

    aircraftList.forEach((ac) => {
      if (ac.hex) {
        newMap.set(ac.hex, ac);

        // Update trail for selected aircraft
        if (ac.hex === selectedAircraftId && ac.lat && ac.lon) {
          const currentTrail = trails.get(ac.hex) || [];
          const lastPos = currentTrail[currentTrail.length - 1];

          // Only add if position has changed
          if (!lastPos || lastPos.lat !== ac.lat || lastPos.lon !== ac.lon) {
            const newTrail = [
              ...currentTrail,
              { lat: ac.lat, lon: ac.lon, timestamp: Date.now() },
            ].slice(-TRAIL_CONFIG.maxPositions);

            set((state) => ({
              trails: new Map(state.trails).set(ac.hex, newTrail),
            }));
          }
        }
      }
    });

    set({
      aircraft: newMap,
      lastUpdate: new Date(),
    });
  },

  selectAircraft: (id) => {
    const { trails, selectedAircraftId: previousId, followedAircraftId } = get();

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
      const aircraft = get().aircraft.get(id);
      const newTrails = new Map(trails);
      
      // Clear previous aircraft's trail
      if (previousId) {
        newTrails.delete(previousId);
      }
      
      // Initialize new aircraft's trail
      if (aircraft && aircraft.lat && aircraft.lon) {
        newTrails.set(id, [
          { lat: aircraft.lat, lon: aircraft.lon, timestamp: Date.now() },
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
}));
