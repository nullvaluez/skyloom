/**
 * Aircraft Processor Web Worker
 * Handles heavy processing off the main thread:
 * - Aircraft classification
 * - Filtering
 * - Spatial indexing with RBush
 */

import { expose } from 'comlink';
import RBush from 'rbush';

// Import classification functions (these need to be duplicated or bundled)
// For now, we'll inline the essential logic

// Database flags for aircraft
const DB_FLAGS = {
  MILITARY: 1,
  INTERESTING: 2,
  PIA: 4,
  LADD: 8,
};

// Emergency squawk codes
const EMERGENCY_SQUAWKS = ['7500', '7600', '7700'];

// Aircraft colors
const AIRCRAFT_COLORS = {
  commercial: '#4ade80',
  cargo: '#fbbf24',
  military: '#f87171',
  private: '#a78bfa',
  helicopter: '#22d3ee',
  government: '#f472b6',
  special: '#fb923c',
  unknown: '#9ca3af',
  selected: '#60a5fa',
  emergency: '#ff0000',
};

/**
 * Check if aircraft is in emergency
 */
function isEmergency(aircraft) {
  if (!aircraft) return false;
  if (aircraft.emergency && aircraft.emergency !== 'none') return true;
  if (aircraft.squawk && EMERGENCY_SQUAWKS.includes(aircraft.squawk)) return true;
  return false;
}

/**
 * Check if aircraft is military
 */
function isMilitary(aircraft) {
  if (!aircraft) return false;
  if (aircraft.dbFlags && (aircraft.dbFlags & DB_FLAGS.MILITARY)) return true;
  
  const militaryPrefixes = ['RCH', 'EVAC', 'DUKE', 'KING', 'REACH', 'NAVY', 'USAF'];
  if (aircraft.flight) {
    const callsign = aircraft.flight.trim().toUpperCase();
    if (militaryPrefixes.some(prefix => callsign.startsWith(prefix))) return true;
  }
  return false;
}

/**
 * Check if aircraft is a helicopter
 */
function isHelicopter(aircraft) {
  if (!aircraft) return false;
  if (aircraft.category === 'A7') return true;
  
  const heliTypes = ['H60', 'H47', 'EC35', 'EC45', 'AS50', 'B06', 'R22', 'R44', 'S76', 'AW09', 'A109'];
  if (aircraft.t && heliTypes.some(type => aircraft.t.toUpperCase().includes(type))) return true;
  return false;
}

/**
 * Check if aircraft is cargo
 */
function isCargo(aircraft) {
  if (!aircraft) return false;
  
  const cargoAirlines = ['FDX', 'UPS', 'GTI', 'ABX', 'DHL', 'CLX'];
  if (aircraft.flight) {
    const callsign = aircraft.flight.trim().toUpperCase();
    if (cargoAirlines.some(prefix => callsign.startsWith(prefix))) return true;
  }
  
  if (aircraft.t) {
    const typeCode = aircraft.t.toUpperCase();
    if (typeCode.endsWith('F')) return true;
  }
  return false;
}

/**
 * Check if aircraft is private/general aviation
 */
function isPrivate(aircraft) {
  if (!aircraft) return false;
  if (aircraft.category === 'A1') return true;
  if (aircraft.r && aircraft.r.startsWith('N') && (!aircraft.flight || aircraft.flight.trim() === aircraft.r)) {
    return true;
  }
  return false;
}

/**
 * Check if aircraft is on ground
 */
function isOnGround(aircraft) {
  if (!aircraft) return false;
  if (aircraft.alt_baro === 'ground' || aircraft.alt_baro <= 0) return true;
  if (aircraft.gs !== undefined && aircraft.gs < 30) return true;
  return false;
}

/**
 * Classify aircraft type
 */
