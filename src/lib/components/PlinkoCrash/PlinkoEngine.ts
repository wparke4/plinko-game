import Matter from 'matter-js';
import { betAmount, betAmountOfExistingBalls, balance, winRecords, totalProfitHistory } from '$lib/stores/game';
import { get } from 'svelte/store';

export default class PlinkoEngine {
  static readonly WIDTH = 800;
  static readonly HEIGHT = 600;
  static readonly BALL_RADIUS = 8;
  static readonly PEG_RADIUS = 4;
  static readonly PADDING_X = 52;
  static readonly PADDING_TOP = 36;
  static readonly PADDING_BOTTOM = 28;
  static readonly ROW_COUNT = 11; // Fixed number of rows for crash variant
  static readonly PIN_CATEGORY = 0x0001;
  static readonly BALL_CATEGORY = 0x0002;

  private engine: Matter.Engine;
  private render: Matter.Render;
  private runner: Matter.Runner;
  private canvas: HTMLCanvasElement;
  private activeBalls: Map<Matter.Body, number> = new Map();
  private pins: Matter.Body[] = [];
  private walls: Matter.Body[] = [];
  private pinsLastRowXCoords: number[] = [];
  
  // Camera tracking properties
  private cameraY: number = 0;
  private trackedBall: Matter.Body | null = null;
  private isCameraTracking: boolean = false;
  private readonly CAMERA_MIDPOINT = PlinkoEngine.HEIGHT / 2;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.engine = Matter.Engine.create();
    this.render = Matter.Render.create({
      canvas: this.canvas,
      engine: this.engine,
      options: {
        width: PlinkoEngine.WIDTH,
        height: PlinkoEngine.HEIGHT,
        wireframes: false,
        background: 'transparent',
        // Enable bounds debugging to see the viewport
        hasBounds: true,
      },
    });

    // Setup physics world
    this.setupWorld();
    this.placePinsAndWalls();

    // Create runner
    this.runner = Matter.Runner.create();

