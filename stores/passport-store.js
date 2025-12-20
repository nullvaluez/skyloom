import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { BADGES, checkBadgeUnlock } from '@/lib/badges';
import { calculateRarity } from '@/lib/rarity';

/**
 * Spotter's Passport Store
 * Gamification system for tracking spotted aircraft
 */
export const usePassportStore = create(
  persist(
    (set, get) => ({
      // Spotted aircraft log
      spottedAircraft: [], // { hex, flight, type, timestamp, rarity, location }
      
      // Earned badges
      badges: [], // { id, name, description, earnedAt }
      
      // Statistics
      stats: {
        totalSpotted: 0,
        uniqueTypes: new Set(),
        militaryCount: 0,
        emergencyCount: 0,
        helicopterCount: 0,
        rarestFind: null, // { hex, rarity, timestamp }
        firstSpotDate: null,
        lastSpotDate: null,
        spotsByType: {},
        spotsByDay: {}, // YYYY-MM-DD -> count
      },
      
      // Leaderboard cache
      weeklyRareFinds: [],
      
      /**
       * Log a spotted aircraft
       */
      logSpot: (aircraft) => {
        const { spottedAircraft, stats } = get();
        const now = Date.now();
        
        // Check if already spotted recently (within 1 hour)
        const recentSpot = spottedAircraft.find(
          spot => spot.hex === aircraft.hex && now - spot.timestamp < 3600000
        );
        if (recentSpot) return; // Don't log duplicate spots
        
        // Calculate rarity
        const rarity = calculateRarity(aircraft);
        
        // Create spot record
        const spot = {
          hex: aircraft.hex,
          flight: aircraft.flight?.trim() || null,
          registration: aircraft.r || null,
          type: aircraft.t || null,
          classification: aircraft._classification || 'unknown',
          timestamp: now,
          rarity,
          location: aircraft.lat && aircraft.lon ? { lat: aircraft.lat, lon: aircraft.lon } : null,
        };
        
        // Update stats
        const newStats = { ...stats };
        newStats.totalSpotted++;
        newStats.lastSpotDate = now;
        if (!newStats.firstSpotDate) newStats.firstSpotDate = now;
        
        // Track unique types
        if (aircraft.t) {
          const uniqueTypes = new Set(stats.uniqueTypes);
          uniqueTypes.add(aircraft.t);
          newStats.uniqueTypes = uniqueTypes;
        }
        
        // Track by classification
        if (aircraft._classification === 'military') newStats.militaryCount++;
        if (aircraft._classification === 'helicopter') newStats.helicopterCount++;
        if (aircraft._emergency) newStats.emergencyCount++;
        
        // Track by type
        const typeKey = aircraft._classification || 'unknown';
        newStats.spotsByType[typeKey] = (newStats.spotsByType[typeKey] || 0) + 1;
        
        // Track by day
        const dayKey = new Date(now).toISOString().split('T')[0];
        newStats.spotsByDay[dayKey] = (newStats.spotsByDay[dayKey] || 0) + 1;
        
        // Update rarest find
        if (!newStats.rarestFind || rarity > newStats.rarestFind.rarity) {
          newStats.rarestFind = { hex: aircraft.hex, rarity, timestamp: now };
        }
        
        // Add to spotted list (keep last 1000)
        const newSpottedAircraft = [spot, ...spottedAircraft].slice(0, 1000);
        
        set({
          spottedAircraft: newSpottedAircraft,
          stats: newStats,
        });
        
        // Check for new badges
        get().checkBadges(aircraft, spot);
        
        // Update weekly rare finds
        get().updateWeeklyRareFinds();
      },
      
      /**
       * Check and unlock badges based on the new spot
       */
      checkBadges: (aircraft, spot) => {
        const { badges, stats } = get();
        const earnedIds = new Set(badges.map(b => b.id));
        const newBadges = [];
        
        Object.entries(BADGES).forEach(([id, badge]) => {
          if (earnedIds.has(id)) return;
          
          const unlocked = checkBadgeUnlock(id, { aircraft, spot, stats, badges });
          if (unlocked) {
            newBadges.push({
              id,
              name: badge.name,
              description: badge.description,
              icon: badge.icon,
              earnedAt: Date.now(),
            });
          }
        });
        
        if (newBadges.length > 0) {
          set({ badges: [...badges, ...newBadges] });
        }
        
        return newBadges;
      },
      
      /**
       * Update weekly rare finds leaderboard
       */
      updateWeeklyRareFinds: () => {
        const { spottedAircraft } = get();
        const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
        
        const weeklyRareFinds = spottedAircraft
          .filter(spot => spot.timestamp > oneWeekAgo)
          .sort((a, b) => b.rarity - a.rarity)
          .slice(0, 10);
        
        set({ weeklyRareFinds });
      },
      
      /**
       * Get spots from today
       */
      getTodaySpots: () => {
        const { spottedAircraft } = get();
        const today = new Date().toISOString().split('T')[0];
        const startOfDay = new Date(today).getTime();
        
        return spottedAircraft.filter(spot => spot.timestamp >= startOfDay);
      },
      
      /**
       * Check if aircraft was already spotted
       */
      hasSpotted: (hex) => {
        const { spottedAircraft } = get();
        return spottedAircraft.some(spot => spot.hex === hex);
      },
      
      /**
       * Get progress towards next badge
       */
      getBadgeProgress: (badgeId) => {
        const { stats, badges } = get();
        const badge = BADGES[badgeId];
        if (!badge) return null;
        
        const earned = badges.some(b => b.id === badgeId);
        if (earned) return { progress: 1, target: 1, earned: true };
        
        // Calculate progress based on badge requirements
        switch (badgeId) {
          case 'first_spot':
            return { progress: stats.totalSpotted > 0 ? 1 : 0, target: 1 };
          case 'spotter_10':
            return { progress: Math.min(stats.totalSpotted, 10), target: 10 };
          case 'spotter_100':
            return { progress: Math.min(stats.totalSpotted, 100), target: 100 };
          case 'spotter_1000':
            return { progress: Math.min(stats.totalSpotted, 1000), target: 1000 };
          case 'military_hunter':
            return { progress: Math.min(stats.militaryCount, 10), target: 10 };
          case 'heli_spotter':
            return { progress: Math.min(stats.helicopterCount, 5), target: 5 };
          case 'emergency_witness':
            return { progress: Math.min(stats.emergencyCount, 1), target: 1 };
          default:
            return { progress: 0, target: 1 };
        }
      },
      
      /**
       * Clear all data (for testing/reset)
       */
      clearAll: () => {
        set({
          spottedAircraft: [],
          badges: [],
          stats: {
            totalSpotted: 0,
            uniqueTypes: new Set(),
            militaryCount: 0,
            emergencyCount: 0,
            helicopterCount: 0,
            rarestFind: null,
            firstSpotDate: null,
            lastSpotDate: null,
            spotsByType: {},
            spotsByDay: {},
          },
          weeklyRareFinds: [],
        });
      },
    }),
    {
      name: 'skytracker-passport',
      partialize: (state) => ({
        spottedAircraft: state.spottedAircraft,
        badges: state.badges,
        stats: {
          ...state.stats,
          uniqueTypes: Array.from(state.stats.uniqueTypes || []),
        },
        weeklyRareFinds: state.weeklyRareFinds,
      }),
      merge: (persistedState, currentState) => ({
        ...currentState,
        ...persistedState,
        stats: {
          ...currentState.stats,
          ...persistedState.stats,
          uniqueTypes: new Set(persistedState.stats?.uniqueTypes || []),
        },
      }),
    }
  )
);
