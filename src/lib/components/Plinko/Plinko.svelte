<script lang="ts">
  import { plinkoEngine, riskLevel, currentMultiplier, totalProfitHistory, isMultiplierFlashing, gameState, winRecords } from '$lib/stores/game';
  import { RiskLevel } from '$lib/types';
  import CircleNotch from 'phosphor-svelte/lib/CircleNotch';
  import Gear from 'phosphor-svelte/lib/Gear';
  import X from 'phosphor-svelte/lib/X';
  import type { Action } from 'svelte/action';
  import BinsRow from './BinsRow.svelte';
  import LastWins from './LastWins.svelte';
  import PlinkoEngine from './PlinkoEngine';

  const { WIDTH, HEIGHT } = PlinkoEngine;

  // Set default risk level to HIGH
  riskLevel.set(RiskLevel.HIGH);

  // Wallet state
  let balance = $state(1000);
  let showSettings = $state(false);
  let settingsBalance = $state(1000);

  // Betting UI state
  let betAmount = $state(100);
  let numberOfBalls = $state(1);
  let isDropping = $state(false);
  
  // Track the last winRecords length to detect new wins
  let lastWinRecordsLength = 0;

  const riskOptions = [
    { value: RiskLevel.LOW, label: 'Low' },
    { value: RiskLevel.MEDIUM, label: 'Medium' },
    { value: RiskLevel.HIGH, label: 'High' },
  ];

  // Subscribe to winRecords to update balance when balls land
  winRecords.subscribe((records) => {
    if (records.length > lastWinRecordsLength) {
      // New win recorded - add the payout
      const newWin = records[records.length - 1];
      const winAmount = betAmount * newWin.payout.multiplier;
      balance += winAmount;
    }
    lastWinRecordsLength = records.length;
  });

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

  let isPlayDisabled = $derived($plinkoEngine === null || isDropping || balance < betAmount * numberOfBalls);

  async function handlePlayClick() {
    if (!$plinkoEngine || isDropping) return;
    
    // Ensure numberOfBalls is an integer (input fields can return strings)
    const ballCount = Math.max(1, Math.floor(Number(numberOfBalls)));
    const totalBet = betAmount * ballCount;
    
    // Check if player has enough balance
    if (balance < totalBet) return;
    
    // Deduct the bet amount
    balance -= totalBet;
    
    isDropping = true;
    
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

  function openSettings() {
    settingsBalance = balance;
    showSettings = true;
  }

  function closeSettings() {
    showSettings = false;
  }

  function saveSettings() {
    balance = Math.max(0, Number(settingsBalance));
    showSettings = false;
  }
</script>

<div class="flex flex-col h-screen bg-black">
  <!-- Header with Wallet -->
  <header class="flex items-center justify-center py-4 px-6 bg-neutral-900 shadow-lg shadow-black/30 relative z-10">
    <div class="flex items-center border border-green-800 rounded-lg overflow-hidden">
      <span class="text-sm font-medium text-neutral-400 uppercase tracking-wide px-4 py-2">Wallet</span>
      <span class="text-lg font-semibold text-white px-4 py-2 bg-neutral-800 border-l border-green-800">${balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
    </div>
    
    <!-- Settings Cog -->
    <button
      onclick={openSettings}
      class="absolute right-4 p-1 text-neutral-700 hover:text-neutral-500 transition-colors"
    >
      <Gear class="size-5" />
    </button>
  </header>

  <!-- Main content -->
  <div class="flex flex-1 min-h-0">
    <!-- Left sidebar: Betting UI (20%) -->
    <div class="w-1/5 flex flex-col bg-neutral-950 border-r border-neutral-800">
      <!-- Betting Controls -->
      <div class="flex flex-col gap-8 p-4 pt-[18vh]">
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
                ? 'bg-neutral-600 text-white border border-neutral-500' 
                : 'bg-neutral-800 border border-neutral-700 text-neutral-400 hover:bg-neutral-700 hover:text-white'}"
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
  </div>

  <!-- Right side: Game Area (75%) -->
  <div class="relative flex-1 bg-black">
    <div class="mx-auto flex h-full flex-col px-4 pt-[8vh]" style:max-width={`${WIDTH}px`}>
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
</div>

<!-- Settings Modal -->
{#if showSettings}
  <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onclick={closeSettings}>
    <div class="bg-neutral-900 rounded-lg p-6 w-80 border border-neutral-700" onclick={(e) => e.stopPropagation()}>
      <div class="flex justify-between items-center mb-4">
        <h2 class="text-lg font-semibold text-white">Settings</h2>
        <button onclick={closeSettings} class="text-neutral-500 hover:text-white transition-colors">
          <X class="size-5" />
        </button>
      </div>
      
      <div class="flex flex-col gap-2 mb-4">
        <label for="settings-balance" class="text-sm font-medium text-neutral-400 uppercase tracking-wide">
          Balance
        </label>
        <div class="relative">
          <span class="absolute left-4 top-1/2 -translate-y-1/2 text-lg font-medium text-neutral-500">$</span>
          <input
            id="settings-balance"
            type="number"
            bind:value={settingsBalance}
            min="0"
            step="100"
            class="w-full rounded-lg bg-neutral-800 border border-neutral-700 pl-8 pr-4 py-3 text-white text-lg font-medium focus:outline-none focus:border-neutral-500 focus:ring-1 focus:ring-neutral-500 transition-colors"
          />
        </div>
      </div>
      
      <button
        onclick={saveSettings}
        class="w-full rounded-lg bg-neutral-700 py-3 text-white font-medium hover:bg-neutral-600 transition-colors"
      >
        Save
      </button>
    </div>
  </div>
{/if}

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
