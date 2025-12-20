/**
 * Badge Definitions
 * Achievements for the Spotter's Passport gamification system
 */

export const BADGES = {
  // Spotting milestones
  first_spot: {
    name: 'First Contact',
    description: 'Spotted your first aircraft',
    icon: '✈️',
    tier: 'bronze',
  },
  spotter_10: {
    name: 'Plane Spotter',
    description: 'Spotted 10 aircraft',
    icon: '🔭',
    tier: 'bronze',
  },
  spotter_100: {
    name: 'Sky Watcher',
    description: 'Spotted 100 aircraft',
    icon: '🌟',
    tier: 'silver',
  },
  spotter_1000: {
    name: 'Aviation Expert',
    description: 'Spotted 1,000 aircraft',
    icon: '🏆',
    tier: 'gold',
  },
  
  // Type-specific
  military_hunter: {
    name: 'Military Hunter',
    description: 'Spotted 10 military aircraft',
    icon: '🎖️',
    tier: 'silver',
  },
  military_ace: {
    name: 'Military Ace',
    description: 'Spotted 50 military aircraft',
    icon: '⭐',
    tier: 'gold',
  },
  heli_spotter: {
    name: 'Rotor Head',
    description: 'Spotted 5 helicopters',
    icon: '🚁',
    tier: 'bronze',
  },
  cargo_king: {
    name: 'Cargo King',
    description: 'Spotted 20 cargo aircraft',
    icon: '📦',
    tier: 'silver',
  },
  
  // Special situations
  emergency_witness: {
    name: 'Emergency Witness',
    description: 'Spotted an aircraft squawking 7700',
    icon: '🚨',
    tier: 'gold',
  },
  hijack_alert: {
    name: 'Code 7500',
    description: 'Spotted an aircraft squawking 7500 (hijack)',
    icon: '⚠️',
    tier: 'platinum',
  },
  radio_failure: {
    name: 'Radio Silence',
    description: 'Spotted an aircraft squawking 7600 (radio failure)',
    icon: '📻',
    tier: 'gold',
  },
  
  // Rare aircraft
  whale_watcher: {
    name: 'Whale Watcher',
    description: 'Spotted an Airbus A380',
    icon: '🐋',
    tier: 'silver',
  },
  jumbo_spotter: {
    name: 'Jumbo Spotter',
    description: 'Spotted a Boeing 747',
    icon: '👑',
    tier: 'silver',
  },
  dreamliner: {
    name: 'Dreamliner',
    description: 'Spotted a Boeing 787',
    icon: '💫',
    tier: 'bronze',
  },
  concorde_heir: {
    name: 'Concorde\'s Heir',
    description: 'Spotted a supersonic-capable aircraft',
    icon: '🚀',
    tier: 'platinum',
  },
  
  // Government/VIP
  vip_spotter: {
    name: 'VIP Spotter',
    description: 'Spotted a government/VIP aircraft',
    icon: '🎩',
    tier: 'gold',
  },
  air_force_one: {
    name: 'Presidential Watch',
    description: 'Spotted Air Force One (VC-25)',
    icon: '🇺🇸',
    tier: 'platinum',
  },
  
  // Variety
  type_collector_10: {
    name: 'Type Collector',
    description: 'Spotted 10 different aircraft types',
    icon: '📚',
    tier: 'bronze',
  },
  type_collector_50: {
    name: 'Aviation Library',
    description: 'Spotted 50 different aircraft types',
    icon: '📖',
    tier: 'silver',
  },
  type_collector_100: {
    name: 'Encyclopedia',
    description: 'Spotted 100 different aircraft types',
    icon: '📕',
    tier: 'gold',
  },
  
  // Time-based
  early_bird: {
    name: 'Early Bird',
    description: 'Spotted aircraft before 6 AM local time',
    icon: '🌅',
    tier: 'bronze',
  },
  night_owl: {
    name: 'Night Owl',
    description: 'Spotted aircraft after midnight',
    icon: '🦉',
    tier: 'bronze',
  },
  daily_streak_7: {
    name: 'Dedicated Spotter',
    description: 'Spotted aircraft 7 days in a row',
    icon: '📅',
    tier: 'silver',
  },
  
  // Rarity
  rare_find: {
    name: 'Rare Find',
    description: 'Spotted an aircraft with legendary rarity',
    icon: '💎',
    tier: 'gold',
  },
};

