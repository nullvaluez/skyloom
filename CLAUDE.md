# Flight Tracker Application - Final Requirements Specification

## Executive Summary

A real-time aircraft tracking web application with a sleek dark theme, interactive map visualization, comprehensive filtering, aircraft clustering for performance, flight trails, and detailed aircraft information including photos.

---

## 1. Technology Stack

```yaml
# Core Framework
framework: Next.js 16.2+
language: TypeScript 5.x
runtime: Node.js 20+

# Styling & UI
css: Tailwind CSS 3.4+
components: shadcn/ui
icons: Lucide React
animations: Framer Motion

# Map & Visualization
map: react-leaflet 4.x + Leaflet 1.9.x
clustering: react-leaflet-cluster
tiles: CartoDB Dark Matter (free)
trails: Leaflet Polyline

# State Management
global_state: Zustand
server_state: TanStack Query (React Query) v5
url_state: nuqs (for shareable filter URLs)

# Data Fetching
http_client: Native fetch + Next.js caching
polling: TanStack Query refetchInterval

# External APIs
aircraft_data: adsb.lol API v2
aircraft_images: Planespotters.net API
aircraft_database: OpenSky Network (fallback metadata)

# Development
linting: ESLint + Prettier
testing: Vitest + Playwright
bundler: Turbopack (Next.js built-in)

# Deployment
platform: Vercel
edge_functions: Vercel Edge Runtime (optional)
analytics: Vercel Analytics
monitoring: Vercel Speed Insights
```

---

## 2. Data Sources & API Integration

### 2.1 Primary API: adsb.lol

```javascript
// Base URL
const ADSB_BASE_URL = "https://api.adsb.lol/v2";

// Endpoints to implement
interface AdsbEndpoints {
  // Get aircraft within radius of point
  byLocation: "/lat/{lat}/lon/{lon}/dist/{nauticalMiles}";
  
  // Get specific aircraft by ICAO hex
  byHex: "/hex/{icao24}";
  
  // Get all military aircraft globally
  military: "/mil";
  
  // Get by squawk code
  bySquawk: "/sqk/{squawk}";
  
  // Get by callsign
  byCallsign: "/callsign/{callsign}";
  
  // Get by registration
  byRegistration: "/reg/{registration}";
  
  // Get by aircraft type
  byType: "/type/{icaoType}";
  
  // PIA (Privacy ICAO Address) aircraft
  pia: "/pia";
  
  // LADD (Limiting Aircraft Data Displayed)
  ladd: "/ladd";
}

// Response structure
interface AdsbAircraft {
  hex: string;              // ICAO 24-bit address
  type: string;             // Message type
  flight?: string;          // Callsign
  r?: string;               // Registration
  t?: string;               // Aircraft type
  alt_baro?: number;        // Barometric altitude (ft)
  alt_geom?: number;        // Geometric altitude (ft)
  gs?: number;              // Ground speed (knots)
  track?: number;           // Track/heading (degrees)
  baro_rate?: number;       // Vertical rate (ft/min)
  squawk?: string;          // Squawk code
  emergency?: string;       // Emergency status
  category?: string;        // Aircraft category
  lat?: number;             // Latitude
  lon?: number;             // Longitude
  seen?: number;            // Seconds since last message
  seen_pos?: number;        // Seconds since last position
  messages?: number;        // Message count
  mlat?: string[];          // MLAT data sources
  tisb?: string[];          // TIS-B data sources
  dbFlags?: number;         // Database flags (military, etc.)
  nav_qnh?: number;         // Altimeter setting
  nav_altitude_mcp?: number; // Selected altitude
  nav_heading?: number;     // Selected heading
  nic?: number;             // Navigation Integrity Category
  rc?: number;              // Radius of containment
  version?: number;         // ADS-B version
}
```

### 2.2 Aircraft Images: Planespotters.net

```javascript
// API endpoint
const PLANESPOTTERS_URL = "https://api.planespotters.net/pub/photos/hex/{icao24}";

// Response structure
interface PlanespottersResponse {
  photos: Array<{
    id: string;
    thumbnail: {
      src: string;
      size: { width: number; height: number };
    };
    thumbnail_large: {
      src: string;
      size: { width: number; height: number };
    };
    link: string;
    photographer: string;
  }>;
}

// Usage notes:
// - Free API with reasonable rate limits
// - Returns empty array if no photos found
// - Use thumbnail_large for detail panel
// - Credit photographer when displaying
```

### 2.3 Aircraft Type Classification

