import Matter from 'matter-js';
import { betAmount, betAmountOfExistingBalls, balance, winRecords, totalProfitHistory, currentMultiplier, gameState } from '$lib/stores/game';
import { RiskLevel, type RowCount } from '$lib/types';
import { get } from 'svelte/store';
import AudioManager from './AudioManager';

export default class PlinkoEngine {
  static readonly WIDTH = 800;
  static readonly HEIGHT = 530;
  static readonly BALL_RADIUS = 8;
  static readonly PEG_RADIUS = 4;
  static readonly PADDING_X = 35; // Slightly reduced padding to accommodate more pins
  static readonly PADDING_TOP = 80; // Increased from 36 to create more space at top
  static readonly PADDING_BOTTOM = 28;
  static readonly PIN_CATEGORY = 0x0001;
  static readonly BALL_CATEGORY = 0x0002;
  static readonly WALL_CATEGORY = 0x0004;  // New category for walls
  static readonly DEATH_PASSAGE_CATEGORY = 0x0008;  // New category for death passages
  static readonly CASH_OUT_PASSAGE_CATEGORY = 0x0016;  // New category for cash out passages
  static readonly EXPLOSION_CATEGORY = 0x0010;  // New category for explosion particles
  static readonly ROW_HEIGHT = 35; // Reduced from 50 to fit more rows
  static readonly VIEWPORT_BUFFER = 2; // Number of screen heights to keep pins loaded above and below viewport
  static readonly TERMINAL_VELOCITY = 12; // Maximum fall speed for balls
  static readonly READY_BALL_SPEED = 7; // Speed of the ready ball moving side to side
  static readonly DEATH_PASSAGE_WIDTH = 25; // Width of the horizontal death passage laser
  static readonly DEATH_PASSAGE_HEIGHT = 8; // Height of the horizontal death passage laser
  static readonly CASH_OUT_PASSAGE_WIDTH = 25; // Width of the horizontal cash out passage
  static readonly CASH_OUT_PASSAGE_HEIGHT = 8; // Height of the horizontal cash out passage

  // Risk-based pin configuration
  private static readonly PINS_PER_ROW_CONFIG = {
    [RiskLevel.LOW]: 25,    // Safer gameplay with more pins
    [RiskLevel.MEDIUM]: 23, // Default balanced setting
    [RiskLevel.HIGH]: 18,   // Moderate risk with 18 pins
  };

  // Fixed pin spacing based on medium risk as reference
  private static readonly REFERENCE_PIN_SPACING = 30; // pixels between pin centers
  private static readonly BASE_PINS_PER_ROW = 23; // medium risk as reference

  private currentRiskLevel: RiskLevel = RiskLevel.HIGH; // Start with high risk (18 pins)
  private currentPinsPerRow: number = 18;
  private currentGameAreaWidth: number = 0;
  private currentGameAreaPaddingX: number = 0;

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
  private audioManager: AudioManager;
  
  // Fixed timestep timing
  private readonly FIXED_TIMESTEP = 1000 / 60; // 16.666ms per physics update (60 FPS)
  private lastPhysicsTime: number = 0;
  private physicsAccumulator: number = 0;
  private animationFrameId: number | null = null;
  private isRunning: boolean = false;
  
  // Dynamic row management
  private lastGeneratedRowY: number = 0;
  private firstVisibleRowY: number = 0;
  private rowPinPositions: Map<number, Matter.Body[]> = new Map(); // Y position to pins mapping
  
  // Death passage management
  private deathPassages: Matter.Body[] = [];
  private rowDeathPassages: Map<number, Matter.Body> = new Map(); // Y position to death passage mapping
  
  // Cash out passage management
  private cashOutPassages: Matter.Body[] = [];
  private rowCashOutPassages: Map<number, Matter.Body> = new Map(); // Y position to cash out passage mapping
  
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
  private celebrationDuration: number = 800; // Reduced from 1500ms to 800ms
  private celebratingBall: Matter.Body | null = null;
  private isCashOutComplete: boolean = false;
  
  // Cash out celebration particles
  private celebrationParticles: Matter.Body[] = [];
  private celebrationPulseStartTime: number = 0;
  private ballOriginalRadius: number = 0;
  
  // Particle lifecycle properties
  private particleLifecycleData: Map<Matter.Body, {
    birthTime: number;
    initialDirection: { x: number; y: number };
    maxDistance: number;
    type: 'golden' | 'green' | 'sparkle';
  }> = new Map();



  // Preview passage system properties (new teasing mechanism)
  private previewPassages: Matter.Body[] = [];
  private rowPreviewPassages: Map<number, Matter.Body[]> = new Map(); // Row Y -> Preview passages array
  private previewOpacityTimers: Map<number, NodeJS.Timeout> = new Map(); // Row Y -> Opacity timer
  private readonly PREVIEW_OPACITY_UPDATE_INTERVAL = 100; // Update opacity every 100ms
  private isPreviewPassagesActive: boolean = false;

  // Progressive spacing configuration
  static readonly SPACING_INCREASE_PER_ROW = 0.005; // 3% increase per row
  static readonly MAX_SPACING_MULTIPLIER = 1.5; // Maximum 100% increase (2x original)

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    
    // Initialize audio manager
    this.audioManager = new AudioManager();
    
