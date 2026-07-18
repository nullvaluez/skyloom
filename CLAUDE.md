# SkyTracker ADSB Application - Comprehensive Analysis & Action Plan

> **⚠️ THE APP IS NOW FLY-ONLY (Round 9, 2026-07-17):** the flat 2D tracker,
> AR spotter, and their components/hooks/stores are DELETED —
> [FLY_ROUND9.md](FLY_ROUND9.md) is the record (tag `round9-pre-delete` =
> full pre-deletion tree). `app/page.js` boots straight into FlyMode behind
> a BootScreen overlay (`window.__flyBoot` progress contract). What remains:
> `components/fly/**`, `lib/fly/**`, the fly/atlas/contracts/passport
> stores, use-fly-traffic/use-fly-audio/use-route/use-aircraft-photo, all
> `app/api/aircraft/*` routes, and the aircraft-processor worker. The
> flat-tracker analysis in the body of this file is HISTORICAL — it
> describes deleted code (markers, panels, Leaflet-era plans); do not act
> on it.

> **⚠️ ACTIVE WORK — READ FIRST:** **Round 7 "Electric Night City" is BUILT
> (2026-07-17): [FLY_ROUND7.md](FLY_ROUND7.md) is the record.** The Neon
> (toy) world now EMITS light (facade windows on `aFacade`, runway edge
> lights on `aGlow`, town glow-domes via `world-bend-anchor` — cache-key
> registry in world-bend.js grew 4 variants), RMB is a full 360° orbit
> (offset-space damping; coalesced pointer events), satellite gained a
> DEM hillshade + anisotropy + z17, the inspect card is a transparent
> isometric holo-panel (wiring/testids unchanged), airports are gameplay
> (lib/fly/airport-buzz.js → contracts + toasts), and the **Night style is
> RETIRED** ('night'→'toy' migration; NIGHT constants kept as documented
> dead values). Mid-round live fixes: traffic altitude LIFT
> (`GLOBE.trafficBend.farLiftBoost` — high traffic reads UP, not
> horizon-pinned; GPU + CPU `airDrop` mirror change together) and rooftop
> brightness (near-black since round 4, exposed by the new camera).
> FLY_ROUND7.md §4 = user sign-offs pending; §5 = which harnesses are
> green vs the paused full sweep + soak; §6 = new lessons (don't run
> harnesses while the user live-tests; stale tabs across dev-server
> restarts). Earlier: **Round 6 "Connected Sky" EXECUTED
> (2026-07-17): [FLY_ROUND6.md](FLY_ROUND6.md) is the record.** It fixed
> the round-5 live-review bugs (silent warp/chase failures → loud;
> contrails now backfill instantly, never render vertical/slab/spear —
> new `world-bend-air-anchor` shader variant + behind-camera cull; sky/
> ground rim unified via `GLOBE.rim` + a bend-following SkyDome dip; far
> warps stream ~3× faster behind a held streak→hold→reveal cinematic;
> POI letters are slot-stable with hysteresis; SPICY no longer pings CAP
> Cessnas and picks the nearest contact) and added the arcade layer the
> user asked for (C cinema wing-cam during chases, Contracts v1 scoring
> panel + persisted `fly-contracts` store, Day-style local-time sun).
> FLY_ROUND6.md §4 lists the user sign-off checkpoints (all defaults
> live-tunable in `fly-constants.js`); §5 has new hard-won lessons
> (ribbon width factors must cover camera geometry; per-vertex bend
> shears rigid objects; no store writes inside React state updaters).
> Harnesses: verify-inspect-actions/tracers/poi/rim/warp-arrival/
> chase-cam/contracts/sun all new and green, plus full round-5 sweep.
> Earlier: **Round 5 "Atlas" (2026-07-17): [FLY_ATLAS_REWORK.md](FLY_ATLAS_REWORK.md) §8.** The Atlas fast-travel screen (M / minimap click / pause menu:
> canvas world map with Natural Earth coastlines, search-to-warp,
> destination cards, recents/favorites/visits in the persisted
> `fly-atlas-store`), `runtime.warpToGeo` (military/hotspot warps spawn
> 4km out, nose on the field), a much bigger offline POI DB
> (`lib/fly/poi/` — ~300 cities +tz, ~120 landmarks, 63 military bases,
> 30 spotting hotspots; military/hotspot letters + tooltip badges +
> minimap triangles), the world-alive pass (worker-baked road-traffic
> pulses on `aArc` + rooftop beacon blink on `aBeacon` — both ZERO extra
> draws, cache keys `world-bend-fade-pulse`/`-beacon`; Day-only instanced
> cloud shadows +1 draw), and SPICY traffic pings (military/epic+ first
> sightings → toast + minimap ring). The §4.4c scout is UNBUILT
> (flag-off; needs explicit user opt-in). Open: live-tuning review of the
> new defaults (ROAD_PULSE/BEACONS/CLOUDS.shadow/SPICY + atlas colors).
> Earlier rounds: the **"Globe" rework (2026-07-16)** made every style a
> curved mini-globe with neon tracers + clean 3D Archivo-Black letters,
> and round 4 added the void-grid floor, terrain-clearing clouds, ribbon
> contrails (clock-skew mass-delete fixed in traffic-engine ingest), the
> INK CODEX inspect card, spot toasts and shoreline foam — see
> **[FLY_GLOBE_REWORK.md](FLY_GLOBE_REWORK.md) §6 + §6.3**.
> [FLY_TOYWORLD_REWORK.md](FLY_TOYWORLD_REWORK.md) §6.5's gotchas still
> apply (vector pipeline/curvature/tracers carry forward). The base Fly
> Mode is COMPLETE (all phases 0–6 + GLB fleet + game-feel pass,
> browser-verified — see
> **[FLY_MODE_HANDOFF.md](FLY_MODE_HANDOFF.md)** §8/§8.5.1 for the record,
> hard constraints (NO API keys; no r3f-perf; asset licensing), and the
> verification harnesses). Before touching anything under `components/fly/`,
> `lib/fly/`, or `stores/fly-store.js`, read those docs. The analysis below
> this notice predates Fly Mode and parts of it are stale (e.g. it
> references Leaflet, which was already replaced by deck.gl/MapLibre).

