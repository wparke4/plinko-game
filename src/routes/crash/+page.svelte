<script lang="ts">
  import LiveStatsWindow from '$lib/components/LiveStatsWindow/LiveStatsWindow.svelte';
  import PlinkoSheep from '$lib/components/PlinkoSheep';
  import SettingsWindow from '$lib/components/SettingsWindow';

  import { plinkoEngine, riskLevel, gameState } from '$lib/stores/game';
  import { RiskLevel } from '$lib/types';

  // Update engine when risk level changes
  $effect(() => {
    if ($plinkoEngine && $riskLevel) {
      $plinkoEngine.setRiskLevel($riskLevel);
    }
  });

  const riskLevels = [
    { value: RiskLevel.LOW, label: 'Mild 🫑', description: 'Lower risk, safer gameplay' },
    { value: RiskLevel.MEDIUM, label: 'Medium 🌶️', description: 'Balanced risk and reward' },
    { value: RiskLevel.HIGH, label: 'Spicy 🔥', description: 'Higher risk, higher multipliers' },
  ];

  // Use reactive gameState store instead of directly calling engine method
  let isGameInProgress = $derived($gameState.isGameInProgress);

  function handleRiskChange(newRisk: RiskLevel) {
    // Prevent risk changes during gameplay
    if (isGameInProgress) {
      return;
    }
    riskLevel.set(newRisk);
  }
</script>



<div class="relative flex min-h-dvh w-full flex-col bg-black">
  <!-- Top Navigation Bar -->
  <div class="absolute top-2 left-4 right-4 z-10 flex items-center justify-between">
    <!-- Risk Level Selector -->
    <div class="flex flex-col gap-0.5">
      <label class="text-xs font-medium text-gray-400">Risk Level</label>
      <div class="flex gap-1 rounded-full bg-gray-950 p-0.5">
        {#each riskLevels as { value, label }}
          <button
            onclick={() => handleRiskChange(value)}
            disabled={isGameInProgress}
            class="rounded-full py-1 px-3 text-sm font-medium text-white transition hover:not-disabled:bg-gray-800 active:not-disabled:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50 {$riskLevel === value ? 'bg-gray-800' : ''}"
            title={isGameInProgress ? 'Cannot change risk level during gameplay' : ''}
          >
            {label}
          </button>
        {/each}
      </div>
    </div>


  </div>

  <div class="flex-1 px-5">
    <div class="mx-auto mt-3 max-w-xl min-w-[300px] drop-shadow-xl md:mt-6 lg:max-w-7xl">
      <div class="flex flex-col-reverse overflow-hidden rounded-lg lg:w-full lg:flex-row bg-black">
        <div class="flex-1">
          <PlinkoSheep />
        </div>
      </div>
    </div>
  </div>

  <SettingsWindow />
  <LiveStatsWindow />
</div>

<style lang="postcss">
  @reference "../../app.css";

  :global(body) {
    @apply bg-black;
  }
</style> 