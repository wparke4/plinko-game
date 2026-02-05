<script lang="ts">
  import PlinkoSwap from '$lib/components/PlinkoSwap';
</script>

<div class="relative min-h-dvh w-full bg-black">
  <PlinkoSwap />
</div>

<style lang="postcss">
  @reference "../../app.css";

  :global(body) {
    @apply bg-black;
  }
</style>
