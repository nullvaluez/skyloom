import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { MAP_CONFIG } from '@/lib/constants';

export const useMapStore = create(
  persist(
    (set, get) => ({
      // Map center coordinates
      center: MAP_CONFIG.defaultCenter,

      // Map zoom level
      zoom: MAP_CONFIG.defaultZoom,

      // Map bounds (set by map component)
      bounds: null,

      // Map instance reference
      mapRef: null,

      // User's geolocation
      userLocation: null,

      // Loading state for geolocation
      geolocating: false,

      // Actions
      setCenter: (center) => {
        set({ center });
      },

      setZoom: (zoom) => {
        set({ zoom });
      },

      setView: (center, zoom) => {
        set({ center, zoom });
      },

      setBounds: (bounds) => {
        set({ bounds });
      },

      setMapRef: (ref) => {
        set({ mapRef: ref });
      },

      // Fly to location with animation
      flyTo: (center, zoom) => {
        const { mapRef } = get();
        if (mapRef) {
          mapRef.flyTo(center, zoom || get().zoom, {
            duration: 1.5,
          });
        }
        set({ center, zoom: zoom || get().zoom });
      },

      // Pan to location
      panTo: (center) => {
        const { mapRef } = get();
        if (mapRef) {
          mapRef.panTo(center);
        }
        set({ center });
      },

      // Reset to default view
      resetView: () => {
        const { mapRef } = get();
        if (mapRef) {
          mapRef.flyTo(MAP_CONFIG.defaultCenter, MAP_CONFIG.defaultZoom, {
            duration: 1.5,
          });
        }
        set({
          center: MAP_CONFIG.defaultCenter,
          zoom: MAP_CONFIG.defaultZoom,
        });
      },

      // Set user location from geolocation
      setUserLocation: (location) => {
        set({ userLocation: location, geolocating: false });
      },

      // Geolocate user and center map
      geolocate: () => {
        if (!navigator.geolocation) {
          console.warn('Geolocation not supported');
          return;
        }

        set({ geolocating: true });

        navigator.geolocation.getCurrentPosition(
          (position) => {
            const location = [position.coords.latitude, position.coords.longitude];
            set({ userLocation: location, geolocating: false });
            get().flyTo(location, 10);
          },
          (error) => {
            console.warn('Geolocation error:', error);
            set({ geolocating: false });
          },
          {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 60000,
          }
        );
      },

      // Center on aircraft
      centerOnAircraft: (aircraft) => {
        if (aircraft && aircraft.lat && aircraft.lon) {
          get().flyTo([aircraft.lat, aircraft.lon], 12);
        }
      },

      // Get icon size based on zoom level
      getIconSize: () => {
        const { zoom } = get();
        if (zoom < 7) return 24;
        if (zoom <= 10) return 32;
        return 40;
      },
    }),
    {
      name: 'skytracker-map',
      partialize: (state) => ({
        center: state.center,
        zoom: state.zoom,
      }),
    }
  )
);
