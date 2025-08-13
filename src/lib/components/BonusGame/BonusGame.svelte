<script lang="ts">
  import { bonusGameState, plinkoEngine, balance, winRecords, totalProfitHistory, betAmount } from '$lib/stores/game';
  import CircleNotch from 'phosphor-svelte/lib/CircleNotch';
  import type { Action } from 'svelte/action';
  import ClassicPlinkoEngine from '$lib/components/Plinko/PlinkoEngine';
  import BinsRow from '$lib/components/Plinko/BinsRow.svelte';
  import { goto } from '$app/navigation';
  import { get } from 'svelte/store';

  const { WIDTH, HEIGHT } = ClassicPlinkoEngine;

  const initBonusPlinko: Action<HTMLCanvasElement> = (node) => {
    // Create a new classic Plinko engine for the bonus game
    const bonusEngine = new ClassicPlinkoEngine(node);
    bonusEngine.start();
    
    // Store reference to the bonus engine
    $plinkoEngine = bonusEngine;

    return {
      destroy: () => {
        bonusEngine?.stop();
        $plinkoEngine = null;
      },
    };
  };

  let remainingDrops = $derived($bonusGameState.remainingDrops);
  let isActive = $derived($bonusGameState.isActive);
  let triggerAmount = $derived($bonusGameState.triggerAmount);
  let bonusMultiplier = $derived($bonusGameState.bonusMultiplier);
  
  // Auto-drop a ball every 2 seconds if there are remaining drops
  let autoDropInterval: ReturnType<typeof setInterval> | null = null;
  let originalBetAmount = 0;
  
  $effect(() => {
    if (isActive && remainingDrops > 0 && $plinkoEngine) {
      // Start auto-dropping balls
      if (!autoDropInterval) {
        // Store original bet amount and set a free bet amount
        originalBetAmount = get(betAmount);
        betAmount.set(10); // Set a small bet amount for free drops
        
        autoDropInterval = setInterval(() => {
          if ($plinkoEngine && remainingDrops > 0) {
            // Store the current balance to restore the deducted amount
            const currentBalance = get(balance);
            
            // Drop the ball (this will deduct the bet amount)
            $plinkoEngine.dropBall();
            
            // Immediately restore the balance since this is a free drop
            balance.set(currentBalance);
            
            // Decrement remaining drops
            bonusGameState.update(state => ({
              ...state,
              remainingDrops: state.remainingDrops - 1
            }));
          }
        }, 2000); // Drop a ball every 2 seconds
      }
    } else if (autoDropInterval) {
      clearInterval(autoDropInterval);
      autoDropInterval = null;
    }
    
    // When all drops are used, end the bonus game
    if (isActive && remainingDrops === 0) {
      setTimeout(() => {
        endBonusGame();
      }, 3000); // Wait 3 seconds for last ball to settle
    }
  });

  function endBonusGame() {
    // Clear auto drop interval
    if (autoDropInterval) {
      clearInterval(autoDropInterval);
      autoDropInterval = null;
    }
    
    // Restore original bet amount
    if (originalBetAmount > 0) {
      betAmount.set(originalBetAmount);
    }
    
    // Reset bonus game state
    bonusGameState.set({
      isActive: false,
      remainingDrops: 0,
      totalDrops: 5,
      isTransitioning: false,
      triggerAmount: 0,
      bonusMultiplier: 1
    });
    
    // Navigate back to crash mode
    goto('/crash');
  }

  function skipBonusGame() {
    if (autoDropInterval) {
      clearInterval(autoDropInterval);
      autoDropInterval = null;
    }
    endBonusGame();
  }
</script>

<div class="relative bg-black">
  <div class="mx-auto flex h-full flex-col px-4" style:max-width={`${WIDTH}px`}>
    
    <!-- Bonus Game Header -->
    <div class="absolute top-4 left-1/2 transform -translate-x-1/2 z-10">
      <div class="bg-gradient-to-r from-yellow-400 to-orange-500 text-black px-6 py-3 rounded-lg shadow-lg">
        <div class="text-center">
          <h2 class="text-2xl font-bold">🎰 BONUS GAME! 🎰</h2>
          <p class="text-sm">
            Triggered by {bonusMultiplier}x bonus! 
            Original win: ${(triggerAmount * bonusMultiplier).toFixed(2)}
          </p>
          <p class="text-lg font-semibold">
            Free Drops Remaining: <span class="text-3xl">{remainingDrops}</span>
          </p>
        </div>
      </div>
    </div>

    <!-- Loading spinner -->
    {#if $plinkoEngine === null}
      <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
        <CircleNotch class="size-20 animate-spin text-slate-600" weight="bold" />
      </div>
    {/if}

    <!-- Plinko Canvas -->
    <canvas use:initBonusPlinko width={WIDTH} height={HEIGHT} class="absolute inset-0 h-full w-full">
    </canvas>
  </div>
  
  <!-- Bins Row -->
  <BinsRow />
  
  <!-- Controls -->
  <div class="mt-4 flex justify-center gap-4 pb-4">
    <button
      onclick={skipBonusGame}
      class="touch-manipulation rounded-md bg-gray-600 py-3 px-8 font-semibold text-white transition-colors hover:bg-gray-500 active:bg-gray-700"
    >
      Skip Bonus Game
    </button>
  </div>
</div> 