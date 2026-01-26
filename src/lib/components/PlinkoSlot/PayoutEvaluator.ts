/**
 * Payout Evaluator for Plinko Slot.
 * 
 * Evaluates the final peg state to determine payout multiplier
 * based on count thresholds and pattern detection.
 */

import type { 
  Peg, 
  PayoutResult, 
  CountTierResult, 
  PatternResult,
  PaytableConfig 
} from './types';
import paytableDefault from './paytable.json';

/**
 * Evaluate count-based payouts.
 * Counts how many pegs reach each level threshold.
 */
function evaluateCountPayouts(
  pegs: Map<string, Peg>,
  config: PaytableConfig
): { levelCounts: PayoutResult['levelCounts']; tiers: CountTierResult[]; highest: CountTierResult | null; multiplier: number } {
  // Count pegs at each level threshold
  const levelCounts = {
    c1: 0, c2: 0, c3: 0, c4: 0, c5: 0,
    c6: 0, c7: 0, c8: 0, c9: 0, c10: 0
  };

  for (const peg of pegs.values()) {
    if (peg.level >= 1) levelCounts.c1++;
    if (peg.level >= 2) levelCounts.c2++;
    if (peg.level >= 3) levelCounts.c3++;
    if (peg.level >= 4) levelCounts.c4++;
    if (peg.level >= 5) levelCounts.c5++;
    if (peg.level >= 6) levelCounts.c6++;
    if (peg.level >= 7) levelCounts.c7++;
    if (peg.level >= 8) levelCounts.c8++;
    if (peg.level >= 9) levelCounts.c9++;
    if (peg.level >= 10) levelCounts.c10++;
  }

  // Evaluate each tier
  const tiers: CountTierResult[] = config.countPayouts.tiers.map(tier => {
    const countKey = `c${tier.levelThreshold}` as keyof typeof levelCounts;
    const actualCount = levelCounts[countKey];
    const achieved = actualCount >= tier.countRequired;

    return {
      tierId: tier.id,
      tierName: tier.name,
      levelThreshold: tier.levelThreshold,
      countRequired: tier.countRequired,
      actualCount,
      achieved,
      multiplier: tier.multiplier
    };
  });

  // Find highest achieved tier (by multiplier)
  const achievedTiers = tiers.filter(t => t.achieved);
  const highest = achievedTiers.length > 0
    ? achievedTiers.reduce((best, t) => t.multiplier > best.multiplier ? t : best)
    : null;

  return {
    levelCounts,
    tiers,
    highest,
    multiplier: highest?.multiplier ?? 0
  };
}

/**
 * Check for diagonal pattern (3 pegs in a row diagonally).
 */
function findDiagonal3(
  pegs: Map<string, Peg>,
  levelThreshold: number
): { found: boolean; matchedPegs: string[] } {
  const matchedPegs: string[] = [];
  
  // Convert to array for easier processing
  const pegArray = Array.from(pegs.values());
  const pegsByPos = new Map<string, Peg>();
  pegArray.forEach(p => pegsByPos.set(`${p.row}-${p.col}`, p));

  // Check down-right diagonals
  for (const peg of pegArray) {
    if (peg.level < levelThreshold) continue;
    
    // Down-right diagonal
    const dr1 = pegsByPos.get(`${peg.row + 1}-${peg.col + 1}`);
    const dr2 = pegsByPos.get(`${peg.row + 2}-${peg.col + 2}`);
    
    if (dr1 && dr2 && dr1.level >= levelThreshold && dr2.level >= levelThreshold) {
      return {
        found: true,
        matchedPegs: [peg.id, dr1.id, dr2.id]
      };
    }
    
    // Down-left diagonal (in Plinko, col stays same or +1 as we go down)
    const dl1 = pegsByPos.get(`${peg.row + 1}-${peg.col}`);
    const dl2 = pegsByPos.get(`${peg.row + 2}-${peg.col}`);
    
    if (dl1 && dl2 && dl1.level >= levelThreshold && dl2.level >= levelThreshold) {
      return {
        found: true,
        matchedPegs: [peg.id, dl1.id, dl2.id]
      };
    }
  }

  return { found: false, matchedPegs };
}

/**
 * Check for hot column pattern (4+ pegs in same column).
 */