## Executive Summary

After thorough analysis of the SkyTracker codebase, I've identified several issues, performance bottlenecks, and opportunities for enhancement. This document provides a detailed breakdown and a prioritized action plan to transform the application into a modern, high-performance flight tracker.

---

## Part 1: Current Issues Identified

### 🔴 Critical Issues

#### 1. **Memory Leaks in Aircraft Store**
```javascript
// Problem: Map references in trails never get cleaned up for stale aircraft
trails: new Map(), // Grows unbounded over time
```
- Trail data persists even after aircraft leave the viewport
- No garbage collection for aircraft that haven't been seen in 30+ seconds

#### 2. **renderToString Performance Bottleneck**
```javascript
// In AircraftMarker.jsx - Line 3877
const iconHtml = renderToString(
  <AircraftIcon type={iconType} color={color} size={size} rotation={rotation} />
);
```
- `renderToString` is called on every render for every marker
- Synchronous, blocking operation that doesn't scale with 5,000+ aircraft

#### 3. **Icon Re-creation on Every Update**
- The `useMemo` dependency array includes `rotation`, causing icon re-creation on every position update
- CSS transforms should handle rotation instead of re-rendering the entire icon

#### 4. **No Virtual Rendering for Aircraft List**
- All filtered aircraft are rendered to the DOM even when not visible
- At 10,000+ aircraft, this causes significant memory pressure

### 🟠 Moderate Issues

#### 5. **Inefficient Filter Processing**
```javascript
// In use-filters.js - runs O(n) filters sequentially
filteredAircraft.forEach((ac) => {
  const type = classifyAircraft(ac); // Called multiple times per aircraft
});
```
- `classifyAircraft()` is called multiple times per aircraft (in filtering + stats)
- Should memoize classification results per aircraft

#### 6. **Missing Error Boundaries**
- No error boundaries around map components
- A single bad aircraft data point could crash the entire application

#### 7. **Polling Inefficiency**
- Uses fixed 5-second interval regardless of viewport size
- Small viewport = wasted API calls; large viewport = stale data

#### 8. **Trail Position Diffing**
```javascript
if (!lastPos || lastPos.lat !== ac.lat || lastPos.lon !== ac.lon)
```
- Floating-point comparison is unreliable
- Aircraft hovering may create duplicate points

### 🟡 Minor Issues

#### 9. **Missing Leaflet Static Assets**
- References `/leaflet/marker-icon.png` but files may not exist in public folder

#### 10. **Tooltip Performance**
- Tooltips create additional DOM nodes for every aircraft
- Should use a single shared tooltip that repositions

#### 11. **No Request Deduplication**
- Rapid panning can trigger multiple overlapping API requests

---

## Part 2: Performance Improvement Plan

### Tier 1: Critical Performance Fixes (Immediate Impact)

#### A. Canvas-Based Rendering for Markers
Replace DOM-based Leaflet markers with Canvas rendering for massive performance gains.

```javascript
// New: CanvasIconLayer.jsx
import L from 'leaflet';

// Use Leaflet.Canvas-Markers plugin or custom canvas layer
const CanvasIconLayer = L.Layer.extend({
  initialize: function(options) {
    this._icons = [];
    L.setOptions(this, options);
  },
  
  onAdd: function(map) {
    this._canvas = L.DomUtil.create('canvas', 'aircraft-canvas');
    this._ctx = this._canvas.getContext('2d');
    map.getPanes().overlayPane.appendChild(this._canvas);
    
    map.on('moveend zoomend', this._redraw, this);
    this._redraw();
  },
  
  setAircraft: function(aircraft) {
    this._icons = aircraft;
    this._redraw();
  },
  
  _redraw: function() {
    // Batch render all aircraft to canvas
    requestAnimationFrame(() => this._draw());
  },
  
  _draw: function() {
    const ctx = this._ctx;
    ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
    
    this._icons.forEach(ac => {
      if (ac.lat && ac.lon) {
        const point = this._map.latLngToContainerPoint([ac.lat, ac.lon]);
        this._drawAircraft(ctx, point, ac);
      }
    });
  }
});
```

