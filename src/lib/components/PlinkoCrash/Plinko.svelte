<!-- Plinko.svelte -->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import PlinkoEngine from './PlinkoEngine';
  import Multiplier from './Multiplier.svelte';

  const { WIDTH, HEIGHT } = PlinkoEngine;
  let canvas: HTMLCanvasElement;
  let engine: PlinkoEngine;
  let multiplier = 0;
  let multiplierInterval: number;

  onMount(() => {
    engine = new PlinkoEngine(canvas);
    engine.start();

    // Update multiplier value regularly
    multiplierInterval = window.setInterval(() => {
      multiplier = engine.getCurrentMultiplier();
    }, 1000 / 60); // 60fps updates
  });

  onDestroy(() => {
    if (engine) {
      engine.stop();
    }
    if (multiplierInterval) {
      clearInterval(multiplierInterval);
    }
  });
</script>

<div class="relative bg-gray-900">
  <div class="mx-auto flex h-full flex-col px-4 pb-4" style:max-width={`${WIDTH}px`}>
    <div class="relative w-full" style:aspect-ratio={`${WIDTH} / ${HEIGHT}`}>
      <canvas 
        bind:this={canvas} 
        width={WIDTH} 
        height={HEIGHT} 
        class="absolute inset-0 h-full w-full"
      />
      <Multiplier {multiplier} />
    </div>
  </div>
</div>

<style>
  :global(.multiplier) {
    position: absolute;
    bottom: 20%;
    left: 50%;
    transform: translateX(-50%);
    font-size: min(8rem, 15vh);
    font-weight: bold;
    color: rgba(255, 255, 255, 0.25);
    z-index: -1;
    pointer-events: none;
    width: 100%;
    text-align: center;
  }
</style>