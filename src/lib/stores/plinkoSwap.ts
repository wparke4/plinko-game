import PlinkoSwapEngine from '$lib/components/PlinkoSwap/PlinkoEngine';
import { DEFAULT_BALANCE, binPayouts, binProbabilitiesByRowCount } from '$lib/constants/game';
import {
  RiskLevel,
  type BetAmountOfExistingBalls,
  type RowCount,
  type WinRecord,
} from '$lib/types';
import { buildIdentityBucketOrder } from '$lib/utils/bucketSwap';
import { derived, get, writable } from 'svelte/store';

export const plinkoSwapEngine = writable<PlinkoSwapEngine | null>(null);

export const betAmount = writable<number>(1);

export const betAmountOfExistingBalls = writable<BetAmountOfExistingBalls>({});

export const rowCount = writable<RowCount>(16);

export const riskLevel = writable<RiskLevel>(RiskLevel.MEDIUM);

export const winRecords = writable<WinRecord[]>([]);

/**
 * Set of bucket indices that are set to 0x multiplier.
 */
export const zeroedBins = writable<Set<number>>(new Set());

export const totalProfitHistory = writable<number[]>([0]);

export const balance = writable<number>(DEFAULT_BALANCE);

function recalculateMultipliers(
  rowCountValue: RowCount,
  riskLevelValue: RiskLevel,
  zeroedBinsSet: Set<number>,
): number[] {
  const originalMultipliers = binPayouts[rowCountValue][riskLevelValue];
  const probabilities = binProbabilitiesByRowCount[rowCountValue];

  if (zeroedBinsSet.size === 0) {
    return originalMultipliers;
  }

  const originalRTP = probabilities.reduce((sum, prob, i) => sum + prob * originalMultipliers[i], 0);

  const lostEV = Array.from(zeroedBinsSet).reduce(
    (sum, binIndex) => sum + probabilities[binIndex] * originalMultipliers[binIndex],
    0,
  );

  const activeMultiplierSum = originalMultipliers.reduce(
    (sum, mult, i) => (zeroedBinsSet.has(i) ? sum : sum + mult * probabilities[i]),
    0,
  );

  const scalingFactor = originalRTP / activeMultiplierSum;

  console.log('Multiplier Adjustment Debug (Plinko Swap):', {
    rowCount: rowCountValue,
    riskLevel: riskLevelValue,
    zeroedBins: Array.from(zeroedBinsSet),
    originalRTP,
    lostEV,
    activeMultiplierSum,
    scalingFactor,
  });

  const adjusted = originalMultipliers.map((mult, i) => {
    if (zeroedBinsSet.has(i)) {
      return 0;
    }
    return mult * scalingFactor;
  });

  console.log(
    'Multiplier Changes (Plinko Swap):',
    originalMultipliers.map((orig, i) => ({
      binIndex: i,
      original: orig,
      adjusted: adjusted[i],
      difference: adjusted[i] - orig,
      percentageIncrease: ((adjusted[i] - orig) / orig * 100).toFixed(2) + '%',
    })),
  );

  return adjusted;
}

export const adjustedMultipliers = derived(
  [rowCount, riskLevel, zeroedBins],
  ([$rowCount, $riskLevel, $zeroedBins]) =>
    recalculateMultipliers($rowCount, $riskLevel, $zeroedBins),
);

export const bucketOrder = writable<number[]>(buildIdentityBucketOrder(get(rowCount) + 1));

rowCount.subscribe((value) => {
  bucketOrder.set(buildIdentityBucketOrder(value + 1));
});

export const currentMultipliersByPosition = derived(
  [adjustedMultipliers, bucketOrder],
  ([$adjustedMultipliers, $bucketOrder]) =>
    $bucketOrder.map((bucketIndex) => $adjustedMultipliers[bucketIndex] ?? 0),
);