function classifyAircraft(aircraft) {
  if (!aircraft) return 'unknown';
  if (isEmergency(aircraft)) return 'emergency';
  if (isMilitary(aircraft)) return 'military';
  if (isHelicopter(aircraft)) return 'helicopter';
  if (isCargo(aircraft)) return 'cargo';
  if (isPrivate(aircraft)) return 'private';
  
  // Check for commercial
  if (['A2', 'A3', 'A4', 'A5'].includes(aircraft.category)) return 'commercial';
  if (aircraft.flight && /^[A-Z]{3}\d+/.test(aircraft.flight.trim())) return 'commercial';
  
  return 'unknown';
}

/**
 * Get aircraft icon type
 */
function getAircraftIconType(aircraft) {
  if (!aircraft) return 'unknown';
  
  const category = aircraft.category;
  if (category === 'A7') return 'helicopter';
  if (category === 'B1' || category === 'B4') return 'glider';
  if (category === 'B6') return 'drone';
  
  const typeCode = aircraft.t?.toUpperCase() || '';
  if (typeCode) {
    // Helicopters
    const heliTypes = ['H60', 'H47', 'EC35', 'EC45', 'AS50', 'B06', 'R22', 'R44', 'S76'];
    if (heliTypes.some(h => typeCode.includes(h))) return 'helicopter';
    
    // Military
    const militaryTypes = ['F16', 'F15', 'F18', 'F22', 'F35', 'C17', 'C130', 'KC135'];
    if (militaryTypes.some(m => typeCode.includes(m))) return 'military';
    
    // Cargo
    const cargoTypes = ['B74F', 'B77F', 'B748', 'MD11'];
    if (cargoTypes.some(c => typeCode.includes(c))) return 'cargo';
    
    // Wide-body airliners
    const widebodyTypes = ['A330', 'A340', 'A350', 'A380', 'B767', 'B777', 'B787', 'B747'];
    if (widebodyTypes.some(w => typeCode.includes(w))) return 'airliner';
    
    // Narrow-body airliners
    const narrowbodyTypes = ['A318', 'A319', 'A320', 'A321', 'B737', 'B757'];
    if (narrowbodyTypes.some(n => typeCode.includes(n))) return 'airliner';
    
    // Business jets
    const bizjetTypes = ['C510', 'C525', 'C560', 'CL60', 'G550', 'G650', 'LJ45'];
    if (bizjetTypes.some(b => typeCode.includes(b))) return 'jet';
    
    // Props
    const propTypes = ['C172', 'C182', 'PA28', 'PA32', 'BE36', 'SR22', 'TBM9', 'PC12'];
    if (propTypes.some(p => typeCode.includes(p))) return 'prop';
  }
  
  // Default based on category
  if (category === 'A5' || category === 'A4' || category === 'A3') return 'airliner';
  if (category === 'A2') return 'jet';
  if (category === 'A1') return 'prop';
  
  if (isMilitary(aircraft)) return 'military';
  if (isHelicopter(aircraft)) return 'helicopter';
  
  return 'unknown';
}

/**
 * Get aircraft color
 */
function getAircraftColor(aircraft) {
  const type = classifyAircraft(aircraft);
  return AIRCRAFT_COLORS[type] || AIRCRAFT_COLORS.unknown;
}

/**
 * Get data source
 */
function getDataSource(aircraft) {
  if (!aircraft) return 'unknown';
  if (aircraft.mlat && aircraft.mlat.length > 0) return 'mlat';
  if (aircraft.tisb && aircraft.tisb.length > 0) return 'tisb';
  return 'adsb';
}

// Spatial index instance
const spatialIndex = new RBush();

/**
 * Worker API exposed via Comlink
 */
