import { AIRPORT_BUZZ } from './fly-constants';
import { buildPoiList } from './poi-data';

/**
 * Round 7: airport low-pass / touch-and-go detection — runways become
 * gameplay. Pure class, fed at 1Hz from the Contracts interval (never per
 * frame); scans the airports subset of the offline POI DB with a bbox
 * pre-filter (~250 entries — trivial at 1Hz).
 *
 * AGL is measured against the AIRPORT's sampled elevation (lazily cached,
 * null-tolerant while DEM streams — the PoiLetters pattern), not MSL, so
 * high-elevation fields judge fairly. The flight model's hard floor is
 * FLIGHT.floorClearance (50m) — "touch-and-go" therefore triggers on a
 * dip below touchAglM (75m) followed by a prompt climb, not wheels-on.
 *
 * Events: { type: 'buzz' | 'touch-go', airport: { name, lat, lon } }.
 * Per-airport per-type cooldown; caller resets on warp (teleports must not
 * mint passes).
 */
export class AirportBuzzDetector {
  constructor(airports = null) {
    this.airports = airports ?? buildPoiList().filter((p) => p.kind === 'airport');
    this._elev = new Map(); // airport name -> sampled elevation (m)
    this._cool = new Map(); // `${type}:${name}` -> nowSec until which it's quiet
    this._buzzTicks = 0;
    this._buzzAirport = null;
    this._dip = null; // { airport, minAgl, atSec } — armed below touchAglM
  }

  /** Hard state clear (warp teleports, style resets). */
  reset() {
    this._buzzTicks = 0;
    this._buzzAirport = null;
    this._dip = null;
  }

  _nearest(px, pz, rWorld) {
    let best = null;
    let bestD = rWorld;
    for (const a of this.airports) {
      const dx = a.wx - px;
      if (dx > rWorld || dx < -rWorld) continue;
      const dz = a.wz - pz;
      if (dz > rWorld || dz < -rWorld) continue;
      const d = Math.hypot(dx, dz);
      if (d < bestD) {
        bestD = d;
        best = a;
      }
    }
    return best;
  }

  /**
   * @param nowSec monotonic seconds
   * @param flight FlightModel (pos absolute world, speed m/s)
   * @param engine TerrainEngine (getElevationAt lon,lat → m | null)
   * @param k mercator scale at the player (world units per true meter)
   * @returns event or null
   */
  update(nowSec, flight, engine, k) {
    const airport = this._nearest(flight.pos.x, flight.pos.z, AIRPORT_BUZZ.radiusM * k);
    if (!airport) {
      this._buzzTicks = 0;
      this._buzzAirport = null;
      this._dip = null;
      return null;
    }
    // Lazy elevation cache (null while the DEM streams → judge next tick)
    let elev = this._elev.get(airport.name);
    if (elev == null) {
      const s = engine?.getElevationAt?.(airport.lon, airport.lat);
      if (s == null) return null;
      elev = s;
      this._elev.set(airport.name, elev);
    }
    const agl = flight.pos.y - elev;

    // --- touch-and-go: dip below touchAglM, then climb out promptly -------
    if (agl < AIRPORT_BUZZ.touchAglM) {
      if (!this._dip || this._dip.airport !== airport.name) {
        this._dip = { airport: airport.name, minAgl: agl, atSec: nowSec };
      } else if (agl < this._dip.minAgl) {
        this._dip.minAgl = agl;
        this._dip.atSec = nowSec;
      }
    } else if (this._dip && this._dip.airport === airport.name) {
      const climbed = agl - this._dip.minAgl >= AIRPORT_BUZZ.climbDeltaM;
      const fresh = nowSec - this._dip.atSec <= AIRPORT_BUZZ.climbWindowSec;
      if (climbed && fresh && this._fire('touch-go', airport, nowSec)) {
        this._dip = null;
        return { type: 'touch-go', airport };
      }
      if (!fresh) this._dip = null;
    }

    // --- buzz: sustained low + fast pass ----------------------------------
    if (agl < AIRPORT_BUZZ.buzzAglM && flight.speed > AIRPORT_BUZZ.minSpeedMps) {
      this._buzzTicks = this._buzzAirport === airport.name ? this._buzzTicks + 1 : 1;
      this._buzzAirport = airport.name;
      if (this._buzzTicks >= 2 && this._fire('buzz', airport, nowSec)) {
        return { type: 'buzz', airport };
      }
    } else {
      this._buzzTicks = 0;
      this._buzzAirport = null;
    }
    return null;
  }

  _fire(type, airport, nowSec) {
    const key = `${type}:${airport.name}`;
    if ((this._cool.get(key) ?? 0) > nowSec) return false;
    this._cool.set(key, nowSec + AIRPORT_BUZZ.cooldownSec);
    return true;
  }
}
