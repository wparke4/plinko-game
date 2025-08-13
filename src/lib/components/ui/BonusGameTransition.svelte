<script lang="ts">
  import { bonusGameState } from '$lib/stores/game';
  import { fade, fly } from 'svelte/transition';
  import { quintOut } from 'svelte/easing';

  let isTransitioning = $derived($bonusGameState.isTransitioning);
  let bonusMultiplier = $derived($bonusGameState.bonusMultiplier);
  let triggerAmount = $derived($bonusGameState.triggerAmount);
</script>

{#if isTransitioning}
  <div 
    class="fixed inset-0 z-[9999] flex items-center justify-center bg-black bg-opacity-90"
    transition:fade={{ duration: 500 }}
  >
    <div 
      class="text-center space-y-8"
      transition:fly={{ y: 50, duration: 800, easing: quintOut }}
    >
      <!-- Main Bonus Title -->
      <div class="relative">
        <h1 class="text-6xl md:text-8xl font-bold bg-gradient-to-r from-yellow-400 via-orange-500 to-red-500 bg-clip-text text-transparent animate-pulse">
          🎰 BONUS GAME! 🎰
        </h1>
        
        <!-- Glow effect -->
        <div class="absolute inset-0 text-6xl md:text-8xl font-bold text-yellow-400 opacity-30 blur-lg">
          🎰 BONUS GAME! 🎰
        </div>
      </div>

      <!-- Trigger Info -->
      <div class="bg-gradient-to-r from-yellow-600 to-orange-600 rounded-lg p-6 mx-4 max-w-md">
        <h2 class="text-2xl font-bold text-white mb-2">Congratulations!</h2>
        <p class="text-lg text-yellow-100">
          You triggered a <span class="font-bold text-2xl">{bonusMultiplier}x</span> bonus!
        </p>
        <p class="text-lg text-yellow-100">
          You won: <span class="font-bold text-xl">${(triggerAmount * bonusMultiplier).toFixed(2)}</span>
        </p>
      </div>

      <!-- Bonus Features -->
      <div class="bg-gradient-to-r from-green-600 to-blue-600 rounded-lg p-6 mx-4 max-w-md">
        <h3 class="text-xl font-bold text-white mb-3">Bonus Features:</h3>
        <div class="space-y-2 text-white">
          <div class="flex items-center justify-center gap-2">
            <span class="text-2xl">🆓</span>
            <span class="text-lg">5 FREE Ball Drops</span>
          </div>
          <div class="flex items-center justify-center gap-2">
            <span class="text-2xl">💰</span>
            <span class="text-lg">Classic Plinko Multipliers</span>
          </div>
          <div class="flex items-center justify-center gap-2">
            <span class="text-2xl">🎯</span>
            <span class="text-lg">All Winnings Are Yours!</span>
          </div>
        </div>
      </div>

      <!-- Loading animation -->
      <div class="flex items-center justify-center space-x-2">
        <div class="text-white text-lg">Preparing bonus game</div>
        <div class="flex space-x-1">
          <div class="w-2 h-2 bg-yellow-400 rounded-full animate-bounce"></div>
          <div class="w-2 h-2 bg-orange-400 rounded-full animate-bounce" style="animation-delay: 0.1s"></div>
          <div class="w-2 h-2 bg-red-400 rounded-full animate-bounce" style="animation-delay: 0.2s"></div>
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  @keyframes glow {
    0%, 100% { text-shadow: 0 0 5px currentColor; }
    50% { text-shadow: 0 0 20px currentColor, 0 0 30px currentColor; }
  }
  
  .animate-glow {
    animation: glow 2s ease-in-out infinite;
  }
</style> 