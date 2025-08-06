<script lang="ts">
  import Balance from '$lib/components/Balance.svelte';
  import LiveStatsWindow from '$lib/components/LiveStatsWindow/LiveStatsWindow.svelte';
  import Plinko from '$lib/components/Plinko';
  import SettingsWindow from '$lib/components/SettingsWindow';


</script>



<div class="relative flex min-h-dvh w-full flex-col bg-black">

  <div class="flex-1 px-5">
    <div class="mx-auto mt-3 max-w-xl min-w-[300px] drop-shadow-xl md:mt-6 lg:max-w-7xl">
      <div class="flex flex-col-reverse overflow-hidden rounded-lg lg:w-full lg:flex-row bg-black">
        <div class="flex-1">
          <Plinko />
        </div>
      </div>
    </div>
  </div>

  <SettingsWindow />
  <LiveStatsWindow />
</div>

<style lang="postcss">
  @reference "../app.css";

  :global(body) {
    @apply bg-black;
  }
</style>