```javascript
// Category codes from ADS-B data
const AIRCRAFT_CATEGORIES = {
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

// Military detection via dbFlags
const DB_FLAGS = {
  MILITARY: 1,
  INTERESTING: 2,
  PIA: 4,
  LADD: 8,
};
```

---

## 3. Feature Specifications

### 3.1 Interactive Map

| Feature | Specification |
|---------|---------------|
| **Map Provider** | CartoDB Dark Matter (no API key required) |
| **Tile URL** | `https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png` |
| **Initial View** | Center on user's geolocation or US center (39.8, -98.5) |
| **Zoom Range** | Min: 2, Max: 18, Default: 5 |
| **Interactions** | Scroll zoom, drag pan, double-click zoom, touch gestures |
| **Attribution** | CartoDB + OpenStreetMap (required) |

### 3.2 Aircraft Clustering

```javascript
// Clustering configuration
const CLUSTER_CONFIG = {
  // Disable clustering above this zoom level
  disableClusteringAtZoom: 10,
  
  // Cluster radius in pixels
  maxClusterRadius: 80,
  
  // Animate cluster splits
  animate: true,
  
  // Show coverage bounds on hover
  showCoverageOnHover: false,
  
  // Spiderfy clusters on click
  spiderfyOnMaxZoom: true,
  
  // Remove outside markers from DOM
  removeOutsideVisibleBounds: true,
  
  // Chunked loading for performance
  chunkedLoading: true,
  
  // Custom icon function
  iconCreateFunction: (cluster) => {
    const count = cluster.getChildCount();
    const size = count < 10 ? 'small' : count < 100 ? 'medium' : 'large';
    return createClusterIcon(count, size);
  },
};
```

### 3.3 Aircraft Markers

```javascript
// Aircraft icon specifications
interface AircraftMarkerConfig {
  // Icon sizes (pixels)
  sizes: {
    small: 24,    // Zoom < 7
    medium: 32,   // Zoom 7-10
    large: 40,    // Zoom > 10
  };
  
  // Colors by aircraft classification
  colors: {
    commercial: "#22c55e",   // Green
    cargo: "#f59e0b",        // Amber
    military: "#ef4444",     // Red
    private: "#8b5cf6",      // Purple
    helicopter: "#06b6d4",   // Cyan
    government: "#ec4899",   // Pink
    special: "#f97316",      // Orange
    unknown: "#6b7280",      // Gray
    selected: "#3b82f6",     // Blue (override)
  };
  
  // Emergency state (pulsing)
  emergency: {
    color: "#ff0000",
    pulse: true,
    pulseInterval: 500, // ms
  };
}

// Icon rotation
// Rotate icon SVG to match aircraft track/heading
// Use CSS transform: rotate({track}deg)
```

### 3.4 Flight Trails

```javascript
interface FlightTrailConfig {
  // Store last N positions
  maxPositions: 100;
  
  // Polyline style
  style: {
    color: "#3b82f6",     // Blue to match selection
    weight: 2,
    opacity: 0.7,
    dashArray: "5, 10",   // Dashed line
  };
  
  // Gradient opacity (newer = more opaque)
  fadeTrail: true;
  fadeSteps: 5;
  
  // Update frequency
  positionInterval: 5000; // 5 seconds
  
  // Only show for selected aircraft (performance)
  showOnlySelected: true;
}
```

### 3.5 Filter System

```javascript
interface FilterState {
  // Aircraft type filters (multi-select)
  types: {
    commercial: boolean;
    cargo: boolean;
    military: boolean;
    private: boolean;
    helicopter: boolean;
    government: boolean;
    special: boolean;
    unknown: boolean;
  };
  
  // Altitude range filter
  altitude: {
    min: number;      // feet
    max: number;      // feet
    enabled: boolean;
  };
  
  // Speed filter
  speed: {
    min: number;      // knots
    max: number;      // knots
    enabled: boolean;
  };
  
  // Status filters
  status: {
    airborne: boolean;
    onGround: boolean;
  };
  
  // Data source filters
  dataSource: {
    adsb: boolean;
    mlat: boolean;
    tisb: boolean;
  };
  
  // Special filters
  special: {
    emergency: boolean;      // Squawk 7500/7600/7700
    military: boolean;       // Military aircraft only
    interesting: boolean;    // Flagged as interesting
  };
  
  // Search/text filter
  search: {
    query: string;
    field: "callsign" | "registration" | "type" | "all";
  };
}

// Default filter state
const DEFAULT_FILTERS: FilterState = {
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
```

### 3.6 Detail Panel