**Expected Impact:** 10x-50x rendering performance improvement for 5,000+ aircraft

#### B. Pre-compiled SVG Icon Sprites
Create a single sprite sheet with all aircraft types and rotations pre-rendered.

```javascript
// Icon sprite configuration
const ROTATION_STEPS = 36; // 10-degree increments (vs continuous)
const ICON_TYPES = ['airliner', 'helicopter', 'military', 'cargo', 'prop', 'jet', 'glider', 'drone', 'unknown'];

// Pre-generate at build time
function generateIconSprite() {
  const canvas = document.createElement('canvas');
  const iconSize = 40;
  const cols = ROTATION_STEPS;
  const rows = ICON_TYPES.length;
  
  canvas.width = iconSize * cols;
  canvas.height = iconSize * rows;
  // ... pre-render all icons
}
```

**Expected Impact:** Eliminate runtime SVG rendering overhead

#### C. Web Worker for Data Processing
Move filtering and classification to a Web Worker.

```javascript
// workers/aircraft-processor.worker.js
self.onmessage = function(e) {
  const { aircraft, filters } = e.data;
  
  // Heavy processing off main thread
  const processed = aircraft.map(ac => ({
    ...ac,
    classification: classifyAircraft(ac),
    iconType: getAircraftIconType(ac),
    color: getAircraftColor(ac),
  }));
  
  const filtered = applyFilters(processed, filters);
  
  self.postMessage({ processed, filtered });
};
```

**Expected Impact:** Unblock main thread, maintain 60fps during data updates

### Tier 2: Optimization Improvements (High Value)

#### D. Spatial Indexing with R-Tree
```javascript
import RBush from 'rbush';

class AircraftSpatialIndex {
  constructor() {
    this.tree = new RBush();
  }
  
  update(aircraft) {
    this.tree.clear();
    this.tree.load(aircraft.map(ac => ({
      minX: ac.lon, minY: ac.lat,
      maxX: ac.lon, maxY: ac.lat,
      aircraft: ac
    })));
  }
  
  queryBounds(bounds) {
    return this.tree.search({
      minX: bounds.getWest(),
      minY: bounds.getSouth(),
      maxX: bounds.getEast(),
      maxY: bounds.getNorth()
    }).map(item => item.aircraft);
  }
}
```

#### E. Adaptive Polling Rate
```javascript
function getPollingInterval(zoom, aircraftCount) {
  if (zoom > 12 && aircraftCount < 100) return 2000;  // Focused view
  if (zoom < 6) return 10000;  // Wide view, less urgent
  if (aircraftCount > 3000) return 8000;  // Heavy load
  return 5000;  // Default
}
```

#### F. Request Coalescing
```javascript
class RequestCoalescer {
  constructor(fetchFn, delay = 300) {
    this.pending = null;
    this.fetchFn = fetchFn;
    this.delay = delay;
  }
  
  request(params) {
    if (this.pending) {
      clearTimeout(this.pending.timeout);
    }
    
    return new Promise((resolve, reject) => {
      this.pending = {
        params,
        resolve,
        reject,
        timeout: setTimeout(() => this._execute(), this.delay)
      };
    });
  }
  
  _execute() {
    const { params, resolve, reject } = this.pending;
    this.pending = null;
    this.fetchFn(params).then(resolve).catch(reject);
  }
}
```

---

## Part 3: Unique Aircraft Icons Implementation

### Current State
You have 9 different icon shapes defined in `AircraftIcon.jsx`:
- AirlinerIcon, HelicopterIcon, MilitaryIcon, CargoIcon, PropIcon, JetIcon, GliderIcon, DroneIcon, UnknownIcon

**Problem:** Same icon shape is used with different colors, making aircraft types visually similar.

### Solution: Distinctive Icon Design System

#### Phase 1: Enhanced Icon Differentiation

