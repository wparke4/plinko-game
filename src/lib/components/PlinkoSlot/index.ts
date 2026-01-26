/**
 * Plinko Slot - A deterministic 10-ball Plinko game with slot-like payouts.
 */

export { default as PlinkoSlot } from './PlinkoSlot.svelte';
export { default as PlinkoSlotEngine } from './PlinkoSlotEngine';
export { default as PayoutEvaluator, evaluatePayout, evaluatePayoutFast } from './PayoutEvaluator';

// Components
export { default as ResultsPanel } from './ResultsPanel.svelte';
export { default as BallProgress } from './BallProgress.svelte';
export { default as ProvablyFairPanel } from './ProvablyFairPanel.svelte';
export { default as RunHistory } from './RunHistory.svelte';

// Types
export * from './types';

// Stores
export * from './stores';

// Default export
export { default } from './PlinkoSlot.svelte';