```
┌─────────────────────────────────────────────────┐
│ ╳ Close                                         │
├─────────────────────────────────────────────────┤
│                                                 │
│  ┌─────────────────────────────────────────┐   │
│  │                                         │   │
│  │          [Aircraft Photo]               │   │
│  │          from Planespotters             │   │
│  │                                         │   │
│  │  📷 Photo by: John Doe                  │   │
│  └─────────────────────────────────────────┘   │
│                                                 │
│  ✈ UAL1234                    🔴 MILITARY      │
│  United Airlines Flight 1234                    │
│                                                 │
├─────────────────────────────────────────────────┤
│  AIRCRAFT                                       │
│  ───────────────────────────────────────────── │
│  Type:          Boeing 737-900ER (B739)        │
│  Registration:  N12345                          │
│  ICAO:          A1B2C3                          │
│  Country:       🇺🇸 United States              │
│                                                 │
├─────────────────────────────────────────────────┤
│  FLIGHT DATA                                    │
│  ───────────────────────────────────────────── │
│                                                 │
│  Altitude     ████████████░░░  35,025 ft       │
│  Speed        ██████████░░░░░  462 kts         │
│  Heading      087° →                            │
│  Vert Rate    ↗ +1,250 ft/min                  │
│  Squawk       1234                              │
│                                                 │
├─────────────────────────────────────────────────┤
│  POSITION                                       │
│  ───────────────────────────────────────────── │
│  Latitude:    40.7128° N                        │
│  Longitude:   -74.0060° W                       │
│  Track:       087°                              │
│                                                 │
├─────────────────────────────────────────────────┤
│  DATA SOURCE                                    │
│  ───────────────────────────────────────────── │
│  Source:      ADS-B                             │
│  Messages:    1,234                             │
│  Last Seen:   2s ago                            │
│                                                 │
├─────────────────────────────────────────────────┤
│                                                 │
│  [🎯 Follow Aircraft]  [📋 Copy Info]  [↗ Share]│
│                                                 │
└─────────────────────────────────────────────────┘
```

### 3.7 Statistics Bar

```javascript
interface StatsBarData {
  totalAircraft: number;
  byType: {
    commercial: number;
    cargo: number;
    military: number;
    private: number;
    helicopter: number;
    other: number;
  };
  inEmergency: number;
  dataSource: {
    adsb: number;
    mlat: number;
  };
  lastUpdate: Date;
}

// Display format (bottom of screen)
// ✈ 12,456 aircraft | 🛫 Commercial: 8,234 | 📦 Cargo: 1,456 | 🎖 Military: 234 | 🚁 Heli: 567 | ⚠️ Emergency: 2 | Updated: 2s ago
```

---

## 4. UI/UX Specifications

### 4.1 Design Tokens

```css
:root {
  /* Background colors */
  --bg-primary: #09090b;      /* Main background */
  --bg-secondary: #0f0f13;    /* Cards, panels */
  --bg-tertiary: #18181b;     /* Elevated surfaces */
  --bg-hover: #27272a;        /* Hover states */
  
  /* Border colors */
  --border-primary: #27272a;
  --border-secondary: #3f3f46;
  --border-focus: #3b82f6;
  
  /* Text colors */
  --text-primary: #fafafa;
  --text-secondary: #a1a1aa;
  --text-muted: #71717a;
  --text-inverse: #09090b;
  
  /* Accent colors */
  --accent-blue: #3b82f6;
  --accent-blue-hover: #2563eb;
  --accent-green: #22c55e;
  --accent-amber: #f59e0b;
  --accent-red: #ef4444;
  --accent-purple: #8b5cf6;
  --accent-cyan: #06b6d4;
  --accent-pink: #ec4899;
  
  /* Aircraft type colors */
  --aircraft-commercial: #22c55e;
  --aircraft-cargo: #f59e0b;
  --aircraft-military: #ef4444;
  --aircraft-private: #8b5cf6;
  --aircraft-helicopter: #06b6d4;
  --aircraft-government: #ec4899;
  --aircraft-special: #f97316;
  --aircraft-unknown: #6b7280;
  --aircraft-emergency: #ff0000;
  
  /* Shadows */
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.5);
  --shadow-md: 0 4px 6px rgba(0, 0, 0, 0.5);
  --shadow-lg: 0 10px 15px rgba(0, 0, 0, 0.5);
  --shadow-glow: 0 0 20px rgba(59, 130, 246, 0.3);
  
  /* Spacing */
  --spacing-xs: 0.25rem;
  --spacing-sm: 0.5rem;
  --spacing-md: 1rem;
  --spacing-lg: 1.5rem;
  --spacing-xl: 2rem;
  
  /* Border radius */
  --radius-sm: 0.25rem;
  --radius-md: 0.5rem;
  --radius-lg: 0.75rem;
  --radius-xl: 1rem;
  
  /* Transitions */
  --transition-fast: 150ms ease;
  --transition-normal: 250ms ease;
  --transition-slow: 350ms ease;
  
  /* Z-index layers */
  --z-map: 1;
  --z-controls: 100;
  --z-panel: 200;
  --z-modal: 300;
  --z-toast: 400;
}
```

