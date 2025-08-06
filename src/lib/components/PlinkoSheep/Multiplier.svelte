<!-- Multiplier.svelte -->
<script lang="ts">
  import { isMultiplierFlashing, gameState } from '$lib/stores/game';
  
  export let multiplier: number = 0;
  
  $: isGameStarted = multiplier > 0;
  $: isGameDead = $gameState.isGameDead;
</script>

<div class="multiplier" class:flashing={$isMultiplierFlashing} class:game-started={isGameStarted} class:game-dead={isGameDead}>
  {multiplier.toFixed(2)}x
</div>

<style>
  .multiplier {
    font-size: 2.5rem;
    font-weight: bold;
    color: rgba(255, 255, 255, 0.8); /* Off-white for 0.00x */
    text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.5);
    transition: all 0.2s ease;
  }

  .multiplier.game-started {
    color: rgba(255, 255, 255, 1); /* Pure white when game starts */
  }

  .multiplier.game-dead {
    color: #EF4444; /* Bright red when player dies */
    text-shadow: 0 0 8px rgba(239, 68, 68, 0.5);
  }
  
  .multiplier.flashing {
    animation: greenPulse 0.3s ease-in-out infinite alternate;
    transform: scale(1.1);
  }
  
  @keyframes greenPulse {
    0% {
      color: #A3E635;
      text-shadow: 0 0 5px #A3E635, 0 0 10px #A3E635, 0 0 15px #A3E635;
      transform: scale(1.1);
    }
    100% {
      color: #A3E635;
      text-shadow: 0 0 3px #A3E635, 0 0 6px #A3E635, 0 0 9px #A3E635;
      transform: scale(1.2);
    }
  }
</style> 