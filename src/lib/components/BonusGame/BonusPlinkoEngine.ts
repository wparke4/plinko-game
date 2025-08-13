import ClassicPlinkoEngine from '$lib/components/Plinko/PlinkoEngine';
import { betAmountOfExistingBalls, balance, bonusGameState } from '$lib/stores/game';
import { getRandomBetween } from '$lib/utils/numbers';
import Matter from 'matter-js';

/**
 * Bonus Plinko Engine extends the Classic Plinko Engine
 * but provides free ball drops without deducting balance
 */
class BonusPlinkoEngine extends ClassicPlinkoEngine {
  private isBonusMode: boolean = true;
  private freeBetAmount: number = 10; // Default free bet amount for bonus game

  constructor(canvas: HTMLCanvasElement) {
    super(canvas);
  }

  /**
   * Override dropBall to provide free drops during bonus game
   */
  dropBall() {
    // Get current bonus game state
    const currentBonusState = bonusGameState;
    let bonusState: any;
    currentBonusState.subscribe(state => bonusState = state)();

    // Only allow drops if bonus game is active and has remaining drops
    if (!bonusState.isActive || bonusState.remainingDrops <= 0) {
      console.log('No free drops remaining or bonus game not active');
      return;
    }

    // Prevent dropping another ball if game is already in progress
    if (this.isGameInProgress()) {
      console.log('Game already in progress, cannot drop another ball');
      return;
    }

    const ballOffsetRangeX = this.pinDistanceX * 0.8;
    const ballRadius = this.pinRadius * 2;
    const { friction, frictionAirByRowCount } = (this.constructor as any).ballFrictions;

    const ball = Matter.Bodies.circle(
      getRandomBetween(
        this.canvas.width / 2 - ballOffsetRangeX,
        this.canvas.width / 2 + ballOffsetRangeX,
      ),
      0,
      ballRadius,
      {
        restitution: 0.8, // Bounciness
        friction,
        frictionAir: frictionAirByRowCount[this.rowCount],
        collisionFilter: {
          category: (this.constructor as any).BALL_CATEGORY,
          mask: (this.constructor as any).PIN_CATEGORY, // Collide with pins only, but not other balls
        },
        render: {
          fillStyle: '#FFD700', // Golden color for bonus balls
        },
      },
    );
    Matter.Composite.add(this.engine.world, ball);

    // Track the ball with free bet amount (NO balance deduction)
    this.trackedBall = ball;
    this.activeBalls.set(ball, this.freeBetAmount);

    // Track the ball in the store but don't deduct balance
    betAmountOfExistingBalls.update((value) => ({ ...value, [ball.id]: this.freeBetAmount }));
    
    console.log(`Free bonus ball dropped! Remaining drops: ${bonusState.remainingDrops - 1}`);
  }

  /**
   * Set the free bet amount for bonus drops
   */
  setFreeBetAmount(amount: number) {
    this.freeBetAmount = amount;
  }

  /**
   * Get the current free bet amount
   */
  getFreeBetAmount(): number {
    return this.freeBetAmount;
  }
}

export default BonusPlinkoEngine; 