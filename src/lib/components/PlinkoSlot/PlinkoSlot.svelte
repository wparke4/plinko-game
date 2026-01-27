<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import CircleNotch from 'phosphor-svelte/lib/CircleNotch';
  import Gear from 'phosphor-svelte/lib/Gear';
  import X from 'phosphor-svelte/lib/X';
  import Info from 'phosphor-svelte/lib/Info';
  import type { Action } from 'svelte/action';
  
  import PlinkoSlotEngine from './PlinkoSlotEngine';
  import ProvablyFairPanel from './ProvablyFairPanel.svelte';
  import paytable from './paytable.json';
  import type { PayoutResult, PaytableConfig } from './types';
  
  // Import symbol SVGs for the win display
  import orangeSvg from '$lib/assets/slot/orange.svg';
  import watermelonSvg from '$lib/assets/slot/watermelon.svg';
  import bearSvg from '$lib/assets/slot/bear.svg';
  import heartSvg from '$lib/assets/slot/heart.svg';
  import starSvg from '$lib/assets/slot/star.svg';
  import gemSvg from '$lib/assets/slot/gem.svg';
  import diamondSvg from '$lib/assets/slot/diamond.svg';
  
  const SYMBOL_SVGS: Record<number, string> = {
    1: orangeSvg,
    2: watermelonSvg,
    3: bearSvg,
    4: heartSvg,
    5: starSvg,
    6: gemSvg,
    7: diamondSvg,
  };
  
  const SYMBOL_NAMES: Record<number, string> = {
    1: 'Orange',
    2: 'Watermelon',
    3: 'Bear',
    4: 'Heart',
    5: 'Star',
    6: 'Gem',
    7: 'Diamond',
  };
  
  const config = paytable as PaytableConfig;
  const { WIDTH, HEIGHT } = PlinkoSlotEngine;

  // Engine instance
  let engine: PlinkoSlotEngine | null = $state(null);
  
  // Game state
  let balance = $state(10000);
  let betAmount = $state(100);
  let gamePhase = $state<'idle' | 'dropping' | 'evaluating' | 'complete'>('idle');
  let currentBall = $state(0);
  let exitedBalls = $state<number[]>([]);
  let payoutResult = $state<PayoutResult | null>(null);
  
  // Individual win entries for the payout display
  interface WinEntry {
    id: number;
    symbolLevel: number;
    count: number;
    multiplier: number;
    payout: number;
    isNew: boolean; // For spawn animation
  }
  let winEntries = $state<WinEntry[]>([]);
  let winEntryIdCounter = 0;
  
  // Provably fair state
  let fairState = $state({
    serverSeedHash: '',
    clientSeed: '',
    nonce: 0,
    revealedServerSeed: undefined as string | undefined
  });
  
  // UI state
  let showSettings = $state(false);
  let showFairModal = $state(false);
  let showInfoModal = $state(false);
  let settingsBalance = $state(10000);
  let isCelebrating = $state(false);
  let currentCelebration = $state<{ symbolLevel: number; count: number; multiplier: number } | null>(null);
  
  // Derived
  let isRunning = $derived(gamePhase === 'dropping' || gamePhase === 'evaluating');
  let canPlay = $derived(!isRunning && !isCelebrating && balance >= betAmount && betAmount > 0);
  
  // Initialize engine
  const initEngine: Action<HTMLCanvasElement> = (node) => {
    engine = new PlinkoSlotEngine(node, config);
    
    // Set up callbacks
    engine.setCallbacks({
      onPegHit: (pegId, newLevel, ballId) => {
        // Could trigger visual effects here
      },
      onBallDropped: (ballId, spawnX) => {
        currentBall = ballId;
      },
      onBallExited: (ballId) => {
        exitedBalls = [...exitedBalls, ballId];
      },
      onRunComplete: (result) => {
        payoutResult = result;
        
        // Calculate winnings
        const winnings = betAmount * result.totalMultiplier;
        balance += winnings;
      },
      onPhaseChange: (phase) => {
        gamePhase = phase;
      },
      onWinCelebration: (symbolLevel, count, multiplier) => {
        isCelebrating = true;
        currentCelebration = { symbolLevel, count, multiplier };
        
        // Add a new win entry to the payout display
        const payout = betAmount * multiplier;
        const newEntry: WinEntry = {
          id: ++winEntryIdCounter,
          symbolLevel,
          count,
          multiplier,
          payout,
          isNew: true,
        };
        
        // Add to the beginning (newest at top, but we'll reverse in display)
        winEntries = [newEntry, ...winEntries].slice(0, 5);
        
        // Remove the "new" flag after animation completes
        setTimeout(() => {
          winEntries = winEntries.map(e => 
            e.id === newEntry.id ? { ...e, isNew: false } : e
          );
        }, 600);
      },
      onAllCelebrationsComplete: () => {
        isCelebrating = false;
        currentCelebration = null;
      }
    });
    
    // Update fair state
    const state = engine.getFairState();
    fairState = {
      serverSeedHash: state.serverSeedHash,
      clientSeed: state.clientSeed,
      nonce: state.nonce,
      revealedServerSeed: undefined
    };
    
    engine.start();
    
    return {
      destroy: () => {
        engine?.stop();
        engine = null;
      }
    };
  };
  
  async function handlePlay() {
    if (!engine || !canPlay) return;
    
    // Reset state for new run
    currentBall = 0;
    exitedBalls = [];
    payoutResult = null;
    winEntries = []; // Reset win entries for new game
    
    // Deduct bet
    balance -= betAmount;
    
    // Update fair state
    const state = engine.getFairState();
    fairState = {
      ...fairState,
      serverSeedHash: state.serverSeedHash,
      nonce: state.nonce
    };
    
    // Start run
    await engine.startRun(betAmount);
  }
  
  function handleClientSeedChange(seed: string) {
    if (engine) {
      engine.setClientSeed(seed);
      fairState = { ...fairState, clientSeed: seed };
    }
  }
  
  function handleRotateSeed() {
    if (engine) {
      const result = engine.rotateServerSeed();
      fairState = {
        serverSeedHash: result.newHash,
        clientSeed: fairState.clientSeed,
        nonce: 0,
        revealedServerSeed: result.revealedSeed
      };
    }
  }
  
  function openSettings() {
    settingsBalance = balance;
    showSettings = true;
  }
  
  function saveSettings() {
    balance = Math.max(0, Number(settingsBalance));
    showSettings = false;
  }
