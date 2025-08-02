<script lang="ts">
  import LiveStatsWindow from '$lib/components/LiveStatsWindow/LiveStatsWindow.svelte';
  import PlinkoSheep from '$lib/components/PlinkoSheep';
  import SettingsWindow from '$lib/components/SettingsWindow';
  import { setBalanceFromLocalStorage, writeBalanceToLocalStorage } from '$lib/utils/game';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';

  $effect(() => {
    setBalanceFromLocalStorage();
  });

  const gameTypes = [
    { value: '/', label: 'Classic Plinko' },
    { value: '/crash', label: 'Sheep' },
    { value: '/sheep', label: 'Crash' }
  ];

  function handleGameChange(path: string) {
    goto(path);
  }
</script>

<svelte:window onbeforeunload={writeBalanceToLocalStorage} />

<div class="relative flex min-h-dvh w-full flex-col bg-gray-900">
  <div class="absolute top-4 right-4 z-10">
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