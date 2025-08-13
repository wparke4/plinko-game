<script lang="ts">
  import { BonusGame } from '$lib/components/BonusGame';
  import { bonusGameState } from '$lib/stores/game';
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';

  // Redirect to crash mode if bonus game is not active
  onMount(() => {
    if (!$bonusGameState.isActive) {
      goto('/crash');
    }
  });
</script>

<svelte:head>
  <title>Plinko - Bonus Game</title>
</svelte:head>

<div class="relative flex min-h-dvh w-full flex-col bg-black">
  <div class="flex-1 px-5">
    <div class="mx-auto mt-3 max-w-xl min-w-[300px] drop-shadow-xl md:mt-6 lg:max-w-7xl">
      <div class="flex flex-col-reverse overflow-hidden rounded-lg lg:w-full lg:flex-row bg-black">
        <div class="flex-1">
          <BonusGame />
        </div>
      </div>
    </div>
  </div>
</div>

<style lang="postcss">
  @reference "../../app.css";

  :global(body) {
    @apply bg-black;
  }
</style> 