    // Initialize risk level configuration
    this.currentRiskLevel = RiskLevel.HIGH;
    this.currentPinsPerRow = PlinkoEngine.PINS_PER_ROW_CONFIG[RiskLevel.HIGH];
    this.currentGameAreaWidth = (this.currentPinsPerRow - 1) * PlinkoEngine.REFERENCE_PIN_SPACING;
    this.currentGameAreaPaddingX = (PlinkoEngine.WIDTH - this.currentGameAreaWidth) / 2;
    
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
        background: '#000000',
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
        // If game is in progress, player must wait for passages. Otherwise, drop a ball.
        else if (this.isGameInProgress()) {
          console.log('Game in progress - wait for ball to hit a cash out passage (green) or death passage (red)');
          // Do nothing - player must wait for automatic cash out or death
        } else {
          this.dropBall();
        }
      }
    };

    // Setup physics world
    this.setupWorld();
    this.placePinsAndWalls();

    // Create runner (we'll control timing manually for true refresh-rate independence)
    this.runner = Matter.Runner.create();

    // Setup camera update and velocity limiting - we'll call this manually in our custom loop
    Matter.Events.on(this.engine, 'beforeUpdate', () => {
      this.updateCamera();
      this.limitBallVelocities();
      this.handleBallWrapping();
      this.updateExplosionParticles();
      this.updateCashOutCelebration();
    });

    // Setup collision detection for death passages and cash out passages
    Matter.Events.on(this.engine, 'collisionStart', (event) => {
      this.handleDeathPassageCollision(event);
      this.handleCashOutPassageCollision(event);
    });
  }

  private get pinDistanceX(): number {
    return PlinkoEngine.REFERENCE_PIN_SPACING;
  }

  // Calculate the spacing for a specific row index (0-based)
  private getRowSpacing(rowIndex: number): number {
    const spacingMultiplier = 1 + Math.min(rowIndex * PlinkoEngine.SPACING_INCREASE_PER_ROW, PlinkoEngine.MAX_SPACING_MULTIPLIER - 1);
    return PlinkoEngine.ROW_HEIGHT * spacingMultiplier;
  }

  // Calculate the cumulative Y position for a specific row index (0-based)
  private getRowYPosition(rowIndex: number): number {
    let cumulativeY = PlinkoEngine.PADDING_TOP;
    
    for (let i = 0; i < rowIndex; i++) {
      cumulativeY += this.getRowSpacing(i);
    }
    
    return cumulativeY;
  }

  // Find the row index for a given Y position (reverse lookup)
  private getRowIndexFromY(y: number): number {
    if (y < PlinkoEngine.PADDING_TOP) return 0;
    
    let cumulativeY = PlinkoEngine.PADDING_TOP;
    let rowIndex = 0;
    
    while (cumulativeY <= y) {
      const spacing = this.getRowSpacing(rowIndex);
      if (cumulativeY + spacing > y) {
        break;
      }
      cumulativeY += spacing;
      rowIndex++;
    }
    
    return rowIndex;
  }

  // Public method to update risk level and regenerate pins if needed
  public setRiskLevel(newRiskLevel: RiskLevel) {
    if (newRiskLevel !== this.currentRiskLevel) {
      this.currentRiskLevel = newRiskLevel;
      this.currentPinsPerRow = PlinkoEngine.PINS_PER_ROW_CONFIG[newRiskLevel];
      
      // Calculate game area dimensions based on fixed pin spacing
      this.currentGameAreaWidth = (this.currentPinsPerRow - 1) * PlinkoEngine.REFERENCE_PIN_SPACING;
      this.currentGameAreaPaddingX = (PlinkoEngine.WIDTH - this.currentGameAreaWidth) / 2;
      
      // Only regenerate pins if no game is in progress
      if (!this.isGameInProgress()) {
        this.resetGame();
      } else {
        // If game is in progress, just update the ready ball position for next game
        console.log('Game in progress, will update on next reset');
      }
      
      // Always recreate the ready ball with new dimensions if it exists
      if (this.readyBall && !this.isGameInProgress()) {
        this.createReadyBall();
      }
      
      console.log('Risk level changed:', { 
        risk: newRiskLevel, 
        pinsPerRow: this.currentPinsPerRow,
        gameAreaWidth: this.currentGameAreaWidth,
        paddingX: this.currentGameAreaPaddingX
      });
    }
  }

  private setupWorld() {
    // No walls needed for wrapping behavior
  }

  private handleBallWrapping() {
    const bodies = Matter.Composite.allBodies(this.engine.world);
    const leftBoundary = this.currentGameAreaPaddingX;
    const rightBoundary = this.currentGameAreaPaddingX + this.currentGameAreaWidth;
    
    for (const body of bodies) {
      // Only wrap ball positions, but exclude the ready ball
      if (body.collisionFilter.category === PlinkoEngine.BALL_CATEGORY && body !== this.readyBall) {
        const position = body.position;
        
        // Check if ball has gone off either side of the game area
        if (position.x < leftBoundary) {
          // Wrap to right side
          Matter.Body.setPosition(body, {
            x: rightBoundary,
            y: position.y
          });
        } else if (position.x > rightBoundary) {
          // Wrap to left side
          Matter.Body.setPosition(body, {
            x: leftBoundary,
            y: position.y
          });
        }
      }
    }
  }

  private placePinsAndWalls() {
    // Clear existing pins and walls if any
    this.clearExistingPins();

    // Start generating rows right from the top - using row 0 position
    this.firstVisibleRowY = this.getRowYPosition(0);
    this.lastGeneratedRowY = this.getRowYPosition(0);

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
    if (this.cashOutPassages.length > 0) {
      Matter.Composite.remove(this.engine.world, this.cashOutPassages);
      this.cashOutPassages = [];
    }
    this.rowPinPositions.clear();
    this.rowDeathPassages.clear();
    this.rowCashOutPassages.clear();
    
    // Clear preview passages
    this.clearAllPreviewPassages();
  }

    private createRowOfPins(rowY: number, pinCount: number, isOffset: boolean = false) {
    const { PIN_CATEGORY, BALL_CATEGORY, REFERENCE_PIN_SPACING } = PlinkoEngine;
    const rowPins: Matter.Body[] = [];
    
    // Use fixed pin spacing and dynamic padding
    const pinSpacing = REFERENCE_PIN_SPACING;
    const paddingX = this.currentGameAreaPaddingX;
    
    // For offset rows, we'll create one less pin and shift everything right by half spacing
    const effectivePinCount = isOffset ? this.currentPinsPerRow - 1 : this.currentPinsPerRow;
    
    for (let col = 0; col < effectivePinCount; ++col) {
      let colX = paddingX + (pinSpacing * col);
      
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
    
    // Calculate row index for passage placement using progressive spacing
    const rowIndex = this.getRowIndexFromY(rowY);
    
    // If game is in progress, create actual passages instead of preview passages
    if (this.isGameInProgress()) {
      const isDeathRow = (rowIndex + 1) % 2 === 0;
      if (isDeathRow) {
        this.createDeathPassage(rowY, isOffset);
      } else {
        this.createCashOutPassage(rowY, isOffset);
      }
    } else {
      // Create preview passages for this row (shows all possible positions with animated opacity)
      this.createPreviewPassages(rowY, isOffset, rowIndex);
    }
  }

  private createDeathPassage(rowY: number, isOffset: boolean) {
    const { DEATH_PASSAGE_CATEGORY, BALL_CATEGORY, DEATH_PASSAGE_WIDTH, DEATH_PASSAGE_HEIGHT, REFERENCE_PIN_SPACING } = PlinkoEngine;
    
    // Use fixed pin spacing and dynamic padding
    const pinSpacing = REFERENCE_PIN_SPACING;
    const paddingX = this.currentGameAreaPaddingX;
    
    // Calculate number of passages (spaces between pins)
    const numPassages = isOffset ? this.currentPinsPerRow - 2 : this.currentPinsPerRow - 1;
    
    // Randomly select a passage index
    const deathPassageIndex = Math.floor(Math.random() * numPassages);
    
    // Calculate the X position of the death passage
    let passageX: number;
    if (isOffset) {
      // For offset rows, passages are between offset pins
      passageX = paddingX + (pinSpacing / 2) + (deathPassageIndex * pinSpacing) + (pinSpacing / 2);
    } else {
      // For normal rows, passages are between regular pins
      passageX = paddingX + (deathPassageIndex * pinSpacing) + (pinSpacing / 2);
    }
    
    // Create the death passage body (horizontal laser) - positioned at the same level as the pegs
    const deathPassage = Matter.Bodies.rectangle(
      passageX,
      rowY,
      DEATH_PASSAGE_WIDTH,
      DEATH_PASSAGE_HEIGHT,
      {
        isStatic: true,
        isSensor: true, // Make it a sensor so balls pass through but we can detect collision
        render: {
          fillStyle: '#EF4444', // Bright neon red
          strokeStyle: '#EF4444',
          lineWidth: 3,
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

  private createCashOutPassage(rowY: number, isOffset: boolean) {
    const { CASH_OUT_PASSAGE_CATEGORY, BALL_CATEGORY, CASH_OUT_PASSAGE_WIDTH, CASH_OUT_PASSAGE_HEIGHT, REFERENCE_PIN_SPACING } = PlinkoEngine;
    
    // Use fixed pin spacing and dynamic padding
    const pinSpacing = REFERENCE_PIN_SPACING;
    const paddingX = this.currentGameAreaPaddingX;
    
    // Calculate number of passages (spaces between pins)
    const numPassages = isOffset ? this.currentPinsPerRow - 2 : this.currentPinsPerRow - 1;
    
    // Get the death passage for this row to avoid conflict
    const deathPassage = this.rowDeathPassages.get(rowY);
    let deathPassageIndex = -1;
    
    if (deathPassage) {
      // Calculate which passage the death passage is in
      for (let i = 0; i < numPassages; i++) {
        let passageX: number;
        if (isOffset) {
          passageX = paddingX + (pinSpacing / 2) + (i * pinSpacing) + (pinSpacing / 2);
        } else {
          passageX = paddingX + (i * pinSpacing) + (pinSpacing / 2);
        }
        
        // Check if death passage X position matches this passage (with some tolerance)
        if (Math.abs(deathPassage.position.x - passageX) < pinSpacing / 4) {
          deathPassageIndex = i;
          break;
        }
      }
    }
    
    // Find available passages (excluding the death passage)
    const availablePassages: number[] = [];
    for (let i = 0; i < numPassages; i++) {
      if (i !== deathPassageIndex) {
        availablePassages.push(i);
      }
    }
    
    // If no available passages (shouldn't happen), don't create cash out passage
    if (availablePassages.length === 0) {
      return;
    }
    
    // Randomly select from available passages
    const cashOutPassageIndex = availablePassages[Math.floor(Math.random() * availablePassages.length)];
    
    // Calculate the X position of the cash out passage
    let passageX: number;
    if (isOffset) {
      // For offset rows, passages are between offset pins
      passageX = paddingX + (pinSpacing / 2) + (cashOutPassageIndex * pinSpacing) + (pinSpacing / 2);
    } else {
      // For normal rows, passages are between regular pins
      passageX = paddingX + (cashOutPassageIndex * pinSpacing) + (pinSpacing / 2);
    }
    
    // Create the cash out passage body (horizontal laser) - positioned at the same level as the pegs
    const cashOutPassage = Matter.Bodies.rectangle(
      passageX,
      rowY,
      CASH_OUT_PASSAGE_WIDTH,
      CASH_OUT_PASSAGE_HEIGHT,
      {
        isStatic: true,
        isSensor: true, // Make it a sensor so balls pass through but we can detect collision
        render: {
          fillStyle: '#A3E635', // Bright neon green
          strokeStyle: '#A3E635',
          lineWidth: 3,
        },
        collisionFilter: {
          category: CASH_OUT_PASSAGE_CATEGORY,
          mask: BALL_CATEGORY,
        },
      }
    );
    
    this.cashOutPassages.push(cashOutPassage);
    this.rowCashOutPassages.set(rowY, cashOutPassage);
    Matter.Composite.add(this.engine.world, cashOutPassage);
  }

  private createPreviewPassages(rowY: number, isOffset: boolean, rowIndex: number) {
    const { REFERENCE_PIN_SPACING, DEATH_PASSAGE_WIDTH, DEATH_PASSAGE_HEIGHT } = PlinkoEngine;
    
    // Use fixed pin spacing and dynamic padding
    const pinSpacing = REFERENCE_PIN_SPACING;
    const paddingX = this.currentGameAreaPaddingX;
    
    // Calculate number of passages (spaces between pins)
    const numPassages = isOffset ? this.currentPinsPerRow - 2 : this.currentPinsPerRow - 1;
    
    // Determine if this is a death row or cash out row
    const isDeathRow = (rowIndex + 1) % 2 === 0;
    const rowPreviewPassages: Matter.Body[] = [];
    
    // Create preview passages for all possible positions in this row
    for (let i = 0; i < numPassages; i++) {
      // Calculate the X position of this passage
      let passageX: number;
      if (isOffset) {
        passageX = paddingX + (pinSpacing / 2) + (i * pinSpacing) + (pinSpacing / 2);
      } else {
        passageX = paddingX + (i * pinSpacing) + (pinSpacing / 2);
      }
      
      // Create the preview passage with initial opacity
      const previewPassage = Matter.Bodies.rectangle(
        passageX,
        rowY,
        DEATH_PASSAGE_WIDTH, // Use same size for both types
        DEATH_PASSAGE_HEIGHT,
        {
          isStatic: true,
          isSensor: true,
          render: {
            fillStyle: isDeathRow ? 'rgba(239, 68, 68, 0.5)' : 'rgba(163, 230, 53, 0.5)', // Semi-transparent red or green
            strokeStyle: isDeathRow ? 'rgba(239, 68, 68, 0.8)' : 'rgba(163, 230, 53, 0.8)',
            lineWidth: 2,
          },
          collisionFilter: {
            category: 0, // No collision category - these are just visual previews
            mask: 0,
          },
        }
      );
      
      rowPreviewPassages.push(previewPassage);
      this.previewPassages.push(previewPassage);
    }
    
    // Store the preview passages for this row
    this.rowPreviewPassages.set(rowY, rowPreviewPassages);
    Matter.Composite.add(this.engine.world, rowPreviewPassages);
    
    // Start opacity animation for this row
    this.startPreviewOpacityAnimation(rowY, isDeathRow);
  }

  private startPreviewOpacityAnimation(rowY: number, isDeathRow: boolean) {
    // Clear any existing timer for this row
    if (this.previewOpacityTimers.has(rowY)) {
      clearInterval(this.previewOpacityTimers.get(rowY)!);
    }

    const timer = setInterval(() => {
      // Only animate if we're still in ready state (not in game)
      if (this.readyBall && !this.isGameInProgress()) {
        this.updatePreviewOpacityForRow(rowY, isDeathRow);
      } else {
        // Stop animation if game state changed
        this.stopPreviewOpacityAnimation(rowY);
      }
    }, this.PREVIEW_OPACITY_UPDATE_INTERVAL);
    
    this.previewOpacityTimers.set(rowY, timer);
    this.isPreviewPassagesActive = true;
  }

  private updatePreviewOpacityForRow(rowY: number, isDeathRow: boolean) {
    const rowPassages = this.rowPreviewPassages.get(rowY);
    if (!rowPassages) return;
    
    const time = Date.now();
    const rowIndex = this.getRowIndexFromY(rowY);
    
    // Create row-specific behavior by using row index as seed
    const rowSeed = rowIndex * 1337; // Different seed per row
    const rowSpeed = 0.002 + (rowIndex % 3) * 0.001; // Vary speed per row: 0.002, 0.003, 0.004
    const rowPhaseOffset = (rowIndex * Math.PI) / 3; // Different phase offset per row
    
    // Target: only show about 1/4 of the passages at any time
    const targetVisibleCount = Math.max(1, Math.ceil(rowPassages.length / 4));
    let currentlyVisible = 0;
    
    // First pass: calculate which passages should be visible based on their natural cycles
    const passageStates: Array<{passage: Matter.Body, targetOpacity: number, index: number}> = [];
    
    for (let i = 0; i < rowPassages.length; i++) {
      const passage = rowPassages[i];
      if (!passage.render) continue;
      
      // Each passage has its own cycle with row-specific modifications
      const passagePhase = rowPhaseOffset + (i * Math.PI * 2) / rowPassages.length + (rowSeed * 0.001);
      const passageSpeed = rowSpeed + (i * 0.0003); // Slight speed variation per passage
      
      // Use sine wave to determine if this passage wants to be visible
      const cycle = Math.sin(time * passageSpeed + passagePhase);
      
      // Convert sine wave (-1 to 1) to a "desire to be visible" (0 to 1)
      const visibilityDesire = (cycle + 1) / 2;
      
      passageStates.push({
        passage,
        targetOpacity: visibilityDesire,
        index: i
      });
    }
    
    // Sort by visibility desire (highest first)
    passageStates.sort((a, b) => b.targetOpacity - a.targetOpacity);
    
    // Only make the top half visible, fade out the rest
    for (let i = 0; i < passageStates.length; i++) {
      const { passage, targetOpacity, index } = passageStates[i];
      
      let finalOpacity: number;
      
      if (i < targetVisibleCount) {
        // This passage gets to be visible - use its natural opacity (0.3 to 0.9)
        finalOpacity = 0.3 + (targetOpacity * 0.6);
        currentlyVisible++;
      } else {
        // This passage should be hidden/very faint (0.0 to 0.15)
        finalOpacity = targetOpacity * 0.15;
      }
      
      // Update the passage color with calculated opacity
      if (isDeathRow) {
        passage.render.fillStyle = `rgba(239, 68, 68, ${finalOpacity})`;
        passage.render.strokeStyle = `rgba(239, 68, 68, ${Math.min(finalOpacity + 0.2, 1)})`;
      } else {
        passage.render.fillStyle = `rgba(163, 230, 53, ${finalOpacity})`;
        passage.render.strokeStyle = `rgba(163, 230, 53, ${Math.min(finalOpacity + 0.2, 1)})`;
      }
    }
  }

  private stopPreviewOpacityAnimation(rowY: number) {
    const timer = this.previewOpacityTimers.get(rowY);
    if (timer) {
      clearInterval(timer);
      this.previewOpacityTimers.delete(rowY);
    }
  }

  private stopAllPreviewOpacityAnimations() {
    this.previewOpacityTimers.forEach(clearInterval);
    this.previewOpacityTimers.clear();
    this.isPreviewPassagesActive = false;
  }

  private clearAllPreviewPassages() {
    if (this.previewPassages.length > 0) {
      Matter.Composite.remove(this.engine.world, this.previewPassages);
      this.previewPassages = [];
    }
    this.rowPreviewPassages.clear();
    this.stopAllPreviewOpacityAnimations();
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
    
    // Enhanced explosion with multiple particle types and better colors
    this.createExplosionWave1(x, y); // Large chunks and primary blast
    this.createExplosionWave2(x, y); // Medium particles and secondary effects
    this.createExplosionWave3(x, y); // Small sparks and debris
    
    // Add all particles to the world
    Matter.Composite.add(this.engine.world, this.explosionParticles);
    
    // Enhanced screen shake effect
    this.startScreenShake();
  }

  private createExplosionWave1(x: number, y: number) {
    // Wave 1: Large chunks with intense colors (primary blast)
    const chunkCount = 20;
    const chunkColors = ['#FF2D00', '#FF4500', '#FF6A00', '#FF8C00', '#FFB700']; // Red to orange gradient
    
    for (let i = 0; i < chunkCount; i++) {
      const angle = (Math.PI * 2 * i) / chunkCount + (Math.random() - 0.5) * 0.3;
      const speed = 15 + Math.random() * 10; // High speed for dramatic effect
      const size = 8 + Math.random() * 6; // Large chunks (8-14)
      
      const particle = Matter.Bodies.circle(x, y, size, {
        frictionAir: 0.015, // Less air friction for chunks
        restitution: 0.9,
        density: 0.002,
        render: {
          fillStyle: chunkColors[Math.floor(Math.random() * chunkColors.length)],
          strokeStyle: '#FFFFFF',
          lineWidth: 2,
        },
        collisionFilter: {
          category: PlinkoEngine.EXPLOSION_CATEGORY,
          mask: PlinkoEngine.PIN_CATEGORY | PlinkoEngine.WALL_CATEGORY,
        },
      });
      
      // Add some randomness to make it more chaotic
      const velocityX = Math.cos(angle) * speed + (Math.random() - 0.5) * 4;
      const velocityY = Math.sin(angle) * speed + (Math.random() - 0.5) * 4;
      Matter.Body.setVelocity(particle, { x: velocityX, y: velocityY });
      
      this.explosionParticles.push(particle);
    }
  }

  private createExplosionWave2(x: number, y: number) {
    // Wave 2: Medium particles with mixed explosion colors
    const mediumCount = 40;
    const mediumColors = ['#FF4500', '#FF6A00', '#FF8C00', '#FFD700', '#FFF200', '#FF1493']; // Orange to yellow with some hot pink
    
    for (let i = 0; i < mediumCount; i++) {
      const angle = (Math.PI * 2 * i) / mediumCount + (Math.random() - 0.5) * 0.4;
      const speed = 10 + Math.random() * 12;
      const size = 4 + Math.random() * 6; // Medium particles (4-10)
      
      const particle = Matter.Bodies.circle(x, y, size, {
        frictionAir: 0.025,
        restitution: 0.85,
        density: 0.0015,
        render: {
          fillStyle: mediumColors[Math.floor(Math.random() * mediumColors.length)],
          strokeStyle: '#FFFF00', // Yellow stroke for extra glow
          lineWidth: 1.5,
        },
        collisionFilter: {
          category: PlinkoEngine.EXPLOSION_CATEGORY,
          mask: PlinkoEngine.PIN_CATEGORY | PlinkoEngine.WALL_CATEGORY,
        },
      });
      
      const velocityX = Math.cos(angle) * speed + (Math.random() - 0.5) * 6;
      const velocityY = Math.sin(angle) * speed + (Math.random() - 0.5) * 6;
      Matter.Body.setVelocity(particle, { x: velocityX, y: velocityY });
      
      this.explosionParticles.push(particle);
    }
  }

  private createExplosionWave3(x: number, y: number) {
    // Wave 3: Small sparks and hot debris
    const sparkCount = 60;
    const sparkColors = ['#FFD700', '#FFF200', '#FFFF00', '#FFFFFF', '#00BFFF', '#87CEEB']; // Yellow, white, and some blue accents
    
    for (let i = 0; i < sparkCount; i++) {
      const angle = Math.PI * 2 * Math.random(); // Completely random directions for chaos
      const speed = 8 + Math.random() * 18; // Very varied speeds
      const size = 2 + Math.random() * 4; // Small sparks (2-6)
      
      const particle = Matter.Bodies.circle(x, y, size, {
        frictionAir: 0.04, // Higher air friction for sparks (they slow down faster)
        restitution: 0.7,
        density: 0.001,
        render: {
          fillStyle: sparkColors[Math.floor(Math.random() * sparkColors.length)],
          strokeStyle: '#FFFFFF',
          lineWidth: 0.5,
        },
        collisionFilter: {
          category: PlinkoEngine.EXPLOSION_CATEGORY,
          mask: PlinkoEngine.PIN_CATEGORY | PlinkoEngine.WALL_CATEGORY,
        },
      });
      
      // Some sparks get extra boost for dramatic spread
      const boost = Math.random() > 0.7 ? 1.5 : 1.0;
      const velocityX = Math.cos(angle) * speed * boost;
      const velocityY = Math.sin(angle) * speed * boost;
      Matter.Body.setVelocity(particle, { x: velocityX, y: velocityY });
      
      this.explosionParticles.push(particle);
    }
  }

  private startScreenShake() {
    const maxShakeIntensity = 9; // Increased from 15
    const shakeDuration = 600; // Increased from 1000ms to 1.5 seconds
    const startTime = Date.now();
    
    const shakeInterval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const progress = elapsed / shakeDuration;
      
      if (progress >= 1 || !this.isGameDead) {
        // Reset camera to normal position when shake ends
        Matter.Render.lookAt(this.render, {
          min: { x: 0, y: this.cameraY },
          max: { x: PlinkoEngine.WIDTH, y: this.cameraY + PlinkoEngine.HEIGHT }
        });
        clearInterval(shakeInterval);
        return;
      }
      
      // More dramatic shake curve - starts intense, has a spike in the middle, then fades
      let intensityMultiplier;
      if (progress < 0.1) {
        // Initial blast - very intense
        intensityMultiplier = 1.0;
      } else if (progress < 0.3) {
        // Sharp drop
        intensityMultiplier = 1.0 - ((progress - 0.1) / 0.2) * 0.4;
      } else if (progress < 0.5) {
        // Secondary explosion surge
        intensityMultiplier = 0.6 + 0.3 * Math.sin((progress - 0.3) * Math.PI * 5);
      } else {
        // Gradual fade out
        intensityMultiplier = 0.6 * (1 - ((progress - 0.5) / 0.5));
      }
      
      const currentIntensity = maxShakeIntensity * intensityMultiplier;
      
      // Add some rotational chaos to the shake
      const shakeAngle = Math.random() * Math.PI * 2;
      const offsetX = Math.cos(shakeAngle) * currentIntensity + (Math.random() - 0.5) * currentIntensity * 0.5;
      const offsetY = Math.sin(shakeAngle) * currentIntensity + (Math.random() - 0.5) * currentIntensity * 0.5;
      
      // Apply shake to camera bounds
      Matter.Render.lookAt(this.render, {
        min: { x: offsetX, y: this.cameraY + offsetY },
        max: { x: PlinkoEngine.WIDTH + offsetX, y: this.cameraY + PlinkoEngine.HEIGHT + offsetY }
      });
    }, 16); // ~60fps
  }

  private createCashOutCelebration(x: number, y: number) {
    console.log('Creating cash out celebration at:', { x, y });
    
    this.isCashOutCelebrating = true;
    this.celebrationStartTime = Date.now();
    this.celebrationPulseStartTime = Date.now();
    
    // Store original ball radius for transformation effects
    if (this.celebratingBall) {
      this.ballOriginalRadius = PlinkoEngine.BALL_RADIUS;
    }
    
    // Clear any existing celebration particles
    if (this.celebrationParticles.length > 0) {
      Matter.Composite.remove(this.engine.world, this.celebrationParticles);
      this.celebrationParticles = [];
    }
    
    // Clear particle lifecycle data
    this.particleLifecycleData.clear();
    
    // Create unified particle burst from ball that expands and contracts
    this.createExpandingParticleBurst(x, y);
    
    // Add all particles to the world
    Matter.Composite.add(this.engine.world, this.celebrationParticles);
    
    // Start screen glow effect
    this.startScreenGlow();
  }

  private createExpandingParticleBurst(x: number, y: number) {
    // Create a unified burst of particles that expand outward from the ball then contract back
    const totalParticles = 60; // Total particle count across all types
    const currentTime = Date.now();
    
    // Define particle type distribution
    const goldenCount = 20;
    const greenCount = 25;
    const sparkleCount = 15;
    
    // Create golden particles
    for (let i = 0; i < goldenCount; i++) {
      const angle = (Math.PI * 2 * i) / goldenCount + (Math.random() - 0.5) * 0.3;
      const speed = 6 + Math.random() * 8;
      const maxDistance = 80 + Math.random() * 40; // How far they'll travel before returning
      const size = 3 + Math.random() * 4;
      
      const particle = Matter.Bodies.circle(x, y, size, {
        frictionAir: 0.001, // Very low friction so we can control movement manually
        restitution: 0.8,
        density: 0.001,
        render: {
          fillStyle: ['#FFD700', '#FFA500', '#FFFF00', '#FFE135'][Math.floor(Math.random() * 4)],
          strokeStyle: '#FFFFFF',
          lineWidth: 1,
        },
        collisionFilter: {
          category: PlinkoEngine.EXPLOSION_CATEGORY,
          mask: 0, // No collisions during celebration
        },
      });
      
      const direction = { x: Math.cos(angle), y: Math.sin(angle) };
      Matter.Body.setVelocity(particle, { x: direction.x * speed, y: direction.y * speed });
      
      // Store lifecycle data
      this.particleLifecycleData.set(particle, {
        birthTime: currentTime,
        initialDirection: direction,
        maxDistance: maxDistance,
        type: 'golden'
      });
      
      this.celebrationParticles.push(particle);
    }
    
    // Create green burst particles
    for (let i = 0; i < greenCount; i++) {
      const angle = (Math.PI * 2 * i) / greenCount + (Math.random() - 0.5) * 0.4;
      const speed = 8 + Math.random() * 10;
      const maxDistance = 60 + Math.random() * 50;
      const size = 4 + Math.random() * 5;
      
      const particle = Matter.Bodies.circle(x, y, size, {
        frictionAir: 0.001,
        restitution: 0.8,
        density: 0.001,
        render: {
          fillStyle: ['#00FF00', '#32CD32', '#90EE90', '#00FA9A'][Math.floor(Math.random() * 4)],
          strokeStyle: '#FFFFFF',
          lineWidth: 1.5,
        },
        collisionFilter: {
          category: PlinkoEngine.EXPLOSION_CATEGORY,
          mask: 0,
        },
      });
      
      const direction = { x: Math.cos(angle), y: Math.sin(angle) };
      Matter.Body.setVelocity(particle, { x: direction.x * speed, y: direction.y * speed });
      
      this.particleLifecycleData.set(particle, {
        birthTime: currentTime,
        initialDirection: direction,
        maxDistance: maxDistance,
        type: 'green'
      });
      
      this.celebrationParticles.push(particle);
    }
    
    // Create sparkle particles
    for (let i = 0; i < sparkleCount; i++) {
      const angle = Math.PI * 2 * Math.random(); // Random angles for sparkles
      const speed = 4 + Math.random() * 12;
      const maxDistance = 100 + Math.random() * 60;
      const size = 2 + Math.random() * 3;
      
      const particle = Matter.Bodies.circle(x, y, size, {
        frictionAir: 0.001,
        restitution: 0.9,
        density: 0.0005,
        render: {
          fillStyle: ['#FFFFFF', '#FFFF00', '#FFD700', '#F0F8FF'][Math.floor(Math.random() * 4)],
          strokeStyle: '#FFFF00',
          lineWidth: 0.5,
        },
        collisionFilter: {
          category: PlinkoEngine.EXPLOSION_CATEGORY,
          mask: 0,
        },
      });
      
      const direction = { x: Math.cos(angle), y: Math.sin(angle) };
      Matter.Body.setVelocity(particle, { x: direction.x * speed, y: direction.y * speed });
      
      this.particleLifecycleData.set(particle, {
        birthTime: currentTime,
        initialDirection: direction,
        maxDistance: maxDistance,
        type: 'sparkle'
      });
      
      this.celebrationParticles.push(particle);
    }
  }

  private startScreenGlow() {
    const maxGlowIntensity = 0.2; // Reduced from 0.3 to 0.2
    const glowDuration = 1000; // Reduced from 2000ms to 1000ms
    const startTime = Date.now();
    
    const glowInterval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const progress = elapsed / glowDuration;
      
      if (progress >= 1 || !this.isCashOutCelebrating) {
        // Reset camera to normal position when glow ends
        Matter.Render.lookAt(this.render, {
          min: { x: 0, y: this.cameraY },
          max: { x: PlinkoEngine.WIDTH, y: this.cameraY + PlinkoEngine.HEIGHT }
        });
        clearInterval(glowInterval);
        return;
      }
      
      // Smooth glow curve - builds up, peaks, then fades
      let glowMultiplier;
      if (progress < 0.2) {
        // Quick build up
        glowMultiplier = progress / 0.2;
      } else if (progress < 0.6) {
        // Peak glow with gentle pulsing
        const pulseBase = 0.8 + 0.2 * Math.sin((progress - 0.2) * Math.PI * 6);
        glowMultiplier = pulseBase;
      } else {
        // Gentle fade out
        glowMultiplier = 0.8 * (1 - ((progress - 0.6) / 0.4));
      }
      
      const currentGlow = maxGlowIntensity * glowMultiplier;
      
      // Add gentle camera zoom/scale effect for celebration
      const zoomFactor = 1 + (currentGlow * 0.1); // Very subtle zoom
      const centerX = PlinkoEngine.WIDTH / 2;
      const centerY = this.cameraY + PlinkoEngine.HEIGHT / 2;
      
      // Calculate zoomed bounds
      const zoomedWidth = PlinkoEngine.WIDTH / zoomFactor;
      const zoomedHeight = PlinkoEngine.HEIGHT / zoomFactor;
      
      Matter.Render.lookAt(this.render, {
        min: { 
          x: centerX - zoomedWidth / 2, 
          y: centerY - zoomedHeight / 2 
        },
        max: { 
          x: centerX + zoomedWidth / 2, 
          y: centerY + zoomedHeight / 2 
        }
      });
         }, 16); // ~60fps
   }

   private updateCelebrationParticles() {
    if (!this.isCashOutCelebrating || this.celebrationParticles.length === 0 || !this.celebratingBall) {
      return;
    }
    
    const elapsed = Date.now() - this.celebrationStartTime;
    const progress = elapsed / this.celebrationDuration;
    const time = Date.now();
    const ballPosition = this.celebratingBall.position;
    
    // Update each particle's position and appearance based on its lifecycle
    for (let i = this.celebrationParticles.length - 1; i >= 0; i--) {
      const particle = this.celebrationParticles[i];
      const lifecycleData = this.particleLifecycleData.get(particle);
      
      if (!particle.render || !lifecycleData) continue;
      
      const particleAge = time - lifecycleData.birthTime;
      const particlePosition = particle.position;
      
      // Calculate distance from ball
      const distanceFromBall = Math.sqrt(
        Math.pow(particlePosition.x - ballPosition.x, 2) + 
        Math.pow(particlePosition.y - ballPosition.y, 2)
      );
      
      // Determine lifecycle phase based on time and distance
      const expandPhaseTime = 300; // 300ms to expand
      const contractStartTime = 400; // Start contracting at 400ms
      
      let newVelocity = { x: 0, y: 0 };
      let alpha = 1.0;
      
      if (particleAge < expandPhaseTime) {
        // EXPAND PHASE: Particles move outward from ball
        const expandProgress = particleAge / expandPhaseTime;
        const targetDistance = lifecycleData.maxDistance * expandProgress;
        
        // Continue expanding in initial direction but slow down as we reach target
        const slowdownFactor = Math.max(0.2, 1 - expandProgress);
        newVelocity.x = lifecycleData.initialDirection.x * 6 * slowdownFactor;
        newVelocity.y = lifecycleData.initialDirection.y * 6 * slowdownFactor;
        
        alpha = 0.3 + (expandProgress * 0.7); // Fade in during expansion
        
      } else if (particleAge >= contractStartTime) {
        // CONTRACT PHASE: Particles swirl back toward ball
        const contractAge = particleAge - contractStartTime;
        const contractDuration = this.celebrationDuration - contractStartTime;
        const contractProgress = Math.min(1.0, contractAge / contractDuration);
        
        // Calculate direction back to ball
        const toBallX = ballPosition.x - particlePosition.x;
        const toBallY = ballPosition.y - particlePosition.y;
        const toBallDistance = Math.sqrt(toBallX * toBallX + toBallY * toBallY);
        
        if (toBallDistance > 5) { // Only move if not too close to ball
          // Normalize direction
          const toBallDirectionX = toBallX / toBallDistance;
          const toBallDirectionY = toBallY / toBallDistance;
          
          // Add swirling motion for more visual appeal
          const swirl = Math.sin(time * 0.01 + i) * 0.3;
          const perpendicularX = -toBallDirectionY; // Perpendicular for swirl
          const perpendicularY = toBallDirectionX;
          
          // Increase speed as we contract more
          const contractSpeed = 8 + (contractProgress * 12);
          
          newVelocity.x = (toBallDirectionX + perpendicularX * swirl) * contractSpeed;
          newVelocity.y = (toBallDirectionY + perpendicularY * swirl) * contractSpeed;
          
          alpha = 1.0 - (contractProgress * 0.5); // Fade out as approaching ball
        } else {
          // Very close to ball - remove particle
          Matter.Composite.remove(this.engine.world, particle);
          this.celebrationParticles.splice(i, 1);
          this.particleLifecycleData.delete(particle);
          continue;
        }
        
      } else {
        // PAUSE PHASE: Brief moment at max expansion before contracting
        newVelocity.x = 0;
        newVelocity.y = 0;
        alpha = 1.0;
      }
      
      // Apply the calculated velocity
      Matter.Body.setVelocity(particle, newVelocity);
      
      // Update visual appearance based on particle type and lifecycle
      this.updateParticleAppearance(particle, lifecycleData, alpha, time, i);
    }
    
    // Remove all particles when celebration is complete
    if (progress >= 1) {
      Matter.Composite.remove(this.engine.world, this.celebrationParticles);
      this.celebrationParticles = [];
      this.particleLifecycleData.clear();
    }
  }

  private updateParticleAppearance(
    particle: Matter.Body, 
    lifecycleData: { type: 'golden' | 'green' | 'sparkle' }, 
    alpha: number, 
    time: number, 
    index: number
  ) {
    if (!particle.render) return;
    
    const baseColor = particle.render.fillStyle as string;
    
    // Add type-specific effects
    let finalAlpha = alpha;
    
    if (lifecycleData.type === 'sparkle') {
      // Sparkles twinkle
      const twinkle = Math.sin(time * 0.02 + index) * 0.3 + 0.7;
      finalAlpha *= twinkle;
    } else if (lifecycleData.type === 'golden') {
      // Golden particles have a warm glow
      const glow = Math.sin(time * 0.008 + index) * 0.2 + 0.8;
      finalAlpha *= glow;
    }
    
    // Update color with calculated alpha
    let finalColor = baseColor;
    if (baseColor.startsWith('#')) {
      const r = parseInt(baseColor.substr(1, 2), 16);
      const g = parseInt(baseColor.substr(3, 2), 16);
      const b = parseInt(baseColor.substr(5, 2), 16);
      finalColor = `rgba(${r}, ${g}, ${b}, ${Math.max(0, finalAlpha)})`;
    } else {
      finalColor = `rgba(255, 215, 0, ${Math.max(0, finalAlpha)})`;
    }
    
    particle.render.fillStyle = finalColor;
    
    // Update stroke
    if (particle.render.strokeStyle) {
      const strokeAlpha = Math.min(finalAlpha * 1.2, 1.0);
      particle.render.strokeStyle = `rgba(255, 255, 255, ${Math.max(0, strokeAlpha)})`;
    }
  }

  private updateCelebrationBall(progress: number) {
    if (!this.celebratingBall || !this.celebratingBall.render) return;
    
    const time = Date.now();
    
    // Make the ball grow and pulse with golden effects - toned down
    const pulseSpeed = 0.01;
    const pulse = Math.sin(time * pulseSpeed) * 0.5 + 0.5; // 0 to 1
    
    // Grow the ball over time - reduced growth factor
    const growthFactor = 1 + (progress * 0.4) + (pulse * 0.15); // Reduced from 0.8 and 0.3 to 0.4 and 0.15
    const newRadius = this.ballOriginalRadius * growthFactor;
    
    // Update ball scale (this is a visual effect, doesn't change physics)
    // For Matter.js, we'll use rendering tricks to make it appear larger
    const goldIntensity = Math.floor(150 + (pulse * 105)); // Gold from 150 to 255
    const greenIntensity = Math.floor(200 + (pulse * 55)); // Green stays high
    
    // Create golden-green gradient effect
    this.celebratingBall.render.fillStyle = `rgb(${goldIntensity}, ${greenIntensity}, 0)`;
    this.celebratingBall.render.strokeStyle = '#FFD700';
    this.celebratingBall.render.lineWidth = 2 + (pulse * 2); // Reduced from 4 + (pulse * 4) to 2 + (pulse * 2)
    
    // Add sparkling ring effect around the ball
    this.addSparkleRingAroundBall();
  }

  private addSparkleRingAroundBall() {
    if (!this.celebratingBall) return;
    
    const time = Date.now();
    const ballX = this.celebratingBall.position.x;
    const ballY = this.celebratingBall.position.y;
    
    // Create fewer sparkles around the ball less frequently
    if (time % 400 < 50) { // Changed from every 200ms to every 400ms
      for (let i = 0; i < 2; i++) { // Reduced from 3 to 2 sparkles
        const angle = (time * 0.005 + i * Math.PI * 2 / 2) % (Math.PI * 2); // Updated for 2 sparkles
        const radius = this.ballOriginalRadius * 3; // Ring around the ball
        const sparkleX = ballX + Math.cos(angle) * radius;
        const sparkleY = ballY + Math.sin(angle) * radius;
        
        const sparkle = Matter.Bodies.circle(sparkleX, sparkleY, 2, {
          frictionAir: 0.1,
          restitution: 0.5,
          density: 0.0001,
          render: {
            fillStyle: '#FFFF00',
            strokeStyle: '#FFD700',
            lineWidth: 1,
          },
          collisionFilter: {
            category: PlinkoEngine.EXPLOSION_CATEGORY,
            mask: 0, // No collisions
          },
        });
        
        // Give sparkles a short lifespan and gentle motion
        const velocity = {
          x: (Math.random() - 0.5) * 2,
          y: (Math.random() - 0.5) * 2 - 1 // Slight upward bias
        };
        Matter.Body.setVelocity(sparkle, velocity);
        
        this.celebrationParticles.push(sparkle);
        Matter.Composite.add(this.engine.world, sparkle);
        
        // Remove sparkle after a short time
        setTimeout(() => {
          if (this.celebrationParticles.includes(sparkle)) {
            Matter.Composite.remove(this.engine.world, sparkle);
            this.celebrationParticles.splice(this.celebrationParticles.indexOf(sparkle), 1);
          }
        }, 1000);
      }
    }
  }
  
    private updateExplosionParticles() {
    if (!this.isGameDead || this.explosionParticles.length === 0) {
      return;
    }
    
    const elapsed = Date.now() - this.explosionStartTime;
    const progress = elapsed / this.explosionDuration;
    const time = Date.now();
    
    // Update particle appearance based on time with enhanced effects
    for (let i = 0; i < this.explosionParticles.length; i++) {
      const particle = this.explosionParticles[i];
      if (!particle.render || !particle.render.fillStyle) continue;
      
      const baseColor = particle.render.fillStyle as string;
      
      // Calculate alpha with more dramatic fade curve
      let alpha;
      if (progress < 0.2) {
        // Start bright and stay bright for initial impact
        alpha = 1.0;
      } else if (progress < 0.7) {
        // Gradual fade
        alpha = 1.0 - ((progress - 0.2) / 0.5) * 0.6;
      } else {
        // Rapid final fade
        alpha = 0.4 * (1 - ((progress - 0.7) / 0.3));
      }
      
      // Add pulsing effect for larger particles (chunks and medium particles)
      const particleRadius = (particle as any).circleRadius || particle.bounds.max.x - particle.bounds.min.x;
      if (particleRadius > 6) { // Large and medium particles
        const pulseSpeed = 0.008 + (i % 3) * 0.002; // Vary pulse speed per particle
        const pulse = Math.sin(time * pulseSpeed + i) * 0.3 + 0.7; // 0.4 to 1.0
        alpha *= pulse;
      }
      
      // Add flickering effect for sparks
      if (particleRadius <= 6) { // Small sparks
        const flickerChance = 0.15; // 15% chance to flicker per frame
        if (Math.random() < flickerChance) {
          alpha *= 0.3; // Dim the spark momentarily
        }
      }
      
      // Color temperature shift over time (hot to cool)
      let finalColor = baseColor;
      if (baseColor.startsWith('#')) {
        const r = parseInt(baseColor.substr(1, 2), 16);
        const g = parseInt(baseColor.substr(3, 2), 16);
        const b = parseInt(baseColor.substr(5, 2), 16);
        
        // Shift colors cooler over time for more realistic fire effect
        const coolFactor = progress * 0.3; // Don't cool too much
        const cooledR = Math.max(0, r - coolFactor * 80);
        const cooledG = Math.max(0, g - coolFactor * 40);
        const cooledB = Math.min(255, b + coolFactor * 60); // Slight blue shift
        
        finalColor = `rgba(${Math.round(cooledR)}, ${Math.round(cooledG)}, ${Math.round(cooledB)}, ${Math.max(0, alpha)})`;
      } else {
        // Fallback for colors that don't start with #
        finalColor = `rgba(255, 100, 0, ${Math.max(0, alpha)})`;
      }
      
      particle.render.fillStyle = finalColor;
      
      // Update stroke with complementary effect
      if (particle.render.strokeStyle) {
        const strokeAlpha = Math.min(alpha * 1.5, 1.0); // Stroke stays visible longer
        particle.render.strokeStyle = `rgba(255, 255, 255, ${Math.max(0, strokeAlpha)})`;
      }
    }
    
    // Remove explosion particles after duration
    if (progress >= 1) {
      Matter.Composite.remove(this.engine.world, this.explosionParticles);
      this.explosionParticles = [];
    }
  }

  private updateCashOutCelebration() {
    if (!this.isCashOutCelebrating) return;
    
    const elapsed = Date.now() - this.celebrationStartTime;
    const progress = elapsed / this.celebrationDuration;

    if (progress >= 1) {
      // Celebration effects complete - stop celebrating but don't reset game yet
      this.finishCashOutEffects();
    } else {
      // Update all celebration effects
      this.updateCashOutEffects(progress);
      this.updateCelebrationParticles();
      this.updateCelebrationBall(progress);
    }
  }

  private updateCashOutEffects(progress: number) {
    // The old simple green effects are now replaced by the spectacular celebration system
    // This method now handles the golden background overlay effect
    this.updateScreenGoldenOverlay(progress);
  }

  private updateScreenGoldenOverlay(progress: number) {
    // Create a subtle golden background overlay that complements the particles
    const time = Date.now();
    const pulse = Math.sin(time * 0.01) * 0.5 + 0.5; // Gentle pulsing
    
    // Golden overlay that starts strong and fades gradually
    let overlayAlpha;
    if (progress < 0.2) {
      overlayAlpha = 0.15 * pulse; // Start with golden glow
    } else if (progress < 0.7) {
      overlayAlpha = 0.15 * pulse * (1 - ((progress - 0.2) / 0.5) * 0.8); // Gentle fade
    } else {
      overlayAlpha = 0.03 * pulse; // Very subtle by the end
    }
    
    const goldenOverlay = `rgba(255, 215, 0, ${overlayAlpha})`;
    
    // Apply golden tint to the render background
    if (this.render.options) {
      this.render.options.background = goldenOverlay;
    }
  }

  private finishCashOutEffects() {
    console.log('Finishing cash out effects...');
    
    // Reset celebration state
    this.isCashOutCelebrating = false;
    this.celebratingBall = null;

    // Clean up celebration particles
    if (this.celebrationParticles.length > 0) {
      Matter.Composite.remove(this.engine.world, this.celebrationParticles);
      this.celebrationParticles = [];
    }

    // Clean up particle lifecycle data
    this.particleLifecycleData.clear();

    // Reset render background
    if (this.render.options) {
      this.render.options.background = '#000000';
    }
    
    // Set flag that cash out is complete and waiting for player to start new game
    this.isCashOutComplete = true;
    
    // Update game state for UI reactivity
    this.updateGameState();
    
    console.log('Cash out effects finished. Press spacebar or reset button to start new game.');
  }

  private completeCashOut() {
    // Remove the tracked ball and clean up
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
    this.currentMultiplier = 0.0;
    currentMultiplier.set(this.currentMultiplier);
    this.startingRowY = null;

    // Reset camera view to initial position
    Matter.Render.lookAt(this.render, {
      min: { x: 0, y: 0 },
      max: { x: PlinkoEngine.WIDTH, y: PlinkoEngine.HEIGHT }
    });

    // Create a new ready ball
    this.createReadyBall();

    console.log('Cash out complete');
  }

  start() {
    this.isRunning = true;
    this.lastPhysicsTime = performance.now();
    this.physicsAccumulator = 0;
    
    this.createReadyBall();

    // Initialize game state for UI reactivity
    this.updateGameState();

    // Add event listener for ready ball movement
    Matter.Events.on(this.engine, 'beforeUpdate', () => {
      this.updateReadyBall();
    });

    // Add keyboard event listener
    window.addEventListener('keydown', this.keydownHandler);
    
    // Start our custom timing loop
    this.startFixedTimestepLoop();
  }

  stop() {
    this.isRunning = false;
    
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    
    Matter.Runner.stop(this.runner);
    Matter.Render.stop(this.render);
    Matter.Engine.clear(this.engine);
    
    // Stop preview passage animations and clean up timers
    this.stopAllPreviewOpacityAnimations();
    
    // Clean up audio manager
    this.audioManager.destroy();
    
    // Remove keyboard event listener
    window.removeEventListener('keydown', this.keydownHandler);
  }

  private startFixedTimestepLoop() {
    if (!this.isRunning) return;
    
    const currentTime = performance.now();
    const deltaTime = currentTime - this.lastPhysicsTime;
    this.lastPhysicsTime = currentTime;
    
    // Accumulate time since last frame
    this.physicsAccumulator += deltaTime;
    
    // Run physics updates at fixed timestep, regardless of display refresh rate
    let physicsUpdates = 0;
    const maxPhysicsUpdates = 5; // Prevent spiral of death if game falls behind
    
    while (this.physicsAccumulator >= this.FIXED_TIMESTEP && physicsUpdates < maxPhysicsUpdates) {
      // Update physics with fixed timestep
      Matter.Engine.update(this.engine, this.FIXED_TIMESTEP);
      
      this.physicsAccumulator -= this.FIXED_TIMESTEP;
      physicsUpdates++;
    }
    
    // Cap accumulator to prevent spiral of death
    if (this.physicsAccumulator > this.FIXED_TIMESTEP * maxPhysicsUpdates) {
      this.physicsAccumulator = this.FIXED_TIMESTEP;
    }
    
    // Render the current state (interpolation could be added here for smoother visuals)
    Matter.Render.world(this.render);
    
    // Schedule next frame
    this.animationFrameId = requestAnimationFrame(() => this.startFixedTimestepLoop());
  }

  private updateCamera() {
    if (!this.trackedBall || !this.isCameraTracking) return;

    // Get the ball's vertical position
    const ballY = this.trackedBall.position.y;

    // Update multiplier based on rows passed
    if (this.startingRowY !== null) {
      // Calculate rows passed using the new progressive spacing system
      const currentRowIndex = this.getRowIndexFromY(ballY);
      const startingRowIndex = this.getRowIndexFromY(this.startingRowY);
      const rowsPassed = Math.max(0, currentRowIndex - startingRowIndex);
      
      // Progressive multiplier with slower acceleration: 0.00x -> 0.05x -> 0.10x -> 0.16x -> 0.22x -> 0.29x...
      // Increment increases by 0.01x every 2 rows: +0.05x, +0.05x, +0.06x, +0.06x, +0.07x, +0.07x...
      let newMultiplier = 0.0;
      if (rowsPassed > 0) {
        const completePairs = Math.floor((rowsPassed - 1) / 2);
        const remainingRows = rowsPassed - (completePairs * 2);
        const currentPairIncrement = 0.05 + 0.01 * completePairs;
        
        // Sum of all complete pairs
        const completePairsSum = completePairs > 0 ? 
          2 * (0.05 * completePairs + 0.005 * (completePairs - 1) * completePairs) : 0;
        
        // Add remaining rows in current pair
        newMultiplier = completePairsSum + (remainingRows * currentPairIncrement);
      }
      
      // Only update if the multiplier has changed
      if (newMultiplier !== this.currentMultiplier) {
        this.currentMultiplier = newMultiplier;
        currentMultiplier.set(this.currentMultiplier); // Update the store for reactivity
        
        // Play progressive multiplier tone
        this.audioManager.playMultiplierTone(this.currentMultiplier);
        
        console.log('Multiplier Update:', {
          ballY,
          startingRowY: this.startingRowY,
          currentRowIndex,
          startingRowIndex,
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
      this.currentMultiplier = 0.0;
      currentMultiplier.set(this.currentMultiplier);
    }
  }

  private manageDynamicRows() {
    const { HEIGHT, VIEWPORT_BUFFER } = PlinkoEngine;
    
    // Calculate viewport boundaries with buffer
    const viewportTop = this.cameraY - (HEIGHT * VIEWPORT_BUFFER);
    const viewportBottom = this.cameraY + HEIGHT + (HEIGHT * VIEWPORT_BUFFER);

    // Generate new rows if needed
    if (this.cameraY > this.lastGeneratedRowY - HEIGHT) {
      // Calculate the current highest row index
      let currentRowIndex = this.getRowIndexFromY(this.lastGeneratedRowY);
      
      // Generate rows until we cover the viewport
      let nextRowY = this.getRowYPosition(currentRowIndex + 1);
      
      while (nextRowY <= viewportBottom) {
        if (!this.rowPinPositions.has(nextRowY)) {
          const rowIndex = this.getRowIndexFromY(nextRowY);
          const isOffset = rowIndex % 2 === 1;
          
          // Use the current pin count for this risk level
          this.createRowOfPins(nextRowY, this.currentPinsPerRow, isOffset);
        }
        
        // Move to next row
        currentRowIndex++;
        nextRowY = this.getRowYPosition(currentRowIndex + 1);
      }
      
      // Update lastGeneratedRowY to the last row we actually generated
      this.lastGeneratedRowY = this.getRowYPosition(currentRowIndex);
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
        
        // Also clean up cash out passage for this row
        const cashOutPassage = this.rowCashOutPassages.get(rowY);
        if (cashOutPassage) {
          Matter.Composite.remove(this.engine.world, cashOutPassage);
          this.cashOutPassages = this.cashOutPassages.filter(cp => cp !== cashOutPassage);
          this.rowCashOutPassages.delete(rowY);
        }
        
        // Also clean up preview passages for this row
        const previewPassages = this.rowPreviewPassages.get(rowY);
        if (previewPassages) {
          Matter.Composite.remove(this.engine.world, previewPassages);
          this.previewPassages = this.previewPassages.filter(pp => !previewPassages.includes(pp));
          this.rowPreviewPassages.delete(rowY);
          this.stopPreviewOpacityAnimation(rowY);
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

    // Position the ready ball in the center of the current game area
    const gameAreaCenterX = this.currentGameAreaPaddingX + (this.currentGameAreaWidth / 2);

    this.readyBall = Matter.Bodies.circle(
      gameAreaCenterX,
      PlinkoEngine.PADDING_TOP - 20, // Position ball 20 units above the first row of pegs
      PlinkoEngine.BALL_RADIUS,
      {
        isStatic: true, // Make it static so it doesn't fall
        render: {
          fillStyle: '#A3E635',
        },
        collisionFilter: {
          category: PlinkoEngine.BALL_CATEGORY,
          mask: 0, // No collisions while in ready state
        },
      }
    );

    Matter.Composite.add(this.engine.world, this.readyBall);
    
    // Preview passages are already created and animating from createPreviewPassages calls
  }

  private updateReadyBall() {
    if (!this.readyBall) return;

    const currentX = this.readyBall.position.x;
    const leftBoundary = this.currentGameAreaPaddingX;
    const rightBoundary = this.currentGameAreaPaddingX + this.currentGameAreaWidth;
    
    // Change direction if reaching bounds
    if (currentX >= rightBoundary) {
      this.readyBallDirection = -1;
    } else if (currentX <= leftBoundary) {
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

    // Play ball drop sound and unlock audio context if needed
    this.audioManager.unlockAudio(); // This will unlock audio on first user interaction
    this.audioManager.playBallDropSound();

    // Generate final passage positions (this will stop preview animations and create actual passages)
    console.log('Stopping preview animations and generating final passage positions...');
    
    // Generate final passage positions one last time
    this.generateFinalPassagePositions();

    // Reset multiplier and set starting row
    this.currentMultiplier = 0.0;
    currentMultiplier.set(this.currentMultiplier); // Update the store
    this.startingRowY = this.getRowYPosition(0); // Set to first row of pins instead of ready ball position
    console.log('Starting row Y set to:', this.startingRowY);

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
          mask: PlinkoEngine.PIN_CATEGORY | PlinkoEngine.WALL_CATEGORY | PlinkoEngine.DEATH_PASSAGE_CATEGORY | PlinkoEngine.CASH_OUT_PASSAGE_CATEGORY,
        },
        render: {
          fillStyle: '#A3E635',
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

    // Update game state for UI reactivity
    this.updateGameState();

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
        this.currentMultiplier = 0.0;
        currentMultiplier.set(this.currentMultiplier);
        // Create a new ready ball for the next game
        this.createReadyBall();
      }
    });
  }

  private generateFinalPassagePositions() {
    console.log('Generating final passage positions and replacing preview passages...');
    
    // Stop all preview animations first
    this.stopAllPreviewOpacityAnimations();
    
    // Get all unique row Y positions that have preview passages
    const allRowsWithPreviews = new Set<number>();
    this.rowPreviewPassages.forEach((_, rowY) => allRowsWithPreviews.add(rowY));
    
    // For each row, remove preview passages and create actual passages
    for (const rowY of allRowsWithPreviews) {
      // Calculate row index to determine passage type using progressive spacing
      const rowIndex = this.getRowIndexFromY(rowY);
      const isOffset = rowIndex % 2 === 1;
      const isDeathRow = (rowIndex + 1) % 2 === 0;
      
      // Remove preview passages for this row
      const previewPassages = this.rowPreviewPassages.get(rowY);
      if (previewPassages) {
        Matter.Composite.remove(this.engine.world, previewPassages);
        // Remove from main preview passages array
        this.previewPassages = this.previewPassages.filter(p => !previewPassages.includes(p));
      }
      
      // Create actual passage for this row
      if (isDeathRow) {
        this.createDeathPassage(rowY, isOffset);
      } else {
        this.createCashOutPassage(rowY, isOffset);
      }
    }
    
    // Clear all preview passage data
    this.rowPreviewPassages.clear();
    this.previewPassages = [];
    
    console.log('Final passage positions set - preview passages replaced with actual passages!');
  }

  cashOut() {
    // This method is now only called automatically when ball hits a cash out passage
    // Manual cash out has been removed - players must wait for passages
    
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

    // Play cash out success sound
    this.audioManager.playCashOutSound(displayedMultiplier);

    // Set celebration state and create spectacular celebration effects
    this.celebratingBall = this.trackedBall; // Set the celebrating ball first
    
    // Freeze the ball immediately by making it static
    if (this.celebratingBall) {
      Matter.Body.setStatic(this.celebratingBall, true);
      // Also zero out any velocity to ensure it stops completely
      Matter.Body.setVelocity(this.celebratingBall, { x: 0, y: 0 });
      
      // Create the spectacular cash out celebration at the ball's position
      this.createCashOutCelebration(this.celebratingBall.position.x, this.celebratingBall.position.y);
    }
    
    // Stop camera tracking immediately - game is paused during celebration
    this.isCameraTracking = false;

    // Update game state for UI reactivity
    this.updateGameState();

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
          this.handleDeathGameOver();
          break; // Only handle the first collision
        } else {
          console.log('Ball hit death passage but was moving upward, ignoring collision.');
        }
      }
    }
  }

  private handleCashOutPassageCollision(event: Matter.IEventCollision<Matter.Engine>) {
    const pairs = event.pairs;
    
    for (const pair of pairs) {
      const { bodyA, bodyB } = pair;
      
      // Check if one body is a ball and the other is a cash out passage
      let ball: Matter.Body | null = null;
      let cashOutPassage: Matter.Body | null = null;
      
      if (bodyA.collisionFilter.category === PlinkoEngine.BALL_CATEGORY && 
          bodyB.collisionFilter.category === PlinkoEngine.CASH_OUT_PASSAGE_CATEGORY) {
        ball = bodyA;
        cashOutPassage = bodyB;
      } else if (bodyB.collisionFilter.category === PlinkoEngine.BALL_CATEGORY && 
                 bodyA.collisionFilter.category === PlinkoEngine.CASH_OUT_PASSAGE_CATEGORY) {
        ball = bodyB;
        cashOutPassage = bodyA;
      }
      
      // If we found a ball-cash out passage collision and it's the tracked ball
      if (ball && cashOutPassage && ball === this.trackedBall) {
        // Additional check: only trigger cash out if ball is moving downward
        // This prevents false positives when ball bounces off nearby pegs
        if (ball.velocity.y > 0) {
          console.log('Ball hit cash out passage while moving downward! Auto cash out.');
          this.cashOut(); // Use the existing cash out method
          break; // Only handle the first collision
        } else {
          console.log('Ball hit cash out passage but was moving upward, ignoring collision.');
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

    // Play death explosion sound
    this.audioManager.playDeathSound();

    // CREATE THE EXPLOSION! 🎆💥
    this.createExplosion(explosionX, explosionY);

    // Update game state for UI reactivity
    this.updateGameState();

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
    return this.trackedBall !== null && !this.isCashOutCelebrating && !this.isCashOutComplete;
  }

  // Add method to check if game is dead (hit death passage)
  public getIsGameDead(): boolean {
    return this.isGameDead;
  }

  // Add method to check if cash out celebration is in progress
  public getIsCashOutCelebrating(): boolean {
    return this.isCashOutCelebrating;
  }

  // Add method to check if cash out is complete
  public getIsCashOutComplete(): boolean {
    return this.isCashOutComplete;
  }

  // Update the reactive game state store
  private updateGameState() {
    gameState.set({
      isGameInProgress: this.isGameInProgress(),
      isGameDead: this.isGameDead,
      isCashOutCelebrating: this.isCashOutCelebrating,
      isCashOutComplete: this.isCashOutComplete
    });
  }

  // Audio control methods
  public setAudioMuted(muted: boolean) {
    this.audioManager.setMuted(muted);
  }

  public toggleAudioMute() {
    this.audioManager.toggleMute();
  }

  // Add reset method to allow starting a new game
  public resetGame() {
    console.log('Resetting game...');
    
    // Stop any ongoing preview passage animations first
    this.stopAllPreviewOpacityAnimations();
    
    // Clear explosion state first
    this.isGameDead = false;
    this.explosionStartTime = 0;
    
    // Clear celebration state
    this.isCashOutCelebrating = false;
    this.isCashOutComplete = false;
    this.celebratingBall = null;
    this.celebrationStartTime = 0;
    
    // Reset render background to clear any green flash effects
    if (this.render.options) {
      this.render.options.background = '#000000';
    }
    
    // Remove explosion particles if any
    if (this.explosionParticles.length > 0) {
      Matter.Composite.remove(this.engine.world, this.explosionParticles);
      this.explosionParticles = [];
    }
    
    // Remove celebration particles if any
    if (this.celebrationParticles.length > 0) {
      Matter.Composite.remove(this.engine.world, this.celebrationParticles);
      this.celebrationParticles = [];
    }
    
    // Clean up particle lifecycle data
    this.particleLifecycleData.clear();
    
    // Complete any ongoing cash out celebration first
    if (this.isCashOutCelebrating || this.isCashOutComplete) {
      this.completeCashOut();
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
    this.currentMultiplier = 0.0;
    currentMultiplier.set(this.currentMultiplier);
    this.startingRowY = null;
    
    // Reset camera view to initial position
    Matter.Render.lookAt(this.render, {
      min: { x: 0, y: 0 },
      max: { x: PlinkoEngine.WIDTH, y: PlinkoEngine.HEIGHT }
    });
    
    // Completely regenerate the pin grid and passages
    this.placePinsAndWalls();
    
    // Create a new ready ball
    this.createReadyBall();
    
    // Update game state for UI reactivity
    this.updateGameState();
    
    console.log('Game reset complete - ready for new game!');
  }
}