### 4.2 Layout Structure

```
┌────────────────────────────────────────────────────────────────────────────┐
│                               HEADER (h-14)                                │
│  [Logo] SkyTracker         [🔍 Search...]        [Filters ▾]    [⚙]       │
├────────────────┬───────────────────────────────────────────────────────────┤
│                │                                                           │
│   FILTER       │                                                           │
│   SIDEBAR      │                                                           │
│   (w-72)       │                        MAP AREA                           │
│                │                      (flex-1)                             │
│   - Types      │                                                           │
│   - Altitude   │                                                           │
│   - Speed      │                                                           │
│   - Status     │                                                           │
│   - Data Src   │                                                           │
│   - Special    │                                                           │
│                │                                                           │
│                │                                                           │
│                │                                                           │
│                ├───────────────────────────────────────────────────────────┤
│                │                    STATS BAR (h-10)                       │
│                │  ✈ 12,456 | Commercial: 8,234 | Military: 234 | ...      │
└────────────────┴───────────────────────────────────────────────────────────┘

                 ┌───────────────────────────────────────────────────────────┐
                 │                                                           │
                 │                   DETAIL PANEL                            │
                 │                   (Slide-in from right)                   │
                 │                   (w-96)                                  │
                 │                                                           │
                 │                   - Aircraft photo                        │
                 │                   - Flight info                           │
                 │                   - Position data                         │
                 │                   - Actions                               │
                 │                                                           │
                 └───────────────────────────────────────────────────────────┘
```

### 4.3 Responsive Breakpoints

```javascript
const breakpoints = {
  sm: "640px",   // Mobile landscape
  md: "768px",   // Tablet
  lg: "1024px",  // Laptop
  xl: "1280px",  // Desktop
  "2xl": "1536px", // Large desktop
};

// Layout behavior per breakpoint
const layoutBehavior = {
  mobile: {
    // < 768px
    sidebar: "hidden", // Bottom sheet instead
    detailPanel: "full-screen overlay",
    statsBar: "simplified",
    headerSearch: "icon only, expands on click",
  },
  tablet: {
    // 768px - 1024px
    sidebar: "collapsible drawer",
    detailPanel: "slide-in, 50% width",
    statsBar: "full",
    headerSearch: "visible",
  },
  desktop: {
    // > 1024px
    sidebar: "always visible",
    detailPanel: "slide-in, fixed width",
    statsBar: "full",
    headerSearch: "expanded",
  },
};
```

### 4.4 Component Specifications

#### Header

```javascript
interface HeaderProps {
  logo: ReactNode;
  search: {
    placeholder: "Search callsign, registration, type...";
    debounceMs: 300;
    showRecent: true;
    maxRecent: 5;
  };
  filterToggle: {
    showCount: true; // Number of active filters
    mobileOnly: true;
  };
  settingsMenu: {
    items: [
      "Map style",
      "Units (metric/imperial)",
      "Update interval",
      "About",
    ];
  };
}
```

#### Filter Panel

```javascript
interface FilterPanelProps {
  sections: [
    {
      title: "Aircraft Type";
      type: "checkbox-group";
      options: AircraftType[];
      showCounts: true; // Number of each type visible
    },
    {
      title: "Altitude";
      type: "range-slider";
      min: 0;
      max: 60000;
      step: 1000;
      unit: "ft";
    },
    {
      title: "Speed";
      type: "range-slider";
      min: 0;
      max: 700;
      step: 50;
      unit: "kts";
    },
    {
      title: "Status";
      type: "checkbox-group";
      options: ["Airborne", "On Ground"];
    },
    {
      title: "Data Source";
      type: "checkbox-group";
      options: ["ADS-B", "MLAT", "TIS-B"];
    },
    {
      title: "Special";
      type: "checkbox-group";
      options: ["Emergency", "Military Only", "Interesting"];
    },
  ];
  footer: {
    resetButton: true;
    activeCount: true;
  };
}
```

#### Map Controls

