<script lang="ts">
  import { onDestroy } from 'svelte';
  import CircleNotch from 'phosphor-svelte/lib/CircleNotch';
  import Gear from 'phosphor-svelte/lib/Gear';
  import X from 'phosphor-svelte/lib/X';
  import Info from 'phosphor-svelte/lib/Info';
  import type { Action } from 'svelte/action';
  
  import PlinkoSlotEngine from './PlinkoSlotEngine';
  import ProvablyFairPanel from './ProvablyFairPanel.svelte';
  import paytable from './paytable.json';
  import type { PayoutResult, PaytableConfig, ProgressiveWaveWin } from './types';
  
  // Import symbol SVGs for the win display
  import orangeSvg from '$lib/assets/slot/orange.svg';
  import watermelonSvg from '$lib/assets/slot/watermelon.svg';
  import bearSvg from '$lib/assets/slot/bear.svg';
  import heartSvg from '$lib/assets/slot/heart.svg';
  import starSvg from '$lib/assets/slot/star.svg';
  import gemSvg from '$lib/assets/slot/gem.svg';
  import diamondSvg from '$lib/assets/slot/diamond.svg';
  import strawberrySvg from '$lib/assets/slot/strawberry.svg';
  import moneySvg from '$lib/assets/slot/money.svg';
  import sunSvg from '$lib/assets/slot/sun.svg';
  import faceSvg from '$lib/assets/slot/face.svg';
  import ghostSvg from '$lib/assets/slot/ghost.svg';
  import laughSvg from '$lib/assets/slot/laugh.svg';
  import bonusSvg from '$lib/assets/slot/bonus.svg';
  
  const SYMBOL_SVGS: Record<number, string> = {
    1: orangeSvg,
    2: watermelonSvg,
    3: bearSvg,
    4: heartSvg,
    5: starSvg,
    6: gemSvg,
    7: strawberrySvg,
    8: moneySvg,
    9: sunSvg,
    10: diamondSvg,
    11: faceSvg,
    12: ghostSvg,
    13: laughSvg,
    99: bonusSvg, // Bonus symbol
  };
  
  const SYMBOL_NAMES: Record<number, string> = {
    1: 'Orange',
    2: 'Watermelon',
    3: 'Bear',
    4: 'Heart',
    5: 'Star',
    6: 'Gem',
    7: 'Strawberry',
    8: 'Money',
    9: 'Sun',
    10: 'Diamond',
    11: 'Face',
    12: 'Ghost',
    13: 'Laugh',
    99: 'Bonus',
    [-1]: 'All Pegs', // Special all pegs bonus
  };
  
  // Special symbol IDs
  const ALL_PEGS_SYMBOL_ID = -1;
  const BONUS_SYMBOL_ID = 99;
  
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
    isExiting: boolean; // For exit animation
  }
  let winEntries = $state<WinEntry[]>([]);
  let winEntryIdCounter = 0;
  const MAX_WIN_ENTRIES = 5;
  let pendingWinnings = $state(0); // Track total winnings from symbol wins
  
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
  
  // Total win display state
  let showTotalWin = $state(false);
  let totalWinAmount = $state(0);
  let displayedWinAmount = $state(0);
  let totalWinExiting = $state(false);
  let totalWinHideTimeout: ReturnType<typeof setTimeout> | null = null;
  let incrementAnimationFrame: number | null = null;
  
  // Free spins / bonus game state
  let isInFreeSpins = $state(false);
  let freeSpinsRemaining = $state(0);
  let freeSpinsTotalWinnings = $state(0);
  let showBonusTransition = $state(false);
  let bonusTransitionPhase = $state<'entering' | 'visible' | 'exiting'>('entering');
  let showFreeSpinsComplete = $state(false);
  let freeSpinsCompleteDisplayAmount = $state(0);
  let freeSpinsCompletePhase = $state<'incrementing' | 'holding' | 'exiting'>('incrementing');
  
  // Progressive mode state
  let progressiveMode = $state(false);
  let isInProgressiveSequence = $state(false);
  let progressiveWaveNumber = $state(0);
  let progressiveTotalWinnings = $state(0);
  let progressiveWaveWins = $state<ProgressiveWaveWin[]>([]);
  
  // Derived
  let isRunning = $derived(gamePhase === 'dropping' || gamePhase === 'evaluating');
  let canPlay = $derived(!isRunning && !isCelebrating && !isInFreeSpins && !isInProgressiveSequence && !showBonusTransition && !showFreeSpinsComplete && balance >= betAmount && betAmount > 0);
  
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
        // Balance will be updated via onWinCelebration and onAllCelebrationsComplete
      },
      onPhaseChange: (phase) => {
        gamePhase = phase;
      },
      onWinCelebration: (symbolLevel, count, multiplier) => {
        isCelebrating = true;
        currentCelebration = { symbolLevel, count, multiplier };
        
        // Add a new win entry to the payout display
        const payout = betAmount * multiplier;
        
        // Track winnings to add to balance
        pendingWinnings += payout;
        const newEntry: WinEntry = {
          id: ++winEntryIdCounter,
          symbolLevel,
          count,
          multiplier,
          payout,
          isNew: true,
          isExiting: false,
        };
        
        // Check if we need to remove the oldest entry (at the end of array)
        const nonExitingEntries = winEntries.filter(e => !e.isExiting);
        if (nonExitingEntries.length >= MAX_WIN_ENTRIES) {
          // Mark the oldest entry as exiting
          const oldestId = nonExitingEntries[nonExitingEntries.length - 1].id;
          winEntries = winEntries.map(e => 
            e.id === oldestId ? { ...e, isExiting: true } : e
          );
          
          // Remove the exiting entry after animation completes
          setTimeout(() => {
            winEntries = winEntries.filter(e => e.id !== oldestId);
          }, 400);
        }
        
        // Add new entry at the beginning (newest at top)
        winEntries = [newEntry, ...winEntries];
        
        // Remove the "new" flag after animation completes
        setTimeout(() => {
          winEntries = winEntries.map(e => 
            e.id === newEntry.id ? { ...e, isNew: false } : e
          );
        }, 600);
        
        // Show total win container and animate the amount
        if (!showTotalWin) {
          // First win - show the container
          showTotalWin = true;
          totalWinExiting = false;
          totalWinAmount = 0;
          displayedWinAmount = 0;
          
          // Clear any existing hide timeout
          if (totalWinHideTimeout) {
            clearTimeout(totalWinHideTimeout);
            totalWinHideTimeout = null;
          }
        }
        
        // Update total and start incrementing animation
        const previousTotal = totalWinAmount;
        totalWinAmount += payout;
        
        // Celebration duration (1125ms for normal, 2250ms for all pegs bonus)
        const celebrationDuration = symbolLevel === ALL_PEGS_SYMBOL_ID ? 2250 : 1125;
        
        // Animate the increment over the celebration duration (leave some buffer)
        animateWinIncrement(previousTotal, totalWinAmount, celebrationDuration - 200);
      },
      onAllCelebrationsComplete: () => {
        isCelebrating = false;
        currentCelebration = null;
        
        // Add all winnings to balance
        balance += pendingWinnings;
        
        // If in free spins mode, track total winnings
        if (isInFreeSpins) {
          freeSpinsTotalWinnings += pendingWinnings;
        }
        
        pendingWinnings = 0;
        
        // Hide total win after 2 seconds (or trigger next free spin)
        if (showTotalWin) {
          totalWinHideTimeout = setTimeout(() => {
            totalWinExiting = true;
            // Remove from DOM after exit animation
            setTimeout(() => {
              showTotalWin = false;
              totalWinExiting = false;
              totalWinAmount = 0;
              displayedWinAmount = 0;
              
              // If in free spins mode, trigger next spin or show complete screen
              if (isInFreeSpins) {
                if (freeSpinsRemaining > 0) {
                  // Trigger next free spin after a brief delay
                  setTimeout(() => startFreeSpin(), 500);
                } else {
                  // Free spins complete - show total winnings
                  showFreeSpinsCompleteScreen();
                }
              }
            }, 400);
          }, 2000);
        } else if (isInFreeSpins) {
          // No wins to display, just continue to next spin
          if (freeSpinsRemaining > 0) {
            setTimeout(() => startFreeSpin(), 500);
          } else {
            showFreeSpinsCompleteScreen();
          }
        }
      },
      onBonusGameTriggered: (bonusPegIds, regularWins) => {
        // Instantly add regular wins to total (skip celebration animations)
        let instantWinTotal = 0;
        
        for (const win of regularWins) {
          const payout = betAmount * win.multiplier;
          instantWinTotal += payout;
          
          // Add instant win entries to the sidebar
          const newEntry: WinEntry = {
            id: ++winEntryIdCounter,
            symbolLevel: win.symbolLevel,
            count: win.count,
            multiplier: win.multiplier,
            payout,
            isNew: true,
            isExiting: false,
          };
          winEntries = [newEntry, ...winEntries].slice(0, MAX_WIN_ENTRIES);
          
          // Remove "new" flag after brief moment
          setTimeout(() => {
            winEntries = winEntries.map(e => 
              e.id === newEntry.id ? { ...e, isNew: false } : e
            );
          }, 300);
        }
        
        // Show total win instantly if there were any regular wins
        if (instantWinTotal > 0) {
          showTotalWin = true;
          totalWinExiting = false;
          totalWinAmount = instantWinTotal;
          displayedWinAmount = instantWinTotal;
          pendingWinnings = instantWinTotal;
        }
        
        isCelebrating = true;
      },
      onBonusCelebrationComplete: () => {
        isCelebrating = false;
        
        // Add pending winnings to balance before bonus transition
        balance += pendingWinnings;
        pendingWinnings = 0;
        
        // Hide the total win display
        showTotalWin = false;
        totalWinAmount = 0;
        displayedWinAmount = 0;
        
        // Reset progressive state if was in progressive mode
        isInProgressiveSequence = false;
        progressiveWaveNumber = 0;
        progressiveTotalWinnings = 0;
        progressiveWaveWins = [];
        
        // Start the bonus transition
        startBonusTransition();
      },
      // Progressive mode callbacks
      onProgressiveWaveStart: (waveNumber) => {
        isInProgressiveSequence = true;
        progressiveWaveNumber = waveNumber;
      },
      onProgressiveWin: (win, totalAccumulated) => {
        isCelebrating = true;
        progressiveTotalWinnings = totalAccumulated;
        progressiveWaveWins = [...progressiveWaveWins, win];
        
        // Add win entry to sidebar
        const newEntry: WinEntry = {
          id: ++winEntryIdCounter,
          symbolLevel: win.symbolLevel,
          count: win.count,
          multiplier: win.multiplier,
          payout: win.payout,
          isNew: true,
          isExiting: false,
        };
        
        // Check if we need to remove the oldest entry
        const nonExitingEntries = winEntries.filter(e => !e.isExiting);
        if (nonExitingEntries.length >= MAX_WIN_ENTRIES) {
          const oldestId = nonExitingEntries[nonExitingEntries.length - 1].id;
          winEntries = winEntries.map(e => 
            e.id === oldestId ? { ...e, isExiting: true } : e
          );
          setTimeout(() => {
            winEntries = winEntries.filter(e => e.id !== oldestId);
          }, 400);
        }
        
        winEntries = [newEntry, ...winEntries];
        
        setTimeout(() => {
          winEntries = winEntries.map(e => 
            e.id === newEntry.id ? { ...e, isNew: false } : e
          );
        }, 600);
        
        // Show total win display
        if (!showTotalWin) {
          showTotalWin = true;
          totalWinExiting = false;
          totalWinAmount = 0;
          displayedWinAmount = 0;
          
          if (totalWinHideTimeout) {
            clearTimeout(totalWinHideTimeout);
            totalWinHideTimeout = null;
          }
        }
        
        // Update total and animate
        const previousTotal = totalWinAmount;
        totalWinAmount = totalAccumulated;
        animateWinIncrement(previousTotal, totalWinAmount, 1000);
      },
      onProgressiveExplosion: (pegIds, symbolLevel) => {
        // Visual feedback handled by engine
        isCelebrating = false;
      },
      onProgressivePegsLocked: (lockedPegIds) => {
        // Visual feedback handled by engine (metallic outline)
      },
      onProgressiveSequenceComplete: (totalWinnings, waveCount) => {
        isInProgressiveSequence = false;
        
        // Add all progressive winnings to balance
        balance += totalWinnings;
        
        // Keep win display visible for a bit longer, then hide
        if (showTotalWin) {
          totalWinHideTimeout = setTimeout(() => {
            totalWinExiting = true;
            setTimeout(() => {
              showTotalWin = false;
              totalWinExiting = false;
              totalWinAmount = 0;
              displayedWinAmount = 0;
              progressiveWaveNumber = 0;
              progressiveTotalWinnings = 0;
              progressiveWaveWins = [];
            }, 400);
          }, 2500);
        }
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
  
  /**
   * Animate the win amount incrementing smoothly.
   */
  function animateWinIncrement(from: number, to: number, duration: number) {
    // Cancel any existing animation
    if (incrementAnimationFrame) {
      cancelAnimationFrame(incrementAnimationFrame);
      incrementAnimationFrame = null;
    }
    
    const startTime = performance.now();
    const diff = to - from;
    
    function tick(currentTime: number) {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      
      // Ease-out curve for satisfying deceleration
      const eased = 1 - Math.pow(1 - progress, 3);
      
      displayedWinAmount = from + diff * eased;
      
      if (progress < 1) {
        incrementAnimationFrame = requestAnimationFrame(tick);
      } else {
        displayedWinAmount = to;
        incrementAnimationFrame = null;
      }
    }
    
    incrementAnimationFrame = requestAnimationFrame(tick);
  }
  
  /**
   * Instantly hide the total win display (when starting new game).
   */
  function hideTotalWinInstantly() {
    if (totalWinHideTimeout) {
      clearTimeout(totalWinHideTimeout);
      totalWinHideTimeout = null;
    }
    if (incrementAnimationFrame) {
      cancelAnimationFrame(incrementAnimationFrame);
      incrementAnimationFrame = null;
    }
    showTotalWin = false;
    totalWinExiting = false;
    totalWinAmount = 0;
    displayedWinAmount = 0;
  }
  
  /**
   * Start the bonus game transition animation.
   */
  function startBonusTransition() {
    showBonusTransition = true;
    bonusTransitionPhase = 'entering';
    
    // Transition to visible after enter animation
    setTimeout(() => {
      bonusTransitionPhase = 'visible';
    }, 600);
    
    // Start exiting after 4 seconds total
    setTimeout(() => {
      bonusTransitionPhase = 'exiting';
    }, 3400);
    
    // Complete transition and start free spins
    setTimeout(() => {
      showBonusTransition = false;
      startFreeSpinsMode();
    }, 4000);
  }
  
  /**
   * Initialize free spins mode.
   */
  function startFreeSpinsMode() {
    isInFreeSpins = true;
    freeSpinsRemaining = PlinkoSlotEngine.FREE_SPINS_AWARDED;
    freeSpinsTotalWinnings = 0;
    
    // Tell engine to disable bonus symbol spawning
    engine?.setFreeSpinsMode(true);
    
    // Start first free spin after a brief delay
    setTimeout(() => startFreeSpin(), 1000);
  }
  
  /**
   * Start a single free spin.
   */
  async function startFreeSpin() {
    if (!engine || freeSpinsRemaining <= 0) return;
    
    // Decrement remaining spins
    freeSpinsRemaining--;
    
    // Reset state for new run (no bet deduction for free spins)
    currentBall = 0;
    exitedBalls = [];
    payoutResult = null;
    winEntries = [];
    pendingWinnings = 0;
    hideTotalWinInstantly();
    
    // Update fair state
    const state = engine.getFairState();
    fairState = {
      ...fairState,
      serverSeedHash: state.serverSeedHash,
      nonce: state.nonce
    };
    
    // Start run (using current bet amount but not deducting)
    await engine.startRun(betAmount);
  }
  
  /**
   * Show the free spins complete screen with total winnings.
   */
  function showFreeSpinsCompleteScreen() {
    isInFreeSpins = false;
    
    // Re-enable bonus symbol spawning
    engine?.setFreeSpinsMode(false);
    
    showFreeSpinsComplete = true;
    freeSpinsCompletePhase = 'incrementing';
    freeSpinsCompleteDisplayAmount = 0;
    
    // Animate the total amount incrementing
    const duration = 2000; // 2 seconds to count up
    const startTime = performance.now();
    const targetAmount = freeSpinsTotalWinnings;
    
    function animateComplete(currentTime: number) {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      
      // Ease-out curve
      const eased = 1 - Math.pow(1 - progress, 3);
      freeSpinsCompleteDisplayAmount = targetAmount * eased;
      
      if (progress < 1) {
        requestAnimationFrame(animateComplete);
      } else {
        freeSpinsCompleteDisplayAmount = targetAmount;
        freeSpinsCompletePhase = 'holding';
        
        // Hold for 2 seconds then exit
        setTimeout(() => {
          freeSpinsCompletePhase = 'exiting';
          
          // Remove after exit animation
          setTimeout(() => {
            showFreeSpinsComplete = false;
            freeSpinsTotalWinnings = 0;
          }, 600);
        }, 2000);
      }
    }
    
    requestAnimationFrame(animateComplete);
  }
  
  async function handlePlay() {
    if (!engine || !canPlay) return;
    
    // Reset state for new run
    currentBall = 0;
    exitedBalls = [];
    payoutResult = null;
    winEntries = []; // Reset win entries for new game
    pendingWinnings = 0; // Reset pending winnings
    
    // Reset progressive state
    progressiveWaveNumber = 0;
    progressiveTotalWinnings = 0;
    progressiveWaveWins = [];
    
    // Instantly hide total win display when starting new game
    hideTotalWinInstantly();
    
    // Deduct bet
    balance -= betAmount;
    
    // Set progressive mode on engine
    engine.setProgressiveMode(progressiveMode);
    
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
  
  // Cleanup timers on destroy
  onDestroy(() => {
    if (totalWinHideTimeout) {
      clearTimeout(totalWinHideTimeout);
    }
    if (incrementAnimationFrame) {
      cancelAnimationFrame(incrementAnimationFrame);
    }
  });
</script>

<div class="flex h-screen bg-black">
  <!-- Left Sidebar: Controls -->
  <div class="w-72 flex flex-col bg-neutral-950 border-r border-neutral-800 p-4 overflow-y-auto">
    <!-- Settings buttons at top -->
    <div class="flex items-center justify-end gap-2 mb-4">
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

    <!-- Balance -->
    <div class="mb-6">
      <label class="text-sm font-medium text-neutral-400 uppercase tracking-wide">Balance</label>
      <div class="relative mt-2">
        <span class="absolute left-4 top-1/2 -translate-y-1/2 text-lg font-medium text-neutral-500">$</span>
        <div class="w-full rounded-lg bg-neutral-800 border border-neutral-700 pl-8 pr-4 py-3 text-white text-lg font-medium">
          {balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </div>
      </div>
    </div>

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
    </div>
    
    <!-- Progressive Mode Toggle -->
    <div class="mb-12">
      <label class="flex items-center justify-between cursor-pointer group">
        <div>
          <span class="text-sm font-medium text-neutral-400 uppercase tracking-wide group-hover:text-neutral-300 transition-colors">Progressive Mode</span>
          <p class="text-xs text-neutral-500 mt-0.5">Cascade wins for bigger payouts</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={progressiveMode}
          disabled={isRunning || isInProgressiveSequence}
          onclick={() => progressiveMode = !progressiveMode}
          class="relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 focus:ring-offset-neutral-950 disabled:opacity-50 disabled:cursor-not-allowed
            {progressiveMode ? 'bg-green-500' : 'bg-neutral-700'}"
        >
          <span
            class="pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out
              {progressiveMode ? 'translate-x-5' : 'translate-x-0'}"
          />
        </button>
      </label>
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

    <!-- Individual Wins Display (at bottom, grows upward) -->
    <div class="min-h-[280px] flex flex-col justify-end gap-2 overflow-hidden">
      {#each winEntries as entry (entry.id)}
        <div 
          class="win-entry flex items-center justify-between p-3 bg-neutral-900 border border-neutral-700 rounded-lg
            {entry.isNew ? 'win-entry-new-subtle' : ''}
            {entry.isExiting ? 'win-entry-exit' : ''}"
        >
          <!-- Left side: count + symbol (or bonus text) -->
          <div class="flex items-center gap-2">
            {#if entry.symbolLevel === ALL_PEGS_SYMBOL_ID}
              <span class="text-sm font-bold text-yellow-400">⭐ ALL PEGS</span>
            {:else}
              <span class="text-xl font-bold text-white">{entry.count}</span>
              <img 
                src={SYMBOL_SVGS[entry.symbolLevel]} 
                alt={SYMBOL_NAMES[entry.symbolLevel]}
                class="w-8 h-8 object-contain"
              />
            {/if}
          </div>
          
          <!-- Right side: payout amount -->
          <div class="text-lg font-bold text-green-400">
            ${entry.payout.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        </div>
      {/each}
    </div>
  </div>

  <!-- Center: Game Board -->
  <div class="flex-1 flex flex-col items-center justify-center bg-black p-4">
    <!-- Free Spins Remaining Indicator (above the win container) -->
    {#if isInFreeSpins}
      <div class="mb-2">
        <div class="px-4 py-1.5 bg-gradient-to-r from-fuchsia-600/90 to-purple-600/90 rounded-full shadow-md">
          <span class="text-sm font-semibold text-white">
            {#if freeSpinsRemaining === 0}
              Final Spin!
            {:else}
              {freeSpinsRemaining} {freeSpinsRemaining === 1 ? 'Spin' : 'Spins'} Remaining
            {/if}
          </span>
        </div>
      </div>
    {/if}
    
    
    <!-- Total Win Container (above the board) -->
    <div class="relative h-24 mb-4 {isInFreeSpins ? '' : 'mt-8'}" style:width="{WIDTH}px">
      {#if showTotalWin}
        <div 
          class="total-win-container absolute inset-0 flex flex-col items-center justify-center
            {totalWinExiting ? 'total-win-exit' : 'total-win-enter'}"
        >
          <div class="total-win-label text-sm font-medium text-neutral-400 uppercase tracking-wider mb-1">
            Win
          </div>
          <div class="total-win-amount text-2xl font-semibold text-emerald-400/90">
            ${displayedWinAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        </div>
      {/if}
    </div>
    
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

<!-- Bonus Transition Overlay -->
{#if showBonusTransition}
  <div class="fixed inset-0 z-50 flex items-center justify-center overflow-hidden bonus-transition-overlay
    {bonusTransitionPhase === 'entering' ? 'bonus-entering' : ''}
    {bonusTransitionPhase === 'exiting' ? 'bonus-exiting' : ''}">
    
    <!-- Floating bonus tiles -->
    <div class="absolute inset-0 pointer-events-none">
      {#each Array(150) as _, i}
        <div 
          class="bonus-tile absolute"
          style="
            --delay: {i * 20}ms;
            --start-x: {Math.random() * 100}vw;
            --start-y: {110 + Math.random() * 20}vh;
            --end-x: {(Math.random() - 0.5) * 30}vw;
            --end-y: {-20 - Math.random() * 30}vh;
            --rotation: {Math.random() * 720 - 360}deg;
            --scale: {0.5 + Math.random() * 1};
            --duration: {3 + Math.random() * 2}s;
          "
        >
          <img src={bonusSvg} alt="Bonus" class="w-16 h-16" />
        </div>
      {/each}
    </div>
    
    <!-- Congratulations text -->
    <div class="text-center z-10 bonus-text {bonusTransitionPhase}">
      <div class="text-6xl font-black text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 via-fuchsia-500 to-purple-500 mb-4 drop-shadow-lg bonus-congrats">
        CONGRATULATIONS!
      </div>
      <div class="text-2xl font-semibold text-white/90 mb-6 bonus-awarded">
        You've been awarded
      </div>
      <div class="text-9xl font-black text-transparent bg-clip-text bg-gradient-to-r from-fuchsia-400 to-purple-400 mb-4 bonus-number">
        {PlinkoSlotEngine.FREE_SPINS_AWARDED}
      </div>
      <div class="text-4xl font-bold text-white bonus-spins">
        Free Spins
      </div>
    </div>
  </div>
{/if}

<!-- Free Spins Complete Overlay -->
{#if showFreeSpinsComplete}
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 free-spins-complete
    {freeSpinsCompletePhase === 'exiting' ? 'complete-exiting' : ''}">
    <div class="text-center">
      <div class="text-2xl font-semibold text-white/80 mb-4">
        Free Spins Complete!
      </div>
      <div class="text-xl font-medium text-white/60 mb-6">
        Total Winnings
      </div>
      <div class="free-spins-total text-7xl font-black text-transparent bg-clip-text bg-gradient-to-r from-green-400 to-emerald-400
        {freeSpinsCompletePhase === 'incrementing' ? 'total-incrementing' : ''}
        {freeSpinsCompletePhase === 'holding' ? 'total-holding' : ''}">
        ${freeSpinsCompleteDisplayAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </div>
    </div>
  </div>
{/if}

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
  
  /* Win entry - simplified, subtle styling */
  .win-entry {
    position: relative;
    transition: all 0.3s ease;
  }
  
  .win-entry-new-subtle {
    animation: winEntrySpawnSubtle 0.4s ease-out;
    border-color: rgba(34, 197, 94, 0.5);
  }
  
  .win-entry-exit {
    animation: winEntryExit 0.4s ease-in forwards;
  }
  
  @keyframes winEntryExit {
    0% {
      opacity: 1;
      transform: translateY(0);
    }
    100% {
      opacity: 0;
      transform: translateY(20px);
    }
  }
  
  @keyframes winEntrySpawnSubtle {
    0% {
      opacity: 0;
      transform: translateY(-8px);
    }
    100% {
      opacity: 1;
      transform: translateY(0);
    }
  }
  
  /* Total Win Container */
  .total-win-container {
    background: radial-gradient(ellipse at center, rgba(34, 197, 94, 0.15) 0%, transparent 70%);
    border-radius: 16px;
    overflow: visible;
  }
  
  .total-win-enter {
    animation: totalWinEnter 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
  }
  
  .total-win-exit {
    animation: totalWinExit 0.4s ease-in forwards;
  }
  
  @keyframes totalWinEnter {
    0% {
      opacity: 0;
      transform: scale(0.5);
    }
    60% {
      transform: scale(1.05);
    }
    100% {
      opacity: 1;
      transform: scale(1);
    }
  }
  
  @keyframes totalWinExit {
    0% {
      opacity: 1;
      transform: scale(1);
    }
    100% {
      opacity: 0;
      transform: scale(0.7);
    }
  }
  
  /* Bonus Transition Overlay */
  .bonus-transition-overlay {
    background: radial-gradient(ellipse at center, rgba(168, 85, 247, 0.4) 0%, rgba(0, 0, 0, 0.95) 70%);
    animation: bonusOverlayIn 0.6s ease-out forwards;
  }
  
  .bonus-transition-overlay.bonus-entering {
    animation: bonusOverlayIn 0.6s ease-out forwards;
  }
  
  .bonus-transition-overlay.bonus-exiting {
    animation: bonusOverlayOut 0.6s ease-in forwards;
  }
  
  @keyframes bonusOverlayIn {
    0% {
      opacity: 0;
    }
    100% {
      opacity: 1;
    }
  }
  
  @keyframes bonusOverlayOut {
    0% {
      opacity: 1;
    }
    100% {
      opacity: 0;
    }
  }
  
  /* Floating bonus tiles */
  .bonus-tile {
    animation: bonusTileFloat var(--duration) ease-in-out var(--delay) forwards;
    opacity: 0;
    transform: scale(var(--scale)) rotate(0deg);
    left: var(--start-x);
    top: var(--start-y);
    filter: drop-shadow(0 0 10px rgba(255, 0, 255, 0.6));
  }
  
  @keyframes bonusTileFloat {
    0% {
      opacity: 0;
      transform: scale(var(--scale)) rotate(0deg) translateY(0);
    }
    10% {
      opacity: 0.8;
    }
    90% {
      opacity: 0.8;
    }
    100% {
      opacity: 0;
      transform: scale(var(--scale)) rotate(var(--rotation)) translateY(calc(var(--end-y) - var(--start-y))) translateX(var(--end-x));
    }
  }
  
  /* Bonus text animations */
  .bonus-text {
    transform: scale(0.8);
    opacity: 0;
  }
  
  .bonus-text.entering {
    animation: bonusTextIn 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
  }
  
  .bonus-text.visible {
    transform: scale(1);
    opacity: 1;
  }
  
  .bonus-text.exiting {
    animation: bonusTextOut 0.5s ease-in forwards;
  }
  
  @keyframes bonusTextIn {
    0% {
      opacity: 0;
      transform: scale(0.5);
    }
    100% {
      opacity: 1;
      transform: scale(1);
    }
  }
  
  @keyframes bonusTextOut {
    0% {
      opacity: 1;
      transform: scale(1);
    }
    100% {
      opacity: 0;
      transform: scale(1.1);
    }
  }
  
  .bonus-congrats {
    animation: bonusCongratsGlow 1s ease-in-out infinite alternate;
  }
  
  @keyframes bonusCongratsGlow {
    0% {
      filter: drop-shadow(0 0 20px rgba(255, 215, 0, 0.5));
    }
    100% {
      filter: drop-shadow(0 0 40px rgba(255, 215, 0, 0.9));
    }
  }
  
  .bonus-awarded {
    animation: fadeInUp 0.5s ease-out 0.2s both;
  }
  
  .bonus-number {
    animation: bonusNumberPulse 0.8s ease-in-out infinite alternate, fadeInUp 0.5s ease-out 0.4s both;
  }
  
  @keyframes bonusNumberPulse {
    0% {
      transform: scale(1);
      filter: drop-shadow(0 0 30px rgba(217, 70, 239, 0.6));
    }
    100% {
      transform: scale(1.05);
      filter: drop-shadow(0 0 50px rgba(217, 70, 239, 0.9));
    }
  }
  
  .bonus-spins {
    animation: fadeInUp 0.5s ease-out 0.6s both;
  }
  
  @keyframes fadeInUp {
    0% {
      opacity: 0;
      transform: translateY(20px);
    }
    100% {
      opacity: 1;
      transform: translateY(0);
    }
  }
  
  /* Free Spins Complete Overlay */
  .free-spins-complete {
    animation: completeOverlayIn 0.5s ease-out forwards;
  }
  
  .free-spins-complete.complete-exiting {
    animation: completeOverlayOut 0.6s ease-in forwards;
  }
  
  @keyframes completeOverlayIn {
    0% {
      opacity: 0;
    }
    100% {
      opacity: 1;
    }
  }
  
  @keyframes completeOverlayOut {
    0% {
      opacity: 1;
    }
    100% {
      opacity: 0;
    }
  }
  
  .free-spins-total {
    filter: drop-shadow(0 0 20px rgba(34, 197, 94, 0.5));
    transition: all 0.3s ease;
  }
  
  .free-spins-total.total-incrementing {
    animation: totalIncrementing 0.15s ease-in-out infinite;
  }
  
  .free-spins-total.total-holding {
    animation: totalHolding 1s ease-in-out infinite alternate;
  }
  
  @keyframes totalIncrementing {
    0%, 100% {
      transform: scale(1);
    }
    50% {
      transform: scale(1.02);
    }
  }
  
  @keyframes totalHolding {
    0% {
      filter: drop-shadow(0 0 30px rgba(34, 197, 94, 0.6));
    }
    100% {
      filter: drop-shadow(0 0 50px rgba(34, 197, 94, 0.9));
    }
  }
  
</style>
