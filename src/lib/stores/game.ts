import ClassicPlinkoEngine from '$lib/components/Plinko/PlinkoEngine';
import CrashPlinkoEngine from '$lib/components/PlinkoCrash/PlinkoEngine';
import SheepPlinkoEngine from '$lib/components/PlinkoSheep/PlinkoEngine';
import { binColor, DEFAULT_BALANCE, binPayouts, binProbabilitiesByRowCount } from '$lib/constants/game';
import {
  RiskLevel,
  type BetAmountOfExistingBalls,
  type RowCount,
  type WinRecord,
} from '$lib/types';
import { interpolateRgbColors } from '$lib/utils/colors';
import { countValueOccurrences } from '$lib/utils/numbers';
import { derived, writable } from 'svelte/store';

// Create a union type for both engine types
type PlinkoEngine = ClassicPlinkoEngine | CrashPlinkoEngine | SheepPlinkoEngine;

export const plinkoEngine = writable<PlinkoEngine | null>(null);

export const betAmount = writable<number>(1);

export const betAmountOfExistingBalls = writable<BetAmountOfExistingBalls>({});

export const rowCount = writable<RowCount>(16);

export const riskLevel = writable<RiskLevel>(RiskLevel.MEDIUM);

export const winRecords = writable<WinRecord[]>([]);

/**
 * Set of bin indices that are set to 0x multiplier.
 * Players can click on bins to toggle them to 0x.
 */
export const zeroedBins = writable<Set<number>>(new Set());

/**
 * History of total profits. Should be updated whenever a new win record is pushed
 * to `winRecords` store.
 *
 * We deliberately don't use `derived(winRecords, ...)` to optimize performance.
 */
export const totalProfitHistory = writable<number[]>([0]);

/**
 * Game balance, which resets to the default value on page refresh.
 */
export const balance = writable<number>(DEFAULT_BALANCE);

// Current multiplier during active gameplay (for Plinko Crash mode)
export const currentMultiplier = writable<number>(0);

// Game state for UI reactivity (specifically for Plinko Crash mode)
export interface GameState {
  isGameInProgress: boolean;
  isGameDead: boolean;
  isCashOutCelebrating: boolean;
  isCashOutComplete: boolean;
}

export const gameState = writable<GameState>({
  isGameInProgress: false,
  isGameDead: false,
  isCashOutCelebrating: false,
  isCashOutComplete: false
});

// Multiplier flash state for cash out celebration feedback
export const isMultiplierFlashing = writable<boolean>(false);

// Bonus doubling animation state (for showing multiplier increase in real-time)
export interface BonusDoubling {
  from: number;
  to: number;
  startedAt: number;
}

export const bonusDoubling = writable<BonusDoubling | null>(null);

// Bonus game state management
export interface BonusGameState {
  isActive: boolean;
  remainingDrops: number;
  totalDrops: number;
  isTransitioning: boolean;
  triggerAmount: number; // The amount that triggered the bonus
  bonusMultiplier: number; // The multiplier from the bonus passage
  isGoldenBonus?: boolean; // Flag to indicate if this is a golden bonus game
}

export const bonusGameState = writable<BonusGameState>({
  isActive: false,
  remainingDrops: 0,
  totalDrops: 5,
  isTransitioning: false,
  triggerAmount: 0,
  bonusMultiplier: 1
});

/**
 * RGB colors for every bin. The length of the array is the number of bins.
 */
export const binColors = derived<typeof rowCount, { background: string[]; shadow: string[] }>(
  rowCount,
  ($rowCount) => {
    const binCount = $rowCount + 1;
    const isBinsEven = binCount % 2 === 0;
    const redToYellowLength = Math.ceil(binCount / 2);

    const redToYellowBg = interpolateRgbColors(
      binColor.background.red,
      binColor.background.yellow,
      redToYellowLength,
    ).map(({ r, g, b }) => `rgb(${r}, ${g}, ${b})`);

    const redToYellowShadow = interpolateRgbColors(
      binColor.shadow.red,
      binColor.shadow.yellow,
      redToYellowLength,
    ).map(({ r, g, b }) => `rgb(${r}, ${g}, ${b})`);

    return {
      background: [...redToYellowBg, ...redToYellowBg.toReversed().slice(isBinsEven ? 0 : 1)],
      shadow: [...redToYellowShadow, ...redToYellowShadow.toReversed().slice(isBinsEven ? 0 : 1)],
    };
  },
);

export const binProbabilities = derived<
  [typeof winRecords, typeof rowCount],
  { [binIndex: number]: number }
>([winRecords, rowCount], ([$winRecords, $rowCount]) => {
  const occurrences = countValueOccurrences($winRecords.map(({ binIndex }) => binIndex));
  const probabilities: Record<number, number> = {};
  for (let i = 0; i < $rowCount + 1; ++i) {
    probabilities[i] = occurrences[i] / $winRecords.length || 0;
  }
  return probabilities;
});

/**
 * Recalculates multipliers to maintain RTP when bins are zeroed
 */
function recalculateMultipliers(rowCount: RowCount, riskLevel: RiskLevel, zeroedBinsSet: Set<number>): number[] {
  const originalMultipliers = binPayouts[rowCount][riskLevel];
  const probabilities = binProbabilitiesByRowCount[rowCount];
  
  // If no bins are zeroed, return original multipliers
  if (zeroedBinsSet.size === 0) {
    return originalMultipliers;
  }

  // Calculate original RTP
  const originalRTP = probabilities.reduce((sum, prob, i) => 
    sum + prob * originalMultipliers[i], 0);

  // Calculate lost expected value from zeroed bins
  const lostEV = Array.from(zeroedBinsSet).reduce((sum, binIndex) => 
    sum + probabilities[binIndex] * originalMultipliers[binIndex], 0);

  // Calculate sum of (probability × multiplier) for non-zeroed bins
  const activeMultiplierSum = originalMultipliers.reduce((sum, mult, i) => 
    zeroedBinsSet.has(i) ? sum : sum + mult * probabilities[i], 0);

  // Calculate scaling factor
  const scalingFactor = originalRTP / activeMultiplierSum;

  // Log debug information
  console.log('Multiplier Adjustment Debug:', {
    rowCount,
    riskLevel,
    zeroedBins: Array.from(zeroedBinsSet),
    originalRTP,
    lostEV,
    activeMultiplierSum,
    scalingFactor
  });

  // Return new multipliers with proportional scaling
  const adjustedMultipliers = originalMultipliers.map((mult, i) => {
    if (zeroedBinsSet.has(i)) {
      return 0;
    }
    return mult * scalingFactor;
  });

  // Log multiplier changes
  console.log('Multiplier Changes:', originalMultipliers.map((orig, i) => ({
    binIndex: i,
    original: orig,
    adjusted: adjustedMultipliers[i],
    difference: adjustedMultipliers[i] - orig,
    percentageIncrease: ((adjustedMultipliers[i] - orig) / orig * 100).toFixed(2) + '%'
  })));

  return adjustedMultipliers;
}

/**
 * Store containing the current adjusted multipliers, accounting for zeroed bins
 */
export const adjustedMultipliers = derived(
  [rowCount, riskLevel, zeroedBins],
  ([$rowCount, $riskLevel, $zeroedBins]) => recalculateMultipliers($rowCount, $riskLevel, $zeroedBins)
);
