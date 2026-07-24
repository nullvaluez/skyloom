/**
 * Aircraft Rarity Calculation
 * Assigns rarity scores to aircraft based on type, classification, and uniqueness
 */

import { WARBIRD_TYPE_RARITY } from './warbirds';
import { EXACT_TYPE_CODES } from './aircraft-type-tables';

// Rarity tiers with colors
export const RARITY_TIERS = {
  common: { min: 0, max: 29, color: '#9ca3af', name: 'Common' },
  uncommon: { min: 30, max: 49, color: '#22c55e', name: 'Uncommon' },
  rare: { min: 50, max: 69, color: '#3b82f6', name: 'Rare' },
  epic: { min: 70, max: 84, color: '#a855f7', name: 'Epic' },
  legendary: { min: 85, max: 94, color: '#f59e0b', name: 'Legendary' },
  mythic: { min: 95, max: 100, color: '#ef4444', name: 'Mythic' },
};

// Base rarity scores by classification
const CLASSIFICATION_RARITY = {
  commercial: 10,
  cargo: 20,
  private: 15,
  helicopter: 30,
  military: 50,
  government: 70,
  special: 60,
  emergency: 90,
  unknown: 5,
  // R14 "AirVenture": warbird/classic archetype bases. Paired with the exact
  // WARBIRD_TYPE_RARITY bonus (added in calculateRarity below) so base+bonus
  // lands the marquee list at legendary+ (>=85). Fly feeds _classification =
  // the archetype string, so these become the base for warbird contacts.
  'warbird-prop': 45,
  'warbird-jet': 45,
  'warbird-heavy': 50,
  'classic-transport': 40,
};

// Rarity bonuses for specific aircraft types
const TYPE_RARITY_BONUS = {
  // Wide-body rarities
  A380: 40,  // Relatively rare
  A388: 40,
  B747: 30,  // Classic jumbo
  B744: 35,
  B748: 40,  // 747-8 is rarer
  A350: 25,
  A359: 25,
  A35K: 30,
  B787: 20,
  B788: 20,
  B789: 22,
  B78X: 25,
  
  // Military aircraft bonuses
  F22: 50,  // Stealth fighter
  F35: 45,
  B2: 60,   // Stealth bomber
  B1B: 45,
  B52: 35,
  C5: 40,   // Galaxy
  C17: 30,
  KC135: 25,
  KC46: 35,
  E3: 45,   // AWACS
  E6: 50,   // Doomsday plane
  P8: 35,
  VC25: 95, // Air Force One
  
  // Special aircraft
  AN124: 55,  // Antonov
  AN225: 100, // Mriya (if it existed)
  C130: 20,
  
  // Helicopters
  H60: 25,  // Black Hawk
  H47: 30,  // Chinook
  H64: 40,  // Apache
  V22: 45,  // Osprey
  
  // Business jets (less common for spotting)
  G650: 35,
  GLEX: 30,
  GL7T: 35,
  
  // Vintage/Rare commercial
  MD11: 45, // Retired type
  DC10: 50,
  L101: 55, // L-1011
  CONC: 100, // Concorde (impossible to spot now)
};

// R15 "Ground Truth": exact type CODE -> bonus, consulted after the warbird
// table and BEFORE the substring loop above; a hit short-circuits.
//
// WHY: TYPE_RARITY_BONUS is matched with .includes() and ICAO doc8643
// designators are at most 4 characters, so its 2-3 char patterns were paying
// out to longer, unrelated types:
//   'C5':40  -> every C500/C501/C510/C525/C550/C551/C560/C56X Citation
//   'B2':60  -> B212 (30 helicopter base + 60 = 90 = LEGENDARY, so every EMS
//               Bell 212 fired a SPICY ping)
//   'C17':30 -> C172 / C177
//   'E3':45  -> BE30 (King Air 300) and E35L (Legacy 600)
//   'E6':50  -> BE60 (Beech Duke)
// Ported here are exactly the entries that name a real full designator, plus
// the variants the substring path legitimately paid (C5M, E3TF, CV22) so no
// intended bonus is lost. Entries NOT ported are dead in substring space and
// stay in the legacy table: 'KC135'/'AN124'/'AN225' are 5 chars and can never
// match a <=4 char designator.
const EXACT_TYPE_BONUS = {
  // Wide-body rarities
  A380: 40,
  A388: 40,
  B747: 30,
  B744: 35,
  B748: 40,
  A350: 25,
  A359: 25,
  A35K: 30,
  B787: 20,
  B788: 20,
  B789: 22,
  B78X: 25,

  // Military aircraft bonuses
  F22: 50,
  F35: 45,
  B2: 60,   // the Spirit itself — no longer the Bell 212's problem
  B1B: 45,
  B52: 35,
  C5: 40,
  C5M: 40,  // 'C5' paid the Super Galaxy too; keep it
  C17: 30,  // the Globemaster keeps its 30; C172/C177 no longer take it
  KC46: 35,
  E3: 45,
  E3TF: 45, // 'E3' paid the CFM56 Sentry too; keep it
  E6: 50,
  P8: 35,
  VC25: 95, // Air Force One

  // Special aircraft
  C130: 20,

  // Helicopters
  H60: 25,
  H47: 30,
  H64: 40,
  V22: 45,
  CV22: 45, // 'V22' paid the CV-22 too; keep it

  // Business jets
  G650: 35,
  GLEX: 30,
  GL7T: 35,

  // Vintage/Rare commercial
  MD11: 45,
  DC10: 50,
  L101: 55,
  CONC: 100,
};