function findHotColumn(
  pegs: Map<string, Peg>,
  levelThreshold: number,
  countRequired: number
): { found: boolean; matchedPegs: string[] } {
  // Group pegs by column (approximate by x position or col index)
  const columns = new Map<number, Peg[]>();
  
  for (const peg of pegs.values()) {
    if (peg.level >= levelThreshold) {
      const col = peg.col;
      if (!columns.has(col)) {
        columns.set(col, []);
      }
      columns.get(col)!.push(peg);
    }
  }

  // Find column with enough hot pegs
  for (const [, columnPegs] of columns) {
    if (columnPegs.length >= countRequired) {
      return {
        found: true,
        matchedPegs: columnPegs.slice(0, countRequired).map(p => p.id)
      };
    }
  }

  return { found: false, matchedPegs: [] };
}

/**
 * Check for crown pattern (V-shape of 5 pegs).
 * Looking for a V pattern like:
 *     P     P
 *      P   P
 *        P
 */
function findCrown(
  pegs: Map<string, Peg>,
  levelThreshold: number
): { found: boolean; matchedPegs: string[] } {
  const pegArray = Array.from(pegs.values());
  const pegsByPos = new Map<string, Peg>();
  pegArray.forEach(p => pegsByPos.set(`${p.row}-${p.col}`, p));

  // Look for V pattern starting from top corners
  for (let row = 0; row < 10; row++) {
    for (let col = 0; col < 10; col++) {
      const top1 = pegsByPos.get(`${row}-${col}`);
      const top2 = pegsByPos.get(`${row}-${col + 4}`);
      const mid1 = pegsByPos.get(`${row + 1}-${col + 1}`);
      const mid2 = pegsByPos.get(`${row + 1}-${col + 3}`);
      const bottom = pegsByPos.get(`${row + 2}-${col + 2}`);

      if (top1 && top2 && mid1 && mid2 && bottom) {
        if (
          top1.level >= levelThreshold &&
          top2.level >= levelThreshold &&
          mid1.level >= levelThreshold &&
          mid2.level >= levelThreshold &&
          bottom.level >= levelThreshold
        ) {
          return {
            found: true,
            matchedPegs: [top1.id, top2.id, mid1.id, mid2.id, bottom.id]
          };
        }
      }
    }
  }

  return { found: false, matchedPegs: [] };
}

/**
 * Check for full row pattern (all pegs in a row meet threshold).
 */
function findFullRow(
  pegs: Map<string, Peg>,
  levelThreshold: number,
  rowCount: number
): { found: boolean; matchedPegs: string[] } {
  // Group pegs by row
  const rows = new Map<number, Peg[]>();
  
  for (const peg of pegs.values()) {
    if (!rows.has(peg.row)) {
      rows.set(peg.row, []);
    }
    rows.get(peg.row)!.push(peg);
  }

  // Check each row
  for (const [rowIdx, rowPegs] of rows) {
    // Number of pegs in row = 3 + rowIdx (for standard Plinko)
    const expectedCount = 3 + rowIdx;
    const hotPegs = rowPegs.filter(p => p.level >= levelThreshold);
    
    if (hotPegs.length === expectedCount && hotPegs.length === rowPegs.length) {
      return {
        found: true,
        matchedPegs: hotPegs.map(p => p.id)
      };
    }
  }

  return { found: false, matchedPegs: [] };
}

/**
 * Check for top triangle pattern (first 3 rows all hot).
 */
function findTopTriangle(
  pegs: Map<string, Peg>,
  levelThreshold: number
): { found: boolean; matchedPegs: string[] } {
  const topPegs: Peg[] = [];
  
  for (const peg of pegs.values()) {
    if (peg.row <= 2) {
      topPegs.push(peg);
    }
  }

  // Rows 0, 1, 2 have 3, 4, 5 pegs = 12 total
  const expectedCount = 3 + 4 + 5; // 12
  const hotPegs = topPegs.filter(p => p.level >= levelThreshold);

  if (hotPegs.length === expectedCount) {
    return {
      found: true,
      matchedPegs: hotPegs.map(p => p.id)
    };
  }

  return { found: false, matchedPegs: [] };
}

/**
 * Check for perfect run (all pegs hit at least once).
 */