const processor = {
  /**
   * Process raw aircraft data - classify and prepare for rendering
   * Skips reclassification for already-processed aircraft (differential processing)
   */
  processAircraft(rawAircraft) {
    if (!rawAircraft || !Array.isArray(rawAircraft)) {
      return [];
    }
    
    return rawAircraft.map(ac => {
      // Skip if already processed (has classification data)
      // This provides significant performance improvement on subsequent polls
      if (ac._classification && ac._iconType && ac._color) {
        // Only update dynamic fields
        return {
          ...ac,
          _onGround: isOnGround(ac),
          _emergency: isEmergency(ac),
        };
      }
      
      // Full processing for new aircraft
      return {
        ...ac,
        _classification: classifyAircraft(ac),
        _iconType: getAircraftIconType(ac),
        _color: getAircraftColor(ac),
        _dataSource: getDataSource(ac),
        _onGround: isOnGround(ac),
        _emergency: isEmergency(ac),
      };
    });
  },

  /**
   * Filter aircraft based on filter settings
   */
  filterAircraft(aircraft, filters) {
    if (!aircraft || !filters) return aircraft;

    return aircraft.filter(ac => {
      // Type filter
      const type = ac._classification || classifyAircraft(ac);
      if (!filters.types[type] && type !== 'emergency') {
        return false;
      }

      // Altitude filter
      if (filters.altitude?.enabled) {
        const altitude = ac.alt_baro || ac.alt_geom || 0;
        if (altitude === 'ground') {
          if (filters.altitude.min > 0) return false;
        } else if (altitude < filters.altitude.min || altitude > filters.altitude.max) {
          return false;
        }
      }

      // Speed filter
      if (filters.speed?.enabled) {
        const speed = ac.gs || 0;
        if (speed < filters.speed.min || speed > filters.speed.max) {
          return false;
        }
      }

      // Status filter (airborne/ground)
      const onGround = ac._onGround || isOnGround(ac);
      if (onGround && !filters.status?.onGround) return false;
      if (!onGround && !filters.status?.airborne) return false;

      // Data source filter
      const dataSource = ac._dataSource || getDataSource(ac);
      if (filters.dataSource && !filters.dataSource[dataSource]) {
        return false;
      }

      // Search filter
      if (filters.search?.query) {
        const query = filters.search.query.toLowerCase().trim();
        const field = filters.search.field;
        let matches = false;

        if (field === 'all' || field === 'callsign') {
          if (ac.flight && ac.flight.toLowerCase().includes(query)) matches = true;
        }
        if (field === 'all' || field === 'registration') {
          if (ac.r && ac.r.toLowerCase().includes(query)) matches = true;
        }
        if (field === 'all' || field === 'type') {
          if (ac.t && ac.t.toLowerCase().includes(query)) matches = true;
        }

        if (!matches) return false;
      }

      return true;
    });
  },

  /**
   * Update the spatial index with aircraft positions
   */
  updateSpatialIndex(aircraft) {
    spatialIndex.clear();
    
    const items = aircraft
      .filter(ac => ac.lat && ac.lon)
      .map(ac => ({
        minX: ac.lon,
        minY: ac.lat,
        maxX: ac.lon,
        maxY: ac.lat,
        aircraft: ac,
      }));
    
    spatialIndex.load(items);
    return items.length;
  },

  /**
   * Query aircraft within bounds
   */
  queryBounds(bounds) {
    const results = spatialIndex.search({
      minX: bounds.west,
      minY: bounds.south,
      maxX: bounds.east,
      maxY: bounds.north,
    });
    
    return results.map(item => item.aircraft);
  },

  /**
   * Find aircraft near a point
   */
  queryNearPoint(lon, lat, radiusDegrees = 0.01) {
    const results = spatialIndex.search({
      minX: lon - radiusDegrees,
      minY: lat - radiusDegrees,
      maxX: lon + radiusDegrees,
      maxY: lat + radiusDegrees,
    });
    
    return results.map(item => item.aircraft);
  },

  /**
   * Combined process, filter, and index operation
   */
  processAndFilter(rawAircraft, filters) {
    const processed = this.processAircraft(rawAircraft);
    const filtered = this.filterAircraft(processed, filters);
    const indexedCount = this.updateSpatialIndex(processed);
    
    return {
      processed,
      filtered,
      indexedCount,
      totalCount: rawAircraft.length,
      filteredCount: filtered.length,
    };
  },
};

// Expose the API via Comlink
expose(processor);
