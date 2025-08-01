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
  static readonly INITIAL_ROW_COUNT = 11; // Initial rows for triangle pattern
  static readonly PIN_CATEGORY = 0x0001;
  static readonly BALL_CATEGORY = 0x0002;
  static readonly WALL_CATEGORY = 0x0004;  // New category for walls
  static readonly ROW_HEIGHT = 50; // Height between rows
  static readonly VIEWPORT_BUFFER = 2; // Number of screen heights to keep pins loaded above and below viewport
  static readonly TERMINAL_VELOCITY = 8; // Maximum fall speed for balls

  private engine: Matter.Engine;
  private render: Matter.Render;
  private runner: Matter.Runner;
  private canvas: HTMLCanvasElement;
  private activeBalls: Map<Matter.Body, number> = new Map();
  private pins: Matter.Body[] = [];
  private walls: Matter.Body[] = [];
  private pinsLastRowXCoords: number[] = [];
  
  // Dynamic row management
  private lastGeneratedRowY: number = 0;
  private firstVisibleRowY: number = 0;
  private lastRowPinCount: number = 0;
  private rowPinPositions: Map<number, Matter.Body[]> = new Map(); // Y position to pins mapping
  
  // Camera tracking properties
  private cameraY: number = 0;
  private highestCameraY: number = 0; // Track the highest (smallest) Y position
  private trackedBall: Matter.Body | null = null;
  private isCameraTracking: boolean = false;
  private readonly CAMERA_MIDPOINT = PlinkoEngine.HEIGHT / 2;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.engine = Matter.Engine.create({
      gravity: {
        x: 0,
        y: 1, // Use default Matter.js gravity
        scale: 0.001
      }
    });
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

    // Setup camera update and velocity limiting
    Matter.Events.on(this.engine, 'afterUpdate', () => {
      this.updateCamera();
      this.limitBallVelocities();
      this.handleBallWrapping();
    });
  }

  private get pinDistanceX(): number {
    const lastRowPinCount = 3 + PlinkoEngine.INITIAL_ROW_COUNT - 1;
    return (this.canvas.width - PlinkoEngine.PADDING_X * 2) / (lastRowPinCount - 1);
  }

  private setupWorld() {
    // No walls needed for wrapping behavior
  }

  private handleBallWrapping() {
    const bodies = Matter.Composite.allBodies(this.engine.world);
    for (const body of bodies) {
      // Only wrap ball positions
      if (body.collisionFilter.category === PlinkoEngine.BALL_CATEGORY) {
        const position = body.position;
        
        // Check if ball has gone off either side
        if (position.x < 0) {
          // Wrap to right side
          Matter.Body.setPosition(body, {
            x: PlinkoEngine.WIDTH,
            y: position.y
          });
        } else if (position.x > PlinkoEngine.WIDTH) {
          // Wrap to left side
          Matter.Body.setPosition(body, {
            x: 0,
            y: position.y
          });
        }
      }
    }
  }

  private placePinsAndWalls() {
    const { PADDING_X, PADDING_TOP, PADDING_BOTTOM, PIN_CATEGORY, BALL_CATEGORY, INITIAL_ROW_COUNT } = PlinkoEngine;

    // Clear existing pins and walls if any
    this.clearExistingPins();

    // Place initial triangle pattern exactly as before
    for (let row = 0; row < INITIAL_ROW_COUNT; ++row) {
      const rowY =
        PADDING_TOP +
        ((this.canvas.height - PADDING_TOP - PADDING_BOTTOM) / (INITIAL_ROW_COUNT - 1)) * row;

      const rowPaddingX = PADDING_X + ((INITIAL_ROW_COUNT - 1 - row) * this.pinDistanceX) / 2;
      const pinCount = 3 + row;
      const rowPins: Matter.Body[] = [];

      for (let col = 0; col < pinCount; ++col) {
        const colX = rowPaddingX + ((this.canvas.width - rowPaddingX * 2) / (pinCount - 1)) * col;
        const pin = Matter.Bodies.circle(colX, rowY, PlinkoEngine.PEG_RADIUS, {
          isStatic: true,
          restitution: 0.8 + (Math.random() - 0.5) * 0.1, // Add slight randomness to pin bounciness
          friction: 0.3 + (Math.random() - 0.5) * 0.1, // Add slight randomness to pin friction
          render: {
            fillStyle: '#ffffff',
          },
          collisionFilter: {
            category: PIN_CATEGORY,
            mask: BALL_CATEGORY,
          },
        });
        
        this.pins.push(pin);
        rowPins.push(pin);
        
        if (row === INITIAL_ROW_COUNT - 1) {
          this.pinsLastRowXCoords.push(colX);
          this.lastRowPinCount = pinCount;
        }
      }
      
      this.rowPinPositions.set(rowY, rowPins);
      Matter.Composite.add(this.engine.world, rowPins);
    }

    // Set the last generated row position to the last row of the initial triangle
    const lastInitialRowY = PADDING_TOP + ((this.canvas.height - PADDING_TOP - PADDING_BOTTOM) / (INITIAL_ROW_COUNT - 1)) * (INITIAL_ROW_COUNT - 1);
    this.lastGeneratedRowY = lastInitialRowY;
    this.firstVisibleRowY = PADDING_TOP;
  }

  private clearExistingPins() {
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
    this.rowPinPositions.clear();
  }

    private createRowOfPins(rowY: number, pinCount: number, isOffset: boolean = false) {
    const { PADDING_X, PIN_CATEGORY, BALL_CATEGORY } = PlinkoEngine;
    const rowPins: Matter.Body[] = [];
    
    // Calculate the base X positions - use the same spacing as the initial triangle
    const pinSpacing = (this.canvas.width - PADDING_X * 2) / (this.lastRowPinCount - 1);
    
    // Calculate how many pins we need for consistent density
    const effectivePinCount = this.lastRowPinCount;
    
    for (let col = 0; col < effectivePinCount; ++col) {
      let colX = PADDING_X + (pinSpacing * col);
      
      // Apply offset for alternating rows
      if (isOffset) {
        colX += pinSpacing / 2;
      }
      
      // Skip first and last pins on offset rows to maintain consistent pattern
      if (isOffset && (col === 0 || col === effectivePinCount - 1)) {
        continue;
      }

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
      rowPins.push(pin);
    }
    
    this.rowPinPositions.set(rowY, rowPins);
    Matter.Composite.add(this.engine.world, rowPins);
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
    const targetCameraY = ballY - this.CAMERA_MIDPOINT;

    // Update camera position with smooth interpolation, but never go above highestCameraY
    const newCameraY = Math.max(
      this.highestCameraY,
      this.cameraY + (targetCameraY - this.cameraY) * 0.1
    );
    
    // Update both camera position and highest point
    this.cameraY = newCameraY;
    this.highestCameraY = newCameraY;

    // Update the render offset - allow infinite downward scrolling
    Matter.Render.lookAt(this.render, {
      min: { x: 0, y: this.cameraY },
      max: { x: PlinkoEngine.WIDTH, y: this.cameraY + PlinkoEngine.HEIGHT }
    });

    // Generate new rows and clean up old ones
    this.manageDynamicRows();

    // Check if ball has fallen too far (optional cleanup)
    if (ballY > 10000) { // Arbitrary large number
      Matter.Composite.remove(this.engine.world, this.trackedBall);
      this.trackedBall = null;
      this.isCameraTracking = false;
    }
  }

  private manageDynamicRows() {
    const { ROW_HEIGHT, HEIGHT, VIEWPORT_BUFFER } = PlinkoEngine;
    
    // Calculate viewport boundaries with buffer
    const viewportTop = this.cameraY - (HEIGHT * VIEWPORT_BUFFER);
    const viewportBottom = this.cameraY + HEIGHT + (HEIGHT * VIEWPORT_BUFFER);

    // Generate new rows if needed
    if (this.cameraY > this.lastGeneratedRowY - HEIGHT) {
      let nextRowY = this.lastGeneratedRowY + ROW_HEIGHT;
      
      while (nextRowY <= viewportBottom) {
        if (!this.rowPinPositions.has(nextRowY)) {
          const rowIndex = Math.floor((nextRowY - this.firstVisibleRowY) / ROW_HEIGHT);
          const isOffset = rowIndex % 2 === 1;
          
          // Use the same pin count as the last row of the initial triangle
          this.createRowOfPins(nextRowY, this.lastRowPinCount, isOffset);
        }
        nextRowY += ROW_HEIGHT;
      }
      this.lastGeneratedRowY = Math.max(this.lastGeneratedRowY, nextRowY - ROW_HEIGHT);
    }
    
    // Clean up rows that are out of view
    for (const [rowY, rowPins] of this.rowPinPositions.entries()) {
      if (rowY < viewportTop || rowY > viewportBottom) {
        Matter.Composite.remove(this.engine.world, rowPins);
        this.pins = this.pins.filter(pin => !rowPins.includes(pin));
        this.rowPinPositions.delete(rowY);
        
        if (this.rowPinPositions.size > 0) {
          this.firstVisibleRowY = Math.min(...this.rowPinPositions.keys());
        }
      }
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
        friction: 0.5, // Match original game's friction
        frictionAir: 0.038, // Use similar air friction to original game's 8-row setting
        density: 0.8, // Slightly reduce density to make it less heavy
        collisionFilter: {
          category: PlinkoEngine.BALL_CATEGORY,
          mask: PlinkoEngine.PIN_CATEGORY | PlinkoEngine.WALL_CATEGORY,
        },
        render: {
          fillStyle: '#ff0000',
        },
      }
    );

    // Add random initial velocity with more controlled range like original
    const randomVelocity = {
      x: (Math.random() - 0.5) * 2,  // Reduced from 6 to 2 like original
      y: 0
    };
    Matter.Body.setVelocity(ball, randomVelocity);

    // Add ball to world
    Matter.Composite.add(this.engine.world, ball);

    // Set this as the tracked ball and reset camera
    this.trackedBall = ball;
    this.cameraY = 0;
    this.highestCameraY = 0; // Reset highest camera position for new ball
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

  private limitBallVelocities() {
    const bodies = Matter.Composite.allBodies(this.engine.world);
    for (const body of bodies) {
      // Only limit ball velocities
      if (body.collisionFilter.category === PlinkoEngine.BALL_CATEGORY) {
        const velocity = body.velocity;
        
        // Limit vertical velocity to terminal velocity
        if (Math.abs(velocity.y) > PlinkoEngine.TERMINAL_VELOCITY) {
          const sign = velocity.y > 0 ? 1 : -1;
          Matter.Body.setVelocity(body, {
            x: velocity.x,
            y: sign * PlinkoEngine.TERMINAL_VELOCITY
          });
        }
      }
    }
  }
}
