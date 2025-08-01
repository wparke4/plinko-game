import Matter from 'matter-js';
import { betAmount, betAmountOfExistingBalls, balance, winRecords, totalProfitHistory } from '$lib/stores/game';
import { get } from 'svelte/store';

export default class PlinkoEngine {
  static readonly WIDTH = 800;
  static readonly HEIGHT = 600;
  static readonly BALL_RADIUS = 8;
  static readonly PEG_RADIUS = 4;
  static readonly PADDING_X = 35; // Slightly reduced padding to accommodate more pins
  static readonly PADDING_TOP = 80; // Increased from 36 to create more space at top
  static readonly PADDING_BOTTOM = 28;
  static readonly PIN_CATEGORY = 0x0001;
  static readonly BALL_CATEGORY = 0x0002;
  static readonly WALL_CATEGORY = 0x0004;  // New category for walls
  static readonly ROW_HEIGHT = 35; // Reduced from 50 to fit more rows
  static readonly VIEWPORT_BUFFER = 2; // Number of screen heights to keep pins loaded above and below viewport
  static readonly TERMINAL_VELOCITY = 12; // Maximum fall speed for balls
  static readonly PINS_PER_ROW = 21; // Increased from 20 to 21 pins per row
  static readonly READY_BALL_SPEED = 7; // Speed of the ready ball moving side to side

  private engine: Matter.Engine;
  private render: Matter.Render;
  private runner: Matter.Runner;
  private canvas: HTMLCanvasElement;
  private activeBalls: Map<Matter.Body, number> = new Map();
  private pins: Matter.Body[] = [];
  private walls: Matter.Body[] = [];
  private pinsLastRowXCoords: number[] = [];
  private readyBall: Matter.Body | null = null;
  private readyBallDirection: number = 1; // 1 for right, -1 for left
  private keydownHandler: (event: KeyboardEvent) => void;
  
  // Dynamic row management
  private lastGeneratedRowY: number = 0;
  private firstVisibleRowY: number = 0;
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

    // Setup keyboard handler
    this.keydownHandler = (event: KeyboardEvent) => {
      if (event.code === 'Space' && !event.repeat) {
        event.preventDefault(); // Prevent page scrolling
        this.dropBall();
      }
    };

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
    return (this.canvas.width - PlinkoEngine.PADDING_X * 2) / (PlinkoEngine.PINS_PER_ROW - 1);
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
    // Clear existing pins and walls if any
    this.clearExistingPins();

    // Start generating rows right from the top
    this.firstVisibleRowY = PlinkoEngine.PADDING_TOP;
    this.lastGeneratedRowY = PlinkoEngine.PADDING_TOP;

    // Generate initial set of rows to fill the viewport
    this.manageDynamicRows();
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
    const { PADDING_X, PIN_CATEGORY, BALL_CATEGORY, PINS_PER_ROW } = PlinkoEngine;
    const rowPins: Matter.Body[] = [];
    
    // Calculate the base X positions using fixed spacing
    const pinSpacing = (this.canvas.width - PADDING_X * 2) / (PINS_PER_ROW - 1);
    
    // For offset rows, we'll create one less pin and shift everything right by half spacing
    const effectivePinCount = isOffset ? PINS_PER_ROW - 1 : PINS_PER_ROW;
    
    for (let col = 0; col < effectivePinCount; ++col) {
      let colX = PADDING_X + (pinSpacing * col);
      
      // Apply offset for alternating rows
      if (isOffset) {
        colX += pinSpacing / 2;
      }

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
    }
    
    this.rowPinPositions.set(rowY, rowPins);
    Matter.Composite.add(this.engine.world, rowPins);
  }

  start() {
    Matter.Runner.run(this.runner, this.engine);
    Matter.Render.run(this.render);
    this.createReadyBall();

    // Add event listener for ready ball movement
    Matter.Events.on(this.engine, 'beforeUpdate', () => {
      this.updateReadyBall();
    });

    // Add keyboard event listener
    window.addEventListener('keydown', this.keydownHandler);
  }

  stop() {
    Matter.Runner.stop(this.runner);
    Matter.Render.stop(this.render);
    Matter.Engine.clear(this.engine);
    
    // Remove keyboard event listener
    window.removeEventListener('keydown', this.keydownHandler);
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
          this.createRowOfPins(nextRowY, PlinkoEngine.PINS_PER_ROW, isOffset);
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

  private createReadyBall() {
    if (this.readyBall) {
      Matter.Composite.remove(this.engine.world, this.readyBall);
    }

    this.readyBall = Matter.Bodies.circle(
      PlinkoEngine.WIDTH / 2,
      PlinkoEngine.PADDING_TOP - 20, // Position ball 20 units above the first row of pegs
      PlinkoEngine.BALL_RADIUS,
      {
        isStatic: true, // Make it static so it doesn't fall
        render: {
          fillStyle: '#ff0000',
        },
        collisionFilter: {
          category: PlinkoEngine.BALL_CATEGORY,
          mask: 0, // No collisions while in ready state
        },
      }
    );

    Matter.Composite.add(this.engine.world, this.readyBall);
  }

  private updateReadyBall() {
    if (!this.readyBall) return;

    const currentX = this.readyBall.position.x;
    
    // Change direction if reaching bounds
    if (currentX >= PlinkoEngine.WIDTH - PlinkoEngine.PADDING_X) {
      this.readyBallDirection = -1;
    } else if (currentX <= PlinkoEngine.PADDING_X) {
      this.readyBallDirection = 1;
    }

    // Move the ball
    Matter.Body.setPosition(this.readyBall, {
      x: currentX + (PlinkoEngine.READY_BALL_SPEED * this.readyBallDirection),
      y: this.readyBall.position.y
    });
  }

  dropBall() {
    const currentBetAmount = get(betAmount);
    const currentBalance = get(balance);

    if (currentBetAmount <= 0 || currentBetAmount > currentBalance || !this.readyBall) {
      return;
    }

    // Deduct bet amount from balance
    balance.update((b) => b - currentBetAmount);

    // Create ball at ready ball's position
    const startX = this.readyBall.position.x;
    const ball = Matter.Bodies.circle(
      startX,
      PlinkoEngine.BALL_RADIUS,
      PlinkoEngine.BALL_RADIUS,
      {
        restitution: 0.8,
        friction: 0.5,
        frictionAir: 0.038,
        density: 0.8,
        collisionFilter: {
          category: PlinkoEngine.BALL_CATEGORY,
          mask: PlinkoEngine.PIN_CATEGORY | PlinkoEngine.WALL_CATEGORY,
        },
        render: {
          fillStyle: '#ff0000',
        },
      }
    );

    // Remove the ready ball
    Matter.Composite.remove(this.engine.world, this.readyBall);
    
    // Add ball to world
    Matter.Composite.add(this.engine.world, ball);

    // Set this as the tracked ball and reset camera
    this.trackedBall = ball;
    this.cameraY = 0;
    this.highestCameraY = 0;
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
        // Create a new ready ball for the next game
        this.createReadyBall();
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
