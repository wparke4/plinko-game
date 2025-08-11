<!-- Multiplier.svelte -->
<script lang="ts">
  import { gameState, bonusDoubling } from '$lib/stores/game';
  import { tweened } from 'svelte/motion';
  import { cubicOut } from 'svelte/easing';
  
  export let multiplier: number = 0;
  
  $: isGameStarted = multiplier > 0;
  $: isGameDead = $gameState.isGameDead;

  // Animate the existing text from current -> doubled when bonus hits
  const animatedValue = tweened(0, { duration: 900, easing: cubicOut });
  let isBonusAnimating = false;
  let displayedOverride: number | null = null;

  // Drive the displayed number during animation
  $: if (isBonusAnimating) {
    displayedOverride = $animatedValue;
  }

  // Trigger animation when engine signals a bonus doubling event
  $: if ($bonusDoubling) {
    const { from, to } = $bonusDoubling;
    isBonusAnimating = true;

    // Initialize and tween to target
    animatedValue.set(from, { duration: 0 });
    displayedOverride = from;
    requestAnimationFrame(() => {
      animatedValue.set(to, { duration: 900, easing: cubicOut });
    });

    // Finish animation and keep showing the doubled value
    setTimeout(() => {
      isBonusAnimating = false;
      displayedOverride = to;
    }, 1100);

    // Clear the trigger so it does not re-fire
    bonusDoubling.set(null);
  }

  // If the engine resets multiplier back to 0, clear any override and animation state
  $: if (!isBonusAnimating && multiplier === 0 && displayedOverride !== null) {
    displayedOverride = null;
    animatedValue.set(0, { duration: 0 });
  }
  
  // Also reset display override when bonusDoubling store is cleared (on game reset)
  $: if ($bonusDoubling === null && displayedOverride !== null && !isBonusAnimating) {
    displayedOverride = null;
    animatedValue.set(0, { duration: 0 });
  }

  // Final text used by the UI
  $: displayText = `${(displayedOverride ?? multiplier).toFixed(2)}x`;
</script>

<div class="multiplier" class:game-started={isGameStarted} class:game-dead={isGameDead} class:bonus-animate={isBonusAnimating}>
  {displayText}
</div>

<style>
  :global(.multiplier) {
    font-size: min(3.6rem, 7.2vh);
    font-weight: bold;
    color: rgba(255, 255, 255, 0.8); /* Off-white for 0.00x */
    text-align: center;
    transition: color 0.2s ease, transform 0.2s ease, text-shadow 0.2s ease;
    will-change: transform, color, text-shadow;
  }

  :global(.multiplier.game-started) {
    color: rgba(255, 255, 255, 1); /* Pure white when game starts */
  }

  :global(.multiplier.game-dead) {
    color: rgba(239, 68, 68, 1); /* Bright red when game is dead */
  }

  /* Impactful, classy celebration that animates the existing text */
  :global(.multiplier.bonus-animate) {
    animation: multBonusScale 1s ease both, multBonusShimmer 1s ease both;
    text-shadow: 0 0 0 rgba(255, 215, 0, 0);
  }

  @keyframes multBonusScale {
    0% { transform: scale(1); }
    20% { transform: scale(1.18); }
    55% { transform: scale(1.1); }
    100% { transform: scale(1); }
  }

  /* Gentle golden shimmer over the text */
  @keyframes multBonusShimmer {
    0% {
      color: #ffffff;
      text-shadow: 0 0 0 rgba(255, 215, 0, 0);
    }
    25% {
      color: #ffe27a; /* gold highlight */
      text-shadow: 0 0 14px rgba(255, 215, 0, 0.9), 0 0 28px rgba(255, 165, 0, 0.6);
    }
    60% {
      color: #fff7cc;
      text-shadow: 0 0 10px rgba(255, 215, 0, 0.7), 0 0 18px rgba(255, 165, 0, 0.45);
    }
    100% {
      color: #ffffff;
      text-shadow: 0 0 0 rgba(255, 215, 0, 0);
    }
  }

  .multiplier-container {
    min-height: 3rem;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
  }
</style> 