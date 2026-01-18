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
    /* Responsive font size: 1.5rem on small screens, scales up to 2.5rem on larger screens */
    font-size: clamp(1.5rem, 4vw + 0.5rem, 2.5rem);
    font-weight: bold;
    color: rgba(255, 255, 255, 0.8); /* Off-white for 0.00x */
    text-shadow: 1px 1px 3px rgba(0, 0, 0, 0.5);
    transition: all 0.2s ease;
    /* Prevent text from being cut off */
    white-space: nowrap;
    padding: 0 0.5rem;
  }

  @media (min-width: 640px) {
    .multiplier {
      text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.5);
    }
  }

  .multiplier.game-started {
    color: rgba(255, 255, 255, 1); /* Pure white when game starts */
  }

  .multiplier.game-dead {
    color: #EF4444; /* Bright red when player dies */
    text-shadow: 0 0 6px rgba(239, 68, 68, 0.5);
  }

  @media (min-width: 640px) {
    .multiplier.game-dead {
      text-shadow: 0 0 8px rgba(239, 68, 68, 0.5);
    }
  }
  
  .multiplier.flashing {
    animation: greenPulse 0.3s ease-in-out infinite alternate;
    transform: scale(1.1);
  }
  
  @keyframes greenPulse {
    0% {
      color: #A3E635;
      text-shadow: 0 0 4px #A3E635, 0 0 8px #A3E635, 0 0 12px #A3E635;
      transform: scale(1.1);
    }
    100% {
      color: #A3E635;
      text-shadow: 0 0 2px #A3E635, 0 0 5px #A3E635, 0 0 8px #A3E635;
      transform: scale(1.15);
    }
  }

  @media (min-width: 640px) {
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
  }
</style> 