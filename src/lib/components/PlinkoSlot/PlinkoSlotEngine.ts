/**
 * Plinko Slot Engine
 * 
 * Deterministic physics simulation for the Plinko Slot game.
 * - Uses Matter.js with fixed timestep for determinism
 * - Tracks peg state (color levels based on unique ball hits)
 * - Manages 10-ball sequential drops
 * - All randomness flows through seeded RNG
 */

import Matter from 'matter-js';
import { SeededRNG } from '$lib/utils/rng';
import { ProvablyFairManager, createProvablyFairSeed } from '$lib/utils/provablyFair';
import { evaluatePayout } from './PayoutEvaluator';
import type { 
  Peg, 
  Ball, 
  RunState, 
  PayoutResult, 
  ReplayLog,
  PaytableConfig 
} from './types';
import type { ProvablyFairSeed } from '$lib/utils/provablyFair';
import paytableDefault from './paytable.json';

// Collision categories
const CATEGORY_PIN = 0x0001;
const CATEGORY_BALL = 0x0002;
const CATEGORY_WALL = 0x0004;

/**
 * Event callbacks for UI updates.
 */
export interface PlinkoSlotCallbacks {
  onPegHit?: (pegId: string, newLevel: number, ballId: number) => void;
  onBallDropped?: (ballId: number, spawnX: number) => void;
  onBallExited?: (ballId: number) => void;
  onRunComplete?: (result: PayoutResult) => void;
  onPhaseChange?: (phase: RunState['phase']) => void;
}

/**
 * Main engine class for Plinko Slot.
 */
export class PlinkoSlotEngine {
  // Canvas and rendering
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  
  // Matter.js components
  private engine: Matter.Engine;
  private runner: Matter.Runner;
  private render: Matter.Render;
  
  // Game configuration
  private config: PaytableConfig;
  
  // Board state
  private pegs: Map<string, Peg> = new Map();
  private pegBodies: Map<string, Matter.Body> = new Map();
  private balls: Ball[] = [];
  private ballBodies: Map<number, Matter.Body> = new Map();
  
  // Provably fair
  private fairManager: ProvablyFairManager;
  private currentSeed: ProvablyFairSeed | null = null;
  private rng: SeededRNG | null = null;
  
  // Run state
  private runState: RunState | null = null;
  private replayLog: ReplayLog | null = null;
  
  // Timing
  private isRunning = false;
  private ballDropTimer: ReturnType<typeof setTimeout> | null = null;
  
  // Callbacks
  private callbacks: PlinkoSlotCallbacks = {};
  
  // Dimensions
  static readonly WIDTH = 836;
  static readonly HEIGHT = 627;
  private static readonly PADDING_X = 52;
  private static readonly PADDING_TOP = 36;
  private static readonly PADDING_BOTTOM = 28;

  // Sensor for detecting ball exits
  private sensor: Matter.Body | null = null;
  private walls: Matter.Body[] = [];

  constructor(canvas: HTMLCanvasElement, config?: PaytableConfig) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.config = config ?? (paytableDefault as PaytableConfig);
    
    // Initialize provably fair manager
    this.fairManager = new ProvablyFairManager();
    
    // Create Matter.js engine with fixed timestep
    this.engine = Matter.Engine.create({
      timing: {
        timeScale: 1,
      },
    });
    
    // Fixed timestep runner for determinism
    this.runner = Matter.Runner.create({
      delta: 1000 / 60, // Fixed 60 FPS - 16.666ms
      isFixed: true,
    });
    
    // Create renderer
    this.render = Matter.Render.create({
      engine: this.engine,
      canvas: this.canvas,
      options: {
        width: PlinkoSlotEngine.WIDTH,
        height: PlinkoSlotEngine.HEIGHT,
        background: '#000000',
        wireframes: false,
      },
    });

