<script lang="ts">
  import type { PayoutResult } from './types';
  
  interface Props {
    result: PayoutResult | null;
    betAmount: number;
  }
  
  let { result, betAmount }: Props = $props();
  
  const formatMultiplier = (m: number) => m.toFixed(2) + 'x';
  const formatCurrency = (v: number) => '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
</script>

{#if result}
  <div class="bg-neutral-900 border border-neutral-700 rounded-lg p-4 space-y-4">
    <!-- Payout Header -->
    <div class="text-center">
      <div class="text-sm text-neutral-400 uppercase tracking-wide mb-1">Total Payout</div>
      <div class="text-4xl font-bold {result.totalMultiplier >= 5 ? 'text-green-400' : result.totalMultiplier >= 1 ? 'text-yellow-400' : 'text-red-400'}">
        {formatMultiplier(result.totalMultiplier)}
      </div>
      <div class="text-lg text-neutral-300 mt-1">
        {formatCurrency(betAmount * result.totalMultiplier)}
      </div>
    </div>

    <!-- Level Counts Grid -->
    <div class="border-t border-neutral-700 pt-4">
      <div class="text-sm text-neutral-400 uppercase tracking-wide mb-2">Peg Levels</div>
      <div class="grid grid-cols-5 gap-2 text-center text-sm">
        {#each [
          { label: 'L1+', value: result.levelCounts.c1, color: '#6B7280' },
          { label: 'L3+', value: result.levelCounts.c3, color: '#2FA4A9' },
          { label: 'L5+', value: result.levelCounts.c5, color: '#A3E635' },
          { label: 'L8+', value: result.levelCounts.c8, color: '#DC2626' },
          { label: 'L10', value: result.levelCounts.c10, color: '#F9FAFB' }
        ] as stat}
          <div class="bg-neutral-800 rounded p-2">
            <div class="text-xs text-neutral-500">{stat.label}</div>
            <div class="font-bold" style:color={stat.color}>{stat.value}</div>
          </div>
        {/each}
      </div>
    </div>

    <!-- Count Tier Hit -->
    {#if result.highestCountTier}
      <div class="border-t border-neutral-700 pt-4">
        <div class="text-sm text-neutral-400 uppercase tracking-wide mb-2">Tier Hit</div>
        <div class="flex items-center justify-between bg-neutral-800 rounded p-3">
          <span class="font-medium text-white">{result.highestCountTier.tierName}</span>
          <span class="text-green-400 font-bold">{formatMultiplier(result.highestCountTier.multiplier)}</span>
        </div>
      </div>
    {/if}

    <!-- Patterns Hit -->
    {#if result.patterns.some(p => p.achieved)}
      <div class="border-t border-neutral-700 pt-4">
        <div class="text-sm text-neutral-400 uppercase tracking-wide mb-2">Patterns</div>
        <div class="space-y-2">
          {#each result.patterns.filter(p => p.achieved) as pattern}
            <div class="flex items-center justify-between bg-gradient-to-r from-purple-900/50 to-neutral-800 rounded p-3">
              <div>
                <div class="font-medium text-purple-300">{pattern.patternName}</div>
                <div class="text-xs text-neutral-400">{pattern.description}</div>
              </div>
              <span class="text-purple-400 font-bold">+{formatMultiplier(pattern.multiplier)}</span>
            </div>
          {/each}
        </div>
      </div>
    {/if}

    <!-- Payout Mode -->
    <div class="text-xs text-neutral-500 text-center border-t border-neutral-700 pt-3">
      Payout Mode: {result.payoutMode === 'add' ? 'Count + Patterns' : 'Best of Count/Patterns'}
    </div>
  </div>
{:else}
  <div class="bg-neutral-900 border border-neutral-700 rounded-lg p-6 text-center">
    <div class="text-neutral-500">Start a run to see results</div>
  </div>
{/if}
