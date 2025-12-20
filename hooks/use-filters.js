'use client';

import { useMemo, useCallback, useEffect } from 'react';
import { useFilterStore } from '@/stores/filter-store';
import { classifyAircraft, isEmergency, isOnGround, getDataSource, isMilitary, isSpecial } from '@/lib/classify';
import { useDevStore } from '@/stores/dev-store';

/**
 * Hook to filter aircraft based on current filter state
 */
export function useFilteredAircraft(aircraft) {
  const { filters } = useFilterStore();
  const setMetric = useDevStore(s => s.setMetric);

  const filteredAircraft = useMemo(() => {
    const start = performance.now();
    if (!aircraft || !Array.isArray(aircraft)) {
      return [];
    }

    const filtered = aircraft.filter((ac) => {
      // ... same logic ...
      // Check if any special filter is active
      const militaryFilterActive = filters.special.military;
      const interestingFilterActive = filters.special.interesting;
      const hasSpecialFilter = militaryFilterActive || interestingFilterActive;

      // If special filters are active, check if aircraft matches any of them
      if (hasSpecialFilter) {
        const matchesMilitary = militaryFilterActive && isMilitary(ac);
        const matchesInteresting = interestingFilterActive && isSpecial(ac);

        // If neither special filter matches, exclude the aircraft
        if (!matchesMilitary && !matchesInteresting) {
          return false;
        }
        // If it matches a special filter, skip the type filter (show all matching aircraft)
      } else {
        // No special filter active - apply normal type filter
        const type = ac._classification || classifyAircraft(ac);
        if (!filters.types[type] && type !== 'emergency') {
          return false;
        }
      }

      // Altitude filter
      if (filters.altitude.enabled) {
        const altitude = ac.alt_baro || ac.alt_geom || 0;
        if (altitude === 'ground') {
          if (filters.altitude.min > 0) return false;
        } else if (altitude < filters.altitude.min || altitude > filters.altitude.max) {
          return false;
        }
      }

      // Speed filter
      if (filters.speed.enabled) {
        const speed = ac.gs || 0;
        if (speed < filters.speed.min || speed > filters.speed.max) {
          return false;
        }
      }

      // Status filter (airborne/ground)
      const onGround = isOnGround(ac);
      if (onGround && !filters.status.onGround) {
        return false;
      }
      if (!onGround && !filters.status.airborne) {
        return false;
      }

      // Data source filter
      const dataSource = getDataSource(ac);
      if (!filters.dataSource[dataSource]) {
        return false;
      }

      // Search filter
      if (filters.search.query) {
        const query = filters.search.query.toLowerCase().trim();
        const field = filters.search.field;

        let matches = false;

        if (field === 'all' || field === 'callsign') {
          if (ac.flight && ac.flight.toLowerCase().includes(query)) {
            matches = true;
          }
        }

        if (field === 'all' || field === 'registration') {
          if (ac.r && ac.r.toLowerCase().includes(query)) {
            matches = true;
          }
        }

        if (field === 'all' || field === 'type') {
          if (ac.t && ac.t.toLowerCase().includes(query)) {
            matches = true;
          }
        }

        if (!matches) {
          return false;
        }
      }

      return true;
    });

    const end = performance.now();
    // Use setTimeout to avoid state updates during render
    setTimeout(() => {
      setMetric('filterTimeMs', end - start);
      setMetric('aircraftCount', aircraft.length);
      setMetric('filteredCount', filtered.length);
    }, 0);

    return filtered;
  }, [aircraft, filters, setMetric]);

  return filteredAircraft;
}

/**
 * Hook to get filter statistics
 */
export function useFilterStats(aircraft) {
  const filteredAircraft = useFilteredAircraft(aircraft);

  const stats = useMemo(() => {
    const byType = {
      commercial: 0,
      cargo: 0,
      military: 0,
      private: 0,
      helicopter: 0,
      government: 0,
      special: 0,
      unknown: 0,
    };

    let inEmergency = 0;
    let adsb = 0;
    let mlat = 0;

    filteredAircraft.forEach((ac) => {
      const type = ac._classification || classifyAircraft(ac);
      if (byType[type] !== undefined) {
        byType[type]++;
      }

      if (isEmergency(ac)) {
        inEmergency++;
      }

      const source = getDataSource(ac);
      if (source === 'adsb') adsb++;
      if (source === 'mlat') mlat++;
    });

    return {
      total: filteredAircraft.length,
      byType,
      inEmergency,
      dataSource: { adsb, mlat },
    };
  }, [filteredAircraft]);

  return stats;
}

/**
 * Hook to check if any filters are active
 */
export function useHasActiveFilters() {
  const { getActiveFilterCount } = useFilterStore();
  return getActiveFilterCount() > 0;
}
