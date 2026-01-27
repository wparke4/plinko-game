/**
 * Type definitions for Plinko Slot game.
 */

import type { ProvablyFairSeed } from '$lib/utils/provablyFair';

/**
 * Peg state tracking which balls have hit it and its color level.
 */
export interface Peg {
  /** Unique identifier: "row-col" format */
  id: string;
  /** Row index (0 = top) */
  row: number;
  /** Column index (0 = leftmost in row) */
  col: number;
  /** Current color level (0-10) */
  level: number;
  /** Bitmask tracking which balls (1-10) have hit this peg */
  hitMask: number;
  /** Total count of unique ball hits */
  hitCount: number;
  /** X position on canvas */
  x: number;
  /** Y position on canvas */
  y: number;
}

/**
 * Ball state during a run.
 */
export interface Ball {
  /** Ball ID (1-10) */
  id: number;
  /** Matter.js body reference */
  body: Matter.Body | null;
  /** Whether ball has exited the board */
  exited: boolean;
  /** Spawn x position (for replay) */
  spawnX: number;
  /** Timestamp of spawn */
  spawnTime: number;
  /** List of peg IDs hit by this ball */
  pegsHit: string[];
}

/**
 * Single tier result from count-based payout evaluation.
 */
export interface CountTierResult {
  tierId: string;
  tierName: string;
  levelThreshold: number;
  countRequired: number;
  actualCount: number;
  achieved: boolean;
  multiplier: number;
}

/**
 * Pattern match result.
 */
export interface PatternResult {
  patternId: string;
  patternName: string;
  description: string;
  achieved: boolean;
  multiplier: number;
  /** Peg IDs that form this pattern */
  matchedPegs: string[];
}

/**
 * Complete payout evaluation result.
 */
export interface PayoutResult {
  /** Count of pegs at each level threshold */
  levelCounts: {
    c1: number;
    c2: number;
    c3: number;
    c4: number;
    c5: number;
    c6: number;
    c7: number;
    c8: number;
    c9: number;
    c10: number;
  };
  /** Results for each count tier */
  countTiers: CountTierResult[];
  /** Highest achieved count tier */
  highestCountTier: CountTierResult | null;
  /** Multiplier from count-based payouts */
  countMultiplier: number;
  /** Pattern matches found */
  patterns: PatternResult[];
  /** Multiplier from pattern-based payouts */
  patternMultiplier: number;
  /** Final combined multiplier */
  totalMultiplier: number;
  /** Calculation mode used ('add' or 'max') */
  payoutMode: 'add' | 'max';
}

/**
 * State of a complete 10-ball run.
 */
export interface RunState {
  /** Unique run ID */
  runId: string;
  /** Current phase of the run */
  phase: 'idle' | 'dropping' | 'evaluating' | 'complete';
  /** Bet amount for this run */
  betAmount: number;
  /** All pegs on the board */
  pegs: Map<string, Peg>;
  /** All balls in this run */
  balls: Ball[];
  /** Index of current ball being dropped (0-9) */
  currentBallIndex: number;
  /** Provably fair seed data */
  seed: ProvablyFairSeed;
  /** Final payout result (set when phase = 'complete') */
  payoutResult: PayoutResult | null;
  /** Timestamp when run started */
  startTime: number;
  /** Timestamp when run ended */
  endTime: number | null;
}

/**
 * Replay log for deterministic reproduction.
 */
export interface ReplayLog {
  runId: string;
  seed: ProvablyFairSeed;
  boardConfig: {
    rows: number;
    ballCount: number;
  };
  ballSpawns: {
    ballId: number;
    spawnX: number;
    timestamp: number;
  }[];
  collisions: {
    ballId: number;
    pegId: string;
    timestamp: number;
    newPegLevel: number;
  }[];
  finalPegs: {
    id: string;
    level: number;
    hitMask: number;
    hitCount: number;
  }[];
  payoutResult: PayoutResult;
}

/**
 * Paytable configuration structure.
 */
export interface PaytableConfig {
  version: string;
  description: string;
  board: {
    rows: number;
    ballCount: number;
    maxPegLevel: number;
  };
  pegColors: Record<string, string>;
  pegGlow: {
    thresholdSoft: number;
    thresholdStrong: number;
    softGlowIntensity: number;
    strongGlowIntensity: number;
  };
  countPayouts: {
    description: string;
    tiers: {
      id: string;
      levelThreshold: number;
      countRequired: number;
      multiplier: number;
      name: string;
    }[];
  };
  patternPayouts: {
    description: string;
    enabled: boolean;
    patterns: {
      id: string;
      name: string;
      description: string;
      levelThreshold: number;
      countRequired?: number | 'all';
      multiplier: number;
    }[];
  };
  payoutMode: {
    description: string;
    mode: 'add' | 'max';
  };
  basePayout: {
    description: string;
    minimum: number;
  };
  physics: {
    ballDropDelayMs: number;
    ballDropJitterX: number;
    restitution: number;
    friction: number;
    frictionAir: number;
  };
  targetRTP: {
    description: string;
    target: number;
    tolerance: number;
  };
}

/**
 * Game statistics for display.
 */
export interface GameStats {
  totalRuns: number;
  totalBet: number;
  totalWon: number;
  netProfit: number;
  biggestWin: number;
  biggestMultiplier: number;
  averageMultiplier: number;
}

/**
 * Run history entry for display.
 */
export interface RunHistoryEntry {
  runId: string;
  betAmount: number;
  multiplier: number;
  payout: number;
  profit: number;
  timestamp: number;
  highestTier: string | null;
  patternsHit: string[];
}
