<script lang="ts">
  import {
    plinkoSwapEngine,
    riskLevel,
    totalProfitHistory,
    winRecords,
    adjustedMultipliers,
    bucketOrder,
    betAmount as betAmountStore,
    betAmountOfExistingBalls,
    zeroedBins,
    rowCount,
  } from '$lib/stores/plinkoSwap';
  import { RiskLevel } from '$lib/types';
  import { buildIdentityBucketOrder, computeBucketOrder } from '$lib/utils/bucketSwap';
  import CircleNotch from 'phosphor-svelte/lib/CircleNotch';
  import Gear from 'phosphor-svelte/lib/Gear';
  import X from 'phosphor-svelte/lib/X';
  import type { Action } from 'svelte/action';
  import BinsRow from './BinsRow.svelte';
  import LastWins from './LastWins.svelte';
  import PlinkoEngine from './PlinkoEngine';
  import type BinsRowComponent from './BinsRow.svelte';

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
  let isDropping = $derived(Object.keys($betAmountOfExistingBalls).length > 0);

  let binsRowRef: BinsRowComponent | null = $state(null);

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
    $plinkoSwapEngine = new PlinkoEngine(node);
    $plinkoSwapEngine.start();

    return {
      destroy: () => {
        $plinkoSwapEngine?.stop();

        totalProfitHistory.set([0]);
        winRecords.set([]);
        zeroedBins.set(new Set());
        bucketOrder.set(buildIdentityBucketOrder($rowCount + 1));
      },
    };
  };

  let isPlayDisabled = $derived(
    $plinkoSwapEngine === null || isDropping || balance < betAmount * numberOfBalls,
  );

  async function handlePlayClick() {
    if (!$plinkoSwapEngine || isDropping) return;

    // Ensure numberOfBalls is an integer (input fields can return strings)
    const ballCount = Math.max(1, Math.floor(Number(numberOfBalls)));
    const totalBet = betAmount * ballCount;

    // Check if player has enough balance
    if (balance < totalBet) return;

    // Deduct the bet amount
    balance -= totalBet;

    // Sync bet amount for the engine payout records
    betAmountStore.set(betAmount);

    const nextOrder = computeBucketOrder($adjustedMultipliers);
    const previousOrder = [...$bucketOrder];
    const previousPositions = new Map<number, number>(
      previousOrder.map((bucketIndex, position) => [bucketIndex, position]),
    );
    const byPosition = nextOrder.map((bucketIndex, position) => ({
      position,
      bucketIndex,
      multiplier: $adjustedMultipliers[bucketIndex],
      fromPosition: previousPositions.get(bucketIndex),
    }));

    console.log('[PlinkoSwap] Bucket swap plan', {
      fromOrder: previousOrder,
      toOrder: nextOrder,
      byPosition,
    });

    if (binsRowRef) {
      void binsRowRef.animateSwap(nextOrder);
    } else {
      bucketOrder.set(nextOrder);
    }

    // Drop the specified number of balls with a delay between each
    for (let i = 0; i < ballCount; i++) {
      $plinkoSwapEngine.dropBall();

      // Add delay between balls (except after the last one)
      if (i < ballCount - 1) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
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

<div class="flex h-screen bg-[#00212F]">
  <!-- Left sidebar: Betting UI (20%) -->
  <div class="w-1/5 flex flex-col bg-neutral-950 border-r border-neutral-800">
    <!-- Betting Controls -->
    <div class="flex flex-col gap-8 p-4 pt-[18vh]">
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

  <!-- Right side: Game Area -->
  <div class="relative flex-1 flex flex-col bg-[#00212F]">
    <!-- Header bar with Bet Amount and Balance - centered above game board -->
    <div class="flex items-center justify-center gap-10 py-4 px-6 bg-[#213845]">
      <!-- Bet Amount Container -->
      <div class="flex flex-col gap-0.5">
        <label class="text-sm font-medium text-[#9BB3C3] tracking-tight">
          Bet Amount
        </label>
        <div class="flex items-center justify-between bg-[#06222C] border-2 border-[#263F49] rounded pl-3 pr-1.5 py-1.5 w-40">
          <div class="relative flex-1">
            <span class="text-white text-base font-semibold tabular-nums pointer-events-none">{betAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            <input
              type="number"
              bind:value={betAmount}
              min="0"
              step="0.01"
              class="absolute inset-0 w-full bg-transparent text-transparent caret-white focus:outline-none tabular-nums"
            />
          </div>
          <svg class="w-5 h-5 flex-shrink-0 ml-1" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M9.651 19.302C14.972 19.302 19.302 14.972 19.302 9.651C19.302 4.33 14.973 0 9.651 0C4.329 0 0 4.329 0 9.651C0 14.972 4.329 19.302 9.651 19.302ZM8.574 10.191C6.953 10.191 5.634 8.872 5.634 7.251C5.634 5.63 6.953 4.311 8.574 4.311H9.112V3.305C9.112 3.007 9.354 2.765 9.652 2.765C9.951 2.765 10.192 3.007 10.192 3.305V4.311H10.729C12.35 4.311 13.669 5.63 13.669 7.251C13.669 7.549 13.427 7.791 13.129 7.791C12.831 7.791 12.589 7.549 12.589 7.251C12.589 6.225 11.755 5.391 10.729 5.391H10.192V9.111H10.729C12.35 9.111 13.669 10.43 13.669 12.051C13.669 13.672 12.35 14.991 10.729 14.991H10.192V15.997C10.192 16.295 9.95 16.537 9.652 16.537C9.354 16.537 9.112 16.295 9.112 15.997V14.991H8.574C6.953 14.991 5.634 13.672 5.634 12.051C5.634 11.753 5.876 11.511 6.174 11.511C6.473 11.511 6.714 11.753 6.714 12.051C6.714 13.077 7.548 13.911 8.574 13.911H9.112V10.191H8.574Z" fill="#70E848"/>
            <path d="M12.589 12.051C12.589 11.025 11.755 10.191 10.729 10.191H10.192V13.911H10.729C11.755 13.911 12.589 13.077 12.589 12.051Z" fill="#70E848"/>
            <path d="M9.11101 5.39099H8.57301C7.54701 5.39099 6.71301 6.22499 6.71301 7.25099C6.71301 8.27699 7.54701 9.11099 8.57301 9.11099H9.11101V5.39099Z" fill="#70E848"/>
          </svg>
        </div>
      </div>

      <!-- Balance Container -->
      <div class="flex flex-col gap-0.5">
        <label class="text-sm font-medium text-[#9BB3C3] tracking-tight">
          Balance
        </label>
        <div class="flex items-center justify-between bg-[#06222C] border-2 border-[#263F49] rounded pl-3 pr-1.5 py-1.5 w-42">
          <span class="text-white text-base font-semibold tabular-nums">${balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          <svg class="w-5 h-5 flex-shrink-0 ml-1" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M9.651 19.302C14.972 19.302 19.302 14.972 19.302 9.651C19.302 4.33 14.973 0 9.651 0C4.329 0 0 4.329 0 9.651C0 14.972 4.329 19.302 9.651 19.302ZM8.574 10.191C6.953 10.191 5.634 8.872 5.634 7.251C5.634 5.63 6.953 4.311 8.574 4.311H9.112V3.305C9.112 3.007 9.354 2.765 9.652 2.765C9.951 2.765 10.192 3.007 10.192 3.305V4.311H10.729C12.35 4.311 13.669 5.63 13.669 7.251C13.669 7.549 13.427 7.791 13.129 7.791C12.831 7.791 12.589 7.549 12.589 7.251C12.589 6.225 11.755 5.391 10.729 5.391H10.192V9.111H10.729C12.35 9.111 13.669 10.43 13.669 12.051C13.669 13.672 12.35 14.991 10.729 14.991H10.192V15.997C10.192 16.295 9.95 16.537 9.652 16.537C9.354 16.537 9.112 16.295 9.112 15.997V14.991H8.574C6.953 14.991 5.634 13.672 5.634 12.051C5.634 11.753 5.876 11.511 6.174 11.511C6.473 11.511 6.714 11.753 6.714 12.051C6.714 13.077 7.548 13.911 8.574 13.911H9.112V10.191H8.574Z" fill="#70E848"/>
            <path d="M12.589 12.051C12.589 11.025 11.755 10.191 10.729 10.191H10.192V13.911H10.729C11.755 13.911 12.589 13.077 12.589 12.051Z" fill="#70E848"/>
            <path d="M9.11101 5.39099H8.57301C7.54701 5.39099 6.71301 6.22499 6.71301 7.25099C6.71301 8.27699 7.54701 9.11099 8.57301 9.11099H9.11101V5.39099Z" fill="#70E848"/>
          </svg>
        </div>
      </div>

      <!-- Settings Cog -->
      <button
        onclick={openSettings}
        class="absolute right-4 p-1 text-neutral-700 hover:text-neutral-500 transition-colors"
      >
        <Gear class="size-5" />
      </button>
    </div>

    <!-- Game board area -->
    <div class="flex-1 relative">
      <div class="mx-auto flex h-full flex-col px-4 pt-4" style:max-width={`${WIDTH}px`}>
        <div class="relative w-full" style:aspect-ratio={`${WIDTH} / ${HEIGHT}`}>
          {#if $plinkoSwapEngine === null}
            <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
              <CircleNotch class="size-20 animate-spin text-slate-600" weight="bold" />
            </div>
          {/if}

          <canvas use:initPlinko width={WIDTH} height={HEIGHT} class="absolute inset-0 h-full w-full">
          </canvas>
        </div>
        <BinsRow bind:this={binsRowRef} />
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