```javascript
// New: lib/aircraft-icons.js
export const AIRCRAFT_ICON_DEFINITIONS = {
  // Commercial Airliners - Wide body silhouette
  airliner: {
    viewBox: '0 0 32 32',
    path: 'M28 18v-2l-10-6V4c0-1.1-.9-2-2-2s-2 .9-2 2v6L4 16v2l10-3v7l-3 2v2l5-1.5 5 1.5v-2l-3-2v-7l10 3z',
    style: 'filled',
    showTrail: true,
  },
  
  // Regional Jets - Smaller, sleeker
  jet: {
    viewBox: '0 0 32 32',
    path: 'M26 17v-2l-9-5V4.5c0-.83-.67-1.5-1.5-1.5S14 3.67 14 4.5V10l-9 5v2l9-2.5v6l-3 2v2l4.5-1 4.5 1v-2l-3-2v-6l9 2.5z',
    style: 'filled',
    showTrail: true,
  },
  
  // Military - Swept wings, aggressive shape
  military: {
    viewBox: '0 0 32 32',
    path: 'M27 16l-9-5.5V4a2 2 0 10-4 0v6.5L5 16v2l9-2v5l-3 2v2l5-1 5 1v-2l-3-2v-5l9 2v-2zM16 6l2-2h-4l2 2z',
    style: 'outlined',
    strokeWidth: 1.5,
    marker: 'star', // Adds small star indicator
  },
  
  // Cargo Freighter - Bulky body
  cargo: {
    viewBox: '0 0 32 32',
    path: 'M28 18v-2l-10-6V4c0-1.1-.9-2-2-2s-2 .9-2 2v6L4 16v2l10-3v7l-3 2v2l5-1.5 5 1.5v-2l-3-2v-7l10 3z',
    bodyPath: 'M11 11h10v6H11z', // Additional cargo bay
    style: 'filled',
    showTrail: true,
  },
  
  // Helicopter - Distinct rotor blade
  helicopter: {
    viewBox: '0 0 32 32',
    path: 'M6 8h20v2H6z M16 10v6m-6 0h12a3 3 0 010 6H10a3 3 0 010-6z M13 22l-2 4h10l-2-4',
    rotorPath: 'M6 8h20', // Animated rotor
    style: 'filled',
    animate: 'rotor',
  },
  
  // Prop/Turboprop - High wing design
  prop: {
    viewBox: '0 0 32 32',
    path: 'M16 3a1 1 0 00-1 1v7L6 15v2l9-2v6l-3 2v2l4-1.5 4 1.5v-2l-3-2v-6l9 2v-2l-9-4V4a1 1 0 00-1-1z',
    propPath: 'M16 3l2-2-4 0 2 2', // Propeller detail
    style: 'filled',
  },
  
  // Glider - Long slender wings
  glider: {
    viewBox: '0 0 32 32',
    path: 'M16 5c-.3 0-.5.2-.5.5v6L2 14v1.5L15.5 13v6l-2.5 1.5v1.5l3-.75 3 .75V20l-2.5-1.5v-6L30 15.5V14l-13.5-2.5V5.5c0-.3-.2-.5-.5-.5z',
    style: 'thin',
    strokeWidth: 1,
  },
  
  // Drone/UAV - Quad configuration
  drone: {
    viewBox: '0 0 32 32',
    path: 'M8 8a4 4 0 100-1 M24 8a4 4 0 100-1 M8 24a4 4 0 100-1 M24 24a4 4 0 100-1',
    bodyPath: 'M13 13h6v6h-6z',
    armPaths: ['M8 8L13 13', 'M24 8L19 13', 'M8 24L13 19', 'M24 24L19 19'],
    style: 'outlined',
    animate: 'props',
  },
  
  // Unknown - Distinctive question mark/radar blip
  unknown: {
    viewBox: '0 0 32 32',
    path: 'M16 4a12 12 0 100 24 12 12 0 000-24z',
    innerPath: 'M16 8l6 12H10l6-12z',
    style: 'pulsing',
    opacity: 0.7,
  },
  
  // NEW: Government/VIP - Distinct executive shape
  government: {
    viewBox: '0 0 32 32',
    path: 'M28 17v-2l-10-6V4c0-1.1-.9-2-2-2s-2 .9-2 2v5L4 15v2l10-2.5v7l-3 2v2l5-1.5 5 1.5v-2l-3-2v-7l10 2.5z',
    crownPath: 'M10 4l2-2h8l2 2', // Crown/official marker
    style: 'filled',
    marker: 'shield',
  },
  
  // NEW: Emergency - Pulsing with alert styling
  emergency: {
    viewBox: '0 0 32 32',
    path: 'M28 18v-2l-10-6V4c0-1.1-.9-2-2-2s-2 .9-2 2v6L4 16v2l10-3v7l-3 2v2l5-1.5 5 1.5v-2l-3-2v-7l10 3z',
    style: 'emergency',
    animate: 'pulse',
    glowColor: '#ff0000',
  }
};
```

#### Phase 2: New AircraftIcon Component