    // Setup camera update
    Matter.Events.on(this.engine, 'afterUpdate', () => {
      this.updateCamera();
    });
  }

  private get pinDistanceX(): number {
    const lastRowPinCount = 3 + PlinkoEngine.ROW_COUNT - 1;
    return (this.canvas.width - PlinkoEngine.PADDING_X * 2) / (lastRowPinCount - 1);
  }

  private setupWorld() {
    const walls = [
      // Remove bottom wall to allow infinite falling
      Matter.Bodies.rectangle(-50, PlinkoEngine.HEIGHT / 2, 100, PlinkoEngine.HEIGHT, { isStatic: true }), // Left
      Matter.Bodies.rectangle(PlinkoEngine.WIDTH + 50, PlinkoEngine.HEIGHT / 2, 100, PlinkoEngine.HEIGHT, { isStatic: true }), // Right
    ];

    Matter.Composite.add(this.engine.world, walls);
  }

  private placePinsAndWalls() {
    const { PADDING_X, PADDING_TOP, PADDING_BOTTOM, PIN_CATEGORY, BALL_CATEGORY, ROW_COUNT } = PlinkoEngine;

    // Clear existing pins and walls if any
    if (this.pins.length > 0) {
      Matter.Composite.remove(this.engine.world, this.pins);
      this.pins = [];
    }
    if (this.pinsLastRowXCoords.length > 0) {
      this.pinsLastRowXCoords = [];
    }
    if (this.walls.length > 0) {
      Matter.Composite.remove(this.engine.world, this.walls);
      this.walls = [];
    }

    // Place pins in a triangle pattern
    for (let row = 0; row < ROW_COUNT; ++row) {
      const rowY =
        PADDING_TOP +
        ((this.canvas.height - PADDING_TOP - PADDING_BOTTOM) / (ROW_COUNT - 1)) * row;

      const rowPaddingX = PADDING_X + ((ROW_COUNT - 1 - row) * this.pinDistanceX) / 2;

      for (let col = 0; col < 3 + row; ++col) {
        const colX = rowPaddingX + ((this.canvas.width - rowPaddingX * 2) / (3 + row - 1)) * col;
        const pin = Matter.Bodies.circle(colX, rowY, PlinkoEngine.PEG_RADIUS, {
          isStatic: true,
          render: {
            fillStyle: '#ffffff',
          },
          collisionFilter: {
            category: PIN_CATEGORY,
            mask: BALL_CATEGORY,
          },
        });
        this.pins.push(pin);

        if (row === ROW_COUNT - 1) {
          this.pinsLastRowXCoords.push(colX);
        }
      }
    }
    Matter.Composite.add(this.engine.world, this.pins);

    // Add slanted walls to guide balls
    const firstPinX = this.pins[0].position.x;
    const leftWallAngle = Math.atan2(
      firstPinX - this.pinsLastRowXCoords[0],
      this.canvas.height - PADDING_TOP - PADDING_BOTTOM,
    );
    const leftWallX =
      firstPinX - (firstPinX - this.pinsLastRowXCoords[0]) / 2 - this.pinDistanceX * 0.25;

    const leftWall = Matter.Bodies.rectangle(
      leftWallX,
      this.canvas.height / 2,
      10,
      this.canvas.height,
      {
        isStatic: true,
        angle: leftWallAngle,
        render: { visible: false },
      },
    );
    const rightWall = Matter.Bodies.rectangle(
      this.canvas.width - leftWallX,
      this.canvas.height / 2,
      10,
      this.canvas.height,
      {
        isStatic: true,
        angle: -leftWallAngle,
        render: { visible: false },
      },
    );
    this.walls.push(leftWall, rightWall);
    Matter.Composite.add(this.engine.world, this.walls);
  }

  start() {
    Matter.Runner.run(this.runner, this.engine);
    Matter.Render.run(this.render);
  }

  stop() {
    Matter.Runner.stop(this.runner);
    Matter.Render.stop(this.render);
    Matter.Engine.clear(this.engine);
  }

  private updateCamera() {
    if (!this.trackedBall || !this.isCameraTracking) return;

    // Get the ball's vertical position
    const ballY = this.trackedBall.position.y;

    // Calculate the desired camera position to keep the ball centered
    // Remove the max(0, ...) to allow negative values for infinite downward scrolling
    const targetCameraY = ballY - this.CAMERA_MIDPOINT;

    // Update camera position with smooth interpolation
    this.cameraY += (targetCameraY - this.cameraY) * 0.1;

    // Update the render offset - allow infinite downward scrolling
    Matter.Render.lookAt(this.render, {
      min: { x: 0, y: this.cameraY },
      max: { x: PlinkoEngine.WIDTH, y: this.cameraY + PlinkoEngine.HEIGHT }
    });

    // Log camera position for debugging
    console.log('Camera Update:', {
      ballY,
      targetCameraY,
      cameraY: this.cameraY,
      isTracking: this.isCameraTracking
    });

    // Check if ball has fallen too far (optional cleanup)
    if (ballY > 10000) { // Arbitrary large number
      Matter.Composite.remove(this.engine.world, this.trackedBall);
      this.trackedBall = null;
      this.isCameraTracking = false;
    }
  }

  dropBall() {
    const currentBetAmount = get(betAmount);
    const currentBalance = get(balance);

    if (currentBetAmount <= 0 || currentBetAmount > currentBalance) {
      return;
    }

    // Deduct bet amount from balance
    balance.update((b) => b - currentBetAmount);

    // Create ball
    const ball = Matter.Bodies.circle(
      PlinkoEngine.WIDTH / 2,
      PlinkoEngine.BALL_RADIUS,
      PlinkoEngine.BALL_RADIUS,
      {
        restitution: 0.8,
        friction: 0.5,
        frictionAir: 0.038,
        density: 1,
        collisionFilter: {
          category: PlinkoEngine.BALL_CATEGORY,
          mask: PlinkoEngine.PIN_CATEGORY,
        },
        render: {
          fillStyle: '#ff0000',
        },
      }
    );

    // Add ball to world
    Matter.Composite.add(this.engine.world, ball);

    // Set this as the tracked ball and reset camera
    this.trackedBall = ball;
    this.cameraY = 0;
    this.isCameraTracking = false;

    // Track ball and its bet amount
    this.activeBalls.set(ball, currentBetAmount);
    betAmountOfExistingBalls.update((balls) => ({
      ...balls,
      [ball.id]: currentBetAmount,
    }));

    // Setup ball position monitoring
    Matter.Events.on(this.engine, 'afterUpdate', () => {
      if (this.trackedBall === ball) {
        // Start camera tracking when ball passes midpoint
        if (!this.isCameraTracking && ball.position.y > this.CAMERA_MIDPOINT) {
          console.log('Starting camera tracking', {
            ballY: ball.position.y,
            midpoint: this.CAMERA_MIDPOINT
          });
          this.isCameraTracking = true;
        }
      }
    });

    // Check if ball is removed
    Matter.Events.on(this.engine, 'afterUpdate', () => {
      if (this.trackedBall === ball && !this.engine.world.bodies.includes(ball)) {
        this.trackedBall = null;
        this.isCameraTracking = false;
      }
    });
  }
}
