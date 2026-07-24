/**
 * R15 "Ground Truth" — canonical EXACT-match type tables for the MODERN fleet.
 *
 * Plain ESM, ZERO imports so node harnesses can dynamically import it exactly
 * like lib/warbirds.js. SINGLE SOURCE OF TRUTH for every modern ICAO type code
 * that must never be resolved by substring.
 *
 * WHY THIS EXISTS: classification used `.includes()` against short patterns.
 * ICAO doc8643 designators are AT MOST 4 characters, so any pattern of length
 * <= 3 can swallow a longer, unrelated code — 'SR22'.includes('R22') made every
 * Cirrus a helicopter, 'C172'.includes('C17') made every Skyhawk a C-17. R14
 * hit the identical class of bug in rarity scoring (FLY_ROUND14.md §7 lesson 1)
 * and fixed it with an exact-first short circuit; this table applies the same
 * escape hatch to the classification chain.
 *
 * CONTRACT: consulted AFTER the R14 warbird exact check and BEFORE any
 * substring list. On a hit the chain returns immediately. Keys here are
 * therefore DISJOINT from WARBIRD_TYPE_RARITY (lib/warbirds.js) — the warbird
 * table owns its 170 codes outright; scripts/verify-classify.mjs enforces it.
 *
 * The worker (lib/workers/aircraft-processor.worker.js) keeps an INLINED copy
 * because it cannot import this module (established pattern, same as
 * WARBIRD_ARCHETYPE). Edit both together; the gate source-parses the worker and
 * hard-fails on divergence.
 */

