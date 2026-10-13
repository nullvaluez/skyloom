/**
 * GATE TO GATE — the airport service contracts (FLY_GATE_TO_GATE.md
 * "Contracts"). One object, runtime.airports (lib/fly/airport-service/index.js),
 * serves the airfield ground, the gate, the taxi router, the hold rule and the
 * lounge. These typedefs are the shapes every W1–W5 stream builds against; the
 * constants are the shared numbers. Nothing here has behaviour.
 */
import { AIRFIELD } from '../observation-config.js';

/**
 * How far a registered runway is drawn above the endpoint profile in an
 * airfield area: the height field's clearance over terrain plus the runway
 * layer's lift (0.02 + 0.07 = 0.09 m). Physics reads profile + this on drawn
 * runways, so wheels touch the paint rather than sinking 9 cm into it.
 */
export const RUNWAY_DRAWN_LIFT = AIRFIELD.ground.terrain.eps + AIRFIELD.ground.lift.runway;

/** OpsSurface.kind values. Only 'grass' is not pavement (ops/contact.js paved()). */
export const SURFACE_KIND = Object.freeze(['runway', 'runway-osm', 'taxiway', 'apron', 'stand', 'grass']);

/** Prefetch phases, in order. */
export const PREFETCH_PHASES = Object.freeze(['none', 'runways', 'data', 'site', 'model', 'ready', 'error']);

/** Area purposes, highest priority first (planAreas). */
export const AREA_PURPOSES = Object.freeze(['lounge', 'player', 'destination', 'departure', 'nearby']);

/** Airfield tiers (ops-flags.js opsTier). */
export const AIRFIELD_TIERS = Object.freeze(['off', 'registry', 'lite', 'full']);

/** Uniform names of the analytic landing/taxi light pool on airfield materials (PLAYER_GLOW_LIGHTS). */
export const SPOT_UNIFORMS = Object.freeze({ position: 'uAfSpot', direction: 'uAfSpotDir', count: 'uAfSpotN' });

/**
 * @typedef {object} OpsSurface  What is under (x, z).
 * @property {'runway'|'runway-osm'|'taxiway'|'apron'|'stand'|'grass'} kind
 * @property {number} height  absolute metres; a registered runway drawn by a
 *   pinned area = endpoint profile + RUNWAY_DRAWN_LIFT, else the profile
 * @property {object} airport  the registry runway record (runway kinds) or the
 *   area's primary runway
 * @property {number} along  metres along that runway
 * @property {number} cross  metres across it
 * @property {string|null} areaIdent
 * @property {'authored'|'catalog'|'osm'|'set'} source
 */

/**
 * @typedef {object} OpsGround  operations.ground (ops/contact.js). Null = authored.
 * @property {(x: number, z: number) => OpsSurface|null} surfaceAt
 * @property {(x: number, z: number) => number|null} [placementHeight]
 */

/**
 * @typedef {object} PrefetchState
 * @property {'none'|'runways'|'data'|'site'|'model'|'ready'|'error'} phase
 * @property {number} progress  0..1
 * @property {boolean} hasOsm  OSM airfield data exists for the ident
 * @property {boolean} hasGate  a gate start is available (only once the area is ready)
 * @property {string|null} error
 */

/**
 * @typedef {object} TaxiRoute  The only route shape (lib/fly/airfield/airfield-taxi-graph.js, W1 B).
 * @property {string} ident
 * @property {'out'|'in'} kind
 * @property {Float64Array} pts  [x, z, ...] absolute scene
 * @property {Float64Array} local  area-local metres
 * @property {Float64Array} s  cumulative true metres
 * @property {number} lengthM
 * @property {{s0:number, s1:number, ref:string, kind:'taxiway'|'apron'|'runway'|'lead-in'|'pushback'|'lineup'}[]} legs
 * @property {{s:number, holdIndex:number, runwayId:string, runwayLabel:string, kind:'departure'|'crossing', x:number, z:number, dirX:number, dirZ:number}[]} holds
 * @property {{kind:'lineup', runwayId:string, reverse:boolean, s:number, heading:number}|{kind:'stand', standIndex:number, stopS:number}} end
 * @property {string[]} instructions  e.g. 'Taxi to 28L via B, B4', 'Hold short of 28L'
 * @property {'graph'|'grid'|'direct'} source
 */

