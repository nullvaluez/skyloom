/**
 * The trailer shot table — the single declarative source for what gets
 * captured, where, under what sun, with which camera move and which overlay.
 *
 * `capture.js` executes these; nothing about a shot is hard-coded in the
 * runner. Re-cutting the trailer means editing this file, not the runner.
 *
 * FEATURE CLAIMS ARE LOAD-BEARING. Every `text` line below is a claim about
 * the SHIPPED game, and each shot carries a `claim` field naming the round
 * and mechanism that makes it true. A line with no mechanism behind it does
 * not go in the trailer (brief §3: "Don't invent claims").
 *
 * Camera vocabulary (see capture.js `runMove`):
 *   photoOrbit  enter photo mode (P), then advance `photoRig._look.yaw` — the
 *               HUD is hidden but AttributionBar survives (verify-photo), and
 *               the plane KEEPS FLYING underneath. The beauty camera.
 *   pinnedPose  freeze heading/pitch/bank/speed at a pose (the harness
 *               `pinScene` idiom) — for shots that must not drift.
 *   freeFlight  let the flight model fly; optionally hold boost.
 *   intercept   `traffic.getNearest()` → `interceptHex()` → `C` wing-cam.
 *
 * Sun vocabulary (see sun.js): elevation-keyed, solved PER LOCATION, because
 * R19 re-keyed every sky bucket on elevation and a timestamp that is dusk in
 * London is mid-afternoon in Los Angeles.
 */

/** Locations, kept separate so a shot can be re-aimed without touching prose. */
const PLACES = {
  manhattan: { lat: 40.7128, lon: -74.006, label: 'Lower Manhattan, New York' },
  jfk: { lat: 40.64, lon: -73.78, label: 'JFK approach, New York' },
  eiffel: { lat: 48.8584, lon: 2.2945, label: 'Eiffel Tower, Paris' },
  liberty: { lat: 40.6892, lon: -74.0445, label: 'Statue of Liberty, New York' },
  colosseum: { lat: 41.8902, lon: 12.4922, label: 'Colosseum, Rome' },
  bigben: { lat: 51.5007, lon: -0.1246, label: 'Big Ben / Thames, London' },
  chicago: { lat: 41.8781, lon: -87.6298, label: 'Chicago' },
  powell: { lat: 40.158, lon: -83.075, label: 'Powell, Ohio' },
  owens: { lat: 36.601, lon: -118.06, label: 'Owens Valley, California' },
};

/** The UTC day every solved sun time is anchored to (kept stable for repeats). */
const DAY_UTC = Date.UTC(2026, 6, 28);

