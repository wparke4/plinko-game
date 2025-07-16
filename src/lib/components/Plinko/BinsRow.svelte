<script lang="ts">
  import { binColorsByRowCount, binPayouts } from '$lib/constants/game';
  import { plinkoEngine, riskLevel, rowCount, winRecords, zeroedBins, adjustedMultipliers } from '$lib/stores/game';
  import { isAnimationOn } from '$lib/stores/settings';
  import type { Action } from 'svelte/action';

  /**
   * Bounce animations for each bin, which is played when a ball falls into the bin.
   */
  let binAnimations: Animation[] = $state([]);

  // NOTE: Not using $effect because it'll play animation if we toggle on animation in settings
  winRecords.subscribe((value) => {
    if (value.length) {
      const lastWinBinIndex = value[value.length - 1].binIndex;
      playAnimation(lastWinBinIndex);
    }
  });

  const initAnimation: Action<HTMLDivElement> = (node) => {
    const bounceAnimation = node.animate(
      [
        { transform: 'translateY(0)' },
        { transform: 'translateY(30%)' },
        { transform: 'translateY(0)' },
      ],
      {
        duration: 300,
        easing: 'cubic-bezier(0.18, 0.89, 0.32, 1.28)',
      },
    );
    bounceAnimation.pause(); // Don't run the animation immediately
    binAnimations.push(bounceAnimation);
  };

  function playAnimation(binIndex: number) {
    if (!$isAnimationOn) {
      return;
    }

    const animation = binAnimations[binIndex];

    // Always reset animation before playing. Safari has a weird behavior where
    // the animation will not play the second time if it's not cancelled.
    animation.cancel();

    animation.play();
  }

  function handleBinClick(binIndex: number) {
    $zeroedBins = new Set($zeroedBins);
    if ($zeroedBins.has(binIndex)) {
      $zeroedBins.delete(binIndex);
    } else {
      $zeroedBins.add(binIndex);
    }
  }

  function getBinDisplayValue(binIndex: number): string {
    if ($zeroedBins.has(binIndex)) {
      return '💀';
    }
    const adjustedPayout = $adjustedMultipliers[binIndex];
    const originalPayout = binPayouts[$rowCount][$riskLevel][binIndex];
    
    // Count decimal places in original payout
    const originalString = originalPayout.toString();
    const decimalPlaces = originalString.includes('.') ? 
      originalString.split('.')[1].length : 
      0;
    
    // Format adjusted payout with same precision
    const formattedPayout = adjustedPayout.toFixed(decimalPlaces);
    
    return parseFloat(formattedPayout) < 100 ? `${formattedPayout}×` : formattedPayout;
  }

  function getBinStyle(binIndex: number): string {
    if ($zeroedBins.has(binIndex)) {
      return 'background-color: rgb(0, 0, 0); color: rgb(255, 255, 255); --shadow-color: rgb(32, 32, 32);';
    }
    const isAdjusted = $adjustedMultipliers[binIndex] > binPayouts[$rowCount][$riskLevel][binIndex];
    return `background-color: ${binColorsByRowCount[$rowCount].background[binIndex]}; --shadow-color: ${binColorsByRowCount[$rowCount].shadow[binIndex]}; ${isAdjusted ? 'color: rgb(0, 255, 0);' : ''}`;
  }
</script>

<!-- Height clamping in mobile: From 10px at 370px viewport width to 16px at 600px viewport width -->
<div class="flex h-[clamp(10px,0.352px+2.609vw,16px)] w-full justify-center lg:h-7">
  {#if $plinkoEngine}
    <div class="flex gap-[1%]" style:width={`${($plinkoEngine.binsWidthPercentage ?? 0) * 100}%`}>
      {#each $adjustedMultipliers as payout, binIndex}
        <!-- Font-size clamping:
              - Mobile (< 1024px): From 6px at 370px viewport width to 8px at 600px viewport width
              - Desktop (>= 1024px): From 10px at 1024px viewport width to 12px at 1100px viewport width
         -->
        <div
          use:initAnimation
          role="button"
          tabindex="0"
          onclick={() => handleBinClick(binIndex)}
          onkeydown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              handleBinClick(binIndex);
            }
          }}
          class="flex min-w-0 flex-1 cursor-pointer items-center justify-center rounded-xs text-[clamp(6px,2.784px+0.87vw,8px)] font-bold text-gray-950 shadow-[0_2px_var(--shadow-color)] transition-all hover:opacity-80 hover:scale-105 focus:outline-none focus:ring-2 focus:ring-white focus:ring-opacity-50 lg:rounded-md lg:text-[clamp(10px,-16.944px+2.632vw,12px)] lg:shadow-[0_3px_var(--shadow-color)]"
          style={getBinStyle(binIndex)}
        >
          {getBinDisplayValue(binIndex)}
        </div>
      {/each}
    </div>
  {/if}
</div>
