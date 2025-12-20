/**
 * Aircraft Rarity Calculation
 * Assigns rarity scores to aircraft based on type, classification, and uniqueness
 */

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
  Object.entries(TYPE_RARITY_BONUS).forEach(([pattern, bonus]) => {
    if (typeCode.includes(pattern)) {
      rarity += bonus;
    }
  });
  
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
