/**
 * Svelte stores for Plinko Slot game state.
 */

import { writable, derived } from 'svelte/store';
import type { PlinkoSlotEngine } from './PlinkoSlotEngine';
import type { 
  RunState, 
  PayoutResult, 
  GameStats, 
  RunHistoryEntry,
  Peg 
} from './types';

/**
 * Engine instance store.
 */
export const slotEngine = writable<PlinkoSlotEngine | null>(null);

/**
 * Current run state.
 */
export const runState = writable<RunState | null>(null);

/**
 * Current phase of the game.
 */
export const gamePhase = writable<RunState['phase']>('idle');

/**
 * Current peg states (map of pegId -> Peg).
 */
export const pegs = writable<Map<string, Peg>>(new Map());

/**
 * Current bet amount.
 */
export const betAmount = writable<number>(100);

/**
 * Player balance.
 */
export const balance = writable<number>(10000);

/**
 * Current ball being dropped (1-10, or 0 if none).
 */
export const currentBall = writable<number>(0);

/**
 * Balls that have exited the board.
 */
export const exitedBalls = writable<number[]>([]);

/**
 * Latest payout result.
 */
export const payoutResult = writable<PayoutResult | null>(null);

/**
 * Provably fair state for display.
 */
export const fairState = writable<{
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
  revealedServerSeed?: string;
}>({
  serverSeedHash: '',
  clientSeed: '',
  nonce: 0,
});

/**
 * Run history (most recent first).
 */
export const runHistory = writable<RunHistoryEntry[]>([]);

/**
 * Game statistics.
 */
export const gameStats = writable<GameStats>({
  totalRuns: 0,
  totalBet: 0,
  totalWon: 0,
  netProfit: 0,
  biggestWin: 0,
  biggestMultiplier: 0,
  averageMultiplier: 0,
});

/**
 * Whether settings modal is open.
 */
export const showSettings = writable<boolean>(false);

/**
 * Whether fair verification modal is open.
 */
export const showFairVerify = writable<boolean>(false);

/**
 * Whether a run is in progress.
 */
export const isRunning = derived(
  gamePhase,
  ($phase) => $phase === 'dropping' || $phase === 'evaluating'
);

/**
 * Last N runs for history display.
 */
export const recentRuns = derived(
  runHistory,
  ($history) => $history.slice(0, 10)
);

/**
 * Level counts for current peg state.
 */
export const levelCounts = derived(
  pegs,
  ($pegs) => {
    const counts = {
      c1: 0, c2: 0, c3: 0, c4: 0, c5: 0,
      c6: 0, c7: 0, c8: 0, c9: 0, c10: 0
    };
    
    for (const peg of $pegs.values()) {
      if (peg.level >= 1) counts.c1++;
      if (peg.level >= 2) counts.c2++;
      if (peg.level >= 3) counts.c3++;
      if (peg.level >= 4) counts.c4++;
      if (peg.level >= 5) counts.c5++;
      if (peg.level >= 6) counts.c6++;
      if (peg.level >= 7) counts.c7++;
      if (peg.level >= 8) counts.c8++;
      if (peg.level >= 9) counts.c9++;
      if (peg.level >= 10) counts.c10++;
    }
    
    return counts;
  }
);

/**
 * Update game stats after a run.
 */
export function updateStatsAfterRun(bet: number, multiplier: number): void {
  gameStats.update(stats => {
    const won = bet * multiplier;
    const profit = won - bet;
    const newTotalRuns = stats.totalRuns + 1;
    
    return {
      totalRuns: newTotalRuns,
      totalBet: stats.totalBet + bet,
      totalWon: stats.totalWon + won,
      netProfit: stats.netProfit + profit,
      biggestWin: Math.max(stats.biggestWin, won),
      biggestMultiplier: Math.max(stats.biggestMultiplier, multiplier),
      averageMultiplier: (stats.averageMultiplier * stats.totalRuns + multiplier) / newTotalRuns,
    };
  });
}

/**
 * Add a run to history.
 */
export function addRunToHistory(
  runId: string,
  bet: number,
  result: PayoutResult
): void {
  const entry: RunHistoryEntry = {
    runId,
    betAmount: bet,
    multiplier: result.totalMultiplier,
    payout: bet * result.totalMultiplier,
    profit: bet * result.totalMultiplier - bet,
    timestamp: Date.now(),
    highestTier: result.highestCountTier?.tierName ?? null,
    patternsHit: result.patterns.filter(p => p.achieved).map(p => p.patternName),
  };

  runHistory.update(history => [entry, ...history].slice(0, 100));
}

/**
 * Reset all stores for a fresh game.
 */
export function resetGame(): void {
  runState.set(null);
  gamePhase.set('idle');
  pegs.set(new Map());
  currentBall.set(0);
  exitedBalls.set([]);
  payoutResult.set(null);
}
