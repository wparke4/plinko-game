<script lang="ts">
  import LiveStatsWindow from '$lib/components/LiveStatsWindow/LiveStatsWindow.svelte';
  import PlinkoSheep from '$lib/components/PlinkoSheep';
  import SettingsWindow from '$lib/components/SettingsWindow';

  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { plinkoEngine, riskLevel } from '$lib/stores/game';
  import { RiskLevel } from '$lib/types';

  // Update engine when risk level changes
  $effect(() => {
    if ($plinkoEngine && $riskLevel) {
      $plinkoEngine.setRiskLevel($riskLevel);
    }
  });

  const gameTypes = [
    { value: '/', label: 'Classic Plinko' },
    { value: '/crash', label: 'Crash' },
    { value: '/sheep', label: 'Sheep' }
  ];

  const riskLevels = [
    { value: RiskLevel.LOW, label: 'Low', pins: '25 pins', description: 'Lower risk, safer gameplay' },
    { value: RiskLevel.MEDIUM, label: 'Medium', pins: '23 pins', description: 'Balanced risk and reward' },
    { value: RiskLevel.HIGH, label: 'High', pins: '15 pins', description: 'Higher risk, higher multipliers' },
  ];

  let isGameInProgress = $derived($plinkoEngine?.isGameInProgress() ?? false);

  function handleGameChange(path: string) {
    goto(path);
  }

  function handleRiskChange(newRisk: RiskLevel) {
    riskLevel.set(newRisk);
  }
</script>



<div class="relative flex min-h-dvh w-full flex-col bg-gray-900">
  <!-- Top Navigation Bar -->
  <div class="absolute top-4 left-4 right-4 z-10 flex items-center justify-between">
    <!-- Risk Level Selector -->
    <div class="flex flex-col gap-1">
      <label class="text-xs font-medium text-slate-400">Risk Level</label>
      <div class="flex gap-1 rounded-full bg-slate-900 p-0.5">
        {#each riskLevels as { value, label, pins }}
          <button
            onclick={() => handleRiskChange(value)}
            disabled={isGameInProgress}
            class="rounded-full py-1 px-3 text-xs font-medium text-white transition hover:not-disabled:bg-slate-600 active:not-disabled:bg-slate-500 disabled:cursor-not-allowed disabled:opacity-50 {$riskLevel === value ? 'bg-slate-600' : ''} flex flex-col items-center"
          >
            <span>{label}</span>
            <span class="text-xs opacity-75">{pins}</span>
          </button>
        {/each}
      </div>
    </div>

    <!-- Game Mode Selector -->
    <div class="flex gap-1 rounded-full bg-slate-900 p-0.5">
      {#each gameTypes as { value, label }}
        <button
          onclick={() => handleGameChange(value)}
          class="flex-1 rounded-full py-1 px-4 text-sm font-medium text-white transition hover:bg-slate-600 active:bg-slate-500 {$page.url.pathname === value ? 'bg-slate-600' : ''}"
        >
          {label}
        </button>
      {/each}
    </div>
  </div>

  <div class="flex-1 px-5">
    <div class="mx-auto mt-5 max-w-xl min-w-[300px] drop-shadow-xl md:mt-10 lg:max-w-7xl">
      <div class="flex flex-col-reverse overflow-hidden rounded-lg lg:w-full lg:flex-row bg-gray-900">
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
    @apply bg-gray-900;
  }
</style> 