```jsx
// components/aircraft/AircraftIcon.jsx - Complete Rewrite
'use client';

import { memo, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { AIRCRAFT_ICON_DEFINITIONS } from '@/lib/aircraft-icons';

export const AircraftIcon = memo(function AircraftIcon({
  type = 'unknown',
  color = '#6b7280',
  size = 32,
  rotation = 0,
  isEmergency = false,
  isSelected = false,
  className,
}) {
  const iconDef = AIRCRAFT_ICON_DEFINITIONS[isEmergency ? 'emergency' : type] 
    || AIRCRAFT_ICON_DEFINITIONS.unknown;
  
  const styles = useMemo(() => ({
    width: size,
    height: size,
    // Use CSS transform for rotation - no re-render needed
    '--rotation': `${rotation}deg`,
    '--icon-color': isSelected ? '#3b82f6' : color,
    '--glow-color': isEmergency ? '#ff0000' : 'transparent',
  }), [size, rotation, color, isSelected, isEmergency]);

  return (
    <svg
      viewBox={iconDef.viewBox}
      style={styles}
      className={cn(
        'aircraft-icon',
        `aircraft-icon--${iconDef.style}`,
        iconDef.animate && `aircraft-icon--${iconDef.animate}`,
        isSelected && 'aircraft-icon--selected',
        className
      )}
    >
      {/* Drop shadow filter */}
      <defs>
        <filter id={`shadow-${type}`} x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow dx="0" dy="1" stdDeviation="1" floodOpacity="0.5"/>
        </filter>
        {isEmergency && (
          <filter id="emergency-glow">
            <feGaussianBlur stdDeviation="2" result="blur"/>
            <feFlood floodColor="#ff0000" floodOpacity="0.6"/>
            <feComposite in2="blur" operator="in"/>
            <feMerge>
              <feMergeNode/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>
        )}
      </defs>
      
      {/* Main aircraft path */}
      <g 
        style={{ transform: 'rotate(var(--rotation))', transformOrigin: 'center' }}
        filter={isEmergency ? 'url(#emergency-glow)' : `url(#shadow-${type})`}
      >
        <path 
          d={iconDef.path} 
          fill={iconDef.style === 'outlined' ? 'none' : 'var(--icon-color)'} 
          stroke={iconDef.style === 'outlined' ? 'var(--icon-color)' : 'none'}
          strokeWidth={iconDef.strokeWidth || 0}
        />
        
        {/* Additional paths for complex icons */}
        {iconDef.bodyPath && (
          <path d={iconDef.bodyPath} fill="var(--icon-color)" opacity="0.8"/>
        )}
        
        {iconDef.propPath && (
          <path d={iconDef.propPath} fill="var(--icon-color)" opacity="0.9"/>
        )}
        
        {/* Markers */}
        {iconDef.marker === 'star' && (
          <polygon points="16,2 17,5 20,5 18,7 19,10 16,8 13,10 14,7 12,5 15,5" 
            fill="var(--icon-color)" opacity="0.7" transform="scale(0.4) translate(24,0)"/>
        )}
        
        {iconDef.marker === 'shield' && (
          <path d="M16 1l4 2v4c0 3-4 5-4 5s-4-2-4-5V3l4-2z" 
            fill="var(--icon-color)" opacity="0.6" transform="scale(0.35) translate(30,0)"/>
        )}
      </g>
    </svg>
  );
});

// CSS to add in globals.css
/*
.aircraft-icon {
  transform-origin: center;
  will-change: transform;
}

.aircraft-icon--pulse {
  animation: pulse 1s ease-in-out infinite;
}

.aircraft-icon--rotor g:first-of-type::after {
  animation: spin 0.1s linear infinite;
}

.aircraft-icon--selected {
  filter: drop-shadow(0 0 6px var(--icon-color));
}

@keyframes pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.7; transform: scale(1.1); }
}
*/
```

#### Phase 3: Icon Preview Component for Testing

```jsx
// components/aircraft/IconGallery.jsx - Development tool
'use client';

import { AircraftIcon } from './AircraftIcon';
import { AIRCRAFT_COLORS } from '@/lib/constants';

const ICON_TYPES = [
  'airliner', 'jet', 'military', 'cargo', 'helicopter', 
  'prop', 'glider', 'drone', 'government', 'unknown'
];