// Callsign patterns that add rarity
const CALLSIGN_RARITY = {
  SAM: 80,    // Special Air Mission
  AF1: 95,    // Air Force One
  AF2: 85,    // Air Force Two
  EXEC: 60,   // Executive flights
  NAVY: 40,
  USAF: 35,
  RCH: 35,    // Reach (military)
  EVAC: 50,   // Medical evacuation
};

// Squawk code bonuses
const SQUAWK_RARITY = {
  '7500': 90, // Hijack
  '7600': 70, // Radio failure
  '7700': 80, // Emergency
};

/**
 * Calculate rarity score for an aircraft
 * @param {Object} aircraft - Aircraft data
 * @returns {number} Rarity score 0-100
 */
export function calculateRarity(aircraft) {
  if (!aircraft) return 0;
  
  let rarity = 0;
  
  // Base rarity from classification
  const classification = aircraft._classification || 'unknown';
  rarity += CLASSIFICATION_RARITY[classification] || 0;
  
  // Type-specific bonuses
  const typeCode = aircraft.t?.toUpperCase() || '';
  // R14 "AirVenture": exact warbird/classic code check FIRST. On a hit, add the
  // audited bonus and SKIP the substring loop entirely. WHY: the substring loop
  // stacks every matching pattern (e.g. B29 would also match key 'B2' for +60,
  // and DC7/DC6/DC4 would match nothing but B25 could catch 'B2') — exact keys
  // must never enter substring space or their scores compound. Non-warbird
  // codes miss this table and fall through to the original substring loop
  // byte-for-byte unchanged.
  // R15 "Ground Truth": the same escape hatch, one rung down — an exact MODERN
  // code takes EXACT_TYPE_BONUS (often 0 by absence) and likewise short-circuits.
  // A code the classifier knows but that has no bonus of its own must score 0
  // rather than fall into substring space: that third branch is what stops the
  // C5xx Citations, B212, C172/C177, BE30/E35L and BE60 from collecting bonuses
  // meant for the C-5, B-2, C-17, E-3 and E-6. Codes in NEITHER exact table are
  // unknown to us and run the legacy loop byte-for-byte unchanged.
  if (typeCode && WARBIRD_TYPE_RARITY[typeCode] !== undefined) {
    rarity += WARBIRD_TYPE_RARITY[typeCode];
  } else if (typeCode && EXACT_TYPE_BONUS[typeCode] !== undefined) {
    rarity += EXACT_TYPE_BONUS[typeCode];
  } else if (typeCode && EXACT_TYPE_CODES.has(typeCode)) {
    // known designator, no bonus of its own → +0, never enters substring space
  } else {
    Object.entries(TYPE_RARITY_BONUS).forEach(([pattern, bonus]) => {
      if (typeCode.includes(pattern)) {
        rarity += bonus;
      }
    });
  }
  
  // Callsign bonuses
  const callsign = aircraft.flight?.trim().toUpperCase() || '';
  Object.entries(CALLSIGN_RARITY).forEach(([pattern, bonus]) => {
    if (callsign.startsWith(pattern)) {
      rarity += bonus;
    }
  });
  
  // Squawk bonuses
  if (aircraft.squawk && SQUAWK_RARITY[aircraft.squawk]) {
    rarity += SQUAWK_RARITY[aircraft.squawk];
  }
  
  // Database flags bonuses
  if (aircraft.dbFlags) {
    if (aircraft.dbFlags & 1) rarity += 20; // Military
    if (aircraft.dbFlags & 2) rarity += 30; // Interesting
  }
  
  // Category bonuses (for unusual categories)
  if (aircraft.category === 'B6') rarity += 25; // UAV
  if (aircraft.category === 'B7') rarity += 50; // Space vehicle
  if (aircraft.category === 'A6') rarity += 15; // High performance
  
  // Altitude bonuses (very high or very low)
  if (aircraft.alt_baro > 45000) rarity += 10; // Very high altitude
  if (aircraft.alt_baro > 50000) rarity += 20; // U-2/SR-71 territory
  
  // Speed bonuses
  if (aircraft.gs > 500) rarity += 5;   // Fast
  if (aircraft.gs > 600) rarity += 10;  // Very fast
  if (aircraft.gs > 1000) rarity += 30; // Supersonic
  
  // Cap at 100
  return Math.min(Math.round(rarity), 100);
}

/**
 * Get rarity tier for a score
 * @param {number} score - Rarity score
 * @returns {Object} Tier info with name and color
 */
export function getRarityTier(score) {
  for (const [tier, info] of Object.entries(RARITY_TIERS)) {
    if (score >= info.min && score <= info.max) {
      return { tier, ...info };
    }
  }
  return { tier: 'common', ...RARITY_TIERS.common };
}

/**
 * Get rarity color for display
 * @param {number} score - Rarity score
 * @returns {string} Hex color
 */
export function getRarityColor(score) {
  return getRarityTier(score).color;
}

/**
 * Format rarity for display
 * @param {number} score - Rarity score
 * @returns {Object} Display info with name, color, score
 */
export function formatRarity(score) {
  const tier = getRarityTier(score);
  return {
    score,
    name: tier.name,
    color: tier.color,
    tier: tier.tier,
  };
}
