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
  // R17: the streak ladder stopped at a week, so the passport had nothing left
  // to ask of a player past day 7. Both run off the same getStreakDays walk.
  daily_streak_30: {
    name: 'Month on Watch',
    description: 'Spotted aircraft 30 days in a row',
    icon: '🗓️',
    tier: 'gold',
  },
  daily_streak_100: {
    name: 'Century Streak',
    description: 'Spotted aircraft 100 days in a row',
    icon: '💯',
    tier: 'platinum',
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
 * R17 — supersonic-capable ICAO type designators for `concorde_heir`.
 *
 * The badge shipped with a description and NO case in checkBadgeUnlock, so it
 * was decorative. Every code below is audited: all but CONC appear in
 * lib/aircraft-type-tables.js's EXACT_TYPE_CLASS as 'military'; CONC is the
 * badge's namesake and is an audited entry of lib/rarity.js's EXACT_TYPE_BONUS
 * (100) — it is a real designator that the classifier simply has no opinion
 * about, and leaving "Concorde's Heir" unable to fire on a Concorde would be
 * absurd.
 *
 * Deliberately NOT included: aircraft that merely go fast (U2, SR71's
 * subsonic-cruise stablemates) or that people assume are supersonic (A10, A4).
 * SR71 is excluded too — it has not flown since 1999 and `rare_find` already
 * covers a Blackbird sighting at rarity 100.
 */
export const SUPERSONIC_TYPES = new Set([
  'CONC',                                     // Concorde
  'F14', 'F15', 'F16', 'F18', 'FA18', 'EA18', // US teen series + Growler
  'F22', 'F35',                               // stealth fighters
  'B1B',                                      // Lancer
  'T38',                                      // Talon (supersonic trainer)
  'EUFI', 'RFAL', 'TORN',                     // Typhoon, Rafale, Tornado
]);

/**
 * R17 — VIP / head-of-state transports for `vip_spotter`.
 *
 * The old test was `aircraft._classification === 'government'`, and the Fly
 * worker's archetype vocabulary has NO 'government' member (airliner/jet/prop/
 * helicopter/military/cargo/glider/drone/unknown + the four R14 warbird
 * classes), so the badge was unreachable — a VC-25 classifies as 'military'
 * like any other USAF airframe. Re-keyed onto the two facts that actually
 * identify a VIP flight in an ADS-B feed: the special-mission callsign
 * prefixes, and the executive-transport designators.
 */
export const VIP_CALLSIGN_PREFIXES = ['SAM', 'AF1', 'AF2', 'EXEC'];
export const VIP_TYPES = new Set(['VC25', 'C32', 'C37', 'C40']);

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
 * Consecutive-day spotting streak ending at `now`, counted over the
 * `stats.spotsByDay` histogram.
 *
 * R16: the day key is `new Date(ms).toISOString().split('T')[0]` — the EXACT
 * expression passport-store's logSpot uses to WRITE those buckets. It is UTC,
 * not local; any other formulation (toLocaleDateString, local getFullYear…)
 * would silently disagree with the buckets it is counting for anyone east of
 * Greenwich or west of the date line, which is precisely how `daily_streak_7`
 * would have shipped broken. Stepping back by whole 86400000 ms steps is exact
 * in UTC (no DST).
 *
 * Today only counts if it actually has a spot; the first gap ends the run.
 *
 * @param {Object} spotsByDay - YYYY-MM-DD -> count
 * @param {number} [now] - epoch ms to count back from
 * @returns {number} consecutive days, 0 if none
 */
export function getStreakDays(spotsByDay, now = Date.now()) {
  if (!spotsByDay || typeof spotsByDay !== 'object') return 0;
  const DAY_MS = 86400000;
  let streak = 0;
  // Hard bound: the passport keeps 1000 spots, so a 10-year run is already
  // impossible — the cap just guarantees termination on a corrupt map.
  for (let i = 0; i < 3700; i++) {
    const key = new Date(now - i * DAY_MS).toISOString().split('T')[0];
    if (!spotsByDay[key]) break;
    streak += 1;
  }
  return streak;
}

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
      
    // R17: the type the badge is named for finally has a test (see
    // SUPERSONIC_TYPES above — exact designators, never a substring match:
    // 'F16'.includes would also claim nothing here, but 'B1B' vs 'B1' is
    // exactly the class of trap R15 spent a round killing).
    case 'concorde_heir':
      return SUPERSONIC_TYPES.has(aircraft.t?.toUpperCase());

    // Government/VIP
    case 'vip_spotter':
      // R17: 'government' is not a class the Fly worker can emit — re-keyed
      // onto special-mission callsigns and executive-transport designators.
      return (
        VIP_TYPES.has(aircraft.t?.toUpperCase()) ||
        VIP_CALLSIGN_PREFIXES.some((p) =>
          (aircraft.flight?.trim().toUpperCase() ?? '').startsWith(p)
        )
      );
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
    // R16: this badge existed in BADGES since the passport shipped but had no
    // case here — it could never unlock. stats is the POST-logSpot snapshot
    // (checkBadges runs after the set()), so today's bucket already counts.
    case 'daily_streak_7':
      return getStreakDays(stats.spotsByDay, spot.timestamp) >= 7;
    // R17: same walk, longer ladders.
    case 'daily_streak_30':
      return getStreakDays(stats.spotsByDay, spot.timestamp) >= 30;
    case 'daily_streak_100':
      return getStreakDays(stats.spotsByDay, spot.timestamp) >= 100;


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
