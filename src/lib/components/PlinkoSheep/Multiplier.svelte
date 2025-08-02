<!-- Multiplier.svelte -->
<script lang="ts">
  import { isMultiplierFlashing } from '$lib/stores/game';
  
  export let multiplier: number = 0;
</script>

<div class="multiplier" class:flashing={$isMultiplierFlashing}>
  {multiplier.toFixed(2)}x
</div>

<style>
  .multiplier {
    font-size: 1.5rem;
    font-weight: bold;
    color: white;
    text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.5);
    transition: all 0.2s ease;
  }
  
  .multiplier.flashing {
    animation: greenPulse 0.3s ease-in-out infinite alternate;
    transform: scale(1.1);
  }
  
  @keyframes greenPulse {
    0% {
      color: #00ff00;
      text-shadow: 0 0 10px #00ff00, 0 0 20px #00ff00, 0 0 30px #00ff00;
      transform: scale(1.1);
    }
    100% {
      color: #88ff88;
      text-shadow: 0 0 5px #00ff00, 0 0 10px #00ff00, 0 0 15px #00ff00;
      transform: scale(1.2);
    }
  }
</style> 