```javascript
// Overlay controls on map
interface MapControls {
  position: "top-right" | "bottom-right";
  controls: [
    {
      type: "zoom";
      buttons: ["+", "-"];
    },
    {
      type: "geolocate";
      icon: "crosshairs";
      tooltip: "Center on my location";
    },
    {
      type: "fullscreen";
      icon: "expand";
    },
    {
      type: "recenter";
      icon: "home";
      tooltip: "Reset view";
    },
  ];
}
```

---

## 5. State Management

### 5.1 Global State (Zustand)

```javascript
// stores/aircraft-store.js
interface AircraftStore {
  // Aircraft data
  aircraft: Map<string, Aircraft>;
  selectedAircraftId: string | null;
  followedAircraftId: string | null;
  
  // Trail data
  trails: Map<string, Position[]>;
  
  // Actions
  setAircraft: (aircraft: Aircraft[]) => void;
  selectAircraft: (id: string | null) => void;
  followAircraft: (id: string | null) => void;
  updateTrail: (id: string, position: Position) => void;
  clearTrails: () => void;
}

// stores/filter-store.js
interface FilterStore {
  filters: FilterState;
  
  // Actions
  setFilter: <K extends keyof FilterState>(
    key: K,
    value: FilterState[K]
  ) => void;
  resetFilters: () => void;
  loadPreset: (preset: FilterPreset) => void;
}

// stores/map-store.js
interface MapStore {
  center: [number, number];
  zoom: number;
  bounds: LatLngBounds | null;
  
  // Actions
  setView: (center: [number, number], zoom: number) => void;
  setBounds: (bounds: LatLngBounds) => void;
  flyTo: (center: [number, number], zoom?: number) => void;
}

// stores/ui-store.js
interface UIStore {
  sidebarOpen: boolean;
  detailPanelOpen: boolean;
  settingsOpen: boolean;
  
  // Actions
  toggleSidebar: () => void;
  toggleDetailPanel: () => void;
  toggleSettings: () => void;
}
```

### 5.2 Server State (TanStack Query)

```javascript
// hooks/use-aircraft.js
function useAircraft(bounds: LatLngBounds) {
  return useQuery({
    queryKey: ["aircraft", bounds.toBBoxString()],
    queryFn: () => fetchAircraftInBounds(bounds),
    refetchInterval: 5000, // 5 second updates
    staleTime: 2000,
    gcTime: 30000,
  });
}

// hooks/use-military.js
function useMilitaryAircraft() {
  return useQuery({
    queryKey: ["military"],
    queryFn: fetchMilitaryAircraft,
    refetchInterval: 5000,
    staleTime: 2000,
  });
}

// hooks/use-aircraft-photo.js
function useAircraftPhoto(icao: string) {
  return useQuery({
    queryKey: ["photo", icao],
    queryFn: () => fetchAircraftPhoto(icao),
    staleTime: Infinity, // Photos don't change
    gcTime: 1000 * 60 * 60, // Cache for 1 hour
    enabled: !!icao,
  });
}

// hooks/use-aircraft-details.js
function useAircraftDetails(icao: string) {
  return useQuery({
    queryKey: ["aircraft", icao],
    queryFn: () => fetchAircraftByHex(icao),
    refetchInterval: 2000, // Faster updates for selected aircraft
    enabled: !!icao,
  });
}
```

---

## 6. API Routes

### 6.1 Route Definitions

```javascript
// app/api/aircraft/route.js
// GET /api/aircraft?lat={lat}&lon={lon}&dist={nm}
// Returns aircraft within distance of point

// app/api/aircraft/[hex]/route.js
// GET /api/aircraft/{hex}
// Returns specific aircraft details

// app/api/aircraft/military/route.js
// GET /api/aircraft/military
// Returns all military aircraft

// app/api/aircraft/search/route.js
// GET /api/aircraft/search?q={query}&field={field}
// Search aircraft by various fields

// app/api/aircraft/[hex]/photo/route.js
// GET /api/aircraft/{hex}/photo
// Proxies Planespotters API to avoid CORS
```

### 6.2 Caching Strategy

