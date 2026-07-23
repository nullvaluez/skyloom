/**
 * R14 "AirVenture" — canonical warbird / classic-aircraft rarity dataset.
 *
 * Plain ESM, ZERO imports so it is node-loadable by the audit harness exactly
 * like lib/fly/assets.js. This module is the SINGLE SOURCE OF TRUTH for the
 * 170 warbird/classic ICAO type codes added in Round 14.
 *
 * REGENERATE BY HAND: this file was generated from the deterministic merge of
 * the verified combat + civil lists (scripts scratchpad r14-merge.mjs). To
 * change an entry, edit here directly and keep all three exports in lock-step
 * (same 170 keys). The worker (lib/workers/aircraft-processor.worker.js) keeps
 * an INLINED copy of WARBIRD_ARCHETYPE because it cannot import this module;
 * scripts/verify-warbirds.mjs audits that the inline copy stays identical and
 * that every code here is valid, unique, un-collided, named and tier-banded.
 *
 *   WARBIRD_TYPE_RARITY : exact type CODE -> rarity bonus (added to the
 *                         archetype base in lib/rarity.js, checked FIRST and
 *                         short-circuiting the substring loop).
 *   WARBIRD_ARCHETYPE   : exact type CODE -> traffic archetype string.
 *   WARBIRD_TYPES       : Set of all 170 codes (contracts / lookups).
 */

