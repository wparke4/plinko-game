<script lang="ts">
  import { plinkoEngine, riskLevel, currentMultiplier, totalProfitHistory, isMultiplierFlashing, gameState, winRecords } from '$lib/stores/game';
  import { RiskLevel } from '$lib/types';
  import CircleNotch from 'phosphor-svelte/lib/CircleNotch';
  import type { Action } from 'svelte/action';
  import BinsRow from './BinsRow.svelte';
  import LastWins from './LastWins.svelte';
  import PlinkoEngine from './PlinkoEngine';

  const { WIDTH, HEIGHT } = PlinkoEngine;

  // Set default risk level to HIGH
  riskLevel.set(RiskLevel.HIGH);

  // Betting UI state
  let betAmount = $state(100);
  let numberOfBalls = $state(1);
  let isDropping = $state(false);

  const riskOptions = [
    { value: RiskLevel.LOW, label: 'Low' },
    { value: RiskLevel.MEDIUM, label: 'Medium' },
    { value: RiskLevel.HIGH, label: 'High' },
  ];

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

  let isPlayDisabled = $derived($plinkoEngine === null || isDropping);

  async function handlePlayClick() {
    if (!$plinkoEngine || isDropping) return;
    
    isDropping = true;
    
    // Ensure numberOfBalls is an integer (input fields can return strings)
    const ballCount = Math.max(1, Math.floor(Number(numberOfBalls)));
    
    // Drop the specified number of balls with a delay between each
    for (let i = 0; i < ballCount; i++) {
      $plinkoEngine.dropBall();
      
      // Add delay between balls (except after the last one)
      if (i < ballCount - 1) {
        await new Promise(resolve => setTimeout(resolve, 30));
      }
    }
    
    isDropping = false;
  }

  function incrementBalls() {
    numberOfBalls = Math.min(numberOfBalls + 1, 100);
  }

  function decrementBalls() {
    numberOfBalls = Math.max(numberOfBalls - 1, 1);
  }
</script>

<div class="flex h-screen bg-black">
  <!-- Left sidebar: Betting UI (20%) -->
  <div class="w-1/5 flex flex-col gap-8 p-4 pt-[20vh] bg-neutral-900 border-r border-neutral-800">
    <!-- Amount Section -->
    <div class="flex flex-col gap-2">
      <label for="bet-amount" class="text-sm font-medium text-neutral-400 uppercase tracking-wide">
        Amount
      </label>
      <div class="relative">
        <span class="absolute left-4 top-1/2 -translate-y-1/2 text-lg font-medium text-neutral-500">$</span>
        <input
          id="bet-amount"
          type="number"
          bind:value={betAmount}
          min="0"
          step="10"
          class="w-full rounded-lg bg-neutral-800 border border-neutral-700 pl-8 pr-4 py-3 text-white text-lg font-medium focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500 transition-colors"
        />
      </div>
    </div>

    <!-- Risk Section -->
    <div class="flex flex-col gap-2">
      <label class="text-sm font-medium text-neutral-400 uppercase tracking-wide">
        Risk
      </label>
      <div class="flex gap-2">
        {#each riskOptions as option}
          <button
            onclick={() => riskLevel.set(option.value)}
            class="flex-1 py-2 rounded-lg font-medium transition-colors {$riskLevel === option.value 
              ? 'bg-green-500 text-slate-900' 
              : 'bg-neutral-800 border border-neutral-700 text-white hover:bg-neutral-700'}"
          >
            {option.label}
          </button>
        {/each}
      </div>
    </div>

    <!-- Number of Balls Section -->
    <div class="flex flex-col gap-2">
      <label for="num-balls" class="text-sm font-medium text-neutral-400 uppercase tracking-wide">
        Number of Balls
      </label>
      <div class="flex items-center gap-2">
        <button
          onclick={decrementBalls}
          disabled={numberOfBalls <= 1}
          class="flex-shrink-0 w-12 h-12 rounded-lg bg-neutral-800 border border-neutral-700 text-white text-xl font-bold hover:bg-neutral-700 active:bg-neutral-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          −
        </button>
        <input
          id="num-balls"
          type="number"
          bind:value={numberOfBalls}
          min="1"
          max="100"
          class="w-full rounded-lg bg-neutral-800 border border-neutral-700 px-4 py-3 text-white text-lg font-medium text-center focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500 transition-colors"
        />
        <button
          onclick={incrementBalls}
          disabled={numberOfBalls >= 100}
          class="flex-shrink-0 w-12 h-12 rounded-lg bg-neutral-800 border border-neutral-700 text-white text-xl font-bold hover:bg-neutral-700 active:bg-neutral-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          +
        </button>
      </div>
    </div>

    <!-- Play Button -->
    <button
      onclick={handlePlayClick}
      disabled={isPlayDisabled}
      class="w-full rounded-lg bg-green-500 py-4 text-lg font-bold text-slate-900 transition-colors hover:bg-green-400 active:bg-green-600 disabled:bg-neutral-700 disabled:text-neutral-500 disabled:cursor-not-allowed mt-2"
    >
      {isDropping ? 'Dropping...' : 'Play'}
    </button>
  </div>

  <!-- Right side: Game Area (75%) -->
  <div class="relative flex-1 bg-black">
    <div class="mx-auto flex h-full flex-col px-4 pt-[11vh]" style:max-width={`${WIDTH}px`}>
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
    </div>

    <!-- Right-side history showing last 5 games -->
    <div class="absolute right-4 top-1/2 -translate-y-1/2">
      <LastWins winCount={5} />
    </div>
  </div>
</div>

<style>
  /* Hide native number input spinners */
  input[type="number"]::-webkit-inner-spin-button,
  input[type="number"]::-webkit-outer-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }
  input[type="number"] {
    -moz-appearance: textfield;
  }
</style>