```javascript
// app/api/aircraft/route.js
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const lat = searchParams.get("lat");
  const lon = searchParams.get("lon");
  const dist = searchParams.get("dist") || "250";
  
  const response = await fetch(
    `https://api.adsb.lol/v2/lat/${lat}/lon/${lon}/dist/${dist}`,
    {
      next: {
        revalidate: 3, // Cache for 3 seconds
      },
    }
  );
  
  const data = await response.json();
  
  return Response.json(data, {
    headers: {
      "Cache-Control": "public, s-maxage=3, stale-while-revalidate=10",
    },
  });
}
```

---

## 7. File Structure

```
flight-tracker/
├── app/
│   ├── layout.jsx              # Root layout with providers
│   ├── page.jsx                # Main map page
│   ├── loading.jsx             # Loading skeleton
│   ├── error.jsx               # Error boundary
│   ├── globals.css             # Global styles + Tailwind
│   └── api/
│       └── aircraft/
│           ├── route.js        # GET aircraft by location
│           ├── military/
│           │   └── route.js    # GET military aircraft
│           ├── search/
│           │   └── route.js    # GET search results
│           └── [hex]/
│               ├── route.js    # GET aircraft by hex
│               └── photo/
│                   └── route.js # GET aircraft photo
│
├── components/
│   ├── layout/
│   │   ├── Header.jsx
│   │   ├── Sidebar.jsx
│   │   ├── StatsBar.jsx
│   │   └── MobileNav.jsx
│   │
│   ├── map/
│   │   ├── FlightMap.jsx       # Main map container
│   │   ├── MapProvider.jsx     # Map context provider
│   │   ├── AircraftLayer.jsx   # Aircraft markers layer
│   │   ├── AircraftMarker.jsx  # Individual aircraft marker
│   │   ├── AircraftCluster.jsx # Cluster icon component
│   │   ├── FlightTrail.jsx     # Trail polyline
│   │   ├── MapControls.jsx     # Zoom, geolocate, etc.
│   │   └── MapAttribution.jsx  # Attribution overlay
│   │
│   ├── panels/
│   │   ├── FilterPanel.jsx     # Main filter sidebar
│   │   ├── FilterSection.jsx   # Individual filter group
│   │   ├── DetailPanel.jsx     # Aircraft detail slide-out
│   │   ├── AircraftPhoto.jsx   # Photo with loading state
│   │   └── FlightInfo.jsx      # Flight data display
│   │
│   ├── search/
│   │   ├── SearchBar.jsx
│   │   ├── SearchResults.jsx
│   │   └── RecentSearches.jsx
│   │
│   ├── aircraft/
│   │   ├── AircraftIcon.jsx    # SVG icon component
│   │   ├── AircraftCard.jsx    # Compact aircraft info
│   │   ├── AircraftBadge.jsx   # Type badge (military, etc.)
│   │   └── EmergencyIndicator.jsx
│   │
│   └── ui/                     # shadcn/ui components
│       ├── button.jsx
│       ├── checkbox.jsx
│       ├── slider.jsx
│       ├── sheet.jsx
│       ├── tooltip.jsx
│       ├── skeleton.jsx
│       ├── badge.jsx
│       ├── input.jsx
│       ├── command.jsx         # For search
│       ├── scroll-area.jsx
│       └── separator.jsx
│
├── hooks/
│   ├── use-aircraft.js         # Aircraft data fetching
│   ├── use-aircraft-photo.js   # Photo fetching
│   ├── use-map-bounds.js       # Track visible bounds
│   ├── use-geolocation.js      # User location
│   ├── use-filters.js          # Filter state helpers
│   ├── use-debounce.js         # Debounce utility
│   ├── use-local-storage.js    # Persist preferences
│   └── use-media-query.js      # Responsive helpers
│
├── stores/
│   ├── aircraft-store.js       # Aircraft state
│   ├── filter-store.js         # Filter state
│   ├── map-store.js            # Map view state
│   └── ui-store.js             # UI state
│
├── lib/
│   ├── api.js                  # API client functions
│   ├── utils.js                # General utilities
│   ├── aircraft-utils.js       # Aircraft-specific helpers
│   ├── format.js               # Number/date formatting
│   ├── classify.js             # Aircraft classification
│   ├── constants.js            # App constants
│   └── cn.js                   # Class name utility
│
├── types/
│   ├── aircraft.js             # Aircraft types
│   ├── api.js                  # API response types
│   ├── filters.js              # Filter types
│   └── map.js                  # Map-related types
│
├── config/
│   ├── map.js                  # Map configuration
│   ├── filters.js              # Default filters
│   └── site.js                 # Site metadata
│
├── public/
│   ├── icons/
│   │   ├── aircraft/           # Aircraft type SVGs
│   │   │   ├── airliner.svg
│   │   │   ├── cargo.svg
│   │   │   ├── helicopter.svg
│   │   │   ├── jet.svg
│   │   │   ├── military.svg
│   │   │   ├── prop.svg
│   │   │   └── unknown.svg
│   │   └── app/
│   │       ├── favicon.ico
│   │       ├── apple-touch-icon.png
│   │       └── og-image.png
│   └── placeholder-aircraft.jpg
│
├── .env.local                  # Environment variables
├── .env.example                # Example env file
├── next.config.js              # Next.js configuration
├── tailwind.config.js          # Tailwind configuration
├── tsconfig.json               # TypeScript configuration
├── package.json
└── README.md
```

---

## 8. Performance Requirements

### 8.1 Metrics Targets

| Metric | Target | Tool |
|--------|--------|------|
| First Contentful Paint (FCP) | < 1.2s | Lighthouse |
| Largest Contentful Paint (LCP) | < 2.0s | Lighthouse |
| Time to Interactive (TTI) | < 3.0s | Lighthouse |
| Cumulative Layout Shift (CLS) | < 0.1 | Lighthouse |
| First Input Delay (FID) | < 100ms | Web Vitals |
| Map Frame Rate | 60 FPS | Chrome DevTools |
| Aircraft Render Time | < 50ms for 5,000 aircraft | Performance API |
| Memory Usage | < 200MB | Chrome DevTools |
| Bundle Size (gzip) | < 400KB initial | Bundle analyzer |

### 8.2 Optimization Strategies

```javascript
// 1. Aircraft data optimization
const optimizations = {
  // Only fetch aircraft in viewport
  viewportFetching: true,
  
  // Cluster at low zoom levels
  clustering: {
    enabled: true,
    disableAtZoom: 10,
  },
  
  // Debounce map movement before fetching
  fetchDebounce: 300, // ms
  
  // Limit concurrent API requests
  maxConcurrent: 3,
  
  // Use Web Workers for data processing
  webWorkers: {
    enabled: true,
    tasks: ["filterAircraft", "calculateTrails", "classifyAircraft"],
  },
  
  // Canvas rendering for markers (instead of DOM)
  canvasMarkers: {
    enabled: true,
    threshold: 500, // Use canvas above this count
  },
};