/**
 * Badge tier colors
 */
export const BADGE_TIERS = {
  bronze: {
    color: '#CD7F32',
    bgColor: 'rgba(205, 127, 50, 0.2)',
    borderColor: 'rgba(205, 127, 50, 0.5)',
  },
  silver: {
    color: '#C0C0C0',
    bgColor: 'rgba(192, 192, 192, 0.2)',
    borderColor: 'rgba(192, 192, 192, 0.5)',
  },
  gold: {
    color: '#FFD700',
    bgColor: 'rgba(255, 215, 0, 0.2)',
    borderColor: 'rgba(255, 215, 0, 0.5)',
  },
  platinum: {
    color: '#E5E4E2',
    bgColor: 'rgba(229, 228, 226, 0.2)',
    borderColor: 'rgba(229, 228, 226, 0.5)',
  },
};

/**
 * Check if a badge should be unlocked
 * @param {string} badgeId - Badge ID to check
 * @param {Object} context - Context with aircraft, spot, stats, badges
 * @returns {boolean} Whether the badge should be unlocked
 */
export function checkBadgeUnlock(badgeId, context) {
  const { aircraft, spot, stats } = context;
  
  switch (badgeId) {
    // Milestone badges
    case 'first_spot':
      return stats.totalSpotted === 1;
    case 'spotter_10':
      return stats.totalSpotted >= 10;
    case 'spotter_100':
      return stats.totalSpotted >= 100;
    case 'spotter_1000':
      return stats.totalSpotted >= 1000;
      
    // Type-specific
    case 'military_hunter':
      return stats.militaryCount >= 10;
    case 'military_ace':
      return stats.militaryCount >= 50;
    case 'heli_spotter':
      return stats.helicopterCount >= 5;
    case 'cargo_king':
      return (stats.spotsByType?.cargo || 0) >= 20;
      
    // Emergency squawks
    case 'emergency_witness':
      return aircraft.squawk === '7700';
    case 'hijack_alert':
      return aircraft.squawk === '7500';
    case 'radio_failure':
      return aircraft.squawk === '7600';
      
    // Specific aircraft types
    case 'whale_watcher':
      return aircraft.t?.toUpperCase()?.includes('A380');
    case 'jumbo_spotter':
      return aircraft.t?.toUpperCase()?.match(/B74[478]/);
    case 'dreamliner':
      return aircraft.t?.toUpperCase()?.match(/B78[789X]/);
      
    // Government/VIP
    case 'vip_spotter':
      return aircraft._classification === 'government';
    case 'air_force_one':
      return aircraft.flight?.includes('AF1') || aircraft.t?.includes('VC25');
      
    // Variety
    case 'type_collector_10':
      return (stats.uniqueTypes?.size || 0) >= 10;
    case 'type_collector_50':
      return (stats.uniqueTypes?.size || 0) >= 50;
    case 'type_collector_100':
      return (stats.uniqueTypes?.size || 0) >= 100;
      
    // Time-based
    case 'early_bird': {
      const hour = new Date(spot.timestamp).getHours();
      return hour < 6;
    }
    case 'night_owl': {
      const hour = new Date(spot.timestamp).getHours();
      return hour >= 0 && hour < 4;
    }
    
    // Rarity
    case 'rare_find':
      return spot.rarity >= 90;
      
    default:
      return false;
  }
}

/**
 * Get badge by ID
 */
export function getBadge(id) {
  return BADGES[id] || null;
}

/**
 * Get all badges grouped by tier
 */
export function getBadgesByTier() {
  const grouped = { bronze: [], silver: [], gold: [], platinum: [] };
  
  Object.entries(BADGES).forEach(([id, badge]) => {
    grouped[badge.tier].push({ id, ...badge });
  });
  
  return grouped;
}
