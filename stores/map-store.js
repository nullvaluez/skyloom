import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { MAP_CONFIG } from '@/lib/constants';

export const useMapStore = create(
  persist(
    (set, get) => ({
      // Map center coordinates [lat, lon]
      center: MAP_CONFIG.defaultCenter,

      // Map zoom level
      zoom: MAP_CONFIG.defaultZoom,

      // 3D camera pitch (tilt) in degrees (0-85)
      pitch: 0,

      // 3D camera bearing (rotation) in degrees (0-360)
      bearing: 0,

      // 3D terrain enabled
      terrain: true,

      // Map bounds (set by map component)
      bounds: null,

      // Map instance reference (for react-map-gl)
      mapRef: null,

      // Deck.gl instance reference
      deckRef: null,

      // User's geolocation
      userLocation: null,

      // Loading state for geolocation
      geolocating: false,

      // View state for Deck.gl (computed)
      getViewState: () => {
        const { center, zoom, pitch, bearing } = get();
        return {
          longitude: center[1],
          latitude: center[0],
          zoom,
          pitch,
          bearing,
        };
      },

      // Actions
      setCenter: (center) => {
        set({ center });
      },

      setZoom: (zoom) => {
        set({ zoom });
      },

      setPitch: (pitch) => {
        // Clamp pitch between 0 and 85 degrees
        set({ pitch: Math.max(0, Math.min(85, pitch)) });
      },

      setBearing: (bearing) => {
        // Normalize bearing to 0-360
        set({ bearing: ((bearing % 360) + 360) % 360 });
      },

      setView: (center, zoom) => {
        set({ center, zoom });
      },

      // Set full view state from Deck.gl onViewStateChange
      setViewState: (viewState) => {
        const updates = {};
        
        if (viewState.longitude !== undefined && viewState.latitude !== undefined) {
          updates.center = [viewState.latitude, viewState.longitude];
        }
        if (viewState.zoom !== undefined) {
          updates.zoom = viewState.zoom;
        }
        if (viewState.pitch !== undefined) {
          updates.pitch = Math.max(0, Math.min(85, viewState.pitch));
        }
        if (viewState.bearing !== undefined) {
          updates.bearing = ((viewState.bearing % 360) + 360) % 360;
        }
        
        set(updates);
      },

      setBounds: (bounds) => {
        set({ bounds });
      },

      setMapRef: (ref) => {
        set({ mapRef: ref });
      },

      setDeckRef: (ref) => {
        set({ deckRef: ref });
      },

      // Fly to location with animation (returns view state for Deck.gl)
      flyTo: (center, zoom, options = {}) => {
        const targetZoom = zoom || get().zoom;
        const targetPitch = options.pitch ?? get().pitch;
        const targetBearing = options.bearing ?? get().bearing;
        
        set({ 
          center, 
          zoom: targetZoom,
          pitch: targetPitch,
          bearing: targetBearing,
        });

        // Return transition config for Deck.gl
        return {
          longitude: center[1],
          latitude: center[0],
          zoom: targetZoom,
          pitch: targetPitch,
          bearing: targetBearing,
          transitionDuration: options.duration || 1500,
        };
      },

      // Pan to location (no zoom change)
      panTo: (center, options = {}) => {
        set({ center });
        
        return {
          longitude: center[1],
          latitude: center[0],
          zoom: get().zoom,
          pitch: get().pitch,
          bearing: get().bearing,
          transitionDuration: options.duration || 500,
        };
      },

      // Reset to default view
      resetView: () => {
        set({
          center: MAP_CONFIG.defaultCenter,
          zoom: MAP_CONFIG.defaultZoom,
          pitch: 0,
          bearing: 0,
        });

        return {
          longitude: MAP_CONFIG.defaultCenter[1],
          latitude: MAP_CONFIG.defaultCenter[0],
          zoom: MAP_CONFIG.defaultZoom,
          pitch: 0,
          bearing: 0,
          transitionDuration: 1500,
        };
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

      // Center on aircraft with optional 3D follow mode
      centerOnAircraft: (aircraft, enable3D = false) => {
        if (aircraft && aircraft.lat && aircraft.lon) {
          const options = enable3D 
            ? { pitch: 60, bearing: aircraft.track || 0, duration: 1000 }
            : {};
          return get().flyTo([aircraft.lat, aircraft.lon], 12, options);
        }
        return null;
      },

      // Enable 3D follow mode (tilted camera following aircraft heading)
      enable3DFollow: (aircraft) => {
        if (aircraft && aircraft.lat && aircraft.lon) {
          return get().flyTo(
            [aircraft.lat, aircraft.lon], 
            14, 
            { 
              pitch: 60, 
              bearing: aircraft.track || 0,
              duration: 1000,
            }
          );
        }
        return null;
      },

      // Disable 3D mode (return to flat view)
      disable3D: () => {
        const { center, zoom } = get();
        set({ pitch: 0, bearing: 0 });
        
        return {
          longitude: center[1],
          latitude: center[0],
          zoom,
          pitch: 0,
          bearing: 0,
          transitionDuration: 800,
        };
      },

      // Toggle terrain
      toggleTerrain: () => {
        set((state) => ({ terrain: !state.terrain }));
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
        pitch: state.pitch,
        bearing: state.bearing,
        terrain: state.terrain,
      }),
    }
  )
);
