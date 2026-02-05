<script lang="ts">
  import { binColorsByRowCount, binPayouts } from '$lib/constants/game';
  import {
    plinkoSwapEngine,
    riskLevel,
    rowCount,
    winRecords,
    zeroedBins,
    adjustedMultipliers,
    bucketOrder,
  } from '$lib/stores/plinkoSwap';
  import { isAnimationOn } from '$lib/stores/settings';
  import type { Action } from 'svelte/action';
  import { tick } from 'svelte';

  /**
   * Bounce animations for each bucket, played when a ball falls into the bucket.
   */
  const binAnimations = new Map<number, Animation>();
  const binElements = new Map<number, HTMLDivElement>();

  // NOTE: Not using $effect because it'll play animation if we toggle on animation in settings
  winRecords.subscribe((value) => {
    if (value.length) {
      const lastWinBinIndex = value[value.length - 1].binIndex;
      playAnimation(lastWinBinIndex);
    }
  });

  const initBin: Action<HTMLDivElement, number> = (node, bucketIndex) => {
    binElements.set(bucketIndex, node);

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
    binAnimations.set(bucketIndex, bounceAnimation);

    return {
      update: (nextBucketIndex) => {
        if (nextBucketIndex === bucketIndex) {
          return;
        }
        binElements.delete(bucketIndex);
        binAnimations.delete(bucketIndex);
        bucketIndex = nextBucketIndex;
        binElements.set(bucketIndex, node);
        binAnimations.set(bucketIndex, bounceAnimation);
      },
      destroy: () => {
        binElements.delete(bucketIndex);
        binAnimations.delete(bucketIndex);
      },
    };
  };

  function playAnimation(binIndex: number) {
    if (!$isAnimationOn) {
      return;
    }

    const bucketIndex = $bucketOrder[binIndex];
    const animation = binAnimations.get(bucketIndex);
    if (!animation) {
      return;
    }

    // Always reset animation before playing. Safari has a weird behavior where
    // the animation will not play the second time if it's not cancelled.
    animation.cancel();

    animation.play();
  }

  export async function animateSwap(nextOrder: number[]): Promise<void> {
    const currentOrder = [...$bucketOrder];
    if (currentOrder.length !== nextOrder.length) {
      $bucketOrder = nextOrder;
      await tick();
      return;
    }

    const previousRects = new Map<number, DOMRect>();
    currentOrder.forEach((bucketIndex) => {
      const node = binElements.get(bucketIndex);
      if (node) {
        previousRects.set(bucketIndex, node.getBoundingClientRect());
      }
    });

    $bucketOrder = nextOrder;
    await tick();

    const animations: Animation[] = [];
    const dropDistance = 28;
    const minShift = 0.5;

    nextOrder.forEach((bucketIndex) => {
      const node = binElements.get(bucketIndex);
      const previousRect = previousRects.get(bucketIndex);
      if (!node || !previousRect) {
        return;
      }

      const nextRect = node.getBoundingClientRect();
      const deltaX = previousRect.left - nextRect.left;

      if (Math.abs(deltaX) < minShift) {
        return;
      }

      const animation = node.animate(
        [
          { transform: `translate(${deltaX}px, 0px) scale(1)`, offset: 0 },
          { transform: `translate(${deltaX}px, ${dropDistance}px) scale(0.96)`, offset: 0.3 },
          { transform: `translate(${deltaX}px, ${dropDistance}px) scale(0.96)`, offset: 0.45 },
          { transform: `translate(0px, ${dropDistance}px) scale(1)`, offset: 0.7 },
          { transform: 'translate(0px, -4px) scale(1.06)', offset: 0.86 },
          { transform: 'translate(0px, 0px) scale(1)', offset: 1 },
        ],
        {
          duration: 950,
          easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
        },
      );

      animations.push(animation);
    });

    if (animations.length === 0) {
      return;
    }

    await Promise.allSettled(animations.map((animation) => animation.finished));
  }

  function handleBinClick(binIndex: number) {
    const bucketIndex = $bucketOrder[binIndex];
    $zeroedBins = new Set($zeroedBins);
    if ($zeroedBins.has(bucketIndex)) {
      $zeroedBins.delete(bucketIndex);
    } else {
      $zeroedBins.add(bucketIndex);
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
    const maxDecimalPlaces = digitsBeforeDecimal >= 2 ? 0 : digitsBeforeDecimal === 1 ? 1 : 2;

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

  function getBinDisplayValue(bucketIndex: number): string {
    if ($zeroedBins.has(bucketIndex)) {
      return '💀';
    }
    const adjustedPayout = $adjustedMultipliers[bucketIndex] ?? 0;
    const originalPayout = binPayouts[$rowCount][$riskLevel][bucketIndex];

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

    return numericValue < 10 || numericValue === 26;
  }

  function getBinStyle(bucketIndex: number): string {
    if ($zeroedBins.has(bucketIndex)) {
      return 'background-color: rgb(0, 0, 0); color: rgb(255, 255, 255); --shadow-color: rgb(32, 32, 32);';
    }
    return `background-color: ${binColorsByRowCount[$rowCount].background[bucketIndex]}; --shadow-color: ${binColorsByRowCount[$rowCount].shadow[bucketIndex]};`;
  }
</script>

<!-- Height clamping in mobile: From 10px at 370px viewport width to 16px at 600px viewport width -->
<div class="flex h-[clamp(10px,0.352px+2.609vw,16px)] w-full justify-center lg:h-7">
  {#if $plinkoSwapEngine}
    <div class="flex gap-[1%]" style:width={`${($plinkoSwapEngine.binsWidthPercentage ?? 0) * 100}%`}>
      {#each $bucketOrder as bucketIndex, binIndex (bucketIndex)}
        {@const displayValue = getBinDisplayValue(bucketIndex)}
        <!-- Font-size clamping:
              - Mobile (< 1024px): From 5px at 370px viewport width to 7px at 600px viewport width
              - Desktop (>= 1024px): From 9px at 1024px viewport width to 11px at 1100px viewport width
         -->
        <div
          use:initBin={bucketIndex}
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
          style={getBinStyle(bucketIndex)}
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
