import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_FILTERS } from '@/lib/constants';

export const useFilterStore = create(
  persist(
    (set, get) => ({
      // Filter state
      filters: { ...DEFAULT_FILTERS },

      // Active filter count
      getActiveFilterCount: () => {
        const { filters } = get();
        let count = 0;

        // Count disabled aircraft types
        Object.values(filters.types).forEach((enabled) => {
          if (!enabled) count++;
        });

        // Count enabled range filters
        if (filters.altitude.enabled) count++;
        if (filters.speed.enabled) count++;

        // Count disabled status filters
        if (!filters.status.airborne) count++;
        if (!filters.status.onGround) count++;

        // Count disabled data sources
        Object.values(filters.dataSource).forEach((enabled) => {
          if (!enabled) count++;
        });

        // Count special filters
        if (filters.special.military) count++;
        if (filters.special.interesting) count++;

        // Count search
        if (filters.search.query) count++;

        return count;
      },

      // Set a specific filter
      setFilter: (key, value) => {
        set((state) => ({
          filters: {
            ...state.filters,
            [key]: value,
          },
        }));
      },

      // Toggle aircraft type
      toggleType: (type) => {
        set((state) => ({
          filters: {
            ...state.filters,
            types: {
              ...state.filters.types,
              [type]: !state.filters.types[type],
            },
          },
        }));
      },

      // Set altitude range
      setAltitudeRange: (min, max) => {
        set((state) => ({
          filters: {
            ...state.filters,
            altitude: {
              ...state.filters.altitude,
              min,
              max,
            },
          },
        }));
      },

      // Toggle altitude filter
      toggleAltitudeFilter: () => {
        set((state) => ({
          filters: {
            ...state.filters,
            altitude: {
              ...state.filters.altitude,
              enabled: !state.filters.altitude.enabled,
            },
          },
        }));
      },

      // Set speed range
      setSpeedRange: (min, max) => {
        set((state) => ({
          filters: {
            ...state.filters,
            speed: {
              ...state.filters.speed,
              min,
              max,
            },
          },
        }));
      },

      // Toggle speed filter
      toggleSpeedFilter: () => {
        set((state) => ({
          filters: {
            ...state.filters,
            speed: {
              ...state.filters.speed,
              enabled: !state.filters.speed.enabled,
            },
          },
        }));
      },

      // Toggle status filter
      toggleStatus: (status) => {
        set((state) => ({
          filters: {
            ...state.filters,
            status: {
              ...state.filters.status,
              [status]: !state.filters.status[status],
            },
          },
        }));
      },

      // Toggle data source
      toggleDataSource: (source) => {
        set((state) => ({
          filters: {
            ...state.filters,
            dataSource: {
              ...state.filters.dataSource,
              [source]: !state.filters.dataSource[source],
            },
          },
        }));
      },

      // Toggle special filter
      toggleSpecial: (special) => {
        set((state) => ({
          filters: {
            ...state.filters,
            special: {
              ...state.filters.special,
              [special]: !state.filters.special[special],
            },
          },
        }));
      },

      // Set search query
      setSearch: (query, field = 'all') => {
        set((state) => ({
          filters: {
            ...state.filters,
            search: { query, field },
          },
        }));
      },

      // Clear search
      clearSearch: () => {
        set((state) => ({
          filters: {
            ...state.filters,
            search: { query: '', field: 'all' },
          },
        }));
      },

      // Reset all filters
      resetFilters: () => {
        set({ filters: { ...DEFAULT_FILTERS } });
      },

      // Select all types
      selectAllTypes: () => {
        set((state) => ({
          filters: {
            ...state.filters,
            types: Object.keys(state.filters.types).reduce(
              (acc, key) => ({ ...acc, [key]: true }),
              {}
            ),
          },
        }));
      },

      // Deselect all types
      deselectAllTypes: () => {
        set((state) => ({
          filters: {
            ...state.filters,
            types: Object.keys(state.filters.types).reduce(
              (acc, key) => ({ ...acc, [key]: false }),
              {}
            ),
          },
        }));
      },
    }),
    {
      name: 'shadowadsb-filters',
      partialize: (state) => ({ filters: state.filters }),
    }
  )
);
