<script lang="ts">
  import { binColorsByRowCount, binPayouts } from '$lib/constants/game';
  import { winRecords } from '$lib/stores/game';

  type Props = {
    /**
     * Number of last wins to display.
     */
    winCount?: number;
  };

  let { winCount = 4 }: Props = $props();

  let lastWins = $derived($winRecords.slice(0, winCount));
</script>

<!-- Clamps in mobile:
      - Width: From 1.5rem at 340px viewport width to 2rem at 620px viewport width
      - Font size: From 8px at 340px viewport width to 10px at 620px viewport width
 -->
<div
  class="flex w-[clamp(1.5rem,0.893rem+2.857vw,2rem)] flex-col overflow-hidden rounded-xs text-[clamp(8px,5.568px+0.714vw,10px)] md:rounded-md lg:w-12 lg:text-sm"
  style:aspect-ratio={`1 / ${winCount}`}
>
  {#each lastWins as { binIndex, rowCount, riskLevel, payout: { multiplier } }}
    <div
      class="flex aspect-square flex-col items-center justify-center font-bold text-gray-950"
      style:background-color={binIndex === -1 ? '#22c55e' : binIndex === -2 ? '#ef4444' : binColorsByRowCount[rowCount].background[binIndex]}
    >
      {#if binIndex === -1}
        <!-- Crash mode cash out (successful) -->
        <span class="text-white">{multiplier.toFixed(2)}×</span>
      {:else if binIndex === -2}
        <!-- Crash mode death (failed) -->
        <span class="text-white">{multiplier.toFixed(2)}×</span>
      {:else}
        <!-- Classic plinko mode -->
        <span>{binPayouts[rowCount][riskLevel][binIndex]}{binPayouts[rowCount][riskLevel][binIndex] < 100 ? '×' : ''}</span>
        {#if multiplier !== binPayouts[rowCount][riskLevel][binIndex]}
          <span class="text-xs text-red-600">({multiplier.toFixed(2)}×)</span>
        {/if}
      {/if}
    </div>
  {/each}
</div>