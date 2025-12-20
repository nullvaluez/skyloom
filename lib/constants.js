// API Configuration
export const ADSB_BASE_URL = "https://api.adsb.lol/v2";
export const PLANESPOTTERS_URL = "https://api.planespotters.net/pub/photos/hex";

// Map Configuration
// Other major US cities:
// Los Angeles (LAX):    [33.95, -118.4]
// Chicago (ORD):        [41.98, -87.9]
// Atlanta (ATL):        [33.64, -84.43]
// Dallas/Fort Worth:    [32.9, -97.0]
// San Francisco (SFO):  [37.62, -122.38]
// Miami (MIA):          [25.79, -80.29]
// Seattle (SEA):        [47.45, -122.31]
export const MAP_CONFIG = {
  defaultCenter: [40.7, -74.0], // New York City metro area (JFK, LaGuardia, Newark)
  defaultZoom: 10, // Zoomed in to show NYC airspace
  minZoom: 2,
  maxZoom: 18,
  tileUrl: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
};

// Clustering Configuration
export const CLUSTER_CONFIG = {
  disableClusteringAtZoom: 10,
  maxClusterRadius: 80,
  animate: true,
  showCoverageOnHover: false,
  spiderfyOnMaxZoom: true,
  removeOutsideVisibleBounds: true,
  chunkedLoading: true,
};

// Aircraft icon sizes by zoom level
export const ICON_SIZES = {
  small: 24,   // Zoom < 7
  medium: 32,  // Zoom 7-10
  large: 40,   // Zoom > 10
};

// Aircraft type colors - optimized for visibility on dark map tiles
export const AIRCRAFT_COLORS = {
  commercial: "#4ade80",   // Brighter green
  cargo: "#fbbf24",        // Brighter amber
  military: "#f87171",     // Lighter red
  private: "#a78bfa",      // Lighter purple
  helicopter: "#22d3ee",   // Brighter cyan
  government: "#f472b6",   // Brighter pink
  special: "#fb923c",      // Brighter orange
  unknown: "#9ca3af",      // Lighter gray
  selected: "#60a5fa",     // Bright blue
  emergency: "#ff0000",    // Bright red
};

// Aircraft categories from ADS-B data
export const AIRCRAFT_CATEGORIES = {
  // Category Set A
  A0: "No info",
  A1: "Light (<15,500 lbs)",
  A2: "Small (15,500-75,000 lbs)",
  A3: "Large (75,000-300,000 lbs)",
  A4: "High vortex large",
  A5: "Heavy (>300,000 lbs)",
  A6: "High performance",
  A7: "Rotorcraft",

  // Category Set B
  B0: "No info",
  B1: "Glider/sailplane",
  B2: "Lighter than air",
  B3: "Parachutist",
  B4: "Ultralight",
  B5: "Reserved",
  B6: "UAV",
  B7: "Space vehicle",

  // Category Set C
  C0: "No info",
  C1: "Emergency vehicle",
  C2: "Service vehicle",
  C3: "Fixed obstruction",
  C4: "Cluster obstruction",
  C5: "Line obstruction",
  C6: "Reserved",
  C7: "Reserved",
};

// Database flags for aircraft
export const DB_FLAGS = {
  MILITARY: 1,
  INTERESTING: 2,
  PIA: 4,
  LADD: 8,
};

// Emergency squawk codes
export const EMERGENCY_SQUAWKS = ["7500", "7600", "7700"];

// Flight trail configuration
export const TRAIL_CONFIG = {
  maxPositions: 100,
  color: "#3b82f6",
  weight: 2,
  opacity: 0.7,
  dashArray: "5, 10",
  fadeTrail: true,
  fadeSteps: 5,
  positionInterval: 5000,
};

// Update intervals in milliseconds
export const UPDATE_INTERVALS = {
  aircraft: 5000,      // 5 seconds
  selectedAircraft: 2000, // 2 seconds for detailed view
  trails: 5000,        // 5 seconds for trail updates
};

// Default filter state
export const DEFAULT_FILTERS = {
  types: {
    commercial: true,
    cargo: true,
    military: true,
    private: true,
    helicopter: true,
    government: true,
    special: true,
    unknown: true,
  },
  altitude: { min: 0, max: 60000, enabled: false },
  speed: { min: 0, max: 700, enabled: false },
  status: { airborne: true, onGround: true },
  dataSource: { adsb: true, mlat: true, tisb: true },
  special: { emergency: true, military: false, interesting: false },
  search: { query: "", field: "all" },
};

// Aircraft type icons mapping
export const AIRCRAFT_ICONS = {
  airliner: "/icons/aircraft/airliner.svg",
  cargo: "/icons/aircraft/cargo.svg",
  helicopter: "/icons/aircraft/helicopter.svg",
  jet: "/icons/aircraft/jet.svg",
  military: "/icons/aircraft/military.svg",
  prop: "/icons/aircraft/prop.svg",
  unknown: "/icons/aircraft/unknown.svg",
};