</script>

<div class="flex flex-col h-screen bg-black">
  <!-- Header -->
  <header class="flex items-center justify-between py-4 px-6 bg-neutral-900 shadow-lg shadow-black/30 relative z-10">
    <div class="flex items-center gap-4">
      <h1 class="text-xl font-bold text-white">Plinko Slot</h1>
      <span class="px-2 py-1 bg-purple-600 rounded text-xs font-medium text-white">10-Ball Run</span>
    </div>
    
    <div class="flex items-center border border-green-800 rounded-lg overflow-hidden">
      <span class="text-sm font-medium text-neutral-400 uppercase tracking-wide px-4 py-2">Wallet</span>
      <span class="text-lg font-semibold text-white px-4 py-2 bg-neutral-800 border-l border-green-800">
        ${balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </span>
    </div>
    
    <div class="flex items-center gap-2">
      <button
        onclick={() => showInfoModal = true}
        class="p-2 text-neutral-500 hover:text-neutral-300 transition-colors"
        title="Game Info"
      >
        <Info class="w-5 h-5" />
      </button>
      <button
        onclick={openSettings}
        class="p-2 text-neutral-500 hover:text-neutral-300 transition-colors"
        title="Settings"
      >
        <Gear class="w-5 h-5" />
      </button>
    </div>
  </header>

  <!-- Main Content -->
  <div class="flex flex-1 min-h-0">
    <!-- Left Sidebar: Controls -->
    <div class="w-72 flex flex-col bg-neutral-950 border-r border-neutral-800 p-4 overflow-y-auto">
      <!-- Bet Amount -->
      <div class="mb-6">
        <label class="text-sm font-medium text-neutral-400 uppercase tracking-wide">Bet Amount</label>
        <div class="relative mt-2">
          <span class="absolute left-4 top-1/2 -translate-y-1/2 text-lg font-medium text-neutral-500">$</span>
          <input
            type="number"
            bind:value={betAmount}
            min="1"
            step="10"
            disabled={isRunning}
            class="w-full rounded-lg bg-neutral-800 border border-neutral-700 pl-8 pr-4 py-3 text-white text-lg font-medium focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500 disabled:opacity-50 transition-colors"
          />
        </div>
        <div class="flex gap-2 mt-2">
          {#each [10, 50, 100, 500] as preset}
            <button
              onclick={() => betAmount = preset}
              disabled={isRunning}
              class="flex-1 py-1 text-sm rounded bg-neutral-800 border border-neutral-700 text-neutral-400 hover:bg-neutral-700 hover:text-white disabled:opacity-50 transition-colors"
            >
              ${preset}
            </button>
          {/each}
        </div>
      </div>

      <!-- Play Button -->
      <button
        onclick={handlePlay}
        disabled={!canPlay}
        class="w-full rounded-lg bg-green-500 py-4 text-lg font-bold text-slate-900 transition-all hover:bg-green-400 active:bg-green-600 disabled:bg-neutral-700 disabled:text-neutral-500 disabled:cursor-not-allowed mb-6"
      >
        Play
      </button>

      <!-- Spacer to push wins to bottom -->
      <div class="flex-1"></div>

      <!-- Individual Wins Display (at bottom) -->
      <div class="min-h-[280px] flex flex-col justify-end gap-2">
        {#each [...winEntries].reverse() as entry (entry.id)}
          <div 
            class="win-entry flex items-center justify-between p-3 bg-neutral-900 border border-neutral-700 rounded-lg overflow-hidden
              {entry.isNew ? 'win-entry-new' : ''}"
          >
            <!-- Left side: count + symbol -->
            <div class="flex items-center gap-2">
              <span class="text-xl font-bold text-white">{entry.count}</span>
              <img 
                src={SYMBOL_SVGS[entry.symbolLevel]} 
                alt={SYMBOL_NAMES[entry.symbolLevel]}
                class="w-8 h-8 object-contain"
              />
            </div>
            
            <!-- Right side: payout amount -->
            <div class="text-lg font-bold text-green-400">
              ${entry.payout.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            
            <!-- Sparkle particles overlay -->
            {#if entry.isNew}
              <div class="sparkle-container">
                {#each Array(12) as _, i}
                  <div 
                    class="sparkle" 
                    style="--delay: {i * 50}ms; --x: {Math.random() * 100}%; --y: {Math.random() * 100}%;"
                  ></div>
                {/each}
              </div>
            {/if}
          </div>
        {/each}
      </div>
    </div>

    <!-- Center: Game Board -->
    <div class="flex-1 flex flex-col items-center justify-center bg-black p-4">
      <div class="relative" style:width="{WIDTH}px" style:height="{HEIGHT}px">
        {#if engine === null}
          <div class="absolute inset-0 flex items-center justify-center">
            <CircleNotch class="w-16 h-16 animate-spin text-neutral-600" weight="bold" />
          </div>
        {/if}
        <canvas
          use:initEngine
          width={WIDTH}
          height={HEIGHT}
          class="rounded-lg shadow-2xl"
        ></canvas>
      </div>
    </div>

  </div>
</div>

<!-- Settings Modal -->
{#if showSettings}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onclick={() => showSettings = false}>
    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
    <div class="bg-neutral-900 rounded-lg p-6 w-96 border border-neutral-700" onclick={(e) => e.stopPropagation()}>
      <div class="flex justify-between items-center mb-4">
        <h2 class="text-lg font-semibold text-white">Settings</h2>
        <button onclick={() => showSettings = false} class="text-neutral-500 hover:text-white transition-colors">
          <X class="w-5 h-5" />
        </button>
      </div>
      
      <div class="mb-4">
        <label class="text-sm font-medium text-neutral-400 uppercase tracking-wide">Balance</label>
        <div class="relative mt-2">
          <span class="absolute left-4 top-1/2 -translate-y-1/2 text-lg font-medium text-neutral-500">$</span>
          <input
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

<!-- Provably Fair Modal -->
{#if showFairModal}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onclick={() => showFairModal = false}>
    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
    <div class="bg-neutral-900 rounded-lg p-6 w-[500px] max-h-[80vh] overflow-y-auto border border-neutral-700" onclick={(e) => e.stopPropagation()}>
      <div class="flex justify-between items-center mb-4">
        <h2 class="text-lg font-semibold text-white">Provably Fair</h2>
        <button onclick={() => showFairModal = false} class="text-neutral-500 hover:text-white transition-colors">
          <X class="w-5 h-5" />
        </button>
      </div>
      
      <ProvablyFairPanel
        serverSeedHash={fairState.serverSeedHash}
        clientSeed={fairState.clientSeed}
        nonce={fairState.nonce}
        revealedServerSeed={fairState.revealedServerSeed}
        onClientSeedChange={handleClientSeedChange}
        onRotate={handleRotateSeed}
      />
    </div>
  </div>
{/if}

<!-- Info Modal -->
{#if showInfoModal}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onclick={() => showInfoModal = false}>
    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
    <div class="bg-neutral-900 rounded-lg p-6 w-[600px] max-h-[80vh] overflow-y-auto border border-neutral-700" onclick={(e) => e.stopPropagation()}>
      <div class="flex justify-between items-center mb-4">
        <h2 class="text-lg font-semibold text-white">How to Play Plinko Slot</h2>
        <button onclick={() => showInfoModal = false} class="text-neutral-500 hover:text-white transition-colors">
          <X class="w-5 h-5" />
        </button>
      </div>
      
      <div class="space-y-4 text-neutral-300 text-sm">
        <p>
          <strong class="text-white">Plinko Slot</strong> combines the excitement of Plinko with slot-machine style payouts based on a unique "peg leveling" mechanic.
        </p>
        
        <div>
          <h3 class="font-semibold text-white mb-1">Game Flow</h3>
          <ol class="list-decimal list-inside space-y-1 text-neutral-400">
            <li>Place your bet</li>
            <li>Click "Drop 10 Balls" to start</li>
            <li>Watch as 10 balls drop sequentially</li>
            <li>Pegs change color based on hits</li>
            <li>Final payout calculated from peg levels</li>
          </ol>
        </div>
        
        <div>
          <h3 class="font-semibold text-white mb-1">Peg Leveling</h3>
          <p class="text-neutral-400">
            Each peg can be hit by multiple balls, but only <strong>unique</strong> ball hits increase its level. If Ball #3 hits a peg twice, it only counts once. This creates a strategic distribution as balls cascade through the board.
          </p>
        </div>
        
        <div>
          <h3 class="font-semibold text-white mb-1">Payouts</h3>
          <p class="text-neutral-400">
            Payouts are based on how many pegs reach certain level thresholds. Higher levels and more matching pegs = bigger multipliers. Pattern bonuses (like diagonals or hot columns) add extra rewards.
          </p>
        </div>
        
        <div>
          <h3 class="font-semibold text-white mb-1">Provably Fair</h3>
          <p class="text-neutral-400">
            Every game uses cryptographic seeds that can be verified. The server seed hash is shown before you play, and you can verify it matches after revealing the actual seed.
          </p>
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  input[type="number"]::-webkit-inner-spin-button,
  input[type="number"]::-webkit-outer-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }
  input[type="number"] {
    -moz-appearance: textfield;
  }
  
  /* Win entry spawn animation */
  .win-entry {
    position: relative;
    transition: all 0.3s ease;
  }
  
  .win-entry-new {
    animation: winEntrySpawn 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
    background: linear-gradient(135deg, rgba(34, 197, 94, 0.2) 0%, rgba(23, 23, 23, 1) 50%);
    border-color: rgb(34, 197, 94);
    box-shadow: 0 0 20px rgba(34, 197, 94, 0.4), inset 0 0 20px rgba(34, 197, 94, 0.1);
  }
  
  @keyframes winEntrySpawn {
    0% {
      opacity: 0;
      transform: scale(0.5) translateY(20px);
    }
    50% {
      transform: scale(1.05) translateY(-5px);
    }
    100% {
      opacity: 1;
      transform: scale(1) translateY(0);
    }
  }
  
  /* Sparkle particles */
  .sparkle-container {
    position: absolute;
    inset: 0;
    pointer-events: none;
    overflow: hidden;
  }
  
  .sparkle {
    position: absolute;
    left: var(--x);
    top: var(--y);
    width: 6px;
    height: 6px;
    background: white;
    border-radius: 50%;
    animation: sparkleAnim 0.8s ease-out var(--delay) forwards;
    opacity: 0;
    box-shadow: 0 0 6px 2px rgba(255, 215, 0, 0.8), 0 0 12px 4px rgba(255, 215, 0, 0.4);
  }
  
  .sparkle::before {
    content: '';
    position: absolute;
    top: 50%;
    left: 50%;
    width: 12px;
    height: 2px;
    background: linear-gradient(90deg, transparent, white, transparent);
    transform: translate(-50%, -50%);
  }
  
  .sparkle::after {
    content: '';
    position: absolute;
    top: 50%;
    left: 50%;
    width: 2px;
    height: 12px;
    background: linear-gradient(180deg, transparent, white, transparent);
    transform: translate(-50%, -50%);
  }
  
  @keyframes sparkleAnim {
    0% {
      opacity: 0;
      transform: scale(0) rotate(0deg);
    }
    20% {
      opacity: 1;
      transform: scale(1.5) rotate(45deg);
    }
    100% {
      opacity: 0;
      transform: scale(0.5) rotate(180deg) translateY(-30px);
    }
  }
</style>
