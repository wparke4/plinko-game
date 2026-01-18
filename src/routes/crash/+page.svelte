<script lang="ts">
  import LiveStatsWindow from '$lib/components/LiveStatsWindow/LiveStatsWindow.svelte';
  import PlinkoSheep from '$lib/components/PlinkoSheep';
  import SettingsWindow from '$lib/components/SettingsWindow';
  import { BonusGameTransition } from '$lib/components/ui';

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



<div class="page-container">
  <!-- Risk Level Selector - overlaid on top -->
  <div class="risk-selector">
    <div class="flex flex-col gap-0.5">
      <label class="text-[10px] sm:text-xs font-medium text-gray-400">Risk Level</label>
      <div class="flex gap-0.5 sm:gap-1 rounded-full bg-gray-950 p-0.5">
        {#each riskLevels as { value, label }}
          <button
            onclick={() => handleRiskChange(value)}
            disabled={isGameInProgress}
            class="risk-button touch-manipulation rounded-full py-1.5 sm:py-1 px-2 sm:px-3 text-xs sm:text-sm font-medium text-white transition hover:not-disabled:bg-gray-800 active:not-disabled:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50 {$riskLevel === value ? 'bg-gray-800' : ''}"
          >
            {label}
          </button>
        {/each}
      </div>
    </div>
  </div>

  <PlinkoSheep />

  <SettingsWindow />
  <LiveStatsWindow />
  <BonusGameTransition />
</div>

<style lang="postcss">
  @reference "../../app.css";

  :global(body) {
    @apply bg-black;
    margin: 0;
    overflow: hidden;
  }

  .page-container {
    position: relative;
  }

  /* Risk selector overlaid at top */
  .risk-selector {
    position: absolute;
    top: 0.5rem;
    left: 0.5rem;
    z-index: 10;
  }

  .risk-button {
    -webkit-tap-highlight-color: transparent;
    user-select: none;
    min-height: 32px;
  }

  @media (min-width: 640px) {
    .risk-button {
      min-height: auto;
    }
  }
</style> 