<script lang="ts">
  import LiveStatsWindow from '$lib/components/LiveStatsWindow/LiveStatsWindow.svelte';
  import PlinkoCrash from '$lib/components/PlinkoCrash';
  import SettingsWindow from '$lib/components/SettingsWindow';
  import AudioControls from '$lib/components/ui/AudioControls.svelte';
  import { Select, BonusGameTransition } from '$lib/components/ui';
  import { plinkoEngine } from '$lib/stores/game';

  // Refresh rate options for dropdown
  const refreshRateOptions = [
    { value: 60, label: '60 FPS' },
    { value: 75, label: '75 FPS' },
    { value: 90, label: '90 FPS' },
    { value: 105, label: '105 FPS' },
    { value: 120, label: '120 FPS' },
    { value: 150, label: '150 FPS' }
  ];
  let currentRefreshRate = $state(90);

  // Update engine when refresh rate changes
  $effect(() => {
    if ($plinkoEngine && currentRefreshRate) {
      $plinkoEngine.setRefreshRate(currentRefreshRate);
    }
  });

  // Update current refresh rate when engine changes
  $effect(() => {
    if ($plinkoEngine) {
      currentRefreshRate = $plinkoEngine.getCurrentRefreshRate();
    }
  });
</script>



<div class="relative flex min-h-dvh w-full flex-col bg-black">
  <!-- Top Right Physics Rate Dropdown (below audio controls) -->
  <div class="fixed top-20 right-5 z-[999] w-32">
    <Select 
      bind:value={currentRefreshRate}
      items={refreshRateOptions}
      title="Physics update rate"
    />
  </div>

  <div class="flex-1 px-5">
    <div class="mx-auto mt-3 max-w-xl min-w-[300px] drop-shadow-xl md:mt-6 lg:max-w-7xl">
      <div class="flex flex-col-reverse overflow-hidden rounded-lg lg:w-full lg:flex-row bg-black">
        <div class="flex-1">
          <PlinkoCrash />
        </div>
      </div>
    </div>
  </div>

  <SettingsWindow />
  <LiveStatsWindow />
  <AudioControls plinkoEngine={$plinkoEngine} />
  <BonusGameTransition />
</div>

<style lang="postcss">
  @reference "../../app.css";

  :global(body) {
    @apply bg-black;
  }
</style> 