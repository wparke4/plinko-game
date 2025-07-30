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
      },
    });

    // Setup physics world
    this.setupWorld();
    this.placePinsAndWalls();

    // Create runner
    this.runner = Matter.Runner.create();
  }

  private get pinDistanceX(): number {
    const lastRowPinCount = 3 + PlinkoEngine.ROW_COUNT - 1;
    return (this.canvas.width - PlinkoEngine.PADDING_X * 2) / (lastRowPinCount - 1);
  }

  private setupWorld() {
    const walls = [
      Matter.Bodies.rectangle(PlinkoEngine.WIDTH / 2, PlinkoEngine.HEIGHT + 50, PlinkoEngine.WIDTH, 100, { isStatic: true }), // Bottom
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

    // Track ball and its bet amount
    this.activeBalls.set(ball, currentBetAmount);
    betAmountOfExistingBalls.update((balls) => ({
      ...balls,
      [ball.id]: currentBetAmount,
    }));

    // Setup collision handling
    Matter.Events.on(this.engine, 'collisionStart', (event) => {
      event.pairs.forEach((pair) => {
        const { bodyA, bodyB } = pair;
        if (bodyA === ball || bodyB === ball) {
          // Handle collision logic for crash variant
          // This is where you'd implement the specific crash game mechanics
        }
      });
    });
  }
}
