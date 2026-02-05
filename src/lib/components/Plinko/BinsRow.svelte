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

  function formatLargeNumber(num: number): string {
    if (num < 1000) {
      // For numbers under 1000, limit to 3 significant digits
      return Number(num.toPrecision(3)).toString();
    }
    
    const inThousands = num / 1000;
    
    // Determine decimal places based on number of digits before decimal
    const digitsBeforeDecimal = Math.floor(inThousands).toString().length;
    
    // If number is 10K or more, reduce decimal places to keep total digits at 3
    const maxDecimalPlaces = digitsBeforeDecimal >= 2 ? 0 : 
                           digitsBeforeDecimal === 1 ? 1 : 2;
    
    // First convert to fixed decimal places
    let formatted = Number(inThousands.toFixed(maxDecimalPlaces)).toString();
    
    // If still too many digits, use toPrecision to force 3 digits
    if (formatted.replace('.', '').length > 3) {
      formatted = Number(inThousands.toPrecision(3)).toString();
    }
    
    // Remove trailing zeros after decimal point
    formatted = formatted.replace(/\.?0+$/, '');
    
    return `${formatted}K`;
  }

  function getBinDisplayValue(binIndex: number): string {
    if ($zeroedBins.has(binIndex)) {
      return '💀';
    }
    const adjustedPayout = $adjustedMultipliers[binIndex];
    const originalPayout = binPayouts[$rowCount][$riskLevel][binIndex];
    
    // For small numbers (< 100)
    if (originalPayout < 100) {
      // Limit to 3 significant digits for small numbers
      let formattedPayout = Number(adjustedPayout.toPrecision(3)).toString();
      // Remove trailing zeros
      formattedPayout = formattedPayout.replace(/\.?0+$/, '');
      return formattedPayout;
    }
    
    // For large numbers, use K formatting
    return formatLargeNumber(adjustedPayout);
  }

  function shouldShowMultiplierX(displayValue: string): boolean {
    if (displayValue === '💀') {
      return false;
    }
    if (displayValue.toLowerCase().includes('k')) {
      return false;
    }

    const numericValue = Number(displayValue);
    if (!Number.isFinite(numericValue)) {
      return false;
    }

    return numericValue < 10;
  }

  function getBinStyle(binIndex: number): string {
    if ($zeroedBins.has(binIndex)) {
      return 'background-color: rgb(0, 0, 0); color: rgb(255, 255, 255); --shadow-color: rgb(32, 32, 32);';
    }
    return `background-color: ${binColorsByRowCount[$rowCount].background[binIndex]}; --shadow-color: ${binColorsByRowCount[$rowCount].shadow[binIndex]};`;
  }
</script>

<!-- Height clamping in mobile: From 10px at 370px viewport width to 16px at 600px viewport width -->
<div class="flex h-[clamp(10px,0.352px+2.609vw,16px)] w-full justify-center lg:h-7">
  {#if $plinkoEngine}
    <div class="flex gap-[1%]" style:width={`${($plinkoEngine.binsWidthPercentage ?? 0) * 100}%`}>
      {#each $adjustedMultipliers as payout, binIndex}
        {@const displayValue = getBinDisplayValue(binIndex)}
        <!-- Font-size clamping:
              - Mobile (< 1024px): From 5px at 370px viewport width to 7px at 600px viewport width
              - Desktop (>= 1024px): From 9px at 1024px viewport width to 11px at 1100px viewport width
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
          class="flex min-w-0 flex-1 cursor-pointer items-center justify-center rounded-xs text-[clamp(5px,2.784px+0.87vw,7px)] font-bold text-gray-950 shadow-[0_2px_var(--shadow-color)] transition-all hover:opacity-80 hover:scale-105 focus:outline-none focus:ring-2 focus:ring-white focus:ring-opacity-50 lg:rounded-md lg:text-[clamp(9px,-16.944px+2.632vw,11px)] lg:shadow-[0_3px_var(--shadow-color)]"
          style={getBinStyle(binIndex)}
        >
          <span>{displayValue}</span>
          {#if shouldShowMultiplierX(displayValue)}
            <span class="ml-[1px] text-[0.75em] leading-none">x</span>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>
