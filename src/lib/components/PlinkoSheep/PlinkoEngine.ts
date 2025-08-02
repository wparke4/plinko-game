import Matter from 'matter-js';
import { betAmount, betAmountOfExistingBalls, balance, winRecords, totalProfitHistory, currentMultiplier, isMultiplierFlashing } from '$lib/stores/game';
import { RiskLevel, type RowCount } from '$lib/types';
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
  static readonly DEATH_PASSAGE_CATEGORY = 0x0008;  // New category for death passages
  static readonly EXPLOSION_CATEGORY = 0x0010;  // New category for explosion particles
  static readonly ROW_HEIGHT = 35; // Reduced from 50 to fit more rows
  static readonly VIEWPORT_BUFFER = 2; // Number of screen heights to keep pins loaded above and below viewport
  static readonly TERMINAL_VELOCITY = 12; // Maximum fall speed for balls
  static readonly PINS_PER_ROW = 23; // Increased from 21 to 22 pins per row
  static readonly READY_BALL_SPEED = 7; // Speed of the ready ball moving side to side
  static readonly DEATH_PASSAGE_WIDTH = 25; // Width of the horizontal death passage laser
  static readonly DEATH_PASSAGE_HEIGHT = 8; // Height of the horizontal death passage laser

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
  
  // Death passage management
  private deathPassages: Matter.Body[] = [];
  private rowDeathPassages: Map<number, Matter.Body> = new Map(); // Y position to death passage mapping
  
  // Death passage visibility management
  private revealedRows: Set<number> = new Set(); // Track which rows have been revealed
  private flashingRows: Map<number, { startTime: number, duration: number }> = new Map(); // Track flashing animations
  private lastPlayerRowY: number = 0; // Track the last row the player was at
  private killerDeathPassage: Matter.Body | null = null; // Track which death passage killed the player
  
  // Camera tracking properties
  private cameraY: number = 0;
  private highestCameraY: number = 0; // Track the highest (smallest) Y position
  private trackedBall: Matter.Body | null = null;
  private isCameraTracking: boolean = false;
  private readonly CAMERA_MIDPOINT = PlinkoEngine.HEIGHT / 2;
  private currentMultiplier: number = 0;
  private startingRowY: number | null = null;

  // Explosion properties
  private explosionParticles: Matter.Body[] = [];
  private isGameDead: boolean = false;
  private explosionStartTime: number = 0;
  private explosionDuration: number = 3000; // 3 seconds

  // Cash out celebration properties
  private isCashOutCelebrating: boolean = false;
  private celebrationStartTime: number = 0;
  private celebrationDuration: number = 2000; // 2 seconds
  private celebratingBall: Matter.Body | null = null;
  private isCashOutComplete: boolean = false; // New state for when celebration is done but game not reset

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
        
        // If cash out is complete/celebrating OR game is dead, reset for new game
        if (this.isCashOutComplete || this.isCashOutCelebrating || this.isGameDead) {
          this.resetGame();
        }
        // If game is in progress, cash out. Otherwise, drop a ball.
        else if (this.isGameInProgress()) {
          this.cashOut();
        } else {
          this.dropBall();
        }
      }
    };

    // Setup physics world
    this.setupWorld();
    this.placePinsAndWalls();

    // Create runner
    this.runner = Matter.Runner.create();

    // Setup camera update and velocity limiting
    Matter.Events.on(this.engine, 'beforeUpdate', () => {
      console.log('Engine update tick');
      this.updateCamera();
      this.limitBallVelocities();
      this.handleBallWrapping();
      this.updateExplosionParticles();
      this.updateCashOutCelebration();
      this.updateFlashAnimations();
    });

    // Setup collision detection for death passages
    Matter.Events.on(this.engine, 'collisionStart', (event) => {
      this.handleDeathPassageCollision(event);
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
    if (this.deathPassages.length > 0) {
      Matter.Composite.remove(this.engine.world, this.deathPassages);
      this.deathPassages = [];
    }
    this.rowPinPositions.clear();
    this.rowDeathPassages.clear();
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
    
    // Create death passage for this row
    this.createDeathPassage(rowY, isOffset);
  }

  private createDeathPassage(rowY: number, isOffset: boolean) {
    const { PADDING_X, PINS_PER_ROW, DEATH_PASSAGE_CATEGORY, BALL_CATEGORY, DEATH_PASSAGE_WIDTH, DEATH_PASSAGE_HEIGHT, PEG_RADIUS } = PlinkoEngine;
    
    // Calculate pin spacing
    const pinSpacing = (this.canvas.width - PADDING_X * 2) / (PINS_PER_ROW - 1);
    
    // Calculate number of passages (spaces between pins)
    const numPassages = isOffset ? PINS_PER_ROW - 2 : PINS_PER_ROW - 1;
    
    // Randomly select a passage index
    const deathPassageIndex = Math.floor(Math.random() * numPassages);
    
    // Calculate the X position of the death passage
    let passageX: number;
    if (isOffset) {
      // For offset rows, passages are between offset pins
      passageX = PADDING_X + (pinSpacing / 2) + (deathPassageIndex * pinSpacing) + (pinSpacing / 2);
    } else {
      // For normal rows, passages are between regular pins
      passageX = PADDING_X + (deathPassageIndex * pinSpacing) + (pinSpacing / 2);
    }
    
    // Create the death passage body (horizontal laser) - initially invisible
    const deathPassage = Matter.Bodies.rectangle(
      passageX,
      rowY,
      DEATH_PASSAGE_WIDTH,
      DEATH_PASSAGE_HEIGHT,
      {
        isStatic: true,
        isSensor: true, // Make it a sensor so balls pass through but we can detect collision
        render: {
          fillStyle: 'transparent', // Start invisible
          strokeStyle: 'transparent',
          lineWidth: 0,
        },
        collisionFilter: {
          category: DEATH_PASSAGE_CATEGORY,
          mask: BALL_CATEGORY,
        },
      }
    );
    
    this.deathPassages.push(deathPassage);
    this.rowDeathPassages.set(rowY, deathPassage);
    Matter.Composite.add(this.engine.world, deathPassage);
  }

  private createExplosion(x: number, y: number) {
    console.log('Creating explosion at:', { x, y });
    
    this.isGameDead = true;
    this.explosionStartTime = Date.now();
    
    // Clear any existing explosion particles
    if (this.explosionParticles.length > 0) {
      Matter.Composite.remove(this.engine.world, this.explosionParticles);
      this.explosionParticles = [];
    }
    
    // Create multiple waves of explosion particles
    const particleCount = 50; // Total number of particles
    const colors = ['#ff0000', '#ff4400', '#ff8800', '#ffaa00', '#ffff00', '#ffffff'];
    
    for (let i = 0; i < particleCount; i++) {
      // Create particles with random angles and speeds
      const angle = (Math.PI * 2 * i) / particleCount + (Math.random() - 0.5) * 0.5;
      const speed = 8 + Math.random() * 12; // Random speed between 8-20
      const size = 3 + Math.random() * 8; // Random size between 3-11
      
      const particle = Matter.Bodies.circle(x, y, size, {
        frictionAir: 0.02, // Low air friction so particles travel far
        restitution: 0.8,
        density: 0.001, // Very light particles
        render: {
          fillStyle: colors[Math.floor(Math.random() * colors.length)],
          strokeStyle: '#ffffff',
          lineWidth: 1,
        },
        collisionFilter: {
          category: PlinkoEngine.EXPLOSION_CATEGORY,
          mask: PlinkoEngine.PIN_CATEGORY | PlinkoEngine.WALL_CATEGORY, // Can collide with pins and walls
        },
      });
      
      // Set initial velocity in explosion direction
      const velocityX = Math.cos(angle) * speed;
      const velocityY = Math.sin(angle) * speed;
      Matter.Body.setVelocity(particle, { x: velocityX, y: velocityY });
      
      this.explosionParticles.push(particle);
    }
    
    // Add all particles to the world
    Matter.Composite.add(this.engine.world, this.explosionParticles);
    
    // Add screen shake effect by updating camera bounds rapidly
    this.startScreenShake();
  }

  private startScreenShake() {
    const shakeIntensity = 15;
    const shakeDuration = 1000; // 1 second
    const startTime = Date.now();
    
    const shakeInterval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const progress = elapsed / shakeDuration;
      
      if (progress >= 1 || !this.isGameDead) {
        clearInterval(shakeInterval);
        return;
      }
      
      // Reduce shake intensity over time
      const currentIntensity = shakeIntensity * (1 - progress);
      const offsetX = (Math.random() - 0.5) * currentIntensity;
      const offsetY = (Math.random() - 0.5) * currentIntensity;
      
      // Apply shake to camera bounds
      Matter.Render.lookAt(this.render, {
        min: { x: offsetX, y: this.cameraY + offsetY },
        max: { x: PlinkoEngine.WIDTH + offsetX, y: this.cameraY + PlinkoEngine.HEIGHT + offsetY }
      });
    }, 16); // ~60fps
  }

  private updateExplosionParticles() {
    if (!this.isGameDead || this.explosionParticles.length === 0) {
      return;
    }
    
    const elapsed = Date.now() - this.explosionStartTime;
    const progress = elapsed / this.explosionDuration;
    
    // Update particle appearance based on time (fade out)
    for (const particle of this.explosionParticles) {
      if (particle.render && particle.render.fillStyle) {
        const alpha = Math.max(0, 1 - progress);
        const baseColor = particle.render.fillStyle as string;
        
        // Extract RGB from hex color and add alpha
        if (baseColor.startsWith('#')) {
          const r = parseInt(baseColor.substr(1, 2), 16);
          const g = parseInt(baseColor.substr(3, 2), 16);
          const b = parseInt(baseColor.substr(5, 2), 16);
          particle.render.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
        }
      }
    }
    
    // Remove explosion particles after duration
    if (progress >= 1) {
      Matter.Composite.remove(this.engine.world, this.explosionParticles);
      this.explosionParticles = [];
    }
  }

  private checkForNewRowReached(ballY: number) {
    if (!this.startingRowY) return;
    
    // Calculate which row the ball is currently at
    const currentRowIndex = Math.floor((ballY - this.startingRowY) / PlinkoEngine.ROW_HEIGHT);
    const currentRowY = this.startingRowY + (currentRowIndex * PlinkoEngine.ROW_HEIGHT);
    
    // Check if this is a new row that hasn't been revealed yet
    if (currentRowIndex >= 0 && !this.revealedRows.has(currentRowY) && currentRowY !== this.lastPlayerRowY) {
      this.revealedRows.add(currentRowY);
      this.lastPlayerRowY = currentRowY;
      
      // Start flash animation for this row
      this.startFlashAnimation(currentRowY);
      
      console.log('New row reached:', {
        ballY,
        currentRowIndex,
        currentRowY,
        startingRowY: this.startingRowY
      });
    }
  }

  private startFlashAnimation(rowY: number) {
    const flashDuration = 1500; // 1.5 seconds flash animation
    const currentTime = Date.now();
    
    this.flashingRows.set(rowY, {
      startTime: currentTime,
      duration: flashDuration
    });
    
    console.log('Starting flash animation for row:', rowY);
  }

  private updateFlashAnimations() {
    const currentTime = Date.now();
    
    // Handle killer death passage flashing during death state
    if (this.isGameDead && this.killerDeathPassage) {
      this.updateKillerDeathPassageFlash(currentTime);
    }
    
    for (const [rowY, flashData] of this.flashingRows.entries()) {
      const elapsed = currentTime - flashData.startTime;
      const progress = elapsed / flashData.duration;
      
      if (progress >= 1) {
        // Animation complete - remove from flashing rows and show final state
        this.flashingRows.delete(rowY);
        this.setDeathPassageFinalVisibility(rowY);
      } else {
        // Update flash animation
        this.updateFlashVisibility(rowY, progress);
      }
    }
  }

  private updateFlashVisibility(rowY: number, progress: number) {
    const deathPassage = this.rowDeathPassages.get(rowY);
    if (!deathPassage || !deathPassage.render) return;
    
    // Create pulsing flash effect with multiple cycles
    const flashCycles = 4; // Number of flash cycles during the animation
    const cycleProgress = (progress * flashCycles) % 1;
    const flashIntensity = Math.sin(cycleProgress * Math.PI * 2) * 0.5 + 0.5; // Oscillate between 0 and 1
    
    // Start with white flash and transition to red
    let red, green, blue, alpha;
    
    if (progress < 0.3) {
      // Initial bright white flash
      red = 255;
      green = 255;
      blue = 255;
      alpha = flashIntensity * 0.9;
    } else if (progress < 0.7) {
      // Transition to red
      const transitionProgress = (progress - 0.3) / 0.4;
      red = 255;
      green = Math.floor(255 * (1 - transitionProgress));
      blue = Math.floor(255 * (1 - transitionProgress));
      alpha = flashIntensity * 0.8;
    } else {
      // Final red flash before revealing
      red = 255;
      green = Math.floor(68 * flashIntensity); // Dim red
      blue = Math.floor(68 * flashIntensity);
      alpha = flashIntensity * 0.7;
    }
    
    deathPassage.render.fillStyle = `rgba(${red}, ${green}, ${blue}, ${alpha})`;
    deathPassage.render.strokeStyle = `rgba(${Math.min(255, red + 50)}, ${Math.min(255, green + 50)}, ${Math.min(255, blue + 50)}, ${alpha})`;
    deathPassage.render.lineWidth = 3;
  }

  private setDeathPassageFinalVisibility(rowY: number) {
    const deathPassage = this.rowDeathPassages.get(rowY);
    if (!deathPassage || !deathPassage.render) return;
    
    // Set final visible state - bright neon red
    deathPassage.render.fillStyle = '#ff0044';
    deathPassage.render.strokeStyle = '#ff6666';
    deathPassage.render.lineWidth = 3;
    
    console.log('Death passage revealed for row:', rowY);
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

    // Check if player has reached a new row and trigger flash animation
    this.checkForNewRowReached(ballY);

    // Update multiplier based on rows passed
    if (this.startingRowY !== null) {
      const rowsPassed = Math.floor((ballY - this.startingRowY) / PlinkoEngine.ROW_HEIGHT);
      const newMultiplier = Math.max(1.0, Math.pow(1.04, rowsPassed)); // Start at 1.0x, increase by 4% each row
      
      // Only update if the multiplier has changed
      if (newMultiplier !== this.currentMultiplier) {
        this.currentMultiplier = newMultiplier;
        currentMultiplier.set(this.currentMultiplier); // Update the store for reactivity
        console.log('Multiplier Update:', {
          ballY,
          startingRowY: this.startingRowY,
          rowsPassed,
          newMultiplier: this.currentMultiplier
        });
      }
    }

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
      // Reset multiplier when ball goes too far
      this.currentMultiplier = 1.0;
      currentMultiplier.set(this.currentMultiplier);
      
      // Reset revelation tracking
      this.revealedRows.clear();
      this.flashingRows.clear();
      this.lastPlayerRowY = 0;
      this.killerDeathPassage = null;
      
      // Hide all death passages again
      this.hideAllDeathPassages();
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
        
        // Also clean up death passage for this row
        const deathPassage = this.rowDeathPassages.get(rowY);
        if (deathPassage) {
          Matter.Composite.remove(this.engine.world, deathPassage);
          this.deathPassages = this.deathPassages.filter(dp => dp !== deathPassage);
          this.rowDeathPassages.delete(rowY);
        }
        
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

    // Prevent dropping balls if game is dead - player must reset first
    if (this.isGameDead) {
      console.log('Game is dead! Please reset the game first.');
      return;
    }

    // Prevent dropping another ball if game is already in progress
    if (this.isGameInProgress()) {
      console.log('Game already in progress, cannot drop another ball');
      return;
    }

    if (currentBetAmount <= 0 || currentBetAmount > currentBalance || !this.readyBall) {
      return;
    }

    console.log('Dropping ball...');

    // Reset multiplier and set starting row
    this.currentMultiplier = 1.0;
    currentMultiplier.set(this.currentMultiplier); // Update the store
    this.startingRowY = PlinkoEngine.PADDING_TOP; // Set to first row of pins instead of ready ball position
    console.log('Starting row Y set to:', this.startingRowY);

    // Reset revelation tracking for new game
    this.revealedRows.clear();
    this.flashingRows.clear();
    this.lastPlayerRowY = 0;
    this.killerDeathPassage = null;

    // Deduct bet amount from balance
    balance.update((b) => b - currentBetAmount);

    // Create ball at ready ball's position
    const startX = this.readyBall.position.x;
    const startY = this.readyBall.position.y;  // Use ready ball's Y position
    const ball = Matter.Bodies.circle(
      startX,
      startY,  // Start at the same Y as ready ball
      PlinkoEngine.BALL_RADIUS,
      {
        restitution: 0.8,
        friction: 0.5,
        frictionAir: 0.038,
        density: 0.8,
        collisionFilter: {
          category: PlinkoEngine.BALL_CATEGORY,
          mask: PlinkoEngine.PIN_CATEGORY | PlinkoEngine.WALL_CATEGORY | PlinkoEngine.DEATH_PASSAGE_CATEGORY,
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
    this.isCameraTracking = true;  // Start tracking immediately
    console.log('Camera tracking enabled:', { 
      trackedBall: !!this.trackedBall,
      isCameraTracking: this.isCameraTracking,
      ballPosition: ball.position
    });

    // Track ball and its bet amount
    this.activeBalls.set(ball, currentBetAmount);
    betAmountOfExistingBalls.update((balls) => ({
      ...balls,
      [ball.id]: currentBetAmount,
    }));

    // Check if ball is removed
    Matter.Events.on(this.engine, 'afterUpdate', () => {
      if (this.trackedBall === ball && !this.engine.world.bodies.includes(ball)) {
        this.trackedBall = null;
        this.isCameraTracking = false;
        // Reset multiplier when game ends
        this.currentMultiplier = 1.0;
        currentMultiplier.set(this.currentMultiplier);
        
        // Reset revelation tracking
        this.revealedRows.clear();
        this.flashingRows.clear();
        this.lastPlayerRowY = 0;
        this.killerDeathPassage = null;
        
        // Hide all death passages again
        this.hideAllDeathPassages();
        
        // Create a new ready ball for the next game
        this.createReadyBall();
      }
    });
  }

  cashOut() {
    // Prevent cashing out if game is dead
    if (this.isGameDead) {
      console.log('Game is dead! Please reset the game first.');
      return;
    }

    if (!this.isGameInProgress() || !this.trackedBall) {
      console.log('No game in progress, cannot cash out');
      return;
    }

    console.log('Cashing out...');

    // Get the bet amount for this ball
    const ballBetAmount = this.activeBalls.get(this.trackedBall);
    if (!ballBetAmount) {
      console.log('Could not find bet amount for this ball');
      return;
    }

    // Calculate winnings
    const displayedMultiplier = parseFloat(this.currentMultiplier.toFixed(2)); // Format to match UI display
    const winAmount = ballBetAmount * displayedMultiplier;
    const profit = winAmount - ballBetAmount;

    console.log('Cash out details:', {
      betAmount: ballBetAmount,
      multiplier: displayedMultiplier,
      winAmount,
      profit
    });

    // Update balance with winnings
    balance.update((b) => b + winAmount);

    // Add to win records
    winRecords.update((records) => [
      {
        id: Date.now().toString(), // Convert to string as expected by WinRecord type
        betAmount: ballBetAmount,
        rowCount: 16 as RowCount, // Use a default row count for crash mode
        riskLevel: RiskLevel.MEDIUM, // Use default risk level for crash mode
        binIndex: -1, // Use -1 to indicate this is a crash mode cash out (no bins)
        payout: {
          multiplier: displayedMultiplier, // Use the formatted multiplier
          value: winAmount,
        },
        profit,
      },
      ...records.slice(0, 9), // Keep only last 10 records
    ]);

    // Update profit history - just add the profit number
    totalProfitHistory.update((history) => {
      const newTotal = (history[history.length - 1] || 0) + profit;
      return [...history, newTotal];
    });

    // Set celebration state
    this.isCashOutCelebrating = true;
    this.celebrationStartTime = Date.now();
    this.celebratingBall = this.trackedBall; // Celebrate the ball that just won
    
    // Freeze the ball immediately by making it static
    if (this.celebratingBall) {
      Matter.Body.setStatic(this.celebratingBall, true);
      // Also zero out any velocity to ensure it stops completely
      Matter.Body.setVelocity(this.celebratingBall, { x: 0, y: 0 });
    }
    
    // Stop camera tracking immediately - game is paused during celebration
    this.isCameraTracking = false;
    
    // Reveal all visible death passages in grayed out state
    this.revealAllDeathPassagesGrayed();
    
    // Start multiplier flashing for UI feedback
    isMultiplierFlashing.set(true);

    console.log('Cash out celebration started - ball frozen in place.');
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

  private handleDeathPassageCollision(event: Matter.IEventCollision<Matter.Engine>) {
    const pairs = event.pairs;
    
    for (const pair of pairs) {
      const { bodyA, bodyB } = pair;
      
      // Check if one body is a ball and the other is a death passage
      let ball: Matter.Body | null = null;
      let deathPassage: Matter.Body | null = null;
      
      if (bodyA.collisionFilter.category === PlinkoEngine.BALL_CATEGORY && 
          bodyB.collisionFilter.category === PlinkoEngine.DEATH_PASSAGE_CATEGORY) {
        ball = bodyA;
        deathPassage = bodyB;
      } else if (bodyB.collisionFilter.category === PlinkoEngine.BALL_CATEGORY && 
                 bodyA.collisionFilter.category === PlinkoEngine.DEATH_PASSAGE_CATEGORY) {
        ball = bodyB;
        deathPassage = bodyA;
      }
      
      // If we found a ball-death passage collision and it's the tracked ball
      if (ball && deathPassage && ball === this.trackedBall) {
        // Additional check: only trigger death if ball is moving downward
        // This prevents false positives when ball bounces off nearby pegs
        if (ball.velocity.y > 0) {
          console.log('Ball hit death passage while moving downward! Game over.');
          this.killerDeathPassage = deathPassage; // Store which passage killed the player
          this.handleDeathGameOver();
          break; // Only handle the first collision
        } else {
          console.log('Ball hit death passage but was moving upward, ignoring collision.');
        }
      }
    }
  }

  private handleDeathGameOver() {
    if (!this.trackedBall) {
      console.log('No tracked ball, cannot handle death game over');
      return;
    }

    console.log('Handling death game over...');

    // Get the explosion position from the ball's current position
    const explosionX = this.trackedBall.position.x;
    const explosionY = this.trackedBall.position.y;

    // Get the bet amount for this ball
    const ballBetAmount = this.activeBalls.get(this.trackedBall);
    if (!ballBetAmount) {
      console.log('Could not find bet amount for this ball');
      return;
    }

    // Store the actual multiplier they had when they died (for display purposes)
    const displayedMultiplier = parseFloat(this.currentMultiplier.toFixed(2));
    // Death means 0.00x multiplier for payout calculation - player loses everything
    const deathMultiplier = 0.00;
    const winAmount = ballBetAmount * deathMultiplier; // This will be 0
    const profit = winAmount - ballBetAmount; // This will be negative (the full bet amount lost)

    console.log('Death game over details:', {
      betAmount: ballBetAmount,
      actualMultiplier: displayedMultiplier,
      payoutMultiplier: deathMultiplier,
      winAmount,
      profit
    });

    // No balance update needed since winAmount is 0 (player gets nothing back)

    // Add to win records (actually a loss record)
    winRecords.update((records) => [
      {
        id: Date.now().toString(),
        betAmount: ballBetAmount,
        rowCount: 16 as RowCount,
        riskLevel: RiskLevel.MEDIUM,
        binIndex: -2, // Use -2 to indicate this is a death passage loss (different from cash out -1)
        payout: {
          multiplier: displayedMultiplier, // Use the actual multiplier they had when they died for display
          value: winAmount, // Still 0 for actual payout
        },
        profit,
      },
      ...records.slice(0, 9), // Keep only last 10 records
    ]);

    // Update profit history with the loss
    totalProfitHistory.update((history) => {
      const newTotal = (history[history.length - 1] || 0) + profit;
      return [...history, newTotal];
    });

    // Remove the tracked ball and clean up
    Matter.Composite.remove(this.engine.world, this.trackedBall);
    this.activeBalls.delete(this.trackedBall);
    betAmountOfExistingBalls.update((balls) => {
      const updated = { ...balls };
      delete updated[this.trackedBall!.id];
      return updated;
    });

    // Clear the tracked ball reference before creating explosion
    this.trackedBall = null;
    this.isCameraTracking = false;
    
    // Reset cash out state
    this.isCashOutComplete = false;
    this.isCashOutCelebrating = false;
    this.celebratingBall = null;
    
    // Reset multiplier flashing
    isMultiplierFlashing.set(false);

    // CREATE THE EXPLOSION! 🎆💥
    this.createExplosion(explosionX, explosionY);

    // Gray out all other death passages and highlight the killer
    this.highlightKillerDeathPassage();

    // DON'T auto-reset! Player must manually reset the game.
    // The explosion will remain visible until they reset.

    console.log('Death explosion created - player must manually reset');
  }

  // Add getter for multiplier
  public getCurrentMultiplier(): number {
    return parseFloat(this.currentMultiplier.toFixed(2));
  }

  // Add method to check if game is in progress
  public isGameInProgress(): boolean {
    return this.trackedBall !== null;
  }

  // Add method to check if game is dead (hit death passage)
  public getIsGameDead(): boolean {
    return this.isGameDead;
  }

  // Add method to check if cash out is complete and waiting for reset
  public getIsCashOutComplete(): boolean {
    return this.isCashOutComplete;
  }

  // Add reset method to allow starting a new game
  public resetGame() {
    console.log('Resetting game...');
    
    // Clear explosion state first
    this.isGameDead = false;
    this.explosionStartTime = 0;
    
    // Reset cash out state
    this.isCashOutComplete = false;
    this.isCashOutCelebrating = false;
    this.celebratingBall = null;
    
    // Remove explosion particles if any
    if (this.explosionParticles.length > 0) {
      Matter.Composite.remove(this.engine.world, this.explosionParticles);
      this.explosionParticles = [];
    }
    
    // Remove tracked ball if it exists
    if (this.trackedBall) {
      Matter.Composite.remove(this.engine.world, this.trackedBall);
      this.activeBalls.delete(this.trackedBall);
      betAmountOfExistingBalls.update((balls) => {
        const updated = { ...balls };
        delete updated[this.trackedBall!.id];
        return updated;
      });
      this.trackedBall = null;
    }
    
    // Reset camera tracking
    this.isCameraTracking = false;
    this.cameraY = 0;
    this.highestCameraY = 0;
    
    // Reset multiplier
    this.currentMultiplier = 1.0;
    currentMultiplier.set(this.currentMultiplier);
    this.startingRowY = null;
    
    // Reset multiplier flashing
    isMultiplierFlashing.set(false);
    
    // Reset revelation tracking
    this.revealedRows.clear();
    this.flashingRows.clear();
    this.lastPlayerRowY = 0;
    this.killerDeathPassage = null;
    
    // Hide all death passages again
    this.hideAllDeathPassages();
    
    // Clear and regenerate all pins and death passages with new random positions
    this.clearExistingPins();
    this.placePinsAndWalls();
    
    // Reset camera view to initial position
    Matter.Render.lookAt(this.render, {
      min: { x: 0, y: 0 },
      max: { x: PlinkoEngine.WIDTH, y: PlinkoEngine.HEIGHT }
    });
    
    // Create a new ready ball
    this.createReadyBall();
    
    console.log('Game reset complete - ready for new game!');
  }

  private hideAllDeathPassages() {
    for (const deathPassage of this.deathPassages) {
      if (deathPassage.render) {
        deathPassage.render.fillStyle = 'transparent';
        deathPassage.render.strokeStyle = 'transparent';
        deathPassage.render.lineWidth = 0;
      }
    }
  }

  private highlightKillerDeathPassage() {
    if (!this.killerDeathPassage) return;
    
    console.log('Highlighting killer death passage...');
    
    // Stop all flash animations immediately when player dies
    this.flashingRows.clear();
    
    // Gray out all other revealed death passages
    for (const deathPassage of this.deathPassages) {
      if (deathPassage !== this.killerDeathPassage && deathPassage.render) {
        // Gray out all revealed passages (check if they were revealed by looking at revealed rows)
        const isRevealed = Array.from(this.revealedRows).some(rowY => {
          const rowDeathPassage = this.rowDeathPassages.get(rowY);
          return rowDeathPassage === deathPassage;
        });
        
        if (isRevealed) {
          deathPassage.render.fillStyle = 'rgba(128, 128, 128, 0.3)'; // Gray with low opacity
          deathPassage.render.strokeStyle = 'rgba(160, 160, 160, 0.4)';
          deathPassage.render.lineWidth = 2;
        }
      }
    }
    
    // The killer death passage will be handled by updateKillerDeathPassageFlash
    console.log('All other death passages grayed out, flash animations stopped');
  }

  private updateKillerDeathPassageFlash(currentTime: number) {
    if (!this.killerDeathPassage || !this.killerDeathPassage.render) return;
    
    // Create dramatic red flashing effect for the killer passage
    const flashSpeed = 800; // Faster flashing for dramatic effect
    const cycle = (currentTime / flashSpeed) % 1;
    const intensity = (Math.sin(cycle * Math.PI * 2) * 0.5 + 0.5); // Oscillate between 0 and 1
    
    // Bright red flashing
    const red = 255;
    const green = Math.floor(intensity * 100); // Some green for variation
    const blue = Math.floor(intensity * 100); // Some blue for variation
    const alpha = 0.8 + (intensity * 0.2); // High opacity with slight variation
    
    this.killerDeathPassage.render.fillStyle = `rgba(${red}, ${green}, ${blue}, ${alpha})`;
    this.killerDeathPassage.render.strokeStyle = `rgba(255, ${Math.floor(intensity * 150)}, ${Math.floor(intensity * 150)}, 1)`;
    this.killerDeathPassage.render.lineWidth = 4 + (intensity * 2); // Pulsing line width
  }

  private updateCashOutCelebration() {
    if (!this.isCashOutCelebrating) return;
    
    const elapsed = Date.now() - this.celebrationStartTime;
    const progress = elapsed / this.celebrationDuration;

    if (progress >= 1) {
      // Celebration effects complete - stop celebrating but don't reset game yet
      this.finishCashOutEffects();
    } else {
      // Update green flash effects
      this.updateCashOutEffects(progress);
    }
  }

  private updateCashOutEffects(progress: number) {
    if (!this.celebratingBall || !this.celebratingBall.render) return;
    
    // Create pulsing green effect for the ball
    const pulse = Math.sin(progress * Math.PI * 8) * 0.5 + 0.5; // Fast pulsing
    const greenIntensity = 100 + (pulse * 155); // Green from 100 to 255
    
    // Make ball flash bright green
    this.celebratingBall.render.fillStyle = `rgb(0, ${Math.floor(greenIntensity)}, 0)`;
    this.celebratingBall.render.strokeStyle = '#00ff00';
    this.celebratingBall.render.lineWidth = 3 + (pulse * 2);
    
    // Add screen-wide green pulse effect
    this.updateScreenGreenPulse(progress, pulse);
  }

  private updateScreenGreenPulse(progress: number, pulse: number) {
    // Create screen-wide green overlay effect by manipulating render background
    const greenAlpha = (pulse * 0.15) * (1 - progress); // Fade out over time
    const greenOverlay = `rgba(0, 255, 0, ${greenAlpha})`;
    
    // Apply green tint to the render background temporarily
    if (this.render.options) {
      this.render.options.background = greenOverlay;
    }
  }

  private finishCashOutEffects() {
    console.log('Finishing cash out effects...');
    
    // Reset celebration state
    this.isCashOutCelebrating = false;
    this.celebratingBall = null;
    
    // Stop multiplier flashing
    isMultiplierFlashing.set(false);

    // Reset render background
    if (this.render.options) {
      this.render.options.background = 'transparent';
    }
    
    // Set flag that cash out is complete and waiting for player to start new game
    this.isCashOutComplete = true;
    
    console.log('Cash out effects finished. Press spacebar or reset button to start new game.');
  }

  private completeCashOut() {
    // Remove the tracked ball if it still exists
    if (this.trackedBall) {
      Matter.Composite.remove(this.engine.world, this.trackedBall);
      this.activeBalls.delete(this.trackedBall);
      betAmountOfExistingBalls.update((balls) => {
        const updated = { ...balls };
        delete updated[this.trackedBall!.id];
        return updated;
      });
    }

    // Reset game state
    this.trackedBall = null;
    this.isCameraTracking = false;
    this.currentMultiplier = 1.0;
    currentMultiplier.set(this.currentMultiplier);
    this.startingRowY = null;

    // Reset revelation tracking
    this.revealedRows.clear();
    this.flashingRows.clear();
    this.lastPlayerRowY = 0;
    this.killerDeathPassage = null;
    
    // Hide all death passages again
    this.hideAllDeathPassages();

    // Reset camera view to initial position
    Matter.Render.lookAt(this.render, {
      min: { x: 0, y: 0 },
      max: { x: PlinkoEngine.WIDTH, y: PlinkoEngine.HEIGHT }
    });

    // Create a new ready ball
    this.createReadyBall();

    console.log('Cash out complete');
  }

  private revealAllDeathPassagesGrayed() {
    console.log('Revealing all visible death passages in grayed out state...');
    
    // Stop all flash animations immediately when player cashes out
    this.flashingRows.clear();
    
    // Calculate current viewport bounds
    const viewportTop = this.cameraY;
    const viewportBottom = this.cameraY + PlinkoEngine.HEIGHT;
    
    // Reveal only death passages that are currently visible on screen
    for (const [rowY, deathPassage] of this.rowDeathPassages.entries()) {
      // Check if this death passage is within the current viewport
      if (rowY >= viewportTop && rowY <= viewportBottom && deathPassage.render) {
        deathPassage.render.fillStyle = 'rgba(128, 128, 128, 0.4)'; // Gray with moderate opacity
        deathPassage.render.strokeStyle = 'rgba(160, 160, 160, 0.5)';
        deathPassage.render.lineWidth = 2;
      }
    }
    
    console.log(`Revealed ${Array.from(this.rowDeathPassages.entries()).filter(([rowY]) => rowY >= viewportTop && rowY <= viewportBottom).length} death passages on screen`);
  }
}
