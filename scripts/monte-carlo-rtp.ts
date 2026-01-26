/**
 * Monte Carlo RTP Simulator for Plinko Slot
 * 
 * Runs N simulated games to estimate the Return-to-Player (RTP) percentage.
 * 
 * Usage:
 *   npx ts-node scripts/monte-carlo-rtp.ts [numRuns] [--verbose]
 *   
 * Example:
 *   npx ts-node scripts/monte-carlo-rtp.ts 100000
 *   npx ts-node scripts/monte-carlo-rtp.ts 50000 --verbose
 */

import * as fs from 'fs';
import * as path from 'path';

// Load paytable config
const paytablePath = path.join(__dirname, '../src/lib/components/PlinkoSlot/paytable.json');
const paytable = JSON.parse(fs.readFileSync(paytablePath, 'utf-8'));

// ============== RNG Implementation ==============

function mulberry32(seed: number): () => number {
  return function() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class SeededRNG {
  private rng: () => number;
  
  constructor(seed: number) {
    this.rng = mulberry32(seed >>> 0);
  }
  
  next(): number {
    return this.rng();
  }
  
  range(min: number, max: number): number {
    return min + this.rng() * (max - min);
  }
  
  jitter(magnitude: number): number {
    return (this.rng() - 0.5) * 2 * magnitude;
  }
}

// ============== Board Simulation ==============

interface SimPeg {
  level: number;
  hitMask: number;
}

interface SimulationResult {
  pegLevels: number[];
  multiplier: number;
}

/**
 * Simplified physics simulation using binomial distribution.
 * 
 * In a real Plinko board, each ball has roughly 50% chance to go left or right at each peg.
 * We simulate which pegs get hit based on this probability.
 */
function simulateRun(rng: SeededRNG, config: typeof paytable): SimulationResult {
  const rows = config.board.rows;
  const ballCount = config.board.ballCount;
  const maxLevel = config.board.maxPegLevel;
  
  // Initialize pegs - total pegs = 3 + 4 + 5 + ... + (3 + rows - 1)
  // = sum from i=0 to rows-1 of (3 + i) = 3*rows + rows*(rows-1)/2
  const totalPegs = 3 * rows + (rows * (rows - 1)) / 2;
  const pegs: SimPeg[] = Array(totalPegs).fill(null).map(() => ({
    level: 0,
    hitMask: 0
  }));
  
  // Helper to get peg index from row, col
  const getPegIndex = (row: number, col: number): number => {
    // Sum of pegs in all rows before this one
    // Row i has (3 + i) pegs
    let index = 0;
    for (let r = 0; r < row; r++) {
      index += 3 + r;
    }
    return index + col;
  };
  
  // Simulate each ball
  for (let ballId = 1; ballId <= ballCount; ballId++) {
    const ballBit = 1 << (ballId - 1);
    
    // Starting position for this ball (small jitter from center)
    // Maps to which column in first row (3 pegs, so 0, 1, 2)
    const startJitter = rng.jitter(1);
    let currentCol = 1 + (startJitter > 0.3 ? 1 : startJitter < -0.3 ? -1 : 0);
    currentCol = Math.max(0, Math.min(2, currentCol));
    
    // Traverse each row
    for (let row = 0; row < rows; row++) {
      const pegsInRow = 3 + row;
      
      // Ensure column is in bounds
      currentCol = Math.max(0, Math.min(pegsInRow - 1, currentCol));
      
      // Get the peg at this position
      const pegIndex = getPegIndex(row, currentCol);
      const peg = pegs[pegIndex];
      
      // Check if this ball already hit this peg
      if ((peg.hitMask & ballBit) === 0) {
        peg.hitMask |= ballBit;
        if (peg.level < maxLevel) {
          peg.level++;
        }
      }
      
      // Decide which direction ball goes for next row (50/50 with small bias)
      const goRight = rng.next() > 0.5;
      if (goRight) {
        currentCol++; // Move right (col increases by 1)
      }
      // If going left, col stays the same (plinko geometry)
    }
  }
  
  // Extract peg levels
  const pegLevels = pegs.map(p => p.level);
  
  // Evaluate payout
  const multiplier = evaluatePayoutFast(pegLevels, config);
  
  return { pegLevels, multiplier };
}

/**
 * Fast payout evaluation (counts only, no pattern detection for speed).
 */
function evaluatePayoutFast(pegLevels: number[], config: typeof paytable): number {
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

  return Math.max(countMultiplier, config.basePayout.minimum);
}

// ============== Monte Carlo Simulation ==============

interface SimulationStats {
  totalRuns: number;
  totalMultiplier: number;
  rtp: number;
  hitRates: Record<string, number>;
  multiplierDistribution: Record<string, number>;
  maxMultiplier: number;
  zeroPayoutRate: number;
  avgMultiplier: number;
}

function runMonteCarlo(numRuns: number, verbose: boolean = false): SimulationStats {
  const stats: SimulationStats = {
    totalRuns: numRuns,
    totalMultiplier: 0,
    rtp: 0,
    hitRates: {},
    multiplierDistribution: {},
    maxMultiplier: 0,
    zeroPayoutRate: 0,
    avgMultiplier: 0
  };
  
  // Initialize tier hit counters
  for (const tier of paytable.countPayouts.tiers) {
    stats.hitRates[tier.id] = 0;
  }
  
  // Multiplier buckets
  const buckets = ['0', '0.01-1', '1-2', '2-5', '5-10', '10-20', '20-50', '50-100', '100+'];
  for (const bucket of buckets) {
    stats.multiplierDistribution[bucket] = 0;
  }
  
  const startTime = Date.now();
  let zeroCount = 0;
  
  for (let i = 0; i < numRuns; i++) {
    // Generate random seed for this run
    const seed = Math.floor(Math.random() * 0xFFFFFFFF);
    const rng = new SeededRNG(seed);
    
    // Run simulation
    const result = simulateRun(rng, paytable);
    
    // Accumulate stats
    stats.totalMultiplier += result.multiplier;
    stats.maxMultiplier = Math.max(stats.maxMultiplier, result.multiplier);
    
    if (result.multiplier === 0) {
      zeroCount++;
    }
    
    // Count tier hits
    const counts: number[] = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (const level of result.pegLevels) {
      for (let j = 1; j <= level; j++) {
        counts[j]++;
      }
    }
    
    for (const tier of paytable.countPayouts.tiers) {
      if (counts[tier.levelThreshold] >= tier.countRequired) {
        stats.hitRates[tier.id]++;
      }
    }
    
    // Multiplier distribution
    const m = result.multiplier;
    if (m === 0) stats.multiplierDistribution['0']++;
    else if (m < 1) stats.multiplierDistribution['0.01-1']++;
    else if (m < 2) stats.multiplierDistribution['1-2']++;
    else if (m < 5) stats.multiplierDistribution['2-5']++;
    else if (m < 10) stats.multiplierDistribution['5-10']++;
    else if (m < 20) stats.multiplierDistribution['10-20']++;
    else if (m < 50) stats.multiplierDistribution['20-50']++;
    else if (m < 100) stats.multiplierDistribution['50-100']++;
    else stats.multiplierDistribution['100+']++;
    
    // Progress update
    if (verbose && (i + 1) % 10000 === 0) {
      const elapsed = (Date.now() - startTime) / 1000;
      const runsPerSec = (i + 1) / elapsed;
      const eta = (numRuns - i - 1) / runsPerSec;
      console.log(`Progress: ${i + 1}/${numRuns} (${((i + 1) / numRuns * 100).toFixed(1)}%) - ${runsPerSec.toFixed(0)} runs/sec - ETA: ${eta.toFixed(1)}s`);
    }
  }
  
  // Calculate final stats
  stats.avgMultiplier = stats.totalMultiplier / numRuns;
  stats.rtp = stats.avgMultiplier * 100; // RTP as percentage
  stats.zeroPayoutRate = (zeroCount / numRuns) * 100;
  
  // Convert hit counts to percentages
  for (const key of Object.keys(stats.hitRates)) {
    stats.hitRates[key] = (stats.hitRates[key] / numRuns) * 100;
  }
  
  // Convert distribution to percentages
  for (const key of Object.keys(stats.multiplierDistribution)) {
    stats.multiplierDistribution[key] = (stats.multiplierDistribution[key] / numRuns) * 100;
  }
  
  return stats;
}

// ============== Main ==============

function main() {
  const args = process.argv.slice(2);
  const numRuns = parseInt(args[0]) || 100000;
  const verbose = args.includes('--verbose') || args.includes('-v');
  
  console.log('='.repeat(60));
  console.log('PLINKO SLOT - Monte Carlo RTP Simulation');
  console.log('='.repeat(60));
  console.log(`\nConfiguration:`);
  console.log(`  Rows: ${paytable.board.rows}`);
  console.log(`  Balls per run: ${paytable.board.ballCount}`);
  console.log(`  Max peg level: ${paytable.board.maxPegLevel}`);
  console.log(`  Target RTP: ${paytable.targetRTP.target}% (±${paytable.targetRTP.tolerance}%)`);
  console.log(`\nSimulating ${numRuns.toLocaleString()} runs...\n`);
  
  const startTime = Date.now();
  const stats = runMonteCarlo(numRuns, verbose);
  const elapsed = (Date.now() - startTime) / 1000;
  
  console.log('\n' + '='.repeat(60));
  console.log('RESULTS');
  console.log('='.repeat(60));
  
  console.log(`\n📊 Overall Statistics:`);
  console.log(`  Total Runs: ${stats.totalRuns.toLocaleString()}`);
  console.log(`  Time Elapsed: ${elapsed.toFixed(2)}s`);
  console.log(`  Runs/Second: ${(stats.totalRuns / elapsed).toFixed(0)}`);
  
  console.log(`\n💰 RTP Analysis:`);
  console.log(`  Average Multiplier: ${stats.avgMultiplier.toFixed(4)}x`);
  console.log(`  Estimated RTP: ${stats.rtp.toFixed(2)}%`);
  console.log(`  Target RTP: ${paytable.targetRTP.target}%`);
  
  const rtpDiff = stats.rtp - paytable.targetRTP.target;
  const withinTolerance = Math.abs(rtpDiff) <= paytable.targetRTP.tolerance;
  console.log(`  Difference: ${rtpDiff >= 0 ? '+' : ''}${rtpDiff.toFixed(2)}% ${withinTolerance ? '✅ (within tolerance)' : '❌ (OUTSIDE tolerance)'}`);
  
  console.log(`\n🎯 Tier Hit Rates:`);
  for (const tier of paytable.countPayouts.tiers) {
    const rate = stats.hitRates[tier.id];
    const bar = '█'.repeat(Math.round(rate / 2)) + '░'.repeat(50 - Math.round(rate / 2));
    console.log(`  ${tier.name.padEnd(12)} (${tier.multiplier}x): ${rate.toFixed(2).padStart(6)}% ${bar.slice(0, 20)}`);
  }
  
  console.log(`\n📈 Multiplier Distribution:`);
  for (const [bucket, rate] of Object.entries(stats.multiplierDistribution)) {
    const bar = '█'.repeat(Math.round(rate / 2));
    console.log(`  ${bucket.padEnd(10)}: ${rate.toFixed(2).padStart(6)}% ${bar}`);
  }
  
  console.log(`\n🏆 Extremes:`);
  console.log(`  Max Multiplier Hit: ${stats.maxMultiplier}x`);
  console.log(`  Zero Payout Rate: ${stats.zeroPayoutRate.toFixed(2)}%`);
  
  console.log('\n' + '='.repeat(60));
  
  // Recommendations
  if (!withinTolerance) {
    console.log('\n⚠️  RECOMMENDATIONS:');
    if (rtpDiff > 0) {
      console.log('  RTP is higher than target. Consider:');
      console.log('  - Increasing countRequired thresholds');
      console.log('  - Decreasing multipliers');
    } else {
      console.log('  RTP is lower than target. Consider:');
      console.log('  - Decreasing countRequired thresholds');
      console.log('  - Increasing multipliers');
    }
  }
  
  console.log('\n');
}

main();
