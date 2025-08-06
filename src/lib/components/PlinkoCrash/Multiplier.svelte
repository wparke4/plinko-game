<!-- Multiplier.svelte -->
<script lang="ts">
  import { gameState } from '$lib/stores/game';
  
  export let multiplier: number = 0;
  
  $: isGameStarted = multiplier > 0;
  $: isGameDead = $gameState.isGameDead;
</script>

<div class="multiplier" class:game-started={isGameStarted} class:game-dead={isGameDead}>
  {multiplier.toFixed(2)}x
</div> 