// 2. React optimizations
const reactOptimizations = {
  // Virtualize aircraft list
  virtualList: true,
  
  // Memoize expensive components
  memoization: ["AircraftMarker", "FilterPanel", "StatsBar"],
  
  // Use transitions for non-urgent updates
  useTransition: ["filterChange", "searchResults"],
  
  // Lazy load panels
  lazyLoad: ["DetailPanel", "SettingsModal"],
};

// 3. Map optimizations
const mapOptimizations = {
  // Prefer canvas over SVG
  preferCanvas: true,
  
  // Remove markers outside viewport
  removeOutsideViewport: true,
  
  // Throttle position updates
  updateThrottle: 100, // ms
  
  // Use requestAnimationFrame for animations
  useRAF: true,
};
```

---

## 9. Deployment Configuration

### 9.1 Vercel Configuration

```json
// vercel.json
{
  "framework": "nextjs",
  "regions": ["iad1"],  // US East for proximity to adsb.lol
  "functions": {
    "app/api/**/*": {
      "maxDuration": 10
    }
  },
  "headers": [
    {
      "source": "/api/(.*)",
      "headers": [
        {
          "key": "Cache-Control",
          "value": "public, s-maxage=3, stale-while-revalidate=10"
        }
      ]
    },
    {
      "source": "/(.*)",
      "headers": [
        {
          "key": "X-Content-Type-Options",
          "value": "nosniff"
        },
        {
          "key": "X-Frame-Options",
          "value": "DENY"
        },
        {
          "key": "X-XSS-Protection",
          "value": "1; mode=block"
        }
      ]
    }
  ]
}
```

### 9.2 Environment Variables

```bash
# .env.example

# API Configuration (optional, for rate limiting bypass)
ADSB_API_KEY=

# Planespotters API (if required)
PLANESPOTTERS_API_KEY=

# Map Configuration
NEXT_PUBLIC_MAP_CENTER_LAT=39.8
NEXT_PUBLIC_MAP_CENTER_LON=-98.5
NEXT_PUBLIC_MAP_DEFAULT_ZOOM=5

# Feature Flags
NEXT_PUBLIC_ENABLE_TRAILS=true
NEXT_PUBLIC_ENABLE_CLUSTERING=true
NEXT_PUBLIC_UPDATE_INTERVAL=5000

# Analytics (optional)
NEXT_PUBLIC_VERCEL_ANALYTICS=true

