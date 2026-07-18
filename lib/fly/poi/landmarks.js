/**
 * Landmark POIs — smaller-radius flavor markers, global spread.
 * Hand-curated, offline (no geocoding APIs).
 *
 * Round 8 (P5) positional extension (backward-compatible — every consumer
 * that destructures [name, lat, lon] keeps working):
 *   [name, lat, lon, archetype|null, heightM, opts?]
 * archetype picks the procedural monument geometry (lib/fly/landmarks-3d.js:
 * spire, obelisk, statue, dome, arch, bridge, castle, crownTower); null =
 * natural/formless feature, no monument (the terrain or the letter carries
 * it). heightM is the REAL-WORLD structure height in meters — monuments
 * scale from it (× LANDMARKS_3D.scaleBoost), so realism here matters.
 * Bridges add { spanM, headingDeg } (deck length + compass axis).
 */
export const LANDMARKS = [
  // --- New York area (spawn neighborhood) ----------------------------------
  ['Statue of Liberty', 40.6892, -74.0445, 'statue', 93],
  ['Central Park', 40.7829, -73.9654, null, 0],
  ['Times Square', 40.758, -73.9855, 'crownTower', 111], // One Times Square (the ball drop)
  ['Wall Street', 40.7069, -74.0113, 'crownTower', 283], // 40 Wall Street
  ['Empire State Building', 40.7484, -73.9857, 'spire', 443],
  ['One World Trade', 40.7127, -74.0134, 'spire', 541],
  ['Brooklyn Bridge', 40.7061, -73.9969, 'bridge', 84, { spanM: 1500, headingDeg: 119 }],
  ['Coney Island', 40.5749, -73.9857, null, 0],
  ['Verrazzano Bridge', 40.6066, -74.0447, 'bridge', 211, { spanM: 2200, headingDeg: 77 }],
  ['George Washington Bridge', 40.8517, -73.9527, 'bridge', 184, { spanM: 1450, headingDeg: 109 }],
  ['Yankee Stadium', 40.8296, -73.9262, 'dome', 50],
  ['Jones Beach', 40.5946, -73.5107, null, 0],
  ['Sandy Hook', 40.4514, -73.9995, null, 0],
  // --- United States ---------------------------------------------------------
  ['Independence Hall', 39.9496, -75.15, 'spire', 51],
  ['White House', 38.8977, -77.0365, 'castle', 21],
  ['US Capitol', 38.8899, -77.0091, 'dome', 88],
  ['National Mall', 38.8895, -77.0227, 'obelisk', 169], // the Washington Monument IS the Mall's landmark
  ['The Pentagon', 38.8719, -77.0563, 'castle', 24],
  ['Niagara Falls', 43.0962, -79.0377, null, 0],
  // Round 8.5 §C user waypoint: 1115 Broadway St, Ann Arbor MI (the record
  // store). Church archetype per the user's "find a church as the marker".
  // Height is a prominent steeple (not the real ~32m) so the monument reads
  // as a waypoint from flight altitude — a literal 32m church is a speck.
  ['Information Entropy', 42.28994, -83.73803, 'church', 58],
  ['Gateway Arch', 38.6247, -90.1848, 'arch', 192],
  ['The Bean', 41.8827, -87.6233, 'dome', 10],
  ['Willis Tower', 41.8789, -87.6359, 'crownTower', 527],
  ['French Quarter', 29.9584, -90.0644, 'spire', 43], // St. Louis Cathedral
  ['The Alamo', 29.426, -98.4861, 'castle', 10],
  ['Space Center Houston', 29.5519, -95.091, 'obelisk', 110], // Saturn V
  ['Walt Disney World', 28.3852, -81.5639, 'castle', 58],
  ['Kennedy Space Center', 28.5729, -80.649, 'obelisk', 110], // Saturn V
  ['Mount Rushmore', 43.8791, -103.4591, 'statue', 18],
  ['Devils Tower', 44.5902, -104.7146, null, 0],
  ['Old Faithful', 44.4605, -110.8281, null, 0],
  ['Grand Canyon', 36.0544, -112.1401, null, 0],
  ['Monument Valley', 36.998, -110.0985, null, 0],
  ['Zion Canyon', 37.2982, -113.0263, null, 0],
  ['Hoover Dam', 36.0161, -114.7377, 'castle', 140],
  ['Las Vegas Strip', 36.1147, -115.1728, 'crownTower', 350], // the Strat tower
  ['Death Valley', 36.2461, -116.8172, null, 0],
  ['El Capitan', 37.7341, -119.6379, null, 0],
  ['Lake Tahoe', 39.0968, -120.0324, null, 0],
  ['Golden Gate Bridge', 37.8199, -122.4783, 'bridge', 227, { spanM: 2000, headingDeg: 17 }],
  ['Alcatraz', 37.827, -122.423, 'castle', 30],
  ['Big Sur', 36.2704, -121.8081, null, 0],
  ['Hollywood Sign', 34.1341, -118.3215, null, 0],
  ['Griffith Observatory', 34.1184, -118.3004, 'dome', 20],
  ['Santa Monica Pier', 34.0083, -118.4987, null, 0],
  ['Disneyland', 33.8121, -117.919, 'castle', 23],
  ['Space Needle', 47.6205, -122.3493, 'spire', 184],
  ['Mount Rainier', 46.8523, -121.7603, null, 0],
  ['Mount St. Helens', 46.1914, -122.1956, null, 0],
  ['Crater Lake', 42.9446, -122.109, null, 0],
  ['Denali', 63.1148, -151.1926, null, 0],
  ['Pearl Harbor', 21.3649, -157.9497, null, 0],
  ['Diamond Head', 21.2606, -157.8044, null, 0],
  // --- Canada / Mexico / Caribbean ------------------------------------------
  ['CN Tower', 43.6426, -79.3871, 'spire', 553],
  ['Banff', 51.4968, -115.9281, null, 0],
  ['Whistler', 50.1163, -122.9574, null, 0],
  ['Chichén Itzá', 20.6843, -88.5678, 'castle', 30], // El Castillo, literally
  ['Teotihuacan', 19.6925, -98.8439, 'castle', 65], // Pyramid of the Sun
  ['Cabo Arch', 22.8778, -109.8946, 'arch', 40],
  // --- South America -----------------------------------------------------------
  ['Christ the Redeemer', -22.9519, -43.2105, 'statue', 38],
  ['Machu Picchu', -13.1631, -72.545, 'castle', 18],
  ['Iguazu Falls', -25.6953, -54.4367, null, 0],
  ['Angel Falls', 5.9701, -62.5362, null, 0],
  ['Uyuni Salt Flat', -20.1338, -67.4891, null, 0],
  ['Galápagos', -0.4397, -90.2687, null, 0],
  ['Perito Moreno', -50.4967, -73.1377, null, 0],
  ['Easter Island', -27.1127, -109.3497, 'statue', 10], // moai
  // --- Europe --------------------------------------------------------------------
  ['Tower Bridge', 51.5055, -0.0754, 'bridge', 65, { spanM: 244, headingDeg: 10 }],
  ['Big Ben', 51.5007, -0.1246, 'crownTower', 96], // lit clock faces = the crown band
  ['Stonehenge', 51.1789, -1.8262, 'arch', 8], // trilithon
  ['White Cliffs of Dover', 51.1344, 1.3277, null, 0],
  ['Edinburgh Castle', 55.9486, -3.1999, 'castle', 40],
  ["Giant's Causeway", 55.2408, -6.5116, null, 0],
  ['Cliffs of Moher', 52.9715, -9.4309, null, 0],
  ['Eiffel Tower', 48.8584, 2.2945, 'spire', 330],
  ['Versailles', 48.8049, 2.1204, 'castle', 27],
  ['Mont-Saint-Michel', 48.6361, -1.5115, 'castle', 80], // abbey above the rock (DEM carries the mount)
  ['Mont Blanc', 45.8326, 6.8652, null, 0],
  ['Matterhorn', 45.9766, 7.6585, null, 0],
  ['Neuschwanstein', 47.5576, 10.7498, 'castle', 65],
  ['Cologne Cathedral', 50.9413, 6.9583, 'spire', 157],
  ['Brandenburg Gate', 52.5163, 13.3777, 'arch', 26],
  ['Leaning Tower of Pisa', 43.723, 10.3966, 'crownTower', 57],
  ['Colosseum', 41.8902, 12.4922, 'dome', 48],
  ["St. Peter's Basilica", 41.9022, 12.4539, 'dome', 136],
  ['Mount Vesuvius', 40.8214, 14.426, null, 0],
  ['Santorini', 36.3932, 25.4615, null, 0],
  ['Acropolis', 37.9715, 23.7267, 'castle', 20],
  ['Hagia Sophia', 41.0086, 28.9802, 'dome', 55],
  ['Sagrada Família', 41.4036, 2.1744, 'spire', 172],
  ['Alhambra', 37.176, -3.5881, 'castle', 26],
  ['Rock of Gibraltar', 36.1408, -5.3536, null, 0],
  ['Geirangerfjord', 62.1049, 7.0987, null, 0],
  ['Red Square', 55.7539, 37.6208, 'dome', 65], // St. Basil's
  // --- Africa / Middle East ---------------------------------------------------------
  ['Giza Pyramids', 29.9792, 31.1342, 'castle', 139], // Khufu — the chunky-mass archetype
  ['Valley of the Kings', 25.7402, 32.6014, null, 0],
  ['Suez Canal', 30.4278, 32.3439, null, 0],
  ['Mount Kilimanjaro', -3.0674, 37.3556, null, 0],
  ['Serengeti', -2.3333, 34.8333, null, 0],
  ['Victoria Falls', -17.9243, 25.8572, null, 0],
  ['Okavango Delta', -19.2833, 22.9, null, 0],
  ['Erg Chebbi', 31.1499, -3.9772, null, 0],
  ['Table Mountain', -33.9628, 18.4098, null, 0],
  ['Petra', 30.3285, 35.4444, 'castle', 40], // the Treasury facade
  ['Dead Sea', 31.559, 35.4732, null, 0],
  ['Burj Khalifa', 25.1972, 55.2744, 'spire', 828],
  ['Palm Jumeirah', 25.1124, 55.139, null, 0],
  // --- Asia ----------------------------------------------------------------------------
  ['Taj Mahal', 27.1751, 78.0421, 'dome', 73],
  ['Mount Everest', 27.9881, 86.925, null, 0],
  ['Angkor Wat', 13.4125, 103.867, 'castle', 65],
  ['Ha Long Bay', 20.9101, 107.1839, null, 0],
  ['Great Wall', 40.3542, 116.0022, 'castle', 12], // Badaling watchtowers
  ['Borobudur', -7.6079, 110.2038, 'dome', 35], // the stupa
  ['Petronas Towers', 3.1579, 101.7116, 'crownTower', 452],
  ['Marina Bay Sands', 1.2834, 103.8607, 'crownTower', 194],
  ['Mount Fuji', 35.3606, 138.7274, null, 0],
  ['Fushimi Inari', 34.9671, 135.7727, 'arch', 8], // torii
  ['Itsukushima Shrine', 34.296, 132.3198, 'arch', 16], // the floating torii
  // --- Oceania ---------------------------------------------------------------------------
  ['Sydney Opera House', -33.8568, 151.2153, 'dome', 65],
  ['Uluru', -25.3444, 131.0369, null, 0],
  ['Great Barrier Reef', -18.2871, 147.6992, null, 0],
  ['Twelve Apostles', -38.6621, 143.1051, null, 0],
  ['Milford Sound', -44.6717, 167.9256, null, 0],
  ['Bora Bora', -16.5004, -151.7415, null, 0],
];
