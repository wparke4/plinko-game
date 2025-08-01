<!-- Plinko.svelte -->
<script lang="ts">
  import { plinkoEngine, betAmount, balance } from '$lib/stores/game';
  import CircleNotch from 'phosphor-svelte/lib/CircleNotch';
  import type { Action } from 'svelte/action';
  import LastWins from './LastWins.svelte';
  import PlinkoEngine from './PlinkoEngine';
  import Multiplier from './Multiplier.svelte';

  const { WIDTH, HEIGHT } = PlinkoEngine;

  const initPlinko: Action<HTMLCanvasElement> = (node) => {
    $plinkoEngine = new PlinkoEngine(node);
    $plinkoEngine.start();

    return {
      destroy: () => {
        $plinkoEngine?.stop();
      },
    };
  };

  let isBetAmountNegative = $derived($betAmount < 0);
  let isBetExceedBalance = $derived($betAmount > $balance);
  let isDropBallDisabled = $derived(
    $plinkoEngine === null || isBetAmountNegative || isBetExceedBalance
  );
  let isGameInProgress = $derived($plinkoEngine?.isGameInProgress() ?? false);
  let currentMultiplier = $derived($plinkoEngine?.getCurrentMultiplier() ?? 0);

  function handleBetClick() {
    $plinkoEngine?.dropBall();
  }
</script>

<div class="relative bg-gray-900">
  <div class="mx-auto flex h-full flex-col px-4" style:max-width={`${WIDTH}px`}>
    <div class="relative w-full" style:aspect-ratio={`${WIDTH} / ${HEIGHT}`}>
      {#if $plinkoEngine === null}
        <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
          <CircleNotch class="size-20 animate-spin text-slate-600" weight="bold" />
        </div>
      {/if}

      <canvas use:initPlinko width={WIDTH} height={HEIGHT} class="absolute inset-0 h-full w-full">
      </canvas>
    </div>
    <div class="mt-4 flex justify-center pb-4">
      {#if isGameInProgress}
        <div class="multiplier-container">
          <Multiplier multiplier={currentMultiplier} />
        </div>
      {:else}
        <button
          onclick={handleBetClick}
          disabled={isDropBallDisabled}
          class="touch-manipulation rounded-md bg-green-500 py-3 px-8 font-semibold text-slate-900 transition-colors hover:bg-green-400 active:bg-green-600 disabled:bg-neutral-600 disabled:text-neutral-400"
        >
          Drop Ball
        </button>
      {/if}
    </div>
  </div>
  <div class="absolute top-1/2 right-[5%] -translate-y-1/2">
    <LastWins />
  </div>
</div>

<style>
  :global(.multiplier) {
    font-size: min(4rem, 8vh);
    font-weight: bold;
    color: rgba(255, 255, 255, 0.8);
    text-align: center;
  }

  .multiplier-container {
    min-height: 48px; /* Match button height */
    display: flex;
    align-items: center;
    justify-content: center;
  }
</style>