# Development
NEXT_PUBLIC_DEBUG_MODE=false
```

### 9.3 Next.js Configuration

```javascript
// next.config.js
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'cdn.planespotters.net',
        pathname: '/photos/**',
      },
      {
        protocol: 'https',
        hostname: '*.planespotters.net',
        pathname: '/**',
      },
    ],
    formats: ['image/avif', 'image/webp'],
  },
  
  experimental: {
    optimizePackageImports: ['lucide-react', '@radix-ui/react-icons'],
  },
  
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Permissions-Policy',
            value: 'geolocation=(self)',
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
```

---

## 10. Testing Requirements

### 10.1 Test Coverage

```javascript
// Unit Tests (Vitest)
const unitTests = {
  coverage: {
    target: "80%",
    include: ["lib/**", "hooks/**", "stores/**"],
  },
  tests: [
    "Aircraft classification logic",
    "Filter application",
    "Data transformation",
    "Utility functions",
    "Custom hooks",
    "Store actions",
  ],
};

// Integration Tests (Vitest + React Testing Library)
const integrationTests = {
  tests: [
    "Filter panel updates map display",
    "Search returns correct results",
    "Detail panel displays correct data",
    "Clustering works at different zoom levels",
  ],
};

// E2E Tests (Playwright)
const e2eTests = {
  tests: [
    "Full user flow: Load → Filter → Select → View Details",
    "Mobile responsive behavior",
    "Map interaction (zoom, pan, click)",
    "Real-time updates work correctly",
  ],
};
```

---

## 11. Accessibility Requirements

```javascript
const a11yRequirements = {
  // WCAG 2.1 AA compliance
  wcag: "2.1 AA",
  
  requirements: [
    // Keyboard navigation
    "Full keyboard navigation for all interactive elements",
    "Focus indicators visible on all focusable elements",
    "Skip link to main content",
    "Escape key closes modals/panels",
    
    // Screen readers
    "All images have alt text",
    "ARIA labels on icon-only buttons",
    "Live regions for real-time updates",
    "Semantic HTML structure",
    
    // Visual
    "Minimum 4.5:1 contrast ratio for text",
    "Minimum 3:1 contrast ratio for UI elements",
    "No information conveyed by color alone",
    "Text remains readable at 200% zoom",
    
    // Motion
    "Respect prefers-reduced-motion",
    "No flashing content",
    
    // Forms
    "Labels associated with form controls",
    "Error messages linked to inputs",
    "Clear focus states",
  ],
};
```

---

## 12. Security Requirements

```javascript
const securityRequirements = {
  // API Security
  api: [
    "Rate limiting on all API routes",
    "Input validation and sanitization",
    "No sensitive data in client-side code",
    "Proxy external APIs to prevent CORS issues",
  ],
  
  // Headers
  headers: [
    "Content-Security-Policy",
    "X-Content-Type-Options: nosniff",
    "X-Frame-Options: DENY",
    "X-XSS-Protection: 1; mode=block",
    "Referrer-Policy: strict-origin-when-cross-origin",
  ],
  
  // Data
  data: [
    "No PII collection without user accounts",
    "No tracking beyond anonymous analytics",
    "Local storage for preferences only",
  ],
};
```

---

## 13. Development Phases

### Phase 1: Foundation (Week 1)
- [ ] Project setup with Next.js, TypeScript, Tailwind
- [ ] Basic layout components (Header, Sidebar, StatsBar)
- [ ] Map integration with CartoDB tiles
- [ ] Basic API route for aircraft data
- [ ] Aircraft markers on map (no clustering yet)

### Phase 2: Core Features (Week 2)
- [ ] Aircraft clustering implementation
- [ ] Filter panel with all filter types
- [ ] Detail panel with aircraft info
- [ ] Planespotters photo integration
- [ ] Real-time updates with polling

### Phase 3: Enhancement (Week 3)
- [ ] Flight trails implementation
- [ ] Search functionality
- [ ] Follow aircraft feature
- [ ] Mobile responsive design
- [ ] Performance optimizations

### Phase 4: Polish (Week 4)
- [ ] Animations and transitions
- [ ] Error handling and loading states
- [ ] Accessibility audit and fixes
- [ ] Testing (unit, integration, e2e)
- [ ] Documentation

### Phase 5: Launch
- [ ] Final performance audit
- [ ] Security review
- [ ] Vercel deployment
- [ ] Monitoring setup
- [ ] Launch! 🚀

---

## 14. Success Criteria

| Criteria | Metric |
|----------|--------|
| Performance | Lighthouse score > 90 |
| Reliability | 99.9% uptime |
| Data Freshness | < 10 second delay from source |
| User Experience | < 3 clicks to any feature |
| Mobile Usability | Full functionality on mobile |
| Accessibility | WCAG 2.1 AA compliant |
| Load Time | < 3s on 3G connection |
| Aircraft Capacity | Handle 10,000+ aircraft smoothly |

---

