/**
 * R25 B FLIGHT PLAN — the curated Free Flight destinations (plan
 * FLY_ROUND25_PLAN.md, Decisions: "Featured list").
 *
 * Every entry is an AIRBORNE START: the player appears at (lat, lon) at `altM`
 * metres MSL, nose on `headingDeg` (compass, 0 = north, 90 = east — the
 * flight model's heading convention), at the aircraft's cruise speed.
 *
 *   groundM   representative ground/water elevation directly under the start
 *             (used only when the DEM under the start is not resident yet).
 *   clearM    the HIGHEST terrain or structure within 5 km of the start,
 *             from published summit / tower heights (named inline). The rule
 *             scripts/verify-r25-flight-plan.mjs enforces: altM >= clearM + 400,
 *             so no featured start can open inside or just above a ridge.
 *   title     the title-screen orbit around this spot ({radiusM, aglM}; read by
 *             A's title camera via spawn.title).
 *   tz        coarse standard-time UTC offset (hours) for the title's clock chip.
 *   glyph     icon key for the hangar's destination grid.
 *
 * Coordinates are WGS84 decimal degrees, hand-checked against the named
 * landmark positions below (all inside the web-mercator band, all verified by
 * the node gate). Offline and keyless like the rest of the POI data.
 */

export const DESTINATIONS = Object.freeze(
  [
    {
      id: 'grand-canyon',
      name: 'Grand Canyon',
      region: 'Arizona, USA',
      // ~2 km north of Yavapai Point (36.0658, -112.1175), over the inner
      // canyon; the Colorado runs ~3 km further north.
      lat: 36.085,
      lon: -112.11,
      groundM: 1300, // Tonto Platform / Bright Angel drainage below the rim
      // Brahma Temple 2,317 m (~4.4 km NE); Isis Temple 2,174 m; South Rim
      // at Yavapai ~2,170 m. North Rim (2,500 m+) is > 12 km away.
      clearM: 2350,
      altM: 2800,
      headingDeg: 20, // across the canyon toward the temples and the North Rim
      tz: -7,
      glyph: 'canyon',
      blurb: 'Two billion years of rock, a mile deep. Drop below the rim if you dare.',
      title: { radiusM: 4000, aglM: 900 },
    },
    {
      id: 'manhattan',
      name: 'Manhattan',
      region: 'New York, USA',
      // Upper New York Bay off the Battery (Battery Park 40.7033, -74.0170).
      lat: 40.7,
      lon: -74.03,
      groundM: 0,
      // One World Trade Center 541 m (40.7127, -74.0134, ~2.0 km). The
      // Empire State Building (443 m) is ~5.4 km away.
      clearM: 545,
      altM: 950,
      headingDeg: 25, // up the Hudson with the skyline on the right
      tz: -5,
      glyph: 'city',
      blurb: 'The skyline from the harbour, then straight up the Hudson.',
      title: { radiusM: 2600, aglM: 700 },
    },
    {
      id: 'swiss-alps',
      name: 'Swiss Alps',
      region: 'Lauterbrunnen, Switzerland',
      // Lauterbrunnen village (46.5935, 7.9091), valley floor ~800 m.
      lat: 46.5935,
      lon: 7.9091,
      groundM: 800,
      // Within 5 km: Schwarzmönch 2,649 m, Tschuggen 2,521 m, Lauberhorn
      // 2,472 m, Männlichen 2,343 m. Jungfrau (4,158 m) is ~7.5 km SE and
      // Schilthorn (2,970 m) ~6.9 km SW — both outside the 5 km ring.
      clearM: 2750,
      altM: 3150,
      headingDeg: 185, // up the U-valley toward Stechelberg and the Jungfrau wall
      tz: 1,
      glyph: 'peak',
      blurb: 'Seventy-two waterfalls, a glacier valley and the Jungfrau wall.',
      title: { radiusM: 3200, aglM: 1100 },
    },
    {
      id: 'rio',
      name: 'Rio de Janeiro',
      region: 'Brazil',
      // Guanabara Bay entrance between Sugarloaf (-22.9486, -43.1566) and
      // the Santa Cruz fortress.
      lat: -22.94,
      lon: -43.14,
      groundM: 0,
      // Sugarloaf 396 m (~1.9 km). Corcovado (710 m + 38 m statue) is
      // ~7.3 km west — outside the ring but dead ahead, so altM clears it too.
      clearM: 450,
      altM: 1100,
      headingDeg: 260, // over Sugarloaf toward Christ the Redeemer
      tz: -3,
      glyph: 'coast',
      blurb: 'Sugarloaf, Copacabana and Christ the Redeemer in one sweep.',
      title: { radiusM: 3000, aglM: 800 },
    },
    {
      id: 'tokyo',
      name: 'Tokyo',
      region: 'Japan',
      // Odaiba waterfront on Tokyo Bay (Rainbow Bridge 35.6365, 139.7630).
      lat: 35.625,
      lon: 139.785,
      groundM: 0,
      // Tokyo Tower 333 m (35.6586, 139.7454, ~5.2 km); Azabudai Hills Mori
      // JP Tower 330 m (~5.7 km). Tokyo Skytree (634 m) is ~10 km north.
      clearM: 340,
      altM: 900,
      headingDeg: 315, // across the bay to Shiodome and Tokyo Tower
      tz: 9,
      glyph: 'city',
      blurb: 'Rainbow Bridge, Tokyo Tower and a city that never ends.',
      title: { radiusM: 3000, aglM: 700 },
    },
    {
      id: 'yosemite',
      name: 'Yosemite Valley',
      region: 'California, USA',
      // West end of the valley below Tunnel View (37.7156, -119.6770).
      lat: 37.72,
      lon: -119.66,
      groundM: 1200,
      // El Capitan 2,307 m (37.7340, -119.6377, ~2.5 km); Eagle Peak
      // 2,358 m (~4.8 km); Dewey Point 2,270 m. Sentinel Dome (2,476 m) is
      // ~6.7 km east.
      clearM: 2400,
      altM: 2850,
      headingDeg: 76, // down the valley between El Capitan and Bridalveil to Half Dome
      tz: -8,
      glyph: 'valley',
      blurb: 'El Capitan on the left, Bridalveil on the right, Half Dome ahead.',
      title: { radiusM: 3200, aglM: 1000 },
    },
    {
      id: 'sydney',
      name: 'Sydney Harbour',
      region: 'Australia',
      // Port Jackson just north-west of Bradleys Head (-33.8537, 151.2461).
      lat: -33.85,
      lon: 151.24,
      groundM: 0,
      // Sydney Tower 309 m (-33.8705, 151.2089, ~3.7 km); Crown Sydney 271 m.
      clearM: 320,
      altM: 750,
      headingDeg: 265, // toward the Opera House and the Harbour Bridge
      tz: 10,
      glyph: 'coast',
      blurb: 'The Opera House, the Coathanger and a harbour full of sails.',
      title: { radiusM: 2400, aglM: 600 },
    },
    {
      id: 'dubai',
      name: 'Dubai',
      region: 'United Arab Emirates',
      // Just off the Jumeirah coast, north-west of Downtown.
      lat: 25.215,
      lon: 55.235,
      groundM: 0,
      // Burj Khalifa 828 m (25.1972, 55.2744, ~4.4 km).
      clearM: 830,
      altM: 1250,
      headingDeg: 117, // straight at the Burj Khalifa
      tz: 4,
      glyph: 'desert',
      blurb: 'The tallest building on Earth rising out of the desert.',
      title: { radiusM: 2800, aglM: 800 },
    },
    {
      id: 'napali',
      name: 'Nāpali Coast',
      region: 'Kauaʻi, Hawaiʻi',
      // Offshore of Kalalau Beach (22.1714, -159.6558).
      lat: 22.185,
      lon: -159.665,
      groundM: 0,
      // Kalalau Lookout rim 1,230 m (22.1510, -159.6461, ~4.2 km); Puʻu o
      // Kila 1,241 m (~5 km). Waiʻaleʻale (1,569 m) is ~20 km inland.
      clearM: 1300,
      altM: 1700,
      headingDeg: 50, // north-east along the fluted sea cliffs toward Kēʻē
      tz: -10,
      glyph: 'coast',
      blurb: 'Knife-edge sea cliffs and hanging valleys only reachable by air.',
      title: { radiusM: 3000, aglM: 900 },
    },
    {
      id: 'geirangerfjord',
      name: 'Geirangerfjord',
      region: 'Norway',
      // On the fjord east of the Seven Sisters falls (62.1063, 7.0944).
      lat: 62.11,
      lon: 7.13,
      groundM: 0,
      // The fjord walls climb to ~1,500–1,700 m within 5 km; Dalsnibba
      // (1,476 m) is ~7 km south-east of Geiranger village.
      clearM: 1750,
      altM: 2150,
      headingDeg: 100, // up the fjord toward Geiranger village
      tz: 1,
      glyph: 'fjord',
      blurb: 'A UNESCO fjord of waterfalls and cliff farms. Fly it low.',
      title: { radiusM: 3000, aglM: 1000 },
    },
    {
      id: 'columbus-practice',
      name: 'Columbus',
      region: 'Ohio State practice area',
      // KOSU runway 09R threshold (FAA NASR, lib/fly/operations-airports.js):
      // today's glider practice spot, 600 m above the 275 m field.
      lat: 40.0771,
      lon: -83.0816,
      groundM: 275,
      // Central Ohio: no terrain above ~330 m within 5 km; downtown Columbus
      // (Rhodes Tower 191 m AGL) is ~14 km south-east.
      clearM: 330,
      altM: 875,
      headingDeg: 0,
      tz: -5,
      glyph: 'field',
      blurb: 'Home field. Quiet sky over Ohio State to learn your aircraft.',
      title: { radiusM: 2600, aglM: 600 },
    },
  ].map((d) => Object.freeze({ ...d, kind: 'featured', title: Object.freeze({ ...d.title }) }))
);

const BY_ID = new Map(DESTINATIONS.map((d) => [d.id, d]));

/** A featured destination by id, or null. */
export function destinationById(id) {
  return (typeof id === 'string' && BY_ID.get(id)) || null;
}