// Exact type CODE -> rarity bonus. Added to the classification base
// (warbird-prop 45, warbird-jet 45, warbird-heavy 50, classic-transport 40,
// prop/jet 0, helicopter 30) in lib/rarity.js calculateRarity().
export const WARBIRD_TYPE_RARITY = {
  // --- WW2 Fighters ---
  P51:   42, // North American P-51 Mustang
  CORS:  45, // Vought F4U Corsair
  SPIT:  45, // Supermarine Spitfire
  HURI:  42, // Hawker Hurricane
  P38:   47, // Lockheed P-38 Lightning
  P40:   42, // Curtiss P-40 Warhawk
  P47:   45, // Republic P-47 Thunderbolt
  P39:   40, // Bell P-39 Airacobra
  P63:   40, // Bell P-63 Kingcobra
  ME09:  47, // Messerschmitt Bf 109
  FW90:  47, // Focke-Wulf Fw 190
  ZERO:  47, // Mitsubishi A6M Zero
  HCAT:  45, // Grumman F6F Hellcat
  BCAT:  45, // Grumman F8F Bearcat
  TCAT:  42, // Grumman F7F Tigercat
  YAK3:  42, // Yakovlev Yak-3
  YAK9:  40, // Yakovlev Yak-9
  I16:   42, // Polikarpov I-16
  FFLY:  42, // Fairey Firefly
  FURY:  35, // Hawker Fury

  // --- WW2 Bombers ---
  MOSQ:  50, // de Havilland DH.98 Mosquito
  TBM:   45, // Grumman TBM Avenger
  SBD:   45, // Douglas SBD Dauntless
  B17:   40, // Boeing B-17 Flying Fortress
  B24:   45, // Consolidated B-24 Liberator
  B29:   47, // Boeing B-29 Superfortress
  LANC:  47, // Avro Lancaster
  B25:   45, // North American B-25 Mitchell
  A20:   40, // Douglas A-20 Havoc

  // --- WW2 Patrol / Flying Boats ---
  CAT:   45, // Consolidated PBY Catalina
  U16:   40, // Grumman HU-16 Albatross

  // --- WW2 / Vintage Trainers ---
  T6:    15, // North American T-6 Texan / Harvard
  T28:   22, // North American T-28 Trojan
  ST75:  12, // Boeing-Stearman PT-17 Kaydet
  T34P:  12, // Beechcraft T-34 Mentor
  YK52:  10, // Yakovlev Yak-52
  CJ6:   12, // Nanchang CJ-6
  F260:  10, // SIAI-Marchetti SF.260
  FA62:  10, // Fairchild PT-19/PT-26 Cornell
  PT22:  10, // Ryan PT-22 Recruit
  N320:  8, // Nord 3202
  FW44:  10, // Focke-Wulf Fw 44 Stieglitz
  BU81:  10, // Bücker Bü 181 Bestmann
  N3N:   10, // Naval Aircraft Factory N3N
  T50:   45, // Cessna T-50 / UC-78 Bobcat

  // --- Korea / Vietnam Era ---
  A1:    45, // Douglas A-1 Skyraider
  V1:    32, // Grumman OV-1 Mohawk
  V10:   33, // North American Rockwell OV-10 Bronco
  B26:   42, // Douglas A-26 Invader
  S2P:   30, // Grumman S-2 Tracker
  MG21:  42, // Mikoyan-Gurevich MiG-21
  F86:   42, // North American F-86 / Canadair Sabre
  A4:    42, // Douglas A-4 Skyhawk
  A37:   30, // Cessna A-37 Dragonfly

  // --- Early Jets ---
  MG15:  40, // Mikoyan-Gurevich MiG-15
  MG17:  45, // Mikoyan-Gurevich MiG-17
  MG19:  40, // Mikoyan-Gurevich MiG-19
  F104:  40, // Lockheed F-104 Starfighter
  VAMP:  42, // de Havilland DH.100 Vampire
  VNOM:  38, // de Havilland DH.112 Venom
  HUNT:  42, // Hawker Hunter
  ME62:  50, // Messerschmitt Me 262

  // --- Jet Trainers ---
  T33:   40, // Lockheed T-33 Shooting Star
  GNAT:  35, // Folland Gnat
  L39:   30, // Aero L-39 Albatros
  L29:   30, // Aero L-29 Delfin
  FOUG:  30, // Fouga CM.170 Magister
  JPRO:  28, // BAC Jet Provost
  STRK:  30, // BAC 167 Strikemaster
  M339:  28, // Aermacchi MB-339
  M326:  28, // Aermacchi MB-326
  T37:   28, // Cessna T-37 Tweet
  T2:    28, // North American T-2 Buckeye
  TS11:  30, // PZL TS-11 Iskra
  G2GL:  30, // Soko G-2 Galeb
  L159:  25, // Aero L-159 Alca

  // --- Military Transports ---
  C97:   32, // Boeing C-97 / KC-97 Stratofreighter
  C119:  30, // Fairchild C-119 Flying Boxcar
  C123:  30, // Fairchild C-123 Provider
  C82:   28, // Fairchild C-82 Packet
  DHC4:  35, // de Havilland Canada C-7 Caribou

  // --- Warbird Helicopters ---
  HUCO:  55, // Bell AH-1 Cobra
  H500:  40, // Hughes OH-6 Cayuse / 369
  S58P:  40, // Sikorsky H-34 Choctaw
  S55P:  40, // Sikorsky H-19 Chickasaw
  B47G:  30, // Bell 47 / OH-13 Sioux

  // --- Liaison / Observation ---
  O1:    52, // Cessna O-1 Bird Dog
  L5:    50, // Stinson L-5 Sentinel
  BROU:  40, // Max Holste MH.1521 Broussard
  F156:  55, // Fieseler Fi 156 Storch

  // --- Classic Airliners ---
  DC3:   47, // Douglas DC-3
  DC4:   38, // Douglas DC-4
  DC6:   40, // Douglas DC-6
  DC7:   45, // Douglas DC-7
  DC2:   55, // Douglas DC-2
  CONI:  46, // Lockheed L-1049 Super Constellation
  L10:   55, // Lockheed Model 10 Electra
  L12:   52, // Lockheed Model 12 Electra Junior
  L18:   25, // Lockheed Model 18 Lodestar
  M404:  44, // Martin 4-0-4
  CVLP:  30, // Convair CV-240/340/440
  CVLT:  15, // Convair CV-580

  // --- Classic Transports ---
  TRIM:  55, // Ford Trimotor
  JU52:  52, // Junkers Ju 52/3m
  C46:   48, // Curtiss C-46 Commando
  BE18:  45, // Beechcraft Model 18 Twin Beech

  // --- Golden-Age Biplanes ---
  BE17:  55, // Beechcraft Model 17 Staggerwing
  BU33:  50, // Bucker Bu 133 Jungmeister
  WACF:  40, // Waco YMF Classic
  FA24:  40, // Fairchild 24
  S108:  32, // Stinson 108 Voyager
  G2T1:  40, // Great Lakes 2T-1 Sport Trainer
  DH82:  42, // de Havilland DH.82 Tiger Moth
  BU31:  45, // Bucker Bu 131 Jungmann

  // --- Classic General Aviation ---
  J3:    40, // Piper J-3 Cub
  PA18:  38, // Piper PA-18 Super Cub
  CH7A:  35, // Aeronca 7AC Champion
  AR11:  33, // Aeronca 11 Chief
  C120:  32, // Cessna 120
  C140:  32, // Cessna 140
  C170:  33, // Cessna 170
  C195:  45, // Cessna 195 Businessliner
  ERCO:  35, // Ercoupe 415
  GC1:   40, // Globe/Temco GC-1 Swift
  NAVI:  33, // North American / Ryan Navion
  DHC3:  42, // de Havilland Canada DHC-3 Otter
  PA22:  25, // Piper PA-22 Tri-Pacer / Caribbean
  C175:  25, // Cessna 175 Skylark
  C180:  28, // Cessna 180 Skywagon
  C185:  30, // Cessna 185 Skywagon
  PA25:  22, // Piper PA-25 Pawnee
  L11E:  40, // Luscombe 11 Sedan
  DHC1:  35, // de Havilland Canada DHC-1 Chipmunk
  AN2:   50, // Antonov An-2 Colt

  // --- Aerobatic ---
  PTS1:  35, // Pitts Special S-1
  PTS2:  33, // Pitts S-2
  E300:  32, // Extra EA-300
  E200:  32, // Extra EA-200
  EDGE:  40, // Zivko Edge 540
  SU26:  42, // Sukhoi Su-26
  SU29:  40, // Sukhoi Su-29
  SU31:  42, // Sukhoi Su-31
  CP10:  30, // Mudry CAP 10
  CP23:  38, // CAP 231/232
  EAGL:  35, // Christen/Aviat Eagle II

  // --- Homebuilt / Experimental ---
  RV3:   30, // Van's RV-3
  RV4:   28, // Van's RV-4
  RV6:   28, // Van's RV-6
  RV7:   28, // Van's RV-7
  RV8:   30, // Van's RV-8
  RV9:   28, // Van's RV-9
  RV12:  26, // Van's RV-12
  RV14:  30, // Van's RV-14
  LGEZ:  42, // Rutan Long-EZ
  VEZE:  42, // Rutan VariEze
  COZY:  40, // Rutan/Co-Z Cozy
  SONX:  28, // Sonex
  VELO:  35, // Velocity
  LNC2:  33, // Lancair 200/235/320
  LEG2:  33, // Lancair Legacy
  LNCE:  30, // Lancair ES
  CH70:  28, // Zenith STOL CH-701
  CH75:  28, // Zenith STOL CH-750
  BD5:   45, // Bede BD-5
  GLAS:  32, // Stoddard-Hamilton Glasair

  // --- Seaplanes / Amphibians ---
  G44:   48, // Grumman G-44 Widgeon
  G73:   52, // Grumman G-73 Mallard
  RC3:   40, // Republic RC-3 Seabee
  LA4:   32, // Lake LA-4 Buccaneer
  G21:   52, // Grumman G-21 Goose
};

