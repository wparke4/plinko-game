<!-- Plinko.svelte -->
<script lang="ts">
  import { plinkoEngine, betAmount, balance, currentMultiplier, gameState, totalProfitHistory, isMultiplierFlashing, winRecords } from '$lib/stores/game';
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
  // Use reactive game state store instead of calling engine methods
  let isGameInProgress = $derived($gameState.isGameInProgress);
  let isGameDead = $derived($gameState.isGameDead);
  let isCashOutCelebrating = $derived($gameState.isCashOutCelebrating);
  let isCashOutComplete = $derived($gameState.isCashOutComplete);

  // Game state logic
  let isBeforeGame = $derived(!isGameInProgress && !isGameDead && !isCashOutCelebrating && !isCashOutComplete);
  let isGameEnded = $derived(isGameDead || isCashOutCelebrating || isCashOutComplete);

  function handleBetClick() {
    $plinkoEngine?.dropBall();
  }

  function handleResetClick() {
    $plinkoEngine?.resetGame();
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
    <div class="mt-4 flex flex-col items-center gap-4 pb-4">
      <div class="multiplier-container">
        <Multiplier multiplier={$currentMultiplier} />
      </div>
      <div class="flex gap-4">
        {#if isBeforeGame}
          <!-- State 1: Before game - only show Drop Ball button -->
          <button
            onclick={handleBetClick}
            disabled={isDropBallDisabled}
            class="touch-manipulation rounded-md bg-green-500 py-2 px-6 font-semibold text-slate-900 transition-colors hover:bg-green-400 active:bg-green-600 disabled:bg-neutral-600 disabled:text-neutral-400 flex flex-col"
          >
            <span>Drop Ball</span>
            <span class="text-sm font-normal">(spacebar)</span>
          </button>
        {:else if isGameInProgress}
          <!-- State 2: Game in progress - no buttons visible -->
        {:else if isGameEnded}
          <!-- State 3: Game ended - only show Reset Game button -->
          <button
            onclick={handleResetClick}
            class="touch-manipulation rounded-md bg-gray-100 py-2 px-6 font-semibold text-black transition-colors hover:bg-gray-200 active:bg-gray-300 flex flex-col"
          >
            <span>Play Again</span>
            <span class="text-sm font-normal">(spacebar)</span>
          </button>
        {/if}
      </div>
    </div>
  </div>
  <div class="absolute top-1/2 right-[5%] -translate-y-1/2">
    <LastWins />
  </div>
</div>

<style>
  :global(.multiplier) {
    font-size: min(3rem, 6vh);
    font-weight: bold;
    color: rgba(255, 255, 255, 0.8); /* Off-white for 0.00x */
    text-align: center;
    transition: color 0.2s ease;
  }

  :global(.multiplier.game-started) {
    color: rgba(255, 255, 255, 1); /* Pure white when game starts */
  }

  :global(.multiplier.game-dead) {
    color: rgba(255, 0, 0, 1); /* Bright red when game is dead */
  }

  .multiplier-container {
    min-height: 3rem;
    display: flex;
    align-items: center;
    justify-content: center;
  }
</style>