/**
 * @typedef {object} GateStage  One stand's choreography (lib/fly/airport-service/gate.js, W3).
 * @property {string} ident
 * @property {number} standIndex  an integer into layout.stands (front stands keep today's indices; pier back stands are appended)
 * @property {'regional'|'narrow'|'wide'} cls
 * @property {'bridge'|'apron'|'stairs'} dockKind
 * @property {{x:number, z:number, y:number, heading:number}} parkPose
 * @property {{x:number, z:number, y:number, heading:number}} stopPose
 * @property {(side: -1|1) => {pts: Float64Array, s: Float64Array, endHeading: number}} pushbackPath
 * @property {(side: -1|1) => {pts: Float64Array, s: Float64Array}} leadIn
 * @property {(pose: object) => {distM:number, lateralM:number, mode:'closing'|'stop'|'over'|'idle'}} dockingState
 * @property {{t:number, target:number, state:'docked'|'moving'|'retracted', set:(target:number)=>void}} bridge
 * @property {{attach:(on:boolean)=>void, pose:(flightPose:object)=>void}} tug
 * @property {(mode:string, distM:number, lateralM:number) => void} vdgs
 * @property {(on:boolean) => void} blockMovers
 * @property {(standIndex:number|null) => void} bindPlayerStand  binds the always-reserved rig capacity
 */

/**
 * @typedef {object} HoldState  clearance.js evaluateHold (W1 B; decision 13).
 * @property {'approach'|'holding'|'cleared'} state
 * @property {'traffic-final'|'runway-occupied'|null} reason
 * @property {number|null} etaS
 * @property {number} waitedS  capped by GATE_TO_GATE.maxHoldSec
 * @property {boolean} incursion  rolled through a red bar (graded, never failed)
 */

/**
 * @typedef {object} AreaView  One mounted airfield area (AirportAreas renders these).
 * @property {string} key  ident|round(site.x,1)|round(site.z,1)|site.runwayId|variant
 *   (no purposes, no siteEpoch: lounge → flight never remounts)
 * @property {string} ident
 * @property {Set<string>} purposes  AREA_PURPOSES
 * @property {'full'|'lite'|'registry'} tier
 * @property {object} site  resolveSessionSite (lib/fly/lounge-site.js)
 * @property {object|null} layout
 * @property {GateStage|null} gate
 * @property {TaxiRoute|null} route
 */

/**
 * @typedef {object} AirportService  runtime.airports. Inert while OPS_AIRFIELD is off.
 * @property {boolean} enabled
 * @property {(frame: object) => void} update  2 Hz planAreas + area lifecycle (FlyScene −40)
 * @property {(fn: Function) => Function} subscribe
 * @property {() => AreaView[]} snapshot  stable identity until a change
 * @property {(ident: string) => AreaView|null} area
 * @property {(ident: string, role: 'departure'|'arrival'|'lounge'|'nearby') => Promise<PrefetchState>} prefetch
 * @property {(ident: string) => PrefetchState} prefetchState
 * @property {(x: number, z: number) => OpsSurface|null} surfaceAt
 * @property {(x: number, z: number) => {elev:number, tileZ:number}|null} groundAt
 * @property {(ident: string, wind: object) => {runwayId:string, reverse:boolean, label:string, headwindMs:number, routeLengthM:number}[]} departureOptions
 * @property {(ident: string, aircraftId: string, standIndex?: number) => GateStage|null} gateFor
 * @property {(ident: string, aircraftId: string, opts?: {prefer:'lounge-visible'|'free'}) => {index:number, side:string, cls:string, label:string, visible:boolean, fits:boolean, dock:string}[]} gateOptions
 * @property {(ident: string) => {index:number, side:string, cls:string, x:number, z:number, heading:number}[]} stands
 * @property {(req: {ident:string, runwayId:string, reverse:boolean, from:{x:number, z:number, heading:number}}) => TaxiRoute|null} planDeparture
 * @property {(req: {ident:string, runwayId:string, reverse:boolean, along:number}) => {exits:object[], route:(i:number)=>TaxiRoute}|null} planArrival
 * @property {(route: TaxiRoute|null) => void} setActiveRoute
 * @property {object|null} routeState  {route, s, cross, headingErr, remainingM, instruction, nextHold}
 * @property {(runwayId: string) => {A:string[], B:string[]}|null} papiState
 * @property {(ident: string) => {x:number, y:number, z:number}|null} towerPoint
 * @property {(ident: string) => object|null} diagram  local-metre polylines for the briefing SVG
 * @property {(on: boolean) => void} debugVisible
 */
