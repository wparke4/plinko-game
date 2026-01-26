<script lang="ts">
  import type { RunHistoryEntry } from './types';
  
  interface Props {
    history: RunHistoryEntry[];
    maxDisplay?: number;
  }
  
  let { history, maxDisplay = 5 }: Props = $props();
  
  const formatMultiplier = (m: number) => m.toFixed(2) + 'x';
  const formatCurrency = (v: number) => {
    const sign = v >= 0 ? '+' : '';
    return sign + '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };
  
  const getMultiplierColor = (m: number) => {
    if (m >= 10) return 'text-purple-400';
    if (m >= 5) return 'text-green-400';
    if (m >= 1) return 'text-yellow-400';
    return 'text-red-400';
  };
</script>

<div class="space-y-2">
  {#if history.length === 0}
    <div class="text-center text-neutral-500 text-sm py-4">
      No games played yet
    </div>
  {:else}
    {#each history.slice(0, maxDisplay) as entry}
      <div class="bg-neutral-800 border border-neutral-700 rounded p-3 flex items-center justify-between">
        <div>
          <div class="text-sm text-neutral-400">
            ${entry.betAmount.toLocaleString()}
          </div>
          {#if entry.highestTier}
            <div class="text-xs text-neutral-500">{entry.highestTier}</div>
          {/if}
        </div>
        
        <div class="text-right">
          <div class="font-bold {getMultiplierColor(entry.multiplier)}">
            {formatMultiplier(entry.multiplier)}
          </div>
          <div class="text-xs {entry.profit >= 0 ? 'text-green-400' : 'text-red-400'}">
            {formatCurrency(entry.profit)}
          </div>
        </div>
      </div>
    {/each}
  {/if}
</div>
