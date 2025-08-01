<!-- Multiplier.svelte -->
<script lang="ts">
  export let multiplier: number = 0;
</script>

<div class="multiplier">
  {multiplier.toFixed(2)}x
</div> 