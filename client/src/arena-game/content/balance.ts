/**
 * Central balance configuration. Every tunable number in the game lives here
 * or in the content definitions (cards/champions/synergies) — never scattered
 * through components or engine code. See BALANCE.md for how to tune safely.
 *
 * `balanceVersion` is stamped into every battle record so replays can refuse
 * to run against a different balance dataset.
 */

/** 0.6.0 — the official five-champion roster (content change: paths, kits,
 *  passives, synergy tags). Older records stay listed but unplayable via the
 *  existing balance-version gate. */
export const BALANCE_VERSION = '0.6.0';

export const TICKS_PER_SECOND = 20;

/** Convert seconds to simulation ticks. */
export function secondsToTicks(seconds: number): number {
  return Math.round(seconds * TICKS_PER_SECOND);
}

/** Opponent AI decision-quality tiers (M6). NO stat modifications anywhere —
 *  difficulty only changes decision quality, cadence and energy discipline. */
export type AiDifficulty = 'training' | 'standard' | 'advanced';

export const ALL_AI_DIFFICULTIES: readonly AiDifficulty[] = [
  'training',
  'standard',
  'advanced',
];

export interface AiDifficultyConfig {
  /** Ticks between AI decisions. */
  decisionIntervalTicks: number;
  /** Deterministic-RNG jitter added to each decision interval. */
  decisionJitterTicks: number;
  /** Energy kept in reserve when building pressure (ignored while defending). */
  energyReserve: number;
  /** Chance a decision is deliberately degraded (wrong lane / random card). */
  mistakeChance: number;
  /** Plays techniques/equipment at resolved targets. */
  usesTechniques: boolean;
  /** Uses its champion's active ability and ultimate. */
  usesChampion: boolean;
  /** Reacts to lane threats with role-appropriate defence (false = no counters). */
  reactsToThreats: boolean;
  /** Pressures the weaker enemy lane (false = random lane). */
  targetsWeakerLane: boolean;
  /** Living enemies near the champion that justify firing the ultimate. */
  ultimateClumpSize: number;
  /** Fire the ultimate anyway once charge has been full this long. */
  ultimateHoldTicks: number;
  /** Own-core health fraction under which a valid ultimate always fires. */
  ultimateCoreThreatFraction: number;
  /** Ticks after the augment offer before the AI picks its augment. */
  augmentChoiceDelayTicks: number;
}

export interface BalanceConfig {
  balanceVersion: string;
  ticksPerSecond: number;

  battle: {
    /** Regular battle duration in ticks (3.5 minutes). */
    durationTicks: number;
    /** Sudden death duration in ticks if core health is equal at timeout. */
    suddenDeathTicks: number;
  };

  arena: {
    /** Lane length in arena units; player core at 0, opponent core at laneLength. */
    laneLength: number;
    laneCount: 2;
    /** Player may deploy in [0, deployZoneDepth] of their own side. */
    deployZoneDepth: number;
    /** Units cannot be deployed within this distance of the enemy core. */
    coreExclusionRadius: number;
    /** Minimum spacing enforced between units so targeting never degenerates. */
    unitSpacing: number;
    /** Units divert from marching to engage enemies within this lane distance. */
    aggroRange: number;
  };

  energy: {
    max: number;
    /** Energy gained per tick (1 energy per 2.8s at 20 tps). */
    regenPerTick: number;
    /** Multiplier during the final minute (enabled after core loop is stable). */
    finalMinuteRegenMult: number;
    finalMinuteStartTick: number;
    startingEnergy: number;
  };

  core: {
    maxHealth: number;
  };

  champion: {
    /** Ticks before a dead Champion respawns beside its own core. */
    respawnTicks: number;
    /** Champions respawn with this fraction of max health. */
    respawnHealthFraction: number;
    /**
     * Champions spawn (and respawn) this far in front of their own core:
     * player at x = offset, opponent mirrored at laneLength - offset.
     */
    spawnOffsetFromCore: number;
  };

  cards: {
    deckSize: 8;
    handSize: 4;
  };

  units: {
    /**
     * Shielder units stop shielding a target once its shield reaches
     * (shielder attackDamage x this multiplier) — bounds shield stacking.
     */
    shielderShieldCapMult: number;
  };

  fitness: {
    /**
     * Ranked cap: total combat variation attributable to fitness ratings.
     * 0.12 = ±12% — inside the mandated 10–15% band.
     */
    rankedMaxTotalAdvantage: number;
    /** Rating value treated as the neutral baseline (no bonus, no penalty). */
    baselineRating: number;
    /** Rating range mapped onto the advantage band. */
    minRating: number;
    maxRating: number;
  };

  rank: {
    pointsPerWin: number;
    pointsPerLoss: number;
    pointsPerDraw: number;
    tiers: readonly { name: string; minPoints: number }[];
  };

  augment: {
    /** Tick at which both teams are offered their augment choices. */
    offerTick: number;
    /** Options offered per team (drawn from the full augment pool). */
    choiceCount: number;
  };