function findPerfectRun(
  pegs: Map<string, Peg>,
  levelThreshold: number
): { found: boolean; matchedPegs: string[] } {
  const allPegs = Array.from(pegs.values());
  const hitPegs = allPegs.filter(p => p.level >= levelThreshold);

  if (hitPegs.length === allPegs.length) {
    return {
      found: true,
      matchedPegs: hitPegs.map(p => p.id)
    };
  }

  return { found: false, matchedPegs: [] };
}

/**
 * Evaluate pattern-based payouts.
 */
function evaluatePatternPayouts(
  pegs: Map<string, Peg>,
  config: PaytableConfig
): { patterns: PatternResult[]; multiplier: number } {
  if (!config.patternPayouts.enabled) {
    return { patterns: [], multiplier: 0 };
  }

  const patterns: PatternResult[] = [];
  let totalMultiplier = 0;

  for (const patternConfig of config.patternPayouts.patterns) {
    let result: { found: boolean; matchedPegs: string[] };

    switch (patternConfig.id) {
      case 'diagonal3':
        result = findDiagonal3(pegs, patternConfig.levelThreshold);
        break;
      case 'hotColumn':
        result = findHotColumn(
          pegs, 
          patternConfig.levelThreshold, 
          typeof patternConfig.countRequired === 'number' ? patternConfig.countRequired : 4
        );
        break;
      case 'crown':
        result = findCrown(pegs, patternConfig.levelThreshold);
        break;
      case 'fullRow':
        result = findFullRow(pegs, patternConfig.levelThreshold, config.board.rows);
        break;
      case 'topTriangle':
        result = findTopTriangle(pegs, patternConfig.levelThreshold);
        break;
      case 'perfectRun':
        result = findPerfectRun(pegs, patternConfig.levelThreshold);
        break;
      default:
        result = { found: false, matchedPegs: [] };
    }

    patterns.push({
      patternId: patternConfig.id,
      patternName: patternConfig.name,
      description: patternConfig.description,
      achieved: result.found,
      multiplier: patternConfig.multiplier,
      matchedPegs: result.matchedPegs
    });

    if (result.found) {
      totalMultiplier += patternConfig.multiplier;
    }
  }

  return { patterns, multiplier: totalMultiplier };
}

/**
 * Main payout evaluation function.
 */
export function evaluatePayout(
  pegs: Map<string, Peg>,
  config: PaytableConfig = paytableDefault as PaytableConfig
): PayoutResult {
  // Evaluate count-based payouts
  const countResult = evaluateCountPayouts(pegs, config);
  
  // Evaluate pattern-based payouts
  const patternResult = evaluatePatternPayouts(pegs, config);

  // Combine based on payout mode
  let totalMultiplier: number;
  
  if (config.payoutMode.mode === 'add') {
    // Add count multiplier + all pattern multipliers
    totalMultiplier = countResult.multiplier + patternResult.multiplier;
  } else {
    // Take max of count vs total patterns
    totalMultiplier = Math.max(countResult.multiplier, patternResult.multiplier);
  }

  // Apply minimum payout
  totalMultiplier = Math.max(totalMultiplier, config.basePayout.minimum);

  return {
    levelCounts: countResult.levelCounts,
    countTiers: countResult.tiers,
    highestCountTier: countResult.highest,
    countMultiplier: countResult.multiplier,
    patterns: patternResult.patterns,
    patternMultiplier: patternResult.multiplier,
    totalMultiplier,
    payoutMode: config.payoutMode.mode
  };
}

/**
 * Quick evaluation for Monte Carlo simulation (optimized, no extra data).
 */
export function evaluatePayoutFast(
  pegLevels: number[],
  config: PaytableConfig = paytableDefault as PaytableConfig
): number {
  // Count pegs at each level threshold
  const counts = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]; // c0-c10
  
  for (const level of pegLevels) {
    for (let i = 1; i <= level; i++) {
      counts[i]++;
    }
  }

  // Find highest achieved tier
  let countMultiplier = 0;
  for (const tier of config.countPayouts.tiers) {
    if (counts[tier.levelThreshold] >= tier.countRequired) {
      countMultiplier = Math.max(countMultiplier, tier.multiplier);
    }
  }

  // For fast simulation, we skip pattern detection (can be added if needed)
  // Pattern bonuses would require full peg position data

  return Math.max(countMultiplier, config.basePayout.minimum);
}

export default evaluatePayout;