const SHOTS = [
  {
    id: 1,
    slug: 'title-manhattan',
    place: PLACES.manhattan,
    altM: 800,
    heading: 205,
    sun: { kind: 'elevation', deg: 6, phase: 'setting' }, // the golden band
    camera: { move: 'photoOrbit', degPerSec: 2.6, pitchDeg: -7, distM: 300 },
    overlay: { kind: 'title', wordmark: 'SKYLOOM', tagline: 'FLY THE REAL WORLD' },
    settleMs: 24000,
    recordMs: 8500,
    claim: 'Title shot. Golden-hour lobe is R19 SkyDome; satellite style is the only style captured.',
  },
  {
    id: 2,
    slug: 'skyline-mass',
    place: PLACES.manhattan,
    altM: 2500,
    heading: 250,
    sun: { kind: 'noon' },
    camera: { move: 'photoOrbit', degPerSec: 3.4, pitchDeg: -16, distM: 420 },
    overlay: { kind: 'lower', text: 'REAL CITIES.\nREAL BUILDINGS.', sub: 'STREAMED FROM OPENSTREETMAP' },
    settleMs: 26000,
    recordMs: 7500,
    claim:
      'R18 sat-skyline-engine: z14 block-mass ring, 8.7km reach, Bayer near-field crossfade with SAT_BLDG_FADE. R18/R19/R20 satellite building extrusion from OpenFreeMap footprints.',
  },
  {
    id: 3,
    slug: 'live-traffic',
    place: PLACES.jfk,
    altM: 1500,
    heading: 300,
    sun: { kind: 'elevation', deg: 28, phase: 'setting' },
    camera: { move: 'intercept', cinema: true, waitTrafficMs: 12000 },
    overlay: { kind: 'lower', text: 'EVERY AIRCRAFT IS REAL', sub: 'LIVE ADS-B · UPDATED SECOND BY SECOND' },
    settleMs: 14000,
    recordMs: 8500,
    claim:
      'Live ADS-B via /api/aircraft (adsb.lol / adsb.fi failover, R19 d5076d0). Tracers + contrails are R16 TOD tracers / R6 ribbon contrails. C = cinema wing-cam (R6).',
    requiresTraffic: true,
  },
  {
    id: 4,
    slug: 'monuments',
    // A montage: three sub-beats cut together inside one clip.
    montage: [
      { place: PLACES.eiffel, altM: 700, heading: 40, holdMs: 3200 },
      { place: PLACES.liberty, altM: 500, heading: 160, holdMs: 3200 },
      { place: PLACES.colosseum, altM: 600, heading: 300, holdMs: 3200 },
    ],
    sun: { kind: 'elevation', deg: 22, phase: 'setting' },
    camera: { move: 'photoOrbit', degPerSec: 4.5, pitchDeg: -10, distM: 260 },
    overlay: { kind: 'lower', text: 'TEN REAL LANDMARKS', sub: 'MODELLED, NOT FAKED' },
    settleMs: 20000,
    recordMs: 10500,
    claim:
      'R20 monument-marquee: ten marquee landmarks as real models in one mesh (ESB, Liberty, Big Ben, Taj, Opera House, Colosseum, Willis, Space Needle, Gateway Arch + a bespoke first-party Eiffel).',
  },
  {
    id: 5,
    slug: 'dusk-thames',
    place: PLACES.bigben,
    altM: 900,
    heading: 285,
    sun: { kind: 'elevation', deg: 2, phase: 'setting' }, // R19's P9 elevation
    camera: { move: 'photoOrbit', degPerSec: 2.8, pitchDeg: -9, distM: 320 },
    overlay: { kind: 'lower', text: 'REAL SUN.\nREAL TIME.', sub: 'YOUR LATITUDE · YOUR HOUR' },
    settleMs: 24000,
    recordMs: 8000,
    claim:
      'R16 sun-model.js (latitude + declination). R19 "Dusk Exists": buckets re-keyed on true elevation, golden lobe, 8-step HDRI cross-blend. +2 deg is dusk with ZERO stars.',
  },
  {
    id: 6,
    slug: 'night-city',
    place: PLACES.chicago,
    altM: 1400,
    heading: 95,
    sun: { kind: 'elevation', deg: -12, phase: 'setting' }, // deep night
    camera: { move: 'photoOrbit', degPerSec: 3.0, pitchDeg: -14, distM: 380 },
    overlay: { kind: 'lower', text: 'THE WORLD AT NIGHT', sub: 'ROAD GLOW · WINDOWS · BEACONS' },
    settleMs: 26000,
    recordMs: 8500,
    claim:
      'R16 night ground: sat-road-engine, runway edge lights from aeroway, SatCityGlow sodium domes to 90km, airport beacons. R15 facade window atlas (tier high). R19 suburban night parcel clusters.',
  },
  {
    id: 7,
    slug: 'suburbs-powell',
    place: PLACES.powell,
    altM: 420,
    heading: 75,
    sun: { kind: 'elevation', deg: 34, phase: 'setting' },
    camera: { move: 'freeFlight', speed: 95, pitchHold: 0 },
    overlay: { kind: 'lower', text: 'EVERY TOWN.\nEVERY HOME.', sub: 'DOWN TO THE ROOFLINE' },
    settleMs: 22000,
    recordMs: 8000,
    claim:
      'R20 SAT_POLY_COVER: Powell OH went 15 -> 1,863 streamed footprints / 1,233 houses. R19 ROOF_TYPOLOGY honest suburbia. R20 PARCEL_HOMES where OFM ships nothing.',
  },
  {
    id: 8,
    slug: 'boost-owens',
    place: PLACES.owens,
    altM: 1900,
    heading: 350,
    sun: { kind: 'elevation', deg: 40, phase: 'setting' },
    camera: { move: 'freeFlight', boost: true, speed: 260, pitchHold: -0.05 },
    overlay: { kind: 'lower', text: 'FEEL THE SPEED', sub: 'BOOST · SPEED LINES · FOV PUNCH' },
    settleMs: 20000,
    recordMs: 8000,
    claim:
      'R19 SpeedLines (radial smear + 44 wedge streaks + boost heat-haze, 0 draws) and the measured +3.06 deg boost FOV punch. R18 BOOST_METER is a real meter.',
  },
  {
    id: 9,
    slug: 'weather',
    place: PLACES.manhattan,
    altM: 2100,
    heading: 180,
    sun: { kind: 'elevation', deg: 24, phase: 'setting' },
    weather: null, // null = clear the override → the LIVE sky (brief §3 shot 9)
    camera: { move: 'photoOrbit', degPerSec: 3.0, pitchDeg: -11, distM: 400 },
    overlay: { kind: 'lower', text: 'REAL WEATHER', sub: 'LIVE CLOUD · WIND · VISIBILITY' },
    settleMs: 22000,
    recordMs: 7000,
    optional: true, // keep only if the live sky reads well (brief: "if it reads well live")
    claim:
      'R16 keyless /api/weather (open-meteo -> aviationweather METAR failover) driving weather-model.js damped wx scalars: cloud coverage, visibility fog, wind, rain/snow.',
  },
  {
    id: 10,
    slug: 'end-card',
    // OPTIONAL, and not the canonical end card: `cards.js` produces a better
    // one. Captured here the plate sits over a live scene, so it inherits the
    // scene's frame rate and the flying HUD is still up underneath during the
    // fade. cards.js renders it with no WebGL at all — smooth, HUD-free, and
    // capturable with the network shut. Kept in the table only as the
    // "end card over live gameplay" variant if that is ever wanted.
    place: PLACES.manhattan,
    altM: 1200,
    heading: 200,
    sun: { kind: 'elevation', deg: 10, phase: 'setting' },
    camera: { move: 'still' },
    overlay: {
      kind: 'end',
      wordmark: 'SKYLOOM',
      features: [
        'A LIVING PLANET',
        'LIVE AIR TRAFFIC',
        'REAL WEATHER',
        'NINE AIRCRAFT',
        'FLY ANYWHERE',
      ],
    },
    settleMs: 4000,
    recordMs: 7000,
    optional: true,
    claim:
      'A LIVING PLANET (streamed Esri imagery + OFM vector world). LIVE AIR TRAFFIC (ADS-B). REAL WEATHER (R16 /api/weather). NINE AIRCRAFT (R17 player hangar, lib/fly/player-aircraft.js). FLY ANYWHERE (R5 Atlas warp, 1719-POI DB).',
  },
];

module.exports = { SHOTS, PLACES, DAY_UTC };
