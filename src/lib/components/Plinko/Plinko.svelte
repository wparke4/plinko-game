<script lang="ts">
  import { plinkoEngine, betAmount, balance, currentMultiplier, totalProfitHistory, isMultiplierFlashing, gameState, winRecords } from '$lib/stores/game';
  import CircleNotch from 'phosphor-svelte/lib/CircleNotch';
  import type { Action } from 'svelte/action';
  import BinsRow from './BinsRow.svelte';
  import LastWins from './LastWins.svelte';
  import PlinkoEngine from './PlinkoEngine';

  const { WIDTH, HEIGHT } = PlinkoEngine;

  const initPlinko: Action<HTMLCanvasElement> = (node) => {
    $plinkoEngine = new PlinkoEngine(node);
    $plinkoEngine.start();

    return {
      destroy: () => {
        $plinkoEngine?.stop();
        
        // Reset multiplier-related stores when switching modes
        currentMultiplier.set(0);
        totalProfitHistory.set([0]);
        isMultiplierFlashing.set(false);
        winRecords.set([]);
        gameState.set({
          isGameInProgress: false,
          isGameDead: false,
          isCashOutCelebrating: false,
          isCashOutComplete: false
        });
      },
    };
  };

  let isBetAmountNegative = $derived($betAmount < 0);
  let isBetExceedBalance = $derived($betAmount > $balance);
  let isDropBallDisabled = $derived(
    $plinkoEngine === null || isBetAmountNegative || isBetExceedBalance
  );
  let isGameInProgress = $derived($plinkoEngine?.isGameInProgress() ?? false);

  function handleBetClick() {
    $plinkoEngine?.dropBall();
  }

  function handleResetClick() {
    $plinkoEngine?.resetGame();
  }
</script>

<div class="relative bg-black">
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
    <BinsRow />
    <div class="mt-4 flex justify-center pb-4">
      {#if !isGameInProgress}
        <button
          onclick={handleBetClick}
          disabled={isDropBallDisabled}
          class="touch-manipulation rounded-md bg-green-500 py-3 px-8 font-semibold text-slate-900 transition-colors hover:bg-green-400 active:bg-green-600 disabled:bg-neutral-600 disabled:text-neutral-400"
        >
          Drop Ball
        </button>
      {:else}
        <button
          onclick={handleResetClick}
          class="touch-manipulation rounded-md bg-red-500 py-3 px-8 font-semibold text-white transition-colors hover:bg-red-400 active:bg-red-600"
        >
          Reset Game
        </button>
      {/if}
    </div>
  </div>
  <div class="absolute top-1/2 right-[5%] -translate-y-1/2">
    <LastWins />
  </div>
</div>