    // Set up collision detection
    this.setupCollisionHandling();
  }

  /**
   * Set event callbacks.
   */
  setCallbacks(callbacks: PlinkoSlotCallbacks): void {
    this.callbacks = callbacks;
  }

  /**
   * Get provably fair state for display.
   */
  getFairState() {
    return {
      serverSeedHash: this.fairManager.serverSeedHash,
      clientSeed: this.fairManager.clientSeed,
      nonce: this.fairManager.nonce,
    };
  }

  /**
   * Set client seed.
   */
  setClientSeed(seed: string): void {
    this.fairManager.clientSeed = seed;
  }

  /**
   * Rotate server seed and get revealed seed for verification.
   */
  rotateServerSeed() {
    return this.fairManager.rotateServerSeed();
  }

  /**
   * Get current run state (read-only).
   */
  getRunState(): RunState | null {
    return this.runState ? { ...this.runState } : null;
  }

  /**
   * Get current peg states.
   */
  getPegs(): Map<string, Peg> {
    return new Map(this.pegs);
  }

  /**
   * Initialize and start the engine.
   */
  start(): void {
    this.setupBoard();
    Matter.Render.run(this.render);
    Matter.Runner.run(this.runner, this.engine);
    this.isRunning = true;
  }

  /**
   * Stop the engine.
   */
  stop(): void {
    this.isRunning = false;
    
    if (this.ballDropTimer) {
      clearTimeout(this.ballDropTimer);
      this.ballDropTimer = null;
    }
    
    Matter.Render.stop(this.render);
    Matter.Runner.stop(this.runner);
  }

  /**
   * Set up the Plinko board (pegs, walls, sensor).
   */
  private setupBoard(): void {
    // Clear existing bodies
    Matter.Composite.clear(this.engine.world, false);
    this.pegs.clear();
    this.pegBodies.clear();
    this.walls = [];

    const { WIDTH, HEIGHT, PADDING_X, PADDING_TOP, PADDING_BOTTOM } = PlinkoSlotEngine;
    const rowCount = this.config.board.rows;
    
    // Calculate spacing
    const lastRowPinCount = 3 + rowCount - 1;
    const pinDistanceX = (WIDTH - PADDING_X * 2) / (lastRowPinCount - 1);
    const pinRadius = (24 - rowCount) / 2;

    // Store last row X coords for bin detection
    const lastRowXCoords: number[] = [];

    // Create pegs row by row
    for (let row = 0; row < rowCount; row++) {
      const rowY = PADDING_TOP + 
        ((HEIGHT - PADDING_TOP - PADDING_BOTTOM) / (rowCount - 1)) * row;
      
      const rowPaddingX = PADDING_X + ((rowCount - 1 - row) * pinDistanceX) / 2;
      const pinsInRow = 3 + row;

      for (let col = 0; col < pinsInRow; col++) {
        const colX = rowPaddingX + ((WIDTH - rowPaddingX * 2) / (pinsInRow - 1)) * col;
        
        // Create peg data
        const pegId = `${row}-${col}`;
        const peg: Peg = {
          id: pegId,
          row,
          col,
          level: 0,
          hitMask: 0,
          x: colX,
          y: rowY,
        };
        this.pegs.set(pegId, peg);

        // Create Matter.js body
        const body = Matter.Bodies.circle(colX, rowY, pinRadius, {
          isStatic: true,
          restitution: this.config.physics.restitution,
          label: `peg-${pegId}`,
          render: {
            fillStyle: this.config.pegColors['0'],
          },
          collisionFilter: {
            category: CATEGORY_PIN,
            mask: CATEGORY_BALL,
          },
        });
        
        this.pegBodies.set(pegId, body);
        Matter.Composite.add(this.engine.world, body);

        if (row === rowCount - 1) {
          lastRowXCoords.push(colX);
        }
      }
    }

    // Create angled walls
    const firstPegX = this.pegs.get('0-0')!.x;
    const leftWallAngle = Math.atan2(
      firstPegX - lastRowXCoords[0],
      HEIGHT - PADDING_TOP - PADDING_BOTTOM
    );
    const leftWallX = firstPegX - (firstPegX - lastRowXCoords[0]) / 2 - pinDistanceX * 0.25;

    const leftWall = Matter.Bodies.rectangle(
      leftWallX,
      HEIGHT / 2,
      10,
      HEIGHT,
      {
        isStatic: true,
        angle: leftWallAngle,
        render: { visible: false },
        collisionFilter: {
          category: CATEGORY_WALL,
          mask: CATEGORY_BALL,
        },
      }
    );

    const rightWall = Matter.Bodies.rectangle(
      WIDTH - leftWallX,
      HEIGHT / 2,
      10,
      HEIGHT,
      {
        isStatic: true,
        angle: -leftWallAngle,
        render: { visible: false },
        collisionFilter: {
          category: CATEGORY_WALL,
          mask: CATEGORY_BALL,
        },
      }
    );

    this.walls = [leftWall, rightWall];
    Matter.Composite.add(this.engine.world, this.walls);

    // Create bottom sensor
    this.sensor = Matter.Bodies.rectangle(
      WIDTH / 2,
      HEIGHT + 5,
      WIDTH,
      10,
      {
        isSensor: true,
        isStatic: true,
        label: 'sensor',
        render: { visible: false },
      }
    );
    Matter.Composite.add(this.engine.world, this.sensor);
  }

  /**
   * Set up collision event handling.
   */
  private setupCollisionHandling(): void {
    Matter.Events.on(this.engine, 'collisionStart', (event) => {
      for (const pair of event.pairs) {
        this.handleCollision(pair.bodyA, pair.bodyB);
      }
    });
  }

  /**
   * Handle a collision between two bodies.
   */
  private handleCollision(bodyA: Matter.Body, bodyB: Matter.Body): void {
    // Check for ball-peg collision
    const [ball, peg] = this.identifyBallPeg(bodyA, bodyB);
    
    if (ball && peg) {
      this.handleBallPegCollision(ball, peg);
      return;
    }

    // Check for ball-sensor collision (ball exited)
    if (bodyA === this.sensor || bodyB === this.sensor) {
      const ballBody = bodyA === this.sensor ? bodyB : bodyA;
      this.handleBallExit(ballBody);
    }
  }

  /**
   * Identify ball and peg bodies from collision pair.
   */
  private identifyBallPeg(
    bodyA: Matter.Body, 
    bodyB: Matter.Body
  ): [Matter.Body | null, string | null] {
    let ball: Matter.Body | null = null;
    let pegId: string | null = null;

    if (bodyA.label?.startsWith('ball-')) {
      ball = bodyA;
    } else if (bodyB.label?.startsWith('ball-')) {
      ball = bodyB;
    }

    if (bodyA.label?.startsWith('peg-')) {
      pegId = bodyA.label.replace('peg-', '');
    } else if (bodyB.label?.startsWith('peg-')) {
      pegId = bodyB.label.replace('peg-', '');
    }

    return [ball, pegId];
  }

  /**
   * Handle ball hitting a peg.
   */
  private handleBallPegCollision(ballBody: Matter.Body, pegId: string): void {
    if (!this.runState) return;

    // Extract ball ID from label
    const ballId = parseInt(ballBody.label.replace('ball-', ''), 10);
    const peg = this.pegs.get(pegId);
    
    if (!peg) return;

    // Check if this ball has already hit this peg (unique ball rule)
    const ballBit = 1 << (ballId - 1);
    if ((peg.hitMask & ballBit) !== 0) {
      // Ball already hit this peg, no level up
      return;
    }

    // Mark this ball as having hit the peg
    peg.hitMask |= ballBit;
    
    // Level up the peg (max 10)
    if (peg.level < this.config.board.maxPegLevel) {
      peg.level++;
      
      // Update visual
      this.updatePegVisual(pegId, peg.level);
      
      // Record in ball's hit list
      const ball = this.runState.balls[ballId - 1];
      if (ball) {
        ball.pegsHit.push(pegId);
      }

      // Record in replay log
      if (this.replayLog) {
        this.replayLog.collisions.push({
          ballId,
          pegId,
          timestamp: Date.now(),
          newPegLevel: peg.level,
        });
      }

      // Callback
      this.callbacks.onPegHit?.(pegId, peg.level, ballId);
    }
  }

  /**
   * Update peg visual based on level.
   */
  private updatePegVisual(pegId: string, level: number): void {
    const body = this.pegBodies.get(pegId);
    if (!body) return;

    const color = this.config.pegColors[level.toString()] ?? this.config.pegColors['0'];
    body.render.fillStyle = color;

    // Add glow effect for high levels
    if (level >= this.config.pegGlow.thresholdStrong) {
      // Strong glow for level 10
      body.render.strokeStyle = '#FFFFFF';
      body.render.lineWidth = 3;
    } else if (level >= this.config.pegGlow.thresholdSoft) {
      // Soft glow for level 6+
      body.render.strokeStyle = color;
      body.render.lineWidth = 2;
    }
  }

  /**
   * Handle ball exiting the board.
   */
  private handleBallExit(ballBody: Matter.Body): void {
    if (!this.runState) return;

    const ballId = parseInt(ballBody.label.replace('ball-', ''), 10);
    const ball = this.runState.balls[ballId - 1];
    
    if (ball && !ball.exited) {
      ball.exited = true;
      
      // Remove ball from physics
      Matter.Composite.remove(this.engine.world, ballBody);
      this.ballBodies.delete(ballId);

      // Callback
      this.callbacks.onBallExited?.(ballId);

      // Check if all balls done
      this.checkRunComplete();
    }
  }

  /**
   * Start a new 10-ball run.
   */
  async startRun(betAmount: number): Promise<void> {
    if (this.runState?.phase === 'dropping') {
      throw new Error('Run already in progress');
    }

    // Reset board
    this.resetBoard();

    // Get provably fair seed
    this.currentSeed = this.fairManager.getNextSeed();
    this.rng = new SeededRNG(this.currentSeed.combinedSeed);

    // Initialize run state
    const runId = `run-${Date.now()}-${this.currentSeed.nonce}`;
    this.runState = {
      runId,
      phase: 'idle',
      betAmount,
      pegs: this.pegs,
      balls: [],
      currentBallIndex: 0,
      seed: this.currentSeed,
      payoutResult: null,
      startTime: Date.now(),
      endTime: null,
    };

    // Initialize replay log
    this.replayLog = {
      runId,
      seed: this.currentSeed,
      boardConfig: {
        rows: this.config.board.rows,
        ballCount: this.config.board.ballCount,
      },
      ballSpawns: [],
      collisions: [],
      finalPegs: [],
      payoutResult: null!,
    };

    // Create ball states
    for (let i = 1; i <= this.config.board.ballCount; i++) {
      this.runState.balls.push({
        id: i,
        body: null,
        exited: false,
        spawnX: 0,
        spawnTime: 0,
        pegsHit: [],
      });
    }

    // Start dropping
    this.setPhase('dropping');
    this.dropNextBall();
  }

  /**
   * Drop the next ball in the sequence.
   */
  private dropNextBall(): void {
    if (!this.runState || !this.rng) return;
    if (this.runState.currentBallIndex >= this.config.board.ballCount) return;

    const ballId = this.runState.currentBallIndex + 1;
    const ball = this.runState.balls[this.runState.currentBallIndex];
    
    // Calculate spawn position with seeded jitter
    const centerX = PlinkoSlotEngine.WIDTH / 2;
    const jitter = this.rng.jitter(this.config.physics.ballDropJitterX);
    const spawnX = centerX + jitter;
    const spawnY = 0;

    // Update ball state
    ball.spawnX = spawnX;
    ball.spawnTime = Date.now();

    // Record spawn
    this.replayLog?.ballSpawns.push({
      ballId,
      spawnX,
      timestamp: ball.spawnTime,
    });

    // Create physics body
    const rowCount = this.config.board.rows;
    const ballRadius = ((24 - rowCount) / 2) * 2;
    
    const body = Matter.Bodies.circle(spawnX, spawnY, ballRadius, {
      restitution: this.config.physics.restitution,
      friction: this.config.physics.friction,
      frictionAir: this.config.physics.frictionAir,
      label: `ball-${ballId}`,
      render: {
        fillStyle: '#A3E635', // Lime green
      },
      collisionFilter: {
        category: CATEGORY_BALL,
        mask: CATEGORY_PIN | CATEGORY_WALL,
      },
    });

    ball.body = body;
    this.ballBodies.set(ballId, body);
    Matter.Composite.add(this.engine.world, body);

    // Callback
    this.callbacks.onBallDropped?.(ballId, spawnX);

    // Schedule next ball drop
    this.runState.currentBallIndex++;
    
    if (this.runState.currentBallIndex < this.config.board.ballCount) {
      this.ballDropTimer = setTimeout(() => {
        this.dropNextBall();
      }, this.config.physics.ballDropDelayMs);
    }
  }

  /**
   * Check if all balls have exited and complete the run.
   */
  private checkRunComplete(): void {
    if (!this.runState) return;

    const allExited = this.runState.balls.every(b => b.exited);
    const allDropped = this.runState.currentBallIndex >= this.config.board.ballCount;

    if (allExited && allDropped) {
      this.completeRun();
    }
  }

  /**
   * Complete the run and evaluate payout.
   */
  private completeRun(): void {
    if (!this.runState) return;

    this.setPhase('evaluating');

    // Evaluate payout
    const payoutResult = evaluatePayout(this.pegs, this.config);
    this.runState.payoutResult = payoutResult;
    this.runState.endTime = Date.now();

    // Finalize replay log
    if (this.replayLog) {
      this.replayLog.finalPegs = Array.from(this.pegs.values()).map(p => ({
        id: p.id,
        level: p.level,
        hitMask: p.hitMask,
      }));
      this.replayLog.payoutResult = payoutResult;
    }

    this.setPhase('complete');

    // Callback
    this.callbacks.onRunComplete?.(payoutResult);
  }

  /**
   * Reset the board for a new run.
   */
  private resetBoard(): void {
    // Remove all balls
    for (const [, body] of this.ballBodies) {
      Matter.Composite.remove(this.engine.world, body);
    }
    this.ballBodies.clear();
    this.balls = [];

    // Reset all pegs
    for (const [pegId, peg] of this.pegs) {
      peg.level = 0;
      peg.hitMask = 0;
      
      const body = this.pegBodies.get(pegId);
      if (body) {
        body.render.fillStyle = this.config.pegColors['0'];
        body.render.strokeStyle = undefined;
        body.render.lineWidth = 0;
      }
    }

    // Clear timer
    if (this.ballDropTimer) {
      clearTimeout(this.ballDropTimer);
      this.ballDropTimer = null;
    }
  }

  /**
   * Set run phase and notify.
   */
  private setPhase(phase: RunState['phase']): void {
    if (this.runState) {
      this.runState.phase = phase;
      this.callbacks.onPhaseChange?.(phase);
    }
  }

  /**
   * Get replay log for the current/last run.
   */
  getReplayLog(): ReplayLog | null {
    return this.replayLog;
  }

  /**
   * Replay a run from a log (for verification).
   */
  async replayRun(log: ReplayLog): Promise<PayoutResult> {
    // Verify seed produces same combined seed
    const recomputedSeed = createProvablyFairSeed(
      log.seed.clientSeed,
      log.seed.nonce,
      log.seed.serverSeed
    );

    if (recomputedSeed.combinedSeed !== log.seed.combinedSeed) {
      throw new Error('Seed verification failed');
    }

    // Reset and replay
    this.resetBoard();
    this.rng = new SeededRNG(log.seed.combinedSeed);

    // Drop balls at recorded positions
    for (const spawn of log.ballSpawns) {
      // In replay mode, we'd simulate the physics or just verify the log
      // For simplicity, we verify the spawn positions match
      const expectedJitter = this.rng.jitter(this.config.physics.ballDropJitterX);
      const expectedX = PlinkoSlotEngine.WIDTH / 2 + expectedJitter;
      
      if (Math.abs(spawn.spawnX - expectedX) > 0.001) {
        throw new Error(`Ball ${spawn.ballId} spawn position mismatch`);
      }
    }

    // Apply final peg states from log
    for (const pegData of log.finalPegs) {
      const peg = this.pegs.get(pegData.id);
      if (peg) {
        peg.level = pegData.level;
        peg.hitMask = pegData.hitMask;
        this.updatePegVisual(pegData.id, pegData.level);
      }
    }

    // Re-evaluate payout
    const payoutResult = evaluatePayout(this.pegs, this.config);

    // Verify payout matches
    if (payoutResult.totalMultiplier !== log.payoutResult.totalMultiplier) {
      throw new Error('Payout verification failed');
    }

    return payoutResult;
  }

  /**
   * Get pin distance X (for external calculations).
   */
  get pinDistanceX(): number {
    const lastRowPinCount = 3 + this.config.board.rows - 1;
    return (PlinkoSlotEngine.WIDTH - PlinkoSlotEngine.PADDING_X * 2) / (lastRowPinCount - 1);
  }

  /**
   * Get config (read-only).
   */
  getConfig(): PaytableConfig {
    return this.config;
  }
}

export default PlinkoSlotEngine;