// Exact ICAO type designator -> classification / icon / traffic-archetype
// string. Values are valid in BOTH consumer domains (the worker's
// FLY_ARCHETYPES and lib/classify.js's icon set).
export const EXACT_TYPE_CLASS = {
  // --- Helicopters -------------------------------------------------------
  // Every rotorcraft code is exact: none of them is a legitimate prefix of
  // another type, and the short ones (R22/R44/H60/B06/S76…) were the trap.
  R22:  'helicopter', // Robinson R22
  R44:  'helicopter', // Robinson R44
  R66:  'helicopter', // Robinson R66
  B06:  'helicopter', // Bell 206 JetRanger / LongRanger
  B105: 'helicopter', // MBB Bo 105
  B212: 'helicopter', // Bell 212
  B407: 'helicopter', // Bell 407
  B412: 'helicopter', // Bell 412
  B429: 'helicopter', // Bell 429
  B430: 'helicopter', // Bell 430
  B505: 'helicopter', // Bell 505 Jet Ranger X
  BK17: 'helicopter', // MBB / Kawasaki BK 117
  S61:  'helicopter', // Sikorsky S-61
  S64:  'helicopter', // Sikorsky S-64 Skycrane
  S70:  'helicopter', // Sikorsky S-70
  S76:  'helicopter', // Sikorsky S-76
  S92:  'helicopter', // Sikorsky S-92
  H60:  'helicopter', // Sikorsky UH-60 Black Hawk
  H47:  'helicopter', // Boeing CH-47 Chinook
  H53:  'helicopter', // Sikorsky CH-53
  H64:  'helicopter', // Boeing AH-64 Apache
  UH1:  'helicopter', // Bell UH-1 Iroquois
  A109: 'helicopter', // Leonardo A109
  A119: 'helicopter', // Leonardo A119 Koala
  A139: 'helicopter', // Leonardo AW139
  A149: 'helicopter', // Leonardo AW149
  A169: 'helicopter', // Leonardo AW169
  A189: 'helicopter', // Leonardo AW189
  AW09: 'helicopter', // Leonardo AW09 / Kopter SH09
  AS50: 'helicopter', // Airbus AS350 Ecureuil / H125
  AS55: 'helicopter', // Airbus AS355 Ecureuil 2
  AS65: 'helicopter', // Airbus AS365 Dauphin
  AS32: 'helicopter', // Airbus AS332 Super Puma
  EC20: 'helicopter', // Airbus EC120 Colibri
  EC25: 'helicopter', // Airbus EC225 Super Puma
  EC30: 'helicopter', // Airbus EC130
  EC35: 'helicopter', // Airbus EC135 / H135
  EC45: 'helicopter', // Airbus EC145 / H145
  EC55: 'helicopter', // Airbus EC155
  EC75: 'helicopter', // Airbus EC725 / H175
  EXPL: 'helicopter', // MD Explorer MD900/902
  MD52: 'helicopter', // MD 520N
  MD60: 'helicopter', // MD 600N
  GAZL: 'helicopter', // Aerospatiale SA341/342 Gazelle
  PUMA: 'helicopter', // Aerospatiale SA330 Puma
  LYNX: 'helicopter', // Westland Lynx
  WASP: 'helicopter', // Westland Wasp
  KMAX: 'helicopter', // Kaman K-MAX
  NH90: 'helicopter', // NHIndustries NH90

  // --- General aviation: piston singles/twins + light turboprops ---------
  C150: 'prop', // Cessna 150
  C152: 'prop', // Cessna 152
  C162: 'prop', // Cessna 162 Skycatcher
  C172: 'prop', // Cessna 172 Skyhawk — the C17 substring victim
  C177: 'prop', // Cessna 177 Cardinal
  C72R: 'prop', // Cessna 172RG Cutlass (listed in SPICY.gaTypes)
  C182: 'prop', // Cessna 182 Skylane
  C188: 'prop', // Cessna 188 Ag Wagon
  C206: 'prop', // Cessna 206 Stationair
  C207: 'prop', // Cessna 207
  C208: 'prop', // Cessna 208 Caravan
  C210: 'prop', // Cessna 210 Centurion
  C303: 'prop', // Cessna 303 Crusader
  C310: 'prop', // Cessna 310
  C337: 'prop', // Cessna 337 Skymaster
  C340: 'prop', // Cessna 340
  C402: 'prop', // Cessna 402
  C404: 'prop', // Cessna 404 Titan
  C414: 'prop', // Cessna 414 Chancellor
  C421: 'prop', // Cessna 421 Golden Eagle
  C425: 'prop', // Cessna 425 Conquest I
  C441: 'prop', // Cessna 441 Conquest II
  PA23: 'prop', // Piper PA-23 Apache / Aztec
  PA24: 'prop', // Piper PA-24 Comanche
  PA28: 'prop', // Piper PA-28 Cherokee (generic)
  PA30: 'prop', // Piper PA-30 Twin Comanche
  PA31: 'prop', // Piper PA-31 Navajo
  PA32: 'prop', // Piper PA-32 Cherokee Six
  PA34: 'prop', // Piper PA-34 Seneca
  PA38: 'prop', // Piper PA-38 Tomahawk
  PA44: 'prop', // Piper PA-44 Seminole
  PA46: 'prop', // Piper PA-46 Malibu
  P28A: 'prop', // Piper PA-28 (fixed gear, Archer/Warrior)
  P28B: 'prop', // Piper PA-28 (fixed gear, 180hp+)
  P28R: 'prop', // Piper PA-28R Arrow
  P28T: 'prop', // Piper PA-28RT Turbo Arrow
  P32R: 'prop', // Piper PA-32R Saratoga / Lance
  P32T: 'prop', // Piper PA-32RT Turbo Lance
  P46T: 'prop', // Piper PA-46 Meridian (turboprop)
  BE33: 'prop', // Beechcraft 33 Debonair
  BE35: 'prop', // Beechcraft 35 Bonanza (V-tail)
  BE36: 'prop', // Beechcraft 36 Bonanza
  BE55: 'prop', // Beechcraft 55 Baron
  BE58: 'prop', // Beechcraft 58 Baron
  BE60: 'prop', // Beechcraft 60 Duke
  BE76: 'prop', // Beechcraft 76 Duchess
  BE9L: 'prop', // Beechcraft King Air 90
  BE10: 'prop', // Beechcraft King Air 100
  BE20: 'prop', // Beechcraft King Air 200
  BE30: 'prop', // Beechcraft King Air 300
  BE99: 'prop', // Beechcraft 99 Airliner
  B350: 'prop', // Beechcraft King Air 350
  DA20: 'prop', // Diamond DA20 Katana
  DA40: 'prop', // Diamond DA40 Star
  DA42: 'prop', // Diamond DA42 Twin Star
  DA50: 'prop', // Diamond DA50
  DA62: 'prop', // Diamond DA62
  DV20: 'prop', // Diamond DV20 Katana
  SR20: 'prop', // Cirrus SR20
  SR22: 'prop', // Cirrus SR22 — the R22 substring victim
  S22T: 'prop', // Cirrus SR22T
  M20P: 'prop', // Mooney M20 (piston)
  M20T: 'prop', // Mooney M20 (turbocharged)
  M7:   'prop', // Maule M-7
  TB10: 'prop', // Socata TB-10 Tobago
  TB20: 'prop', // Socata TB-20 Trinidad
  TB21: 'prop', // Socata TB-21 Trinidad TC
  TBM7: 'prop', // Socata TBM 700
  TBM8: 'prop', // Daher TBM 850
  TBM9: 'prop', // Daher TBM 900/910/930/940
  PC6:  'prop', // Pilatus PC-6 Porter
  PC7:  'prop', // Pilatus PC-7
  PC9:  'prop', // Pilatus PC-9
  PC12: 'prop', // Pilatus PC-12
  PC21: 'prop', // Pilatus PC-21
  P180: 'prop', // Piaggio P.180 Avanti
  AA1:  'prop', // Grumman American AA-1
  AA5:  'prop', // Grumman American AA-5
  DR40: 'prop', // Robin DR400
  RV10: 'prop', // Van's RV-10 (RV-3..RV-14 are warbird-table classics)
  COL4: 'prop', // Columbia 400 / Cessna TTx
  BN2:  'prop', // Britten-Norman BN-2 Islander
  BN2T: 'prop', // Britten-Norman BN-2T Turbine Islander
  DHC2: 'prop', // de Havilland Canada DHC-2 Beaver
  DHC6: 'prop', // de Havilland Canada DHC-6 Twin Otter

  // --- Business jets ------------------------------------------------------
  C500: 'jet', // Cessna Citation I
  C501: 'jet', // Cessna Citation ISP
  C510: 'jet', // Cessna Citation Mustang
  C525: 'jet', // Cessna CitationJet CJ1
  C550: 'jet', // Cessna Citation II
  C551: 'jet', // Cessna Citation IISP
  C560: 'jet', // Cessna Citation V / Ultra / Encore
  C56X: 'jet', // Cessna Citation Excel / XLS
  C650: 'jet', // Cessna Citation III / VI / VII
  C680: 'jet', // Cessna Citation Sovereign
  C68A: 'jet', // Cessna Citation Latitude
  C700: 'jet', // Cessna Citation Longitude
  C750: 'jet', // Cessna Citation X
  C25A: 'jet', // Cessna CitationJet CJ2
  C25B: 'jet', // Cessna CitationJet CJ3
  C25C: 'jet', // Cessna CitationJet CJ4
  C25M: 'jet', // Cessna Citation M2
  CL30: 'jet', // Bombardier Challenger 300
  CL35: 'jet', // Bombardier Challenger 350
  CL60: 'jet', // Bombardier Challenger 600 series
  GLF4: 'jet', // Gulfstream IV
  GLF5: 'jet', // Gulfstream V / G500 / G550
  GLF6: 'jet', // Gulfstream G650
  GLEX: 'jet', // Bombardier Global Express
  GL5T: 'jet', // Bombardier Global 5000
  GL6T: 'jet', // Bombardier Global 6000
  GL7T: 'jet', // Bombardier Global 7500
  G150: 'jet', // Gulfstream G150
  G280: 'jet', // Gulfstream G280
  GALX: 'jet', // IAI Galaxy / Gulfstream G200
  ASTR: 'jet', // IAI Astra
  E50P: 'jet', // Embraer Phenom 100
  E55P: 'jet', // Embraer Phenom 300
  E545: 'jet', // Embraer Legacy 450 / Praetor 500
  E550: 'jet', // Embraer Legacy 500 / Praetor 600
  E35L: 'jet', // Embraer Legacy 600 / 650
  LJ24: 'jet', // Learjet 24
  LJ25: 'jet', // Learjet 25
  LJ31: 'jet', // Learjet 31
  LJ35: 'jet', // Learjet 35
  LJ40: 'jet', // Learjet 40
  LJ45: 'jet', // Learjet 45
  LJ55: 'jet', // Learjet 55
  LJ60: 'jet', // Learjet 60
  LJ70: 'jet', // Learjet 70
  LJ75: 'jet', // Learjet 75
  FA10: 'jet', // Dassault Falcon 10
  FA20: 'jet', // Dassault Falcon 20
  FA50: 'jet', // Dassault Falcon 50
  FA7X: 'jet', // Dassault Falcon 7X
  FA8X: 'jet', // Dassault Falcon 8X
  F900: 'jet', // Dassault Falcon 900
  F2TH: 'jet', // Dassault Falcon 2000
  H25A: 'jet', // BAe 125-700
  H25B: 'jet', // BAe / Hawker 125-800
  H25C: 'jet', // BAe 125-1000
  HA4T: 'jet', // Hawker 4000
  PRM1: 'jet', // Raytheon Premier I
  HDJT: 'jet', // Honda HA-420 HondaJet
  SF50: 'jet', // Cirrus SF50 Vision Jet
  EA50: 'jet', // Eclipse 500
  BE40: 'jet', // Beechjet 400 / Hawker 400
  PC24: 'jet', // Pilatus PC-24
  WW24: 'jet', // IAI Westwind

  // --- Military ----------------------------------------------------------
  // The two-character designators (B1/B2/C2/C5/E2/E3/E6/E8/P3/P8/U2/A6/A7) are
  // real doc8643 codes and are the single worst substring offenders — exact
  // only, never in a fallback list.
  F15:  'military', // McDonnell Douglas F-15 Eagle
  F16:  'military', // General Dynamics F-16 Fighting Falcon
  F18:  'military', // Boeing F/A-18 Hornet
  FA18: 'military', // Boeing F/A-18 Super Hornet
  EA18: 'military', // Boeing EA-18G Growler
  EF18: 'military', // Boeing EF-18 Hornet (Spanish Air Force)
  F22:  'military', // Lockheed Martin F-22 Raptor
  F35:  'military', // Lockheed Martin F-35 Lightning II
  F14:  'military', // Grumman F-14 Tomcat
  F4:   'military', // McDonnell Douglas F-4 Phantom II
  F5:   'military', // Northrop F-5
  F117: 'military', // Lockheed F-117 Nighthawk
  A10:  'military', // Fairchild A-10 Thunderbolt II
  A6:   'military', // Grumman A-6 Intruder
  A7:   'military', // LTV A-7 Corsair II
  B1:   'military', // Rockwell B-1 Lancer
  B1B:  'military', // Rockwell B-1B Lancer
  B2:   'military', // Northrop B-2 Spirit
  B52:  'military', // Boeing B-52 Stratofortress
  C5:   'military', // Lockheed C-5 Galaxy
  C5M:  'military', // Lockheed C-5M Super Galaxy
  C17:  'military', // Boeing C-17 Globemaster III
  C130: 'military', // Lockheed C-130 Hercules
  C30J: 'military', // Lockheed C-130J Super Hercules
  C12:  'military', // Beechcraft C-12 Huron
  C32:  'military', // Boeing C-32 (757 VIP)
  C37:  'military', // Gulfstream C-37
  C38:  'military', // Gulfstream C-38
  C40:  'military', // Boeing C-40 Clipper
  VC25: 'military', // Boeing VC-25 (Air Force One)
  RC12: 'military', // Beechcraft RC-12 Guardrail
  K35R: 'military', // Boeing KC-135R Stratotanker
  C2:   'military', // Grumman C-2 Greyhound
  E2:   'military', // Northrop Grumman E-2 Hawkeye
  E3:   'military', // Boeing E-3 Sentry
  E3TF: 'military', // Boeing E-3 Sentry (CFM56)
  E6:   'military', // Boeing E-6 Mercury
  E8:   'military', // Northrop Grumman E-8 J-STARS
  P3:   'military', // Lockheed P-3 Orion
  P8:   'military', // Boeing P-8 Poseidon
  U2:   'military', // Lockheed U-2
  SR71: 'military', // Lockheed SR-71 Blackbird
  T38:  'military', // Northrop T-38 Talon
  T45:  'military', // Boeing T-45 Goshawk
  V22:  'military', // Bell Boeing V-22 Osprey
  CV22: 'military', // Bell Boeing CV-22 Osprey
  MQ9:  'military', // General Atomics MQ-9 Reaper
  RQ4:  'military', // Northrop Grumman RQ-4 Global Hawk
  EUFI: 'military', // Eurofighter Typhoon
  RFAL: 'military', // Dassault Rafale
  TORN: 'military', // Panavia Tornado

  // --- Legacy aliases -----------------------------------------------------
  // Kept so no code that classified correctly before R15 regresses. These are
  // marketing/colloquial strings rather than confirmed doc8643 designators;
  // they carried the pre-R15 substring lists and are harmless as exact keys.
  H125: 'helicopter', // Airbus H125 (doc8643: AS50)
  H130: 'helicopter', // Airbus H130 (doc8643: EC30)
  H135: 'helicopter', // Airbus H135 (doc8643: EC35)
  H145: 'helicopter', // Airbus H145 (doc8643: EC45)
  H155: 'helicopter', // Airbus H155 (doc8643: EC55)
  H160: 'helicopter', // Airbus H160
  H175: 'helicopter', // Airbus H175 (doc8643: EC75)
  H215: 'helicopter', // Airbus H215 (doc8643: AS32)
  H225: 'helicopter', // Airbus H225 (doc8643: EC25)
  AW39: 'helicopter', // Leonardo AW139 marketing string (doc8643: A139)
  AW69: 'helicopter', // Leonardo AW169 marketing string (doc8643: A169)
  MD50: 'helicopter', // MD 500 (doc8643: H500, owned by the warbird table)
  EC65: 'helicopter', // Airbus EC665 Tiger
  AS33: 'helicopter', // Airbus AS532 Cougar
  G550: 'jet',        // Gulfstream G550 marketing string (doc8643: GLF5)
  G650: 'jet',        // Gulfstream G650 marketing string (doc8643: GLF6)
  KC10: 'military',   // McDonnell Douglas KC-10 (doc8643: DC10)
  KC46: 'military',   // Boeing KC-46 Pegasus
  TORD: 'military',   // Panavia Tornado legacy string
  T1:   'military',   // Raytheon T-1 Jayhawk
};

// Valid value domain — every entry must also be a legal FLY_ARCHETYPES member
// (worker) and a legal icon shape (lib/classify.js).
export const TYPE_CLASS_DOMAIN = new Set([
  'helicopter', 'prop', 'jet', 'military', 'airliner', 'cargo',
]);

export const EXACT_TYPE_CODES = new Set(Object.keys(EXACT_TYPE_CLASS));
