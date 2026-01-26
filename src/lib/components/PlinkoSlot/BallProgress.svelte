<script lang="ts">
  interface Props {
    totalBalls: number;
    currentBall: number;
    exitedBalls: number[];
  }
  
  let { totalBalls, currentBall, exitedBalls }: Props = $props();
  
  const getBallStatus = (ballId: number): 'pending' | 'active' | 'exited' => {
    if (exitedBalls.includes(ballId)) return 'exited';
    if (ballId === currentBall) return 'active';
    if (ballId < currentBall) return 'active'; // In flight
    return 'pending';
  };
</script>

<div class="bg-neutral-900 border border-neutral-700 rounded-lg p-4">
  <div class="text-sm text-neutral-400 uppercase tracking-wide mb-3">Ball Progress</div>
  
  <div class="flex gap-2 justify-center">
    {#each Array.from({ length: totalBalls }, (_, i) => i + 1) as ballId}
      {@const status = getBallStatus(ballId)}
      <div
        class="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-all duration-300
          {status === 'pending' ? 'bg-neutral-700 text-neutral-500' : ''}
          {status === 'active' ? 'bg-green-500 text-black animate-pulse' : ''}
          {status === 'exited' ? 'bg-green-700 text-green-200' : ''}"
      >
        {ballId}
      </div>
    {/each}
  </div>
  
  <div class="text-center mt-3 text-sm text-neutral-400">
    {exitedBalls.length} / {totalBalls} complete
  </div>
</div>