  gym: {
    /** Maximum borrowed (non-commandable) champions per squad (M9). */
    maxBorrowed: number;
    /** Gym War contribution points per member per war participated. */
    contributionPerWar: number;
    /** Extra contribution points per fielded member when the war is won. */
    contributionWinBonus: number;
  };

  ai: {
    /** Enemy units past this fraction of the lane count as a lane threat. */
    threatMidlineFraction: number;
    /** Lane threat score that triggers a defensive response. */
    threatTriggerScore: number;
    /** A single threatening unit at/above this health reads as a tank push. */
    tankHealthThreshold: number;
    /** This many threatening units read as a swarm push. */
    swarmCountThreshold: number;
    /** A threatening unit at/above this move speed invites a ranged counter. */
    fastThreatSpeed: number;
    /** Own units below this health fraction invite a heal technique. */
    healWoundedFraction: number;
    /** Distance behind the frontline pusher for support deploys. */
    supportBehindOffset: number;
    difficulties: Record<AiDifficulty, AiDifficultyConfig>;
  };
}

export const BALANCE: BalanceConfig = {
  balanceVersion: BALANCE_VERSION,
  ticksPerSecond: TICKS_PER_SECOND,

  battle: {
    durationTicks: secondsToTicks(210),
    suddenDeathTicks: secondsToTicks(30),
  },

  arena: {
    laneLength: 100,
    laneCount: 2,
    deployZoneDepth: 40,
    coreExclusionRadius: 12,
    unitSpacing: 2,
    aggroRange: 30,
  },

  energy: {
    max: 10,
    regenPerTick: 1 / secondsToTicks(2.8),
    finalMinuteRegenMult: 1.5,
    finalMinuteStartTick: secondsToTicks(150),
    startingEnergy: 5,
  },

  core: {
    maxHealth: 2400,
  },

  champion: {
    respawnTicks: secondsToTicks(15),
    respawnHealthFraction: 0.5,
    spawnOffsetFromCore: 6,
  },

  cards: {
    deckSize: 8,
    handSize: 4,
  },

  units: {
    shielderShieldCapMult: 4,
  },

  fitness: {
    rankedMaxTotalAdvantage: 0.12,
    baselineRating: 50,
    minRating: 0,
    maxRating: 100,
  },

  rank: {
    pointsPerWin: 30,
    pointsPerLoss: -20,
    pointsPerDraw: 5,
    tiers: [
      { name: 'Bronze', minPoints: 0 },
      { name: 'Silver', minPoints: 300 },
      { name: 'Gold', minPoints: 700 },
      { name: 'Platinum', minPoints: 1200 },
      { name: 'Diamond', minPoints: 1800 },
      { name: 'Champion', minPoints: 2500 },
    ],
  },

  augment: {
    offerTick: secondsToTicks(90),
    choiceCount: 3,
  },

  gym: {
    maxBorrowed: 3,
    contributionPerWar: 1,
    contributionWinBonus: 2,
  },

  ai: {
    threatMidlineFraction: 0.5,
    threatTriggerScore: 60,
    tankHealthThreshold: 500,
    swarmCountThreshold: 3,
    fastThreatSpeed: 0.35,
    healWoundedFraction: 0.6,
    supportBehindOffset: 6,
    difficulties: {
      // Genuinely beatable by a new player: slow decisions, no counters, no
      // champion usage, frequent deliberate mistakes — but it never cheats
      // (no stat boosts on any difficulty).
      training: {
        decisionIntervalTicks: secondsToTicks(5),
        decisionJitterTicks: secondsToTicks(2),
        energyReserve: 0,
        mistakeChance: 0.35,
        usesTechniques: false,
        usesChampion: false,
        reactsToThreats: false,
        targetsWeakerLane: false,
        ultimateClumpSize: 99,
        ultimateHoldTicks: secondsToTicks(999),
        ultimateCoreThreatFraction: 0,
        augmentChoiceDelayTicks: secondsToTicks(4),
      },
      standard: {
        decisionIntervalTicks: secondsToTicks(2.5),
        decisionJitterTicks: secondsToTicks(1),
        energyReserve: 1,
        mistakeChance: 0.15,
        usesTechniques: true,
        usesChampion: true,
        reactsToThreats: true,
        targetsWeakerLane: true,
        ultimateClumpSize: 3,
        ultimateHoldTicks: secondsToTicks(8),
        ultimateCoreThreatFraction: 0.5,
        augmentChoiceDelayTicks: secondsToTicks(2),
      },
      advanced: {
        decisionIntervalTicks: secondsToTicks(1.2),
        decisionJitterTicks: secondsToTicks(0.5),
        energyReserve: 2,
        mistakeChance: 0.04,
        usesTechniques: true,
        usesChampion: true,
        reactsToThreats: true,
        targetsWeakerLane: true,
        ultimateClumpSize: 2,
        ultimateHoldTicks: secondsToTicks(5),
        ultimateCoreThreatFraction: 0.6,
        augmentChoiceDelayTicks: secondsToTicks(1),
      },
    },
  },
};