export function IconGallery() {
  return (
    <div className="grid grid-cols-5 gap-4 p-4 bg-gray-900">
      {ICON_TYPES.map(type => (
        <div key={type} className="flex flex-col items-center gap-2">
          <div className="text-xs text-gray-400">{type}</div>
          <div className="flex gap-2">
            {[0, 45, 90, 180, 270].map(rotation => (
              <AircraftIcon
                key={rotation}
                type={type}
                color={AIRCRAFT_COLORS[type] || AIRCRAFT_COLORS.unknown}
                size={32}
                rotation={rotation}
              />
            ))}
          </div>
        </div>
      ))}
      
      {/* Emergency states */}
      <div className="col-span-5 border-t border-gray-700 pt-4 mt-4">
        <div className="text-sm text-gray-400 mb-2">Emergency States</div>
        <div className="flex gap-4">
          {['airliner', 'helicopter', 'military'].map(type => (
            <AircraftIcon
              key={type}
              type={type}
              color="#ff0000"
              size={40}
              rotation={45}
              isEmergency={true}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
```

---

## Part 4: New Features for Modern Sleek Tracker

### Feature 1: Real-time Flight Path Prediction

```javascript
// lib/prediction.js
export function predictFlightPath(aircraft, minutes = 5) {
  if (!aircraft.lat || !aircraft.lon || !aircraft.track || !aircraft.gs) {
    return null;
  }
  
  const speedKnots = aircraft.gs;
  const headingRad = (aircraft.track * Math.PI) / 180;
  const distanceNm = (speedKnots / 60) * minutes;
  
  // Convert nautical miles to degrees (approximate)
  const distanceDeg = distanceNm / 60;
  
  const predictedLat = aircraft.lat + distanceDeg * Math.cos(headingRad);
  const predictedLon = aircraft.lon + distanceDeg * Math.sin(headingRad) / Math.cos(aircraft.lat * Math.PI / 180);
  
  return {
    lat: predictedLat,
    lon: predictedLon,
    eta: new Date(Date.now() + minutes * 60000),
  };
}
```

### Feature 2: 3D Altitude Visualization

```jsx
// components/map/AltitudeLayer.jsx
'use client';

import { useMemo } from 'react';
import { Polyline } from 'react-leaflet';

export function AltitudeLayer({ aircraft }) {
  const altitudeLines = useMemo(() => {
    return aircraft
      .filter(ac => ac.lat && ac.lon && ac.alt_baro > 1000)
      .map(ac => {
        const height = Math.min(ac.alt_baro / 1000, 50); // Normalize
        const opacity = 0.3 + (height / 50) * 0.4;
        
        return {
          positions: [
            [ac.lat, ac.lon],
            [ac.lat + 0.01, ac.lon + 0.01], // Offset for shadow effect
          ],
          color: `hsl(${200 + height * 2}, 70%, 50%)`,
          weight: 1,
          opacity,
          key: ac.hex,
        };
      });
  }, [aircraft]);
  
  return altitudeLines.map(line => (
    <Polyline key={line.key} {...line} />
  ));
}
```

### Feature 3: Aircraft Proximity Alerts

```javascript
// hooks/use-proximity-alerts.js
'use client';

import { useMemo } from 'react';

export function useProximityAlerts(aircraft, thresholdNm = 5) {
  const alerts = useMemo(() => {
    const proximityAlerts = [];
    const checked = new Set();
    
    aircraft.forEach((ac1, i) => {
      if (!ac1.lat || !ac1.lon) return;
      
      aircraft.slice(i + 1).forEach(ac2 => {
        if (!ac2.lat || !ac2.lon) return;
        
        const key = [ac1.hex, ac2.hex].sort().join('-');
        if (checked.has(key)) return;
        checked.add(key);
        
        const distance = calculateDistanceNm(
          ac1.lat, ac1.lon, ac2.lat, ac2.lon
        );
        
        // Check altitude separation
        const altSeparation = Math.abs(
          (ac1.alt_baro || 0) - (ac2.alt_baro || 0)
        );
        
        if (distance < thresholdNm && altSeparation < 1000) {
          proximityAlerts.push({
            aircraft1: ac1,
            aircraft2: ac2,
            distance,
            altitudeSeparation: altSeparation,
            severity: distance < 2 ? 'critical' : 'warning',
          });
        }
      });
    });
    
    return proximityAlerts.sort((a, b) => a.distance - b.distance);
  }, [aircraft, thresholdNm]);
  
  return alerts;
}

function calculateDistanceNm(lat1, lon1, lat2, lon2) {
  const R = 3440.065; // Earth radius in nautical miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) ** 2 + 
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon/2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}
```

### Feature 4: Weather Layer Integration

```jsx
// components/map/WeatherLayer.jsx
'use client';

import { TileLayer } from 'react-leaflet';
import { useUIStore } from '@/stores/ui-store';

const WEATHER_LAYERS = {
  radar: 'https://tilecache.rainviewer.com/v2/radar/{ts}/256/{z}/{x}/{y}/2/1_1.png',
  clouds: 'https://tile.openweathermap.org/map/clouds_new/{z}/{x}/{y}.png?appid={apiKey}',
  wind: 'https://tile.openweathermap.org/map/wind_new/{z}/{x}/{y}.png?appid={apiKey}',
};

export function WeatherLayer({ type = 'radar', apiKey }) {
  const { weatherLayerEnabled } = useUIStore();
  
  if (!weatherLayerEnabled) return null;
  
  const url = WEATHER_LAYERS[type]
    .replace('{apiKey}', apiKey)
    .replace('{ts}', Math.floor(Date.now() / 600000) * 600); // 10-min cache
  
  return (
    <TileLayer
      url={url}
      opacity={0.5}
      zIndex={100}
    />
  );
}
```

### Feature 5: Flight History Playback

```javascript
// stores/playback-store.js
import { create } from 'zustand';

export const usePlaybackStore = create((set, get) => ({
  isPlaying: false,
  playbackSpeed: 1,
  currentTime: null,
  history: [], // [{timestamp, aircraft: []}]
  
  recordFrame: (aircraft) => {
    set(state => ({
      history: [
        ...state.history.slice(-360), // Keep 30 min at 5s intervals
        { timestamp: Date.now(), aircraft: [...aircraft] }
      ]
    }));
  },
  
  startPlayback: (fromTime) => {
    set({ isPlaying: true, currentTime: fromTime || get().history[0]?.timestamp });
  },
  
  stopPlayback: () => {
    set({ isPlaying: false, currentTime: null });
  },
  
  getFrameAtTime: (time) => {
    const history = get().history;
    return history.find(h => h.timestamp >= time)?.aircraft || [];
  },
  
  setPlaybackSpeed: (speed) => {
    set({ playbackSpeed: speed });
  },
}));
```

### Feature 6: Airport/Runway Overlay

```javascript
// lib/airports.js
export const MAJOR_AIRPORTS = {
  KJFK: { lat: 40.6413, lon: -73.7781, name: 'JFK International', runways: ['04L/22R', '04R/22L', '13L/31R', '13R/31L'] },
  KLAX: { lat: 33.9425, lon: -118.4081, name: 'Los Angeles International', runways: ['06L/24R', '06R/24L', '07L/25R', '07R/25L'] },
  KORD: { lat: 41.9742, lon: -87.9073, name: 'O\'Hare International', runways: ['04L/22R', '09C/27C', '10L/28R', '10C/28C', '10R/28L', '09L/27R', '09R/27L', '04R/22L', '14R/32L', '15/33'] },
  // ... add more
};
```

### Feature 7: Keyboard Shortcuts

```javascript
// hooks/use-keyboard-shortcuts.js
'use client';

import { useEffect } from 'react';
import { useUIStore } from '@/stores/ui-store';
import { useMapStore } from '@/stores/map-store';
import { useAircraftStore } from '@/stores/aircraft-store';

export function useKeyboardShortcuts() {
  const { toggleSidebar, toggleDetailPanel } = useUIStore();
  const { resetView, geolocate } = useMapStore();
  const { selectAircraft, unfollowAircraft } = useAircraftStore();
  
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Ignore if typing in input
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      
      switch (e.key) {
        case 'f':
          e.preventDefault();
          toggleSidebar(); // Toggle filters
          break;
        case 'd':
          e.preventDefault();
          toggleDetailPanel(); // Toggle detail panel
          break;
        case 'Escape':
          selectAircraft(null);
          unfollowAircraft();
          break;
        case 'h':
          e.preventDefault();
          resetView(); // Home view
          break;
        case 'l':
          e.preventDefault();
          geolocate(); // My location
          break;
        case '+':
        case '=':
          // Zoom in handled by Leaflet
          break;
        case '-':
          // Zoom out handled by Leaflet
          break;
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleSidebar, toggleDetailPanel, selectAircraft, unfollowAircraft, resetView, geolocate]);
}
```

### Feature 8: Night Mode Map Variant

```javascript
// lib/constants.js - Add map themes
export const MAP_THEMES = {
  dark: {
    name: 'Dark Matter',
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; CARTO',
  },
  satellite: {
    name: 'Satellite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: '&copy; Esri',
  },
  terrain: {
    name: 'Terrain',
    url: 'https://stamen-tiles.a.ssl.fastly.net/terrain/{z}/{x}/{y}.jpg',
    attribution: '&copy; Stamen',
  },
  light: {
    name: 'Light',
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; CARTO',
  },
};
```

### Feature 9: Live Stats Dashboard

```jsx
// components/panels/StatsDashboard.jsx
'use client';

import { memo, useMemo } from 'react';
import { useAircraftStore } from '@/stores/aircraft-store';
import { useFilterStats } from '@/hooks/use-filters';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

export const StatsDashboard = memo(function StatsDashboard() {
  const aircraft = useAircraftStore(s => s.getAircraftArray());
  const stats = useFilterStats(aircraft);
  
  const altitudeDistribution = useMemo(() => {
    const ranges = [
      { range: '0-10k', min: 0, max: 10000, count: 0 },
      { range: '10-20k', min: 10000, max: 20000, count: 0 },
      { range: '20-30k', min: 20000, max: 30000, count: 0 },
      { range: '30-40k', min: 30000, max: 40000, count: 0 },
      { range: '40k+', min: 40000, max: Infinity, count: 0 },
    ];
    
    aircraft.forEach(ac => {
      const alt = ac.alt_baro || 0;
      const range = ranges.find(r => alt >= r.min && alt < r.max);
      if (range) range.count++;
    });
    
    return ranges;
  }, [aircraft]);
  
  return (
    <div className="p-4 bg-card rounded-lg space-y-4">
      <h3 className="text-sm font-semibold">Live Statistics</h3>
      
      <div className="grid grid-cols-3 gap-4 text-center">
        <div>
          <div className="text-2xl font-bold text-primary">{stats.total}</div>
          <div className="text-xs text-muted-foreground">Total Aircraft</div>
        </div>
        <div>
          <div className="text-2xl font-bold text-green-500">{stats.byType.commercial}</div>
          <div className="text-xs text-muted-foreground">Commercial</div>
        </div>
        <div>
          <div className="text-2xl font-bold text-red-500">{stats.byType.military}</div>
          <div className="text-xs text-muted-foreground">Military</div>
        </div>
      </div>
      
      <div className="h-32">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={altitudeDistribution}>
            <XAxis dataKey="range" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip />
            <Bar dataKey="count" fill="#3b82f6" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
});
```

### Feature 10: Shareable Flight Links

```javascript
// hooks/use-share.js
'use client';

import { useCallback } from 'react';
import { useAircraftStore } from '@/stores/aircraft-store';
import { useMapStore } from '@/stores/map-store';

export function useShare() {
  const selectedAircraft = useAircraftStore(s => s.getSelectedAircraft());
  const { center, zoom } = useMapStore();
  
  const generateShareUrl = useCallback(() => {
    const params = new URLSearchParams();
    
    if (selectedAircraft) {
      params.set('hex', selectedAircraft.hex);
    }
    
    params.set('lat', center[0].toFixed(4));
    params.set('lon', center[1].toFixed(4));
    params.set('zoom', zoom.toString());
    
    return `${window.location.origin}?${params.toString()}`;
  }, [selectedAircraft, center, zoom]);
  
  const share = useCallback(async () => {
    const url = generateShareUrl();
    
    if (navigator.share) {
      await navigator.share({
        title: selectedAircraft 
          ? `Tracking ${selectedAircraft.flight || selectedAircraft.hex}`
          : 'SkyTracker - Live Flight Tracker',
        url,
      });
    } else {
      await navigator.clipboard.writeText(url);
      // Show toast notification
    }
  }, [generateShareUrl, selectedAircraft]);
  
  return { generateShareUrl, share };
}
```

---

## Part 5: Prioritized Implementation Roadmap

### Phase 1: Critical Fixes (Week 1)
| Priority | Task | Impact | Effort |
|----------|------|--------|--------|
| P0 | Fix memory leaks in trail storage | High | Low |
| P0 | Remove renderToString, use CSS rotation | High | Medium |
| P0 | Add error boundaries | High | Low |
| P1 | Memoize classification results | Medium | Low |
| P1 | Implement request coalescing | Medium | Medium |

### Phase 2: Performance Optimization (Week 2)
| Priority | Task | Impact | Effort |
|----------|------|--------|--------|
| P0 | Implement Canvas-based marker rendering | Very High | High |
| P1 | Add Web Worker for data processing | High | Medium |
| P1 | Pre-generate icon sprites | Medium | Medium |
| P2 | Implement spatial indexing | Medium | Medium |
| P2 | Add adaptive polling | Low | Low |

### Phase 3: Icon System (Week 3)
| Priority | Task | Impact | Effort |
|----------|------|--------|--------|
| P0 | Design 10 unique aircraft icons | High | Medium |
| P0 | Implement new AircraftIcon component | High | Medium |
| P1 | Add emergency/selected states | Medium | Low |
| P1 | Create icon gallery for testing | Low | Low |
| P2 | Add icon animations (helicopter rotor) | Low | Medium |

### Phase 4: New Features (Week 4+)
| Priority | Task | Impact | Effort |
|----------|------|--------|--------|
| P1 | Keyboard shortcuts | Medium | Low |
| P1 | Shareable flight links | Medium | Low |
| P2 | Weather layer integration | Medium | Medium |
| P2 | Airport overlay | Medium | Medium |
| P2 | Statistics dashboard | Medium | Medium |
| P3 | Flight path prediction | Low | Medium |
| P3 | Altitude visualization | Low | Medium |
| P3 | History playback | Low | High |

---

## Part 6: Quick Wins (Can Implement Today)

### 1. CSS-Only Rotation Fix (5 minutes)
```css
/* globals.css */
.aircraft-marker svg {
  transform: rotate(var(--rotation, 0deg));
  transition: transform 0.3s ease-out;
}
```

```jsx
// AircraftMarker.jsx - Remove rotation from dependency array
const icon = useMemo(() => {
  // Don't include rotation here
}, [iconType, color, size, emergency]);

// Apply rotation via CSS variable
return (
  <Marker
    style={{ '--rotation': `${rotation}deg` }}
    // ...
  />
);
```

### 2. Classification Memoization (10 minutes)
```javascript
// In aircraft-store.js
setAircraft: (aircraftList) => {
  const newMap = new Map();
  
  aircraftList.forEach((ac) => {
    if (ac.hex) {
      // Pre-calculate and cache classification
      ac._classification = classifyAircraft(ac);
      ac._iconType = getAircraftIconType(ac);
      ac._color = getAircraftColor(ac);
      newMap.set(ac.hex, ac);
    }
  });
  // ...
}
```

### 3. Trail Cleanup (5 minutes)
```javascript
// In aircraft-store.js
setAircraft: (aircraftList) => {
  const { trails } = get();
  const activeHexes = new Set(aircraftList.map(ac => ac.hex));
  
  // Clean up trails for aircraft no longer in view
  const cleanedTrails = new Map();
  trails.forEach((trail, hex) => {
    if (activeHexes.has(hex)) {
      cleanedTrails.set(hex, trail);
    }
  });
  
  set({ trails: cleanedTrails });
  // ...
}
```

### 4. Error Boundary (10 minutes)
```jsx
// components/ErrorBoundary.jsx
'use client';

import { Component } from 'react';

export class MapErrorBoundary extends Component {
  state = { hasError: false };
  
  static getDerivedStateFromError(error) {
    return { hasError: true };
  }
  
  componentDidCatch(error, errorInfo) {
    console.error('Map error:', error, errorInfo);
  }
  
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full items-center justify-center bg-background">
          <div className="text-center">
            <p className="text-lg font-medium">Map failed to load</p>
            <button 
              onClick={() => this.setState({ hasError: false })}
              className="mt-2 text-primary hover:underline"
            >
              Try again
            </button>
          </div>
        </div>
      );
    }
    
    return this.props.children;
  }
}
```

---

## Summary

Your SkyTracker application has a solid foundation but requires optimization for handling 5,000+ aircraft smoothly. The key improvements are:

1. **Performance**: Switch to Canvas rendering, use Web Workers, and optimize icon creation
2. **Icons**: Implement 10 unique, distinctive aircraft silhouettes instead of color-only differentiation
3. **Features**: Add modern features like keyboard shortcuts, sharing, weather layers, and statistics

The phased approach allows for incremental improvements while maintaining a working application throughout the process.