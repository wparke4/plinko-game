<!-- Multiplier.svelte -->
<script lang="ts">
  export let multiplier: number = 0;
  
  $: isGameStarted = multiplier > 0;
</script>

<div class="multiplier" class:game-started={isGameStarted}>
  {multiplier.toFixed(2)}x
</div> 