// Exact type CODE -> traffic archetype. The four R14 archetypes drive new GLB
// models; explicit overrides (e.g. BE18 -> 'prop') route small/edge types to
// existing archetypes so they keep sensible size and base rarity.
export const WARBIRD_ARCHETYPE = {
  // --- WW2 Fighters ---
  P51:   'warbird-prop', // North American P-51 Mustang
  CORS:  'warbird-prop', // Vought F4U Corsair
  SPIT:  'warbird-prop', // Supermarine Spitfire
  HURI:  'warbird-prop', // Hawker Hurricane
  P38:   'warbird-prop', // Lockheed P-38 Lightning
  P40:   'warbird-prop', // Curtiss P-40 Warhawk
  P47:   'warbird-prop', // Republic P-47 Thunderbolt
  P39:   'warbird-prop', // Bell P-39 Airacobra
  P63:   'warbird-prop', // Bell P-63 Kingcobra
  ME09:  'warbird-prop', // Messerschmitt Bf 109
  FW90:  'warbird-prop', // Focke-Wulf Fw 190
  ZERO:  'warbird-prop', // Mitsubishi A6M Zero
  HCAT:  'warbird-prop', // Grumman F6F Hellcat
  BCAT:  'warbird-prop', // Grumman F8F Bearcat
  TCAT:  'warbird-prop', // Grumman F7F Tigercat
  YAK3:  'warbird-prop', // Yakovlev Yak-3
  YAK9:  'warbird-prop', // Yakovlev Yak-9
  I16:   'warbird-prop', // Polikarpov I-16
  FFLY:  'warbird-prop', // Fairey Firefly
  FURY:  'warbird-prop', // Hawker Fury

  // --- WW2 Bombers ---
  MOSQ:  'warbird-prop', // de Havilland DH.98 Mosquito
  TBM:   'warbird-prop', // Grumman TBM Avenger
  SBD:   'warbird-prop', // Douglas SBD Dauntless
  B17:   'warbird-heavy', // Boeing B-17 Flying Fortress
  B24:   'warbird-heavy', // Consolidated B-24 Liberator
  B29:   'warbird-heavy', // Boeing B-29 Superfortress
  LANC:  'warbird-heavy', // Avro Lancaster
  B25:   'classic-transport', // North American B-25 Mitchell
  A20:   'classic-transport', // Douglas A-20 Havoc

  // --- WW2 Patrol / Flying Boats ---
  CAT:   'classic-transport', // Consolidated PBY Catalina
  U16:   'classic-transport', // Grumman HU-16 Albatross

  // --- WW2 / Vintage Trainers ---
  T6:    'warbird-prop', // North American T-6 Texan / Harvard
  T28:   'warbird-prop', // North American T-28 Trojan
  ST75:  'warbird-prop', // Boeing-Stearman PT-17 Kaydet
  T34P:  'warbird-prop', // Beechcraft T-34 Mentor
  YK52:  'warbird-prop', // Yakovlev Yak-52
  CJ6:   'warbird-prop', // Nanchang CJ-6
  F260:  'warbird-prop', // SIAI-Marchetti SF.260
  FA62:  'warbird-prop', // Fairchild PT-19/PT-26 Cornell
  PT22:  'warbird-prop', // Ryan PT-22 Recruit
  N320:  'warbird-prop', // Nord 3202
  FW44:  'warbird-prop', // Focke-Wulf Fw 44 Stieglitz
  BU81:  'warbird-prop', // Bücker Bü 181 Bestmann
  N3N:   'warbird-prop', // Naval Aircraft Factory N3N
  T50:   'prop', // Cessna T-50 / UC-78 Bobcat

  // --- Korea / Vietnam Era ---
  A1:    'warbird-prop', // Douglas A-1 Skyraider
  V1:    'warbird-prop', // Grumman OV-1 Mohawk
  V10:   'warbird-prop', // North American Rockwell OV-10 Bronco
  B26:   'classic-transport', // Douglas A-26 Invader
  S2P:   'classic-transport', // Grumman S-2 Tracker
  MG21:  'warbird-jet', // Mikoyan-Gurevich MiG-21
  F86:   'warbird-jet', // North American F-86 / Canadair Sabre
  A4:    'warbird-jet', // Douglas A-4 Skyhawk
  A37:   'warbird-jet', // Cessna A-37 Dragonfly

  // --- Early Jets ---
  MG15:  'warbird-jet', // Mikoyan-Gurevich MiG-15
  MG17:  'warbird-jet', // Mikoyan-Gurevich MiG-17
  MG19:  'warbird-jet', // Mikoyan-Gurevich MiG-19
  F104:  'warbird-jet', // Lockheed F-104 Starfighter
  VAMP:  'warbird-jet', // de Havilland DH.100 Vampire
  VNOM:  'warbird-jet', // de Havilland DH.112 Venom
  HUNT:  'warbird-jet', // Hawker Hunter
  ME62:  'warbird-jet', // Messerschmitt Me 262

  // --- Jet Trainers ---
  T33:   'warbird-jet', // Lockheed T-33 Shooting Star
  GNAT:  'warbird-jet', // Folland Gnat
  L39:   'warbird-jet', // Aero L-39 Albatros
  L29:   'warbird-jet', // Aero L-29 Delfin
  FOUG:  'warbird-jet', // Fouga CM.170 Magister
  JPRO:  'warbird-jet', // BAC Jet Provost
  STRK:  'warbird-jet', // BAC 167 Strikemaster
  M339:  'warbird-jet', // Aermacchi MB-339
  M326:  'warbird-jet', // Aermacchi MB-326
  T37:   'warbird-jet', // Cessna T-37 Tweet
  T2:    'warbird-jet', // North American T-2 Buckeye
  TS11:  'warbird-jet', // PZL TS-11 Iskra
  G2GL:  'warbird-jet', // Soko G-2 Galeb
  L159:  'warbird-jet', // Aero L-159 Alca

  // --- Military Transports ---
  C97:   'warbird-heavy', // Boeing C-97 / KC-97 Stratofreighter
  C119:  'warbird-heavy', // Fairchild C-119 Flying Boxcar
  C123:  'warbird-heavy', // Fairchild C-123 Provider
  C82:   'warbird-heavy', // Fairchild C-82 Packet
  DHC4:  'classic-transport', // de Havilland Canada C-7 Caribou

  // --- Warbird Helicopters ---
  HUCO:  'helicopter', // Bell AH-1 Cobra
  H500:  'helicopter', // Hughes OH-6 Cayuse / 369
  S58P:  'helicopter', // Sikorsky H-34 Choctaw
  S55P:  'helicopter', // Sikorsky H-19 Chickasaw
  B47G:  'helicopter', // Bell 47 / OH-13 Sioux

  // --- Liaison / Observation ---
  O1:    'prop', // Cessna O-1 Bird Dog
  L5:    'prop', // Stinson L-5 Sentinel
  BROU:  'prop', // Max Holste MH.1521 Broussard
  F156:  'prop', // Fieseler Fi 156 Storch

  // --- Classic Airliners ---
  DC3:   'classic-transport', // Douglas DC-3
  DC4:   'warbird-heavy', // Douglas DC-4
  DC6:   'warbird-heavy', // Douglas DC-6
  DC7:   'warbird-heavy', // Douglas DC-7
  DC2:   'classic-transport', // Douglas DC-2
  CONI:  'warbird-heavy', // Lockheed L-1049 Super Constellation
  L10:   'prop', // Lockheed Model 10 Electra
  L12:   'prop', // Lockheed Model 12 Electra Junior
  L18:   'classic-transport', // Lockheed Model 18 Lodestar
  M404:  'classic-transport', // Martin 4-0-4
  CVLP:  'classic-transport', // Convair CV-240/340/440
  CVLT:  'classic-transport', // Convair CV-580

  // --- Classic Transports ---
  TRIM:  'classic-transport', // Ford Trimotor
  JU52:  'classic-transport', // Junkers Ju 52/3m
  C46:   'classic-transport', // Curtiss C-46 Commando
  BE18:  'prop', // Beechcraft Model 18 Twin Beech

  // --- Golden-Age Biplanes ---
  BE17:  'prop', // Beechcraft Model 17 Staggerwing
  BU33:  'prop', // Bucker Bu 133 Jungmeister
  WACF:  'prop', // Waco YMF Classic
  FA24:  'prop', // Fairchild 24
  S108:  'prop', // Stinson 108 Voyager
  G2T1:  'prop', // Great Lakes 2T-1 Sport Trainer
  DH82:  'prop', // de Havilland DH.82 Tiger Moth
  BU31:  'prop', // Bucker Bu 131 Jungmann

  // --- Classic General Aviation ---
  J3:    'prop', // Piper J-3 Cub
  PA18:  'prop', // Piper PA-18 Super Cub
  CH7A:  'prop', // Aeronca 7AC Champion
  AR11:  'prop', // Aeronca 11 Chief
  C120:  'prop', // Cessna 120
  C140:  'prop', // Cessna 140
  C170:  'prop', // Cessna 170
  C195:  'prop', // Cessna 195 Businessliner
  ERCO:  'prop', // Ercoupe 415
  GC1:   'prop', // Globe/Temco GC-1 Swift
  NAVI:  'prop', // North American / Ryan Navion
  DHC3:  'prop', // de Havilland Canada DHC-3 Otter
  PA22:  'prop', // Piper PA-22 Tri-Pacer / Caribbean
  C175:  'prop', // Cessna 175 Skylark
  C180:  'prop', // Cessna 180 Skywagon
  C185:  'prop', // Cessna 185 Skywagon
  PA25:  'prop', // Piper PA-25 Pawnee
  L11E:  'prop', // Luscombe 11 Sedan
  DHC1:  'prop', // de Havilland Canada DHC-1 Chipmunk
  AN2:   'prop', // Antonov An-2 Colt

  // --- Aerobatic ---
  PTS1:  'prop', // Pitts Special S-1
  PTS2:  'prop', // Pitts S-2
  E300:  'prop', // Extra EA-300
  E200:  'prop', // Extra EA-200
  EDGE:  'prop', // Zivko Edge 540
  SU26:  'prop', // Sukhoi Su-26
  SU29:  'prop', // Sukhoi Su-29
  SU31:  'prop', // Sukhoi Su-31
  CP10:  'prop', // Mudry CAP 10
  CP23:  'prop', // CAP 231/232
  EAGL:  'prop', // Christen/Aviat Eagle II

  // --- Homebuilt / Experimental ---
  RV3:   'prop', // Van's RV-3
  RV4:   'prop', // Van's RV-4
  RV6:   'prop', // Van's RV-6
  RV7:   'prop', // Van's RV-7
  RV8:   'prop', // Van's RV-8
  RV9:   'prop', // Van's RV-9
  RV12:  'prop', // Van's RV-12
  RV14:  'prop', // Van's RV-14
  LGEZ:  'prop', // Rutan Long-EZ
  VEZE:  'prop', // Rutan VariEze
  COZY:  'prop', // Rutan/Co-Z Cozy
  SONX:  'prop', // Sonex
  VELO:  'prop', // Velocity
  LNC2:  'prop', // Lancair 200/235/320
  LEG2:  'prop', // Lancair Legacy
  LNCE:  'prop', // Lancair ES
  CH70:  'prop', // Zenith STOL CH-701
  CH75:  'prop', // Zenith STOL CH-750
  BD5:   'prop', // Bede BD-5
  GLAS:  'prop', // Stoddard-Hamilton Glasair

  // --- Seaplanes / Amphibians ---
  G44:   'prop', // Grumman G-44 Widgeon
  G73:   'prop', // Grumman G-73 Mallard
  RC3:   'prop', // Republic RC-3 Seabee
  LA4:   'prop', // Lake LA-4 Buccaneer
  G21:   'prop', // Grumman G-21 Goose
};

// Set of every R14 warbird/classic code (used by the spot-warbird contract).
export const WARBIRD_TYPES = new Set(Object.keys(WARBIRD_TYPE_RARITY));
