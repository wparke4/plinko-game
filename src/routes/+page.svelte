<script lang="ts">
  import Balance from '$lib/components/Balance.svelte';
  import LiveStatsWindow from '$lib/components/LiveStatsWindow/LiveStatsWindow.svelte';
  import Plinko from '$lib/components/Plinko';
  import SettingsWindow from '$lib/components/SettingsWindow';


</script>



<div class="relative min-h-dvh w-full bg-black">
  <Plinko />
  <SettingsWindow />
  <LiveStatsWindow />
</div>

<style lang="postcss">
  @reference "../app.css";

  :global(body) {
    @apply bg-black;
  }
</style>
