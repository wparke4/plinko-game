<!-- Plinko.svelte -->
<script lang="ts">
  import { plinkoEngine, betAmount, balance, currentMultiplier, gameState, totalProfitHistory, isMultiplierFlashing, winRecords } from '$lib/stores/game';
  import CircleNotch from 'phosphor-svelte/lib/CircleNotch';
  import type { Action } from 'svelte/action';
  import PlinkoEngine from './PlinkoEngine';
  import Multiplier from './Multiplier.svelte';
  import { browser } from '$app/environment';

  const { WIDTH } = PlinkoEngine;
  
  // Calculate canvas height synchronously so it's ready before engine creation
  function getCanvasHeight(): number {
    if (!browser) return 600;
    // 80% of viewport minus space for risk selector (48px)
    const gameAreaHeight = (window.innerHeight * 0.8) - 48;
    const gameAreaWidth = Math.min(window.innerWidth, WIDTH);
    return Math.round((gameAreaHeight / gameAreaWidth) * WIDTH);
  }
  
  const canvasHeight = getCanvasHeight();

  const initPlinko: Action<HTMLCanvasElement> = (node) => {
    $plinkoEngine = new PlinkoEngine(node, canvasHeight);
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

  function handleCashOutClick() {
    $plinkoEngine?.cashOut();
  }
</script>

<div class="game-container">
  <div class="canvas-area">
    {#if $plinkoEngine === null}
      <div class="loading-spinner">
        <CircleNotch class="size-12 sm:size-20 animate-spin text-slate-600" weight="bold" />
      </div>
    {/if}
    <canvas 
      use:initPlinko 
      width={WIDTH} 
      height={canvasHeight}
      class="canvas"
    >
    </canvas>
  </div>
  <div class="controls-section">

      <div class="multiplier-container">
        <Multiplier multiplier={$currentMultiplier} />
      </div>
      <div class="flex gap-2 sm:gap-4">
        {#if isBeforeGame}
          <!-- State 1: Before game - only show Drop Ball button -->
          <button
            onclick={handleBetClick}
            disabled={isDropBallDisabled}
            class="game-button touch-manipulation rounded-md bg-green-500 py-3 px-8 sm:py-2 sm:px-6 font-semibold text-slate-900 transition-colors hover:bg-green-400 active:bg-green-600 disabled:bg-neutral-600 disabled:text-neutral-400 flex flex-col items-center min-w-[140px] sm:min-w-0"
          >
            <span class="text-base sm:text-base">Drop Ball</span>
            <span class="keyboard-hint text-xs font-normal opacity-60 hidden sm:inline">(spacebar)</span>
          </button>
        {:else if isGameInProgress}
          <!-- State 2: Game in progress - show Cash Out button -->
          <button
            onclick={handleCashOutClick}
            class="game-button touch-manipulation rounded-md bg-red-500 py-3 px-8 sm:py-2 sm:px-6 font-semibold text-white transition-colors hover:bg-red-400 active:bg-red-600 flex flex-col items-center min-w-[140px] sm:min-w-0"
          >
            <span class="text-base sm:text-base">Cash Out</span>
            <span class="keyboard-hint text-xs font-normal opacity-60 hidden sm:inline">(spacebar)</span>
          </button>
        {:else if isGameEnded}
          <!-- State 3: Game ended - only show Reset Game button -->
          <button
            onclick={handleResetClick}
            class="game-button touch-manipulation rounded-md bg-gray-100 py-3 px-8 sm:py-2 sm:px-6 font-semibold text-black transition-colors hover:bg-gray-200 active:bg-gray-300 flex flex-col items-center min-w-[140px] sm:min-w-0"
          >
            <span class="text-base sm:text-base">Play Again</span>
            <span class="keyboard-hint text-xs font-normal opacity-60 hidden sm:inline">(spacebar)</span>
          </button>
        {/if}
      </div>
  </div>
</div>

<style>
  /* 80/20 split layout */
  .game-container {
    height: 100dvh;
    display: flex;
    flex-direction: column;
    background: black;
  }

  /* Top 80% for game canvas */
  .canvas-area {
    height: 80%;
    display: flex;
    justify-content: center;
    align-items: flex-start;
    position: relative;
    padding-top: 3rem; /* Space for risk selector overlay */
  }

  .canvas {
    max-width: 100%;
    max-height: 100%;
    /* Canvas will display at its natural aspect ratio */
  }

  .loading-spinner {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
  }

  /* Bottom 20% for UI */
  .controls-section {
    height: 20%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
  }

  /* Multiplier styles */
  :global(.multiplier) {
    font-size: clamp(1.5rem, 4vw, 2.5rem);
    font-weight: bold;
    color: rgba(255, 255, 255, 0.8);
    text-align: center;
  }

  :global(.multiplier.game-started) {
    color: rgba(255, 255, 255, 1);
  }

  .multiplier-container {
    display: flex;
    align-items: center;
    justify-content: center;
  }

  /* Button styles */
  .game-button {
    -webkit-tap-highlight-color: transparent;
    user-select: none;
    min-height: 44px;
  }

  /* Hide keyboard hints on touch devices */
  @media (hover: none) and (pointer: coarse) {
    .keyboard-hint {
      display: none !important;
    }
  }
</style>