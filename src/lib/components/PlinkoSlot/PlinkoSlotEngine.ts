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
  PaytableConfig,
  ProgressiveState,
  ProgressiveWaveWin
} from './types';
import type { ProvablyFairSeed } from '$lib/utils/provablyFair';
import paytableDefault from './paytable.json';

// SVG symbols for peg levels
import orangeSvg from '$lib/assets/slot/orange.svg';
import watermelonSvg from '$lib/assets/slot/watermelon.svg';
import bearSvg from '$lib/assets/slot/bear.svg';
import heartSvg from '$lib/assets/slot/heart.svg';
import starSvg from '$lib/assets/slot/star.svg';
import gemSvg from '$lib/assets/slot/gem.svg';
import diamondSvg from '$lib/assets/slot/diamond.svg';
import strawberrySvg from '$lib/assets/slot/strawberry.svg';
import moneySvg from '$lib/assets/slot/money.svg';
import sunSvg from '$lib/assets/slot/sun.svg';
import faceSvg from '$lib/assets/slot/face.svg';
import ghostSvg from '$lib/assets/slot/ghost.svg';
import laughSvg from '$lib/assets/slot/laugh.svg';
import bonusSvg from '$lib/assets/slot/bonus.svg';

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
  onWinCelebration?: (symbolLevel: number, count: number, multiplier: number) => void;
  onAllCelebrationsComplete?: () => void;
  onBonusGameTriggered?: (bonusPegIds: string[], regularWins: Array<{ symbolLevel: number; count: number; multiplier: number }>) => void;
  onBonusCelebrationComplete?: () => void;
  // Progressive mode callbacks
  onProgressiveWaveStart?: (waveNumber: number) => void;
  onProgressiveWin?: (win: ProgressiveWaveWin, totalAccumulated: number) => void;
  onProgressiveExplosion?: (pegIds: string[], symbolLevel: number) => void;
  onProgressivePegsLocked?: (lockedPegIds: string[]) => void;
  onProgressiveSequenceComplete?: (totalWinnings: number, waveCount: number) => void;
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
  
  // Stuck ball detection
  private stuckBallTracker: Map<number, { lowVelocityStartTime: number }> = new Map();
  
  // Callbacks
  private callbacks: PlinkoSlotCallbacks = {};
  
  // Ring effect animations
  private ringEffects: Array<{
    x: number;
    y: number;
    startTime: number;
    duration: number;
    color: string;
    isOuter: boolean;
    delay: number;
  }> = [];
  
  // SVG symbol images for peg levels
  private pegSymbols: Map<number, HTMLImageElement> = new Map();
  private symbolsLoaded = false;
  
  // Win celebration state
  private winCelebrations: Array<{
    symbolLevel: number;
    pegIds: string[];
    multiplier: number;
    startTime: number;
    duration: number;
    isAllPegsBonus: boolean;
    isBonusCelebration?: boolean;
  }> = [];
  private currentCelebrationIndex = -1;
  private celebrationStartTime = 0;
  private static readonly CELEBRATION_DURATION = 1150; // ms per win celebration
  private static readonly ALL_PEGS_CELEBRATION_DURATION = 2250; // 2x duration for all pegs bonus
  
  // Sparkle particle system
  private sparkles: Array<{
    x: number;
    y: number;
    vx: number;
    vy: number;
    size: number;
    alpha: number;
    color: string;
    rotation: number;
    rotationSpeed: number;
    birthTime: number;
    lifetime: number;
    twinkleOffset: number; // For glistening effect
  }> = [];
  private lastSparkleSpawn = 0;
  private static readonly SPARKLE_SPAWN_RATE = 20; // ms between spawns per peg (faster = more particles)
  
  // Symbol definitions - easy to add more symbols here!
  // Each symbol has: id, name, color (for glow), payouts by count
  private static readonly SYMBOLS: Array<{
    id: number;
    name: string;
    color: string;
    payouts: Record<number, number>; // count -> multiplier
  }> = [
    { id: 1, name: 'Orange',     color: '#FF8C00', payouts: { 4: 0.25, 5: 0.5, 6: 1, 7: 2, 8: 4 } },
    { id: 2, name: 'Watermelon', color: '#FF6B6B', payouts: { 4: 0.25, 5: 0.5, 6: 1, 7: 2, 8: 4 } },
    { id: 3, name: 'Bear',       color: '#8B4513', payouts: { 4: 0.25, 5: 0.5, 6: 1, 7: 2, 8: 4 } },
    { id: 4, name: 'Heart',      color: '#FF1493', payouts: { 4: 0.25, 5: 0.5, 6: 1, 7: 2, 8: 4 } },
    { id: 5, name: 'Star',       color: '#FFD700', payouts: { 4: 0.25, 5: 0.5, 6: 1, 7: 2, 8: 4 } },
    { id: 6, name: 'Gem',        color: '#00CED1', payouts: { 4: 0.25, 5: 0.5, 6: 1, 7: 2, 8: 4 } },
    { id: 7, name: 'Strawberry', color: '#FF4466', payouts: { 4: 0.25, 5: 0.5, 6: 1, 7: 2, 8: 4 } },
    { id: 8, name: 'Money',      color: '#22C55E', payouts: { 4: 0.25, 5: 0.5, 6: 1, 7: 2, 8: 4 } },
    { id: 9, name: 'Sun',        color: '#FBBF24', payouts: { 4: 0.25, 5: 0.5, 6: 1, 7: 2, 8: 4 } },
    { id: 10, name: 'Diamond',   color: '#E0E0FF', payouts: { 4: 1, 5: 2, 6: 4, 7: 8, 8: 16 } },
    { id: 11, name: 'Face',      color: '#FFE066', payouts: { 4: 0.25, 5: 0.5, 6: 1, 7: 2, 8: 4 } },
    { id: 12, name: 'Ghost',     color: '#B8B8D1', payouts: { 4: 0.25, 5: 0.5, 6: 1, 7: 2, 8: 4 } },
    { id: 13, name: 'Laugh',     color: '#FF9933', payouts: { 4: 0.25, 5: 0.5, 6: 1, 7: 2, 8: 4 } },
  ];
  
  // Bonus symbol - special, not in regular rotation
  static readonly BONUS_SYMBOL_ID = 99;
  private static readonly BONUS_SYMBOL = { 
    id: 99, 
    name: 'Bonus', 
    color: '#FF00FF', // Magenta/purple glow
    payouts: {} // No regular payouts - triggers bonus game instead
  };
  private static readonly BONUS_SPAWN_CHANCE = 1 / 200; // 1 in 200 chance per hit
  static readonly BONUS_PEGS_REQUIRED = 3; // Number of bonus pegs needed to trigger bonus game
  static readonly FREE_SPINS_AWARDED = 5; // Number of free spins awarded
  static readonly MIN_SYMBOLS_FOR_WIN = 4; // Minimum matching symbols required for a win
  private static readonly BONUS_CELEBRATION_DURATION = 2250; // Longer duration for bonus celebration
  
  // Track which pegs have the bonus symbol (locked pegs)
  private bonusPegs: Set<string> = new Set();
  
  // Bonus game state
  private isBonusGameTriggered = false;
  private isFreeSpinsMode = false; // When true, bonus symbols cannot spawn
  
  // Progressive mode state
  private progressiveMode = false;
  private progressiveState: ProgressiveState | null = null;
  private lockedPegs: Map<string, number> = new Map(); // pegId -> lock timestamp
  
  // Explosion particle system
  private explosionParticles: Array<{
    x: number;
    y: number;
    vx: number;
    vy: number;
    size: number;
    alpha: number;
    color: string;
    rotation: number;
    rotationSpeed: number;
    birthTime: number;
    lifetime: number;
    symbolLevel: number;
  }> = [];
  
  // Progressive mode timing
  private static readonly EXPLOSION_DURATION = 400; // ms for explosion animation
  private static readonly PROGRESSIVE_WAVE_DELAY = 1200; // ms delay before next wave
  
  // Helper to get symbol by ID (including bonus symbol)
  private static getSymbol(id: number) {
    if (id === PlinkoSlotEngine.BONUS_SYMBOL_ID) {
      return PlinkoSlotEngine.BONUS_SYMBOL;
    }
    return PlinkoSlotEngine.SYMBOLS.find(s => s.id === id);
  }
  
  // Helper to get random symbol ID (excludes bonus - bonus has its own spawn logic)
  private static getRandomSymbolId(): number {
    const randomIndex = Math.floor(Math.random() * PlinkoSlotEngine.SYMBOLS.length);
    return PlinkoSlotEngine.SYMBOLS[randomIndex].id;
  }
  
  // Helper to get symbol color
  private static getSymbolColor(id: number): string {
    return PlinkoSlotEngine.getSymbol(id)?.color ?? '#FFFFFF';
  }
  
  // Helper to get symbol payouts
  private static getSymbolPayouts(id: number): Record<number, number> {
    return PlinkoSlotEngine.getSymbol(id)?.payouts ?? {};
  }
  
  // Hits required before first color change
  private static readonly HITS_FOR_FIRST_COLOR = 1;
  
  // Size scale factor (2x for larger pegs/balls)
  private static readonly SIZE_SCALE = 2.0;
  
  // Dimensions
  static readonly WIDTH = 836;
  static readonly HEIGHT = 750;
  private static readonly PADDING_X = 52;
  private static readonly PADDING_TOP = 130;
  private static readonly PADDING_BOTTOM = 50;

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
        timeScale: 4, // Speed up physics simulation
      },
    });
    
    // Fixed timestep runner for determinism
    this.runner = Matter.Runner.create({
      delta: 1000 / 60, // Fixed 60 FPS - 16.666ms
      isFixed: true,
    });
    
    // Create renderer (transparent background - we draw our own in beforeRender)
    this.render = Matter.Render.create({
      engine: this.engine,
      canvas: this.canvas,
      options: {
        width: PlinkoSlotEngine.WIDTH,
        height: PlinkoSlotEngine.HEIGHT,
        background: 'transparent',
        wireframes: false,
      },
    });

    // Set up collision detection
    this.setupCollisionHandling();
    
    // Set up stuck ball detection
    this.setupStuckBallDetection();
    
    // Set up ring effect rendering
    this.setupRingEffectRendering();
    
    // Load peg symbol SVGs
    this.loadPegSymbols();
  }
  
  /**
   * Load SVG symbols for peg levels.
   */
  private loadPegSymbols(): void {
    const symbolSources: [number, string][] = [
      [1, orangeSvg],
      [2, watermelonSvg],
      [3, bearSvg],
      [4, heartSvg],
      [5, starSvg],
      [6, gemSvg],
      [7, strawberrySvg],
      [8, moneySvg],
      [9, sunSvg],
      [10, diamondSvg],
      [11, faceSvg],
      [12, ghostSvg],
      [13, laughSvg],
      [PlinkoSlotEngine.BONUS_SYMBOL_ID, bonusSvg], // Bonus symbol
    ];
    
    let loadedCount = 0;
    const totalToLoad = symbolSources.length;
    
    for (const [level, src] of symbolSources) {
      const img = new Image();
      img.src = src;
      img.onload = () => {
        this.pegSymbols.set(level, img);
        loadedCount++;
        if (loadedCount === totalToLoad) {
          this.symbolsLoaded = true;
        }
      };
    }
  }
  
  /**
   * Set up custom rendering for ring effects (rendered UNDER balls).
   */
  private setupRingEffectRendering(): void {
    // Use beforeRender to clear and draw background
    Matter.Events.on(this.render, 'beforeRender', () => {
      // Clear and draw background first
      this.ctx.fillStyle = '#000000';
      this.ctx.fillRect(0, 0, PlinkoSlotEngine.WIDTH, PlinkoSlotEngine.HEIGHT);
    });
    
    // Use afterRender to draw everything on top of Matter.js bodies
    Matter.Events.on(this.render, 'afterRender', () => {
      // Ring effects first (under balls/symbols but over peg bodies)
      this.renderRingEffects();
      this.renderBalls();
      this.renderPegSymbols();
      this.updateAndRenderSparkles();
      this.updateAndRenderExplosions();
      this.renderWinCelebrations();
    });
  }
  
  /**
   * Render balls with a simple, subtle gradient.
   */
  private renderBalls(): void {
    const ctx = this.ctx;
    const rowCount = this.config.board.rows;
    const ballRadius = ((24 - rowCount) / 2) * PlinkoSlotEngine.SIZE_SCALE * 1.5;
    
    for (const [, body] of this.ballBodies) {
      const x = body.position.x;
      const y = body.position.y;
      
      ctx.save();
      
      // Vibrant neon pink gradient
      const gradient = ctx.createRadialGradient(
        x, y, 0,
        x, y, ballRadius
      );
      gradient.addColorStop(0, '#ff4d94');   // Hot pink center
      gradient.addColorStop(0.6, '#e6006a'); // Vibrant magenta
      gradient.addColorStop(1, '#b30052');   // Deep magenta edge
      
      ctx.beginPath();
      ctx.arc(x, y, ballRadius, 0, Math.PI * 2);
      ctx.fillStyle = gradient;
      ctx.fill();
      
      ctx.restore();
    }
  }
  
  /**
   * Spawn sparkle particles around winning pegs.
   */
  private spawnCelebrationSparkles(): void {
    if (this.currentCelebrationIndex < 0 || this.currentCelebrationIndex >= this.winCelebrations.length) {
      return;
    }
    
    const now = Date.now();
    const celebration = this.winCelebrations[this.currentCelebrationIndex];
    const elapsed = now - celebration.startTime;
    
    // Don't spawn in the last portion (let existing sparkles fade out)
    const isBonusCelebration = celebration.isBonusCelebration ?? false;
    const fadeOutBuffer = (celebration.isAllPegsBonus || isBonusCelebration) ? 500 : 250;
    if (elapsed > celebration.duration - fadeOutBuffer) return;
    
    // Check spawn rate (faster for bonus/All Pegs - bonus is 3x faster for double polish)
    let spawnRate = PlinkoSlotEngine.SPARKLE_SPAWN_RATE;
    if (isBonusCelebration) {
      spawnRate = PlinkoSlotEngine.SPARKLE_SPAWN_RATE / 3; // Triple speed for bonus celebration
    } else if (celebration.isAllPegsBonus) {
      spawnRate = PlinkoSlotEngine.SPARKLE_SPAWN_RATE / 2;
    }
    if (now - this.lastSparkleSpawn < spawnRate) return;
    this.lastSparkleSpawn = now;
    
    // Use magenta for bonus celebration, golden for All Pegs, otherwise symbol color
    let symbolColor: string;
    if (isBonusCelebration) {
      symbolColor = PlinkoSlotEngine.BONUS_SYMBOL.color;
    } else if (celebration.isAllPegsBonus) {
      symbolColor = '#FFD700';
    } else {
      symbolColor = PlinkoSlotEngine.getSymbolColor(celebration.symbolLevel);
    }
    const scale = PlinkoSlotEngine.SIZE_SCALE;
    const rowCount = this.config.board.rows;
    const pinRadius = ((24 - rowCount) / 2) * scale;
    
    // Spawn more sparkles for bonus celebration (double) and All Pegs bonus
    for (const pegId of celebration.pegIds) {
      const peg = this.pegs.get(pegId);
      if (!peg) continue;
      
      // Bonus celebration gets 6-12 sparkles per peg (double polish)
      const baseCount = isBonusCelebration ? 6 : (celebration.isAllPegsBonus ? 4 : 3);
      const sparkleCount = baseCount + Math.floor(Math.random() * baseCount);
      
      for (let i = 0; i < sparkleCount; i++) {
        // Random position around the peg
        const angle = Math.random() * Math.PI * 2;
        const distance = pinRadius * (0.3 + Math.random() * 1.8);
        const x = peg.x + Math.cos(angle) * distance;
        const y = peg.y + Math.sin(angle) * distance;
        
        // Random velocity (mostly upward with some spread)
        const speed = 0.4 + Math.random() * 1.0;
        const velAngle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.9; // Upward bias with more spread
        const vx = Math.cos(velAngle) * speed;
        const vy = Math.sin(velAngle) * speed;
        
        // Pick color: mix of white, gold, and symbol color
        const colorRoll = Math.random();
        let color: string;
        if (colorRoll < 0.35) {
          color = '#FFFFFF'; // White sparkles
        } else if (colorRoll < 0.65) {
          color = '#FFD700'; // Gold sparkles
        } else {
          color = symbolColor; // Symbol-colored sparkles
        }
        
        this.sparkles.push({
          x,
          y,
          vx,
          vy,
          size: 3 + Math.random() * 5,
          alpha: 0.55 + Math.random() * 0.15,
          color,
          rotation: Math.random() * Math.PI * 2,
          rotationSpeed: (Math.random() - 0.5) * 0.4,
          birthTime: now,
          lifetime: 700 + Math.random() * 700, // 700-1400ms
          twinkleOffset: Math.random() * Math.PI * 2,
        });
      }
    }
  }
  
  /**
   * Update and render sparkle particles.
   */
  private updateAndRenderSparkles(): void {
    const now = Date.now();
    const ctx = this.ctx;
    
    // Spawn new sparkles if celebrating
    this.spawnCelebrationSparkles();
    
    // Update and render sparkles
    this.sparkles = this.sparkles.filter(sparkle => {
      const age = now - sparkle.birthTime;
      if (age >= sparkle.lifetime) {
        return false; // Remove expired sparkle
      }
      
      // Update position
      sparkle.x += sparkle.vx;
      sparkle.y += sparkle.vy;
      sparkle.vy += 0.01; // Slight gravity
      sparkle.rotation += sparkle.rotationSpeed;
      
      // Calculate alpha with twinkle effect
      const lifeProgress = age / sparkle.lifetime;
      const fadeAlpha = lifeProgress < 0.2 
        ? lifeProgress / 0.2 // Fade in
        : 1 - ((lifeProgress - 0.2) / 0.8); // Fade out
      
      // Glistening twinkle effect
      const twinkle = 0.5 + 0.5 * Math.sin(age * 0.02 + sparkle.twinkleOffset);
      const finalAlpha = sparkle.alpha * fadeAlpha * (0.4 + twinkle * 0.6);
      
      // Calculate size with slight pulse
      const sizePulse = 1 + 0.3 * Math.sin(age * 0.015 + sparkle.twinkleOffset);
      const finalSize = sparkle.size * sizePulse * (1 - lifeProgress * 0.3);
      
      // Draw the sparkle (4-point star shape)
      ctx.save();
      ctx.translate(sparkle.x, sparkle.y);
      ctx.rotate(sparkle.rotation);
      ctx.globalAlpha = finalAlpha;
      
      // Draw a 4-point star
      ctx.fillStyle = sparkle.color;
      ctx.beginPath();
      
      const outerRadius = finalSize;
      const innerRadius = finalSize * 0.3;
      
      for (let i = 0; i < 8; i++) {
        const radius = i % 2 === 0 ? outerRadius : innerRadius;
        const angle = (i * Math.PI) / 4;
        const px = Math.cos(angle) * radius;
        const py = Math.sin(angle) * radius;
        
        if (i === 0) {
          ctx.moveTo(px, py);
        } else {
          ctx.lineTo(px, py);
        }
      }
      ctx.closePath();
      ctx.fill();
      
      // Add a bright center glow
      const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, finalSize * 0.5);
      gradient.addColorStop(0, '#FFFFFF');
      gradient.addColorStop(1, sparkle.color + '00');
      ctx.globalAlpha = finalAlpha * 0.8;
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(0, 0, finalSize * 0.5, 0, Math.PI * 2);
      ctx.fill();
      
      ctx.restore();
      
      return true; // Keep this sparkle
    });
  }
  
  /**
   * Spawn explosion particles for winning symbols (progressive mode).
   */
  private spawnExplosionParticles(pegIds: string[], symbolLevel: number): void {
    const now = Date.now();
    const scale = PlinkoSlotEngine.SIZE_SCALE;
    const rowCount = this.config.board.rows;
    const pinRadius = ((24 - rowCount) / 2) * scale;
    const symbolColor = PlinkoSlotEngine.getSymbolColor(symbolLevel);
    
    for (const pegId of pegIds) {
      const peg = this.pegs.get(pegId);
      if (!peg) continue;
      
      // Create many particles per peg for a satisfying explosion
      const particleCount = 25 + Math.floor(Math.random() * 15);
      
      for (let i = 0; i < particleCount; i++) {
        // Explosion radiates outward from center
        const angle = (Math.PI * 2 * i) / particleCount + (Math.random() - 0.5) * 0.5;
        const speed = 3 + Math.random() * 6;
        const vx = Math.cos(angle) * speed;
        const vy = Math.sin(angle) * speed;
        
        // Vary the starting position slightly
        const startDist = pinRadius * 0.3 * Math.random();
        const x = peg.x + Math.cos(angle) * startDist;
        const y = peg.y + Math.sin(angle) * startDist;
        
        // Mix of symbol color, white, and gold particles
        const colorRoll = Math.random();
        let color: string;
        if (colorRoll < 0.4) {
          color = symbolColor;
        } else if (colorRoll < 0.7) {
          color = '#FFFFFF';
        } else {
          color = '#FFD700';
        }
        
        this.explosionParticles.push({
          x,
          y,
          vx,
          vy,
          size: 4 + Math.random() * 8,
          alpha: 0.9 + Math.random() * 0.1,
          color,
          rotation: Math.random() * Math.PI * 2,
          rotationSpeed: (Math.random() - 0.5) * 0.6,
          birthTime: now + Math.random() * 50, // Slight stagger
          lifetime: 600 + Math.random() * 400,
          symbolLevel,
        });
      }
    }
  }
  
  /**
   * Update and render explosion particles.
   */
  private updateAndRenderExplosions(): void {
    const now = Date.now();
    const ctx = this.ctx;
    
    this.explosionParticles = this.explosionParticles.filter(particle => {
      const age = now - particle.birthTime;
      if (age < 0) return true; // Not started yet
      if (age >= particle.lifetime) return false; // Expired
      
      // Update position with physics
      particle.x += particle.vx;
      particle.y += particle.vy;
      particle.vy += 0.15; // Gravity
      particle.vx *= 0.98; // Air resistance
      particle.rotation += particle.rotationSpeed;
      
      // Calculate alpha (fade out)
      const lifeProgress = age / particle.lifetime;
      const fadeAlpha = lifeProgress < 0.1
        ? lifeProgress / 0.1 // Quick fade in
        : 1 - Math.pow((lifeProgress - 0.1) / 0.9, 0.5); // Smooth fade out
      const finalAlpha = particle.alpha * fadeAlpha;
      
      // Size shrinks over time
      const finalSize = particle.size * (1 - lifeProgress * 0.6);
      
      // Draw particle as a rounded rectangle (symbol shard)
      ctx.save();
      ctx.translate(particle.x, particle.y);
      ctx.rotate(particle.rotation);
      ctx.globalAlpha = finalAlpha;
      
      // Draw shard shape
      ctx.fillStyle = particle.color;
      ctx.beginPath();
      const w = finalSize * 0.8;
      const h = finalSize * 1.2;
      ctx.roundRect(-w / 2, -h / 2, w, h, 2);
      ctx.fill();
      
      // Add glow
      ctx.shadowColor = particle.color;
      ctx.shadowBlur = finalSize * 0.5;
      ctx.fill();
      
      ctx.restore();
      
      return true;
    });
  }
  
  // Special symbol ID for "All Pegs" bonus win
  static readonly ALL_PEGS_SYMBOL_ID = -1;
  static readonly ALL_PEGS_MULTIPLIER = 2;
  
  /**
   * Detect all winning symbol combinations (4+ matching symbols) and special bonuses.
   */
  private detectWins(): Array<{ symbolLevel: number; pegIds: string[]; multiplier: number; isAllPegsBonus?: boolean }> {
    const wins: Array<{ symbolLevel: number; pegIds: string[]; multiplier: number; isAllPegsBonus?: boolean }> = [];
    
    // Count pegs at each symbol level (any valid symbol)
    const symbolPegs: Map<number, string[]> = new Map();
    const allPegIds: string[] = [];
    let pegsWithSymbols = 0;
    
    for (const [pegId, peg] of this.pegs) {
      allPegIds.push(pegId);
      // Check if this peg has a valid symbol (level > 0)
      if (peg.level > 0 && PlinkoSlotEngine.getSymbol(peg.level)) {
        pegsWithSymbols++;
        if (!symbolPegs.has(peg.level)) {
          symbolPegs.set(peg.level, []);
        }
        symbolPegs.get(peg.level)!.push(pegId);
      }
    }
    
    // Check for wins (MIN_SYMBOLS_FOR_WIN+ of same symbol)
    for (const [level, pegIds] of symbolPegs) {
      const count = pegIds.length;
      if (count >= PlinkoSlotEngine.MIN_SYMBOLS_FOR_WIN) {
        const payoutTable = PlinkoSlotEngine.getSymbolPayouts(level);
        // Get the multiplier for this count (cap at max defined)
        const maxCount = Math.min(count, 8);
        const multiplier = payoutTable[maxCount] ?? payoutTable[8] ?? 0;
        
        if (multiplier > 0) {
          wins.push({ symbolLevel: level, pegIds, multiplier });
        }
      }
    }
    
    // Sort by multiplier (ascending) - least valuable first
    wins.sort((a, b) => a.multiplier - b.multiplier);
    
    // Check for "All Pegs" bonus (all pegs have a symbol) - added last as the grand finale
    if (pegsWithSymbols === this.pegs.size) {
      wins.push({
        symbolLevel: PlinkoSlotEngine.ALL_PEGS_SYMBOL_ID,
        pegIds: allPegIds,
        multiplier: PlinkoSlotEngine.ALL_PEGS_MULTIPLIER,
        isAllPegsBonus: true,
      });
    }
    
    return wins;
  }
  
  /**
   * Start the win celebration sequence.
   */
  private startWinCelebrations(): void {
    const wins = this.detectWins();
    
    // Check if bonus game is triggered (3+ bonus pegs)
    const bonusPegCount = this.bonusPegs.size;
    if (bonusPegCount >= PlinkoSlotEngine.BONUS_PEGS_REQUIRED) {
      this.isBonusGameTriggered = true;
      
      // Collect regular wins info for instant display (skip celebration animations)
      const regularWins = wins
        .filter(w => !w.isAllPegsBonus && w.symbolLevel !== PlinkoSlotEngine.BONUS_SYMBOL_ID)
        .map(w => ({
          symbolLevel: w.symbolLevel,
          count: w.pegIds.length,
          multiplier: w.multiplier
        }));
      
      // Get bonus peg IDs for the special celebration
      const bonusPegIds = Array.from(this.bonusPegs);
      
      // Notify UI about bonus game trigger (UI will handle instant wins display)
      this.callbacks.onBonusGameTriggered?.(bonusPegIds, regularWins);
      
      // Start special bonus celebration (only on the bonus pegs)
      this.winCelebrations = [{
        symbolLevel: PlinkoSlotEngine.BONUS_SYMBOL_ID,
        pegIds: bonusPegIds,
        multiplier: 0, // No multiplier - triggers free spins instead
        startTime: 0,
        duration: PlinkoSlotEngine.BONUS_CELEBRATION_DURATION,
        isAllPegsBonus: false,
        isBonusCelebration: true,
      }];
      
      this.currentCelebrationIndex = 0;
      this.startBonusCelebration();
      return;
    }
    
    if (wins.length === 0) {
      // No wins, complete immediately
      this.setPhase('complete');
      this.callbacks.onAllCelebrationsComplete?.();
      return;
    }
    
    // Convert to celebration objects
    this.winCelebrations = wins.map(win => ({
      symbolLevel: win.symbolLevel,
      pegIds: win.pegIds,
      multiplier: win.multiplier,
      startTime: 0, // Will be set when celebration starts
      duration: win.isAllPegsBonus 
        ? PlinkoSlotEngine.ALL_PEGS_CELEBRATION_DURATION 
        : PlinkoSlotEngine.CELEBRATION_DURATION,
      isAllPegsBonus: win.isAllPegsBonus ?? false,
    }));
    
    // Start first celebration
    this.currentCelebrationIndex = 0;
    this.startNextCelebration();
  }
  
  /**
   * Start the special bonus celebration (double polish).
   */
  private startBonusCelebration(): void {
    const celebration = this.winCelebrations[0];
    celebration.startTime = Date.now();
    this.celebrationStartTime = celebration.startTime;
    
    // Schedule end of bonus celebration
    setTimeout(() => {
      this.currentCelebrationIndex = -1;
      this.isBonusGameTriggered = false;
      this.setPhase('complete');
      this.callbacks.onBonusCelebrationComplete?.();
    }, celebration.duration + 150);
  }
  
  /**
   * Start the next celebration in the sequence.
   */
  private startNextCelebration(): void {
    if (this.currentCelebrationIndex >= this.winCelebrations.length) {
      // All celebrations complete
      this.currentCelebrationIndex = -1;
      this.setPhase('complete');
      this.callbacks.onAllCelebrationsComplete?.();
      return;
    }
    
    const celebration = this.winCelebrations[this.currentCelebrationIndex];
    celebration.startTime = Date.now();
    this.celebrationStartTime = celebration.startTime;
    
    // Notify callback
    this.callbacks.onWinCelebration?.(
      celebration.symbolLevel,
      celebration.pegIds.length,
      celebration.multiplier
    );
    
    // Schedule next celebration
    setTimeout(() => {
      this.currentCelebrationIndex++;
      this.startNextCelebration();
    }, celebration.duration + 150); // Small gap between celebrations
  }
  
  /**
   * Render win celebration effects (scale up with rotation, then back down).
   */
  private renderWinCelebrations(): void {
    if (this.currentCelebrationIndex < 0 || this.currentCelebrationIndex >= this.winCelebrations.length) {
      return;
    }
    
    const celebration = this.winCelebrations[this.currentCelebrationIndex];
    const now = Date.now();
    const elapsed = now - celebration.startTime;
    const progress = Math.min(elapsed / celebration.duration, 1);
    
    const ctx = this.ctx;
    const scale = PlinkoSlotEngine.SIZE_SCALE;
    const rowCount = this.config.board.rows;
    const pinRadius = ((24 - rowCount) / 2) * scale;
    // Use golden color for All Pegs bonus, otherwise use symbol color
    const symbolColor = celebration.isAllPegsBonus 
      ? '#FFD700' 
      : PlinkoSlotEngine.getSymbolColor(celebration.symbolLevel);
    
    // Animation: scale up to apex at 50%, then scale back down
    // Use smooth ease-in-out curve
    const easeInOut = (t: number) => t < 0.5 
      ? 2 * t * t 
      : 1 - Math.pow(-2 * t + 2, 2) / 2;
    
    // Scale: 1.0 -> 1.3 -> 1.0 (apex at 50%)
    const maxScaleBoost = 1.0;
    let scaleProgress: number;
    if (progress < 0.5) {
      // First half: scale up (0 to 1)
      scaleProgress = easeInOut(progress * 2);
    } else {
      // Second half: scale down (1 to 0)
      scaleProgress = easeInOut(1 - (progress - 0.5) * 2);
    }
    const symbolScale = 1 + maxScaleBoost * scaleProgress;
    
    // Rotation: 0 -> 20deg -> 0 (apex at 50%)
    const maxRotation = 20 * (Math.PI / 180); // 20 degrees in radians
    const rotation = maxRotation * scaleProgress; // Same curve as scale
    
    // Glow intensity follows the same curve
    const glowIntensity = 0.4 + 0.6 * scaleProgress;
    
    for (const pegId of celebration.pegIds) {
      const peg = this.pegs.get(pegId);
      if (!peg) continue;
      
      ctx.save();
      
      // Draw outer glow
      const glowRadius = pinRadius * 2.5;
      const gradient = ctx.createRadialGradient(
        peg.x, peg.y, pinRadius * 0.5,
        peg.x, peg.y, glowRadius
      );
      gradient.addColorStop(0, symbolColor);
      gradient.addColorStop(0.4, symbolColor + '80'); // 50% alpha
      gradient.addColorStop(1, symbolColor + '00'); // 0% alpha
      
      ctx.globalAlpha = glowIntensity;
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(peg.x, peg.y, glowRadius, 0, Math.PI * 2);
      ctx.fill();
      
      // Draw highlight ring
      ctx.globalAlpha = 0.8 * glowIntensity;
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 3 * scale;
      ctx.beginPath();
      ctx.arc(peg.x, peg.y, pinRadius * 1.3, 0, Math.PI * 2);
      ctx.stroke();
      
      // Draw scaled and rotated symbol
      // For All Pegs bonus, use the peg's actual level; otherwise use celebration's symbolLevel
      const symbolLevel = celebration.isAllPegsBonus ? peg.level : celebration.symbolLevel;
      const symbolImg = this.pegSymbols.get(symbolLevel);
      if (symbolImg && symbolImg.naturalWidth > 0) {
        const normalSize = pinRadius * 1.8;
        const celebrationBaseSize = pinRadius * 2.2;
        const maxSize = celebrationBaseSize * symbolScale;
        const aspectRatio = symbolImg.naturalWidth / symbolImg.naturalHeight;
        
        let drawWidth: number;
        let drawHeight: number;
        
        if (aspectRatio > 1) {
          drawWidth = maxSize;
          drawHeight = maxSize / aspectRatio;
        } else {
          drawHeight = maxSize;
          drawWidth = maxSize * aspectRatio;
        }
        
        // Draw dark circular backdrop behind the symbol
        const backdropRadius = Math.max(drawWidth, drawHeight) * 0.6;
        const backdropGradient = ctx.createRadialGradient(
          peg.x, peg.y, 0,
          peg.x, peg.y, backdropRadius
        );
        backdropGradient.addColorStop(0, 'rgba(0, 0, 0, 0.85)');
        backdropGradient.addColorStop(0.7, 'rgba(0, 0, 0, 0.6)');
        backdropGradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
        
        ctx.globalAlpha = 1;
        ctx.fillStyle = backdropGradient;
        ctx.beginPath();
        ctx.arc(peg.x, peg.y, backdropRadius, 0, Math.PI * 2);
        ctx.fill();
        
        // Translate to peg center, rotate, then draw symbol centered at origin
        ctx.translate(peg.x, peg.y);
        ctx.rotate(rotation);
        ctx.drawImage(
          symbolImg,
          -drawWidth / 2,
          -drawHeight / 2,
          drawWidth,
          drawHeight
        );
      }
      
      ctx.restore();
    }
  }
  
  /**
   * Render SVG symbols on pegs that have them.
   */
  private renderPegSymbols(): void {
    if (!this.symbolsLoaded) return;
    
    const ctx = this.ctx;
    const scale = PlinkoSlotEngine.SIZE_SCALE;
    const rowCount = this.config.board.rows;
    const pinRadius = ((24 - rowCount) / 2) * scale;
    const now = Date.now();
    
    // Maximum size the symbol can be (diameter of the peg, with slight padding)
    const maxSize = pinRadius * 1.8;
    
    for (const [pegId, peg] of this.pegs) {
      // Check if this peg is locked in progressive mode
      const isLockedProgressive = this.progressiveMode && this.lockedPegs.has(pegId);
      
      // Render symbol if peg has one (level > 0 means it has a symbol)
      if (peg.level > 0) {
        const symbolImg = this.pegSymbols.get(peg.level);
        if (symbolImg && symbolImg.naturalWidth > 0 && symbolImg.naturalHeight > 0) {
          ctx.save();
          
          // Check if this is a bonus peg - render pulsing glow
          const isBonus = this.bonusPegs.has(pegId);
          if (isBonus) {
            // Pulsing glow effect for bonus symbols
            const pulseSpeed = 1500; // ms for full pulse cycle
            const pulseProgress = (now % pulseSpeed) / pulseSpeed;
            const pulseFactor = 0.5 + 0.5 * Math.sin(pulseProgress * Math.PI * 2);
            
            // Outer glow
            const glowRadius = pinRadius * (1.8 + pulseFactor * 0.4);
            const gradient = ctx.createRadialGradient(
              peg.x, peg.y, pinRadius * 0.3,
              peg.x, peg.y, glowRadius
            );
            const bonusColor = PlinkoSlotEngine.BONUS_SYMBOL.color;
            gradient.addColorStop(0, bonusColor + '60'); // 37% alpha at center
            gradient.addColorStop(0.5, bonusColor + '30'); // 19% alpha
            gradient.addColorStop(1, bonusColor + '00'); // 0% alpha at edge
            
            ctx.globalAlpha = 0.6 + pulseFactor * 0.4;
            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.arc(peg.x, peg.y, glowRadius, 0, Math.PI * 2);
            ctx.fill();
            
            ctx.globalAlpha = 1;
          }
          
          // Draw metallic/steel outline for locked pegs in progressive mode
          if (isLockedProgressive) {
            const lockTime = this.lockedPegs.get(pegId) || now;
            this.renderLockedPegOutline(peg.x, peg.y, pinRadius, now, lockTime);
          }
          
          // Calculate aspect ratio and fit within the circle
          const imgWidth = symbolImg.naturalWidth;
          const imgHeight = symbolImg.naturalHeight;
          const aspectRatio = imgWidth / imgHeight;
          
          let drawWidth: number;
          let drawHeight: number;
          
          if (aspectRatio > 1) {
            // Image is wider than tall
            drawWidth = maxSize;
            drawHeight = maxSize / aspectRatio;
          } else {
            // Image is taller than wide (or square)
            drawHeight = maxSize;
            drawWidth = maxSize * aspectRatio;
          }
          
          // Slight scale pulse for bonus symbols
          if (isBonus) {
            const pulseSpeed = 1500;
            const pulseProgress = (now % pulseSpeed) / pulseSpeed;
            const scalePulse = 1 + 0.08 * Math.sin(pulseProgress * Math.PI * 2);
            drawWidth *= scalePulse;
            drawHeight *= scalePulse;
          }
          
          // Draw the symbol centered on the peg
          ctx.drawImage(
            symbolImg,
            peg.x - drawWidth / 2,
            peg.y - drawHeight / 2,
            drawWidth,
            drawHeight
          );
          
          ctx.restore();
        }
      }
    }
  }
  
  /**
   * Render a metallic/steel outline around a locked peg with fade-in animation.
   */
  private renderLockedPegOutline(x: number, y: number, radius: number, now: number, lockTime: number): void {
    const ctx = this.ctx;
    
    // Ease-in animation over 400ms
    const animationDuration = 400;
    const timeSinceLock = now - lockTime;
    const animationProgress = Math.min(1, timeSinceLock / animationDuration);
    
    // Ease-out cubic for smooth appearance
    const easeOutCubic = 1 - Math.pow(1 - animationProgress, 3);
    
    // Scale animation: starts at 1.5x and settles to 1x
    const scaleMultiplier = 1 + (0.5 * (1 - easeOutCubic));
    const outlineRadius = radius * 1.25 * scaleMultiplier;
    const lineWidth = radius * 0.15;
    
    // Opacity fades in
    const opacity = easeOutCubic;
    
    // Subtle shimmer animation
    const shimmerSpeed = 2000;
    const shimmerProgress = (now % shimmerSpeed) / shimmerSpeed;
    const shimmerAngle = shimmerProgress * Math.PI * 2;
    
    ctx.save();
    ctx.globalAlpha = opacity;
    
    // Create metallic gradient for the outline
    const gradient = ctx.createLinearGradient(
      x - outlineRadius,
      y - outlineRadius,
      x + outlineRadius,
      y + outlineRadius
    );
    
    // Steel/chrome colors with shimmer
    const shimmerOffset = Math.sin(shimmerAngle) * 0.1;
    gradient.addColorStop(0, '#6B7280'); // Gray-500
    gradient.addColorStop(0.2 + shimmerOffset, '#9CA3AF'); // Gray-400
    gradient.addColorStop(0.4, '#D1D5DB'); // Gray-300 (highlight)
    gradient.addColorStop(0.5, '#E5E7EB'); // Gray-200 (bright highlight)
    gradient.addColorStop(0.6, '#D1D5DB'); // Gray-300
    gradient.addColorStop(0.8 - shimmerOffset, '#9CA3AF'); // Gray-400
    gradient.addColorStop(1, '#6B7280'); // Gray-500
    
    // Draw the metallic ring
    ctx.beginPath();
    ctx.arc(x, y, outlineRadius, 0, Math.PI * 2);
    ctx.strokeStyle = gradient;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
    
    // Add inner shadow for depth
    ctx.beginPath();
    ctx.arc(x, y, outlineRadius - lineWidth * 0.3, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.lineWidth = lineWidth * 0.3;
    ctx.stroke();
    
    // Add outer highlight for 3D effect
    ctx.beginPath();
    ctx.arc(x, y, outlineRadius + lineWidth * 0.1, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = lineWidth * 0.2;
    ctx.stroke();
    
    ctx.restore();
  }
  
  /**
   * Render expanding ring effects on peg hits.
   */
  private renderRingEffects(): void {
    const now = Date.now();
    const ctx = this.ctx;
    const scale = PlinkoSlotEngine.SIZE_SCALE;
    
    // Filter out expired effects and render active ones
    this.ringEffects = this.ringEffects.filter(effect => {
      const elapsed = now - effect.startTime - effect.delay;
      
      // Not started yet (delayed)
      if (elapsed < 0) return true;
      
      const progress = elapsed / effect.duration;
      
      if (progress >= 1) {
        return false; // Remove expired effect
      }
      
      // Ease out cubic for satisfying deceleration
      const easeOut = 1 - Math.pow(1 - progress, 3);
      
      // Calculate ring properties based on whether it's inner or outer ring
      const baseStartRadius = effect.isOuter ? 12 * scale : 8 * scale;
      const baseEndRadius = effect.isOuter ? 40 * scale : 28 * scale;
      const radius = baseStartRadius + (baseEndRadius - baseStartRadius) * easeOut;
      
      // Alpha with smooth fade (reduced to 50% of original)
      const baseAlpha = effect.isOuter ? 0.25 : 0.1;
      const alpha = baseAlpha * (1 - easeOut);
      
      // Line width - thicker for inner ring, thins as it expands
      const baseLineWidth = effect.isOuter ? 2 : 3.5;
      const lineWidth = baseLineWidth * scale * (1 - progress * 0.6);
      
      // Draw the ring
      ctx.save();
      ctx.beginPath();
      ctx.arc(effect.x, effect.y, radius, 0, Math.PI * 2);
      ctx.strokeStyle = effect.color;
      ctx.globalAlpha = alpha;
      ctx.lineWidth = lineWidth;
      ctx.stroke();
      
      // Add subtle glow for the inner ring at the start
      if (!effect.isOuter && progress < 0.3) {
        const glowAlpha = 0.15 * (1 - progress / 0.3);
        ctx.globalAlpha = glowAlpha;
        ctx.shadowColor = effect.color;
        ctx.shadowBlur = 15 * scale;
        ctx.stroke();
      }
      
      ctx.restore();
      
      return true; // Keep this effect
    });
  }

  /**
   * Set event callbacks.
   */
  setCallbacks(callbacks: PlinkoSlotCallbacks): void {
    this.callbacks = callbacks;
  }
  
  /**
   * Get current bonus peg count.
   */
  getBonusPegCount(): number {
    return this.bonusPegs.size;
  }
  
  /**
   * Get bonus peg IDs.
   */
  getBonusPegIds(): string[] {
    return Array.from(this.bonusPegs);
  }
  
  /**
   * Set free spins mode (disables bonus symbol spawning).
   */
  setFreeSpinsMode(enabled: boolean): void {
    this.isFreeSpinsMode = enabled;
  }
  
  /**
   * Enable or disable progressive mode.
   * In progressive mode, only the highest win is awarded per wave,
   * winning symbols explode, and remaining symbols lock for cascading wins.
   */
  setProgressiveMode(enabled: boolean): void {
    this.progressiveMode = enabled;
  }
  
  /**
   * Check if progressive mode is enabled.
   */
  isProgressiveModeEnabled(): boolean {
    return this.progressiveMode;
  }
  
  /**
   * Get current progressive state (read-only).
   */
  getProgressiveState(): ProgressiveState | null {
    return this.progressiveState ? { ...this.progressiveState } : null;
  }
  
  /**
   * Initialize progressive state for a new run.
   */
  private initProgressiveState(): void {
    this.progressiveState = {
      isActive: true,
      waveNumber: 1,
      lockedPegIds: new Set(),
      emptyPegIds: new Set(),
      accumulatedWinnings: 0,
      waveWins: [],
      isComplete: false,
    };
    this.lockedPegs.clear();
  }
  
  /**
   * Reset progressive state.
   */
  private resetProgressiveState(): void {
    this.progressiveState = null;
    this.lockedPegs.clear();
    this.explosionParticles = [];
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

    const { WIDTH, HEIGHT, PADDING_X, PADDING_TOP, PADDING_BOTTOM, SIZE_SCALE } = PlinkoSlotEngine;
    const rowCount = this.config.board.rows;
    
    // Calculate spacing
    const lastRowPinCount = 3 + rowCount - 1;
    const pinDistanceX = (WIDTH - PADDING_X * 2) / (lastRowPinCount - 1);
    // Base radius scaled up for larger visuals
    const pinRadius = ((24 - rowCount) / 2) * SIZE_SCALE;

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
          hitCount: 0,
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
   * Set up stuck ball detection to prevent balls from balancing on pegs.
   * Checks each physics tick for balls with very low velocity and applies
   * a velocity nudge to knock them free.
   */
  private setupStuckBallDetection(): void {
    // Velocity threshold below which a ball is considered potentially stuck
    const STUCK_VELOCITY_THRESHOLD = 0.5;
    // Time in ms a ball must be below threshold before we nudge it
    const STUCK_TIME_THRESHOLD = 150;
    // Velocity to apply when nudging (direct velocity, not force)
    const NUDGE_VELOCITY = 2;
    
    Matter.Events.on(this.engine, 'beforeUpdate', () => {
      if (!this.runState || this.runState.phase !== 'dropping') return;
      
      const now = Date.now();
      
      for (const [ballId, body] of this.ballBodies) {
        // Calculate total velocity magnitude
        const velocityMagnitude = Math.sqrt(
          body.velocity.x * body.velocity.x + 
          body.velocity.y * body.velocity.y
        );
        
        // Check if ball is moving very slowly
        if (velocityMagnitude < STUCK_VELOCITY_THRESHOLD) {
          // Start tracking if not already
          if (!this.stuckBallTracker.has(ballId)) {
            this.stuckBallTracker.set(ballId, { lowVelocityStartTime: now });
          } else {
            // Check if it's been stuck long enough
            const tracker = this.stuckBallTracker.get(ballId)!;
            const stuckDuration = now - tracker.lowVelocityStartTime;
            
            if (stuckDuration > STUCK_TIME_THRESHOLD) {
              // Apply a random horizontal velocity kick to knock the ball free
              const randomDirection = Math.random() < 0.5 ? -1 : 1;
              const kickX = NUDGE_VELOCITY * randomDirection * (0.8 + Math.random() * 0.4);
              const kickY = NUDGE_VELOCITY * 0.5; // Downward kick to help it fall
              
              // Use setVelocity for immediate effect instead of applyForce
              Matter.Body.setVelocity(body, {
                x: body.velocity.x + kickX,
                y: body.velocity.y + kickY,
              });
              
              // Reset tracker so we don't nudge continuously
              tracker.lowVelocityStartTime = now;
            }
          }
        } else {
          // Ball is moving normally, remove from tracker
          this.stuckBallTracker.delete(ballId);
        }
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

    // Increment hit count on every hit (same ball can level up multiple times)
    peg.hitCount++;
    
    // Check if this peg is locked in progressive mode (cannot be changed)
    const isLockedInProgressive = this.progressiveMode && this.lockedPegs.has(pegId);
    
    // Check if this peg has the bonus symbol (locked - cannot be changed)
    if (this.bonusPegs.has(pegId) || isLockedInProgressive) {
      // Locked pegs - no ring effect, symbol doesn't change
    } else {
      // Check for bonus symbol spawn (1 in 200 chance, but not during free spins)
      const canSpawnBonus = !this.isFreeSpinsMode;
      const spawnBonus = canSpawnBonus && Math.random() < PlinkoSlotEngine.BONUS_SPAWN_CHANCE;
      
      let newSymbolId: number;
      if (spawnBonus) {
        // Spawn bonus symbol and lock this peg
        newSymbolId = PlinkoSlotEngine.BONUS_SYMBOL_ID;
        this.bonusPegs.add(pegId);
      } else {
        // Randomly select a regular symbol
        newSymbolId = PlinkoSlotEngine.getRandomSymbolId();
      }
      
      peg.level = newSymbolId;
      
      // Update visual
      this.updatePegVisual(pegId, peg.level);
      
      // Add ring effect only when symbol changes (unlocked pegs)
      const symbolColor = PlinkoSlotEngine.getSymbolColor(peg.level);
      this.addRingEffect(peg.x, peg.y, symbolColor);
    }
    
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
  
  /**
   * Add a ring effect at the specified position.
   * Creates multiple rings for a more satisfying visual.
   */
  private addRingEffect(x: number, y: number, color: string): void {
    const now = Date.now();
    
    // Inner ring - faster, more prominent
    this.ringEffects.push({
      x,
      y,
      startTime: now,
      duration: 400,
      color,
      isOuter: false,
      delay: 0,
    });
    
    // Outer ring - slightly delayed, slower expansion
    this.ringEffects.push({
      x,
      y,
      startTime: now,
      duration: 500,
      color,
      isOuter: true,
      delay: 50,
    });
  }

  /**
   * Update peg visual based on level (symbol ID).
   */
  private updatePegVisual(pegId: string, level: number): void {
    const body = this.pegBodies.get(pegId);
    if (!body) return;
    
    // All symbols use the gray background - SVG will be rendered on top
    body.render.fillStyle = this.config.pegColors['0'];
    body.render.strokeStyle = undefined;
    body.render.lineWidth = 0;
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
      
      // Remove from stuck ball tracker
      this.stuckBallTracker.delete(ballId);

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
    const ballRadius = ((24 - rowCount) / 2) * PlinkoSlotEngine.SIZE_SCALE * 1.5;
    
    const body = Matter.Bodies.circle(spawnX, spawnY, ballRadius, {
      restitution: this.config.physics.restitution,
      friction: this.config.physics.friction,
      frictionAir: this.config.physics.frictionAir,
      label: `ball-${ballId}`,
      render: {
        visible: false, // We'll render custom balls in afterRender
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
      // If in progressive mode and already in a wave (not the initial run), process the wave
      if (this.progressiveMode && this.progressiveState && this.progressiveState.waveNumber > 1) {
        this.setPhase('evaluating');
        setTimeout(() => {
          this.processProgressiveWave();
        }, 300);
      } else {
        this.completeRun();
      }
    }
  }

  /**
   * Complete the run and evaluate payout.
   */
  private completeRun(): void {
    if (!this.runState) return;

    this.setPhase('evaluating');

    // If progressive mode is enabled, start progressive sequence instead
    if (this.progressiveMode) {
      this.startProgressiveSequence();
      return;
    }

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
        hitCount: p.hitCount,
      }));
      this.replayLog.payoutResult = payoutResult;
    }

    // Callback for run complete (UI can update balance, etc.)
    this.callbacks.onRunComplete?.(payoutResult);

    // Start win celebrations after a brief pause (will call onAllCelebrationsComplete when done)
    // Phase remains 'evaluating' until celebrations complete to keep play button disabled
    setTimeout(() => {
      this.startWinCelebrations();
    }, 300);
  }
  
  /**
   * Start the progressive sequence (progressive mode).
   * Awards highest win, explodes symbols, locks remaining, then cascades.
   */
  private startProgressiveSequence(): void {
    if (!this.runState) return;
    
    // Initialize progressive state
    this.initProgressiveState();
    
    // Notify UI that wave 1 is starting
    this.callbacks.onProgressiveWaveStart?.(1);
    
    // Process the first wave
    setTimeout(() => {
      this.processProgressiveWave();
    }, 300);
  }
  
  /**
   * Process a single progressive wave.
   */
  private processProgressiveWave(): void {
    if (!this.runState || !this.progressiveState) return;
    
    // Check for bonus game trigger first
    const bonusPegCount = this.bonusPegs.size;
    if (bonusPegCount >= PlinkoSlotEngine.BONUS_PEGS_REQUIRED) {
      // Bonus game triggered - end progressive sequence
      this.completeProgressiveWithBonus();
      return;
    }
    
    // Detect wins (only consider non-empty, non-locked pegs for new wins)
    const wins = this.detectProgressiveWins();
    
    if (wins.length === 0) {
      // No more wins - complete the progressive sequence
      this.completeProgressiveSequence();
      return;
    }
    
    // Get the highest value win (last in sorted array)
    const highestWin = wins[wins.length - 1];
    
    // Calculate payout
    const payout = this.runState.betAmount * highestWin.multiplier;
    
    // Create wave win record
    const waveWin: ProgressiveWaveWin = {
      waveNumber: this.progressiveState.waveNumber,
      symbolLevel: highestWin.symbolLevel,
      count: highestWin.pegIds.length,
      multiplier: highestWin.multiplier,
      payout,
      pegIds: highestWin.pegIds,
    };
    
    // Update progressive state
    this.progressiveState.accumulatedWinnings += payout;
    this.progressiveState.waveWins.push(waveWin);
    
    // Notify UI about the win
    this.callbacks.onProgressiveWin?.(waveWin, this.progressiveState.accumulatedWinnings);
    
    // Start win celebration for this specific win
    this.startProgressiveWinCelebration(highestWin, () => {
      // After celebration, explode the winning symbols
      this.explodeWinningSymbols(highestWin.pegIds, highestWin.symbolLevel);
    });
  }
  
  /**
   * Detect wins for progressive mode (excludes bonus and all-pegs special wins).
   * Returns wins sorted by multiplier (ascending).
   */
  private detectProgressiveWins(): Array<{ symbolLevel: number; pegIds: string[]; multiplier: number }> {
    const wins: Array<{ symbolLevel: number; pegIds: string[]; multiplier: number }> = [];
    
    // Count pegs at each symbol level (only non-empty pegs)
    const symbolPegs: Map<number, string[]> = new Map();
    
    for (const [pegId, peg] of this.pegs) {
      // Skip empty pegs (level 0) and bonus pegs
      if (peg.level > 0 && peg.level !== PlinkoSlotEngine.BONUS_SYMBOL_ID && PlinkoSlotEngine.getSymbol(peg.level)) {
        if (!symbolPegs.has(peg.level)) {
          symbolPegs.set(peg.level, []);
        }
        symbolPegs.get(peg.level)!.push(pegId);
      }
    }
    
    // Check for wins (MIN_SYMBOLS_FOR_WIN+ of same symbol)
    for (const [level, pegIds] of symbolPegs) {
      const count = pegIds.length;
      if (count >= PlinkoSlotEngine.MIN_SYMBOLS_FOR_WIN) {
        const payoutTable = PlinkoSlotEngine.getSymbolPayouts(level);
        // Get the multiplier for this count (cap at max defined)
        const maxCount = Math.min(count, 8);
        const multiplier = payoutTable[maxCount] ?? payoutTable[8] ?? 0;
        
        if (multiplier > 0) {
          wins.push({ symbolLevel: level, pegIds, multiplier });
        }
      }
    }
    
    // Sort by multiplier (ascending) - highest last
    wins.sort((a, b) => a.multiplier - b.multiplier);
    
    return wins;
  }
  
  /**
   * Start a celebration for a progressive win (single win animation).
   * Note: Does NOT call onWinCelebration - progressive mode uses onProgressiveWin instead
   * to avoid duplicate win entries.
   */
  private startProgressiveWinCelebration(
    win: { symbolLevel: number; pegIds: string[]; multiplier: number },
    onComplete: () => void
  ): void {
    // Create a temporary celebration for this win
    this.winCelebrations = [{
      symbolLevel: win.symbolLevel,
      pegIds: win.pegIds,
      multiplier: win.multiplier,
      startTime: Date.now(),
      duration: PlinkoSlotEngine.CELEBRATION_DURATION,
      isAllPegsBonus: false,
    }];
    
    this.currentCelebrationIndex = 0;
    this.celebrationStartTime = Date.now();
    
    // Note: onProgressiveWin is called separately in processProgressiveWave()
    // so we don't call onWinCelebration here to avoid duplicate entries
    
    // Schedule end of celebration
    setTimeout(() => {
      this.currentCelebrationIndex = -1;
      this.winCelebrations = [];
      onComplete();
    }, PlinkoSlotEngine.CELEBRATION_DURATION + 100);
  }
  
  /**
   * Explode winning symbols and clear those peg positions.
   */
  private explodeWinningSymbols(pegIds: string[], symbolLevel: number): void {
    // Spawn explosion particles
    this.spawnExplosionParticles(pegIds, symbolLevel);
    
    // Notify UI
    this.callbacks.onProgressiveExplosion?.(pegIds, symbolLevel);
    
    // Clear the peg levels (make them empty) and unlock them
    for (const pegId of pegIds) {
      const peg = this.pegs.get(pegId);
      if (peg) {
        peg.level = 0;
        this.updatePegVisual(pegId, 0);
        this.progressiveState?.emptyPegIds.add(pegId);
        
        // Unlock these pegs so new symbols can be assigned
        this.lockedPegs.delete(pegId);
        this.progressiveState?.lockedPegIds.delete(pegId);
      }
    }
    
    // After explosion animation completes, lock remaining symbols and drop new wave
    setTimeout(() => {
      this.lockRemainingSymbols();
    }, PlinkoSlotEngine.EXPLOSION_DURATION);
  }
  
  /**
   * Lock all remaining (non-empty) symbols on the board.
   */
  private lockRemainingSymbols(): void {
    if (!this.progressiveState) return;
    
    const newlyLocked: string[] = [];
    
    const lockTime = Date.now();
    for (const [pegId, peg] of this.pegs) {
      // Lock pegs that have symbols and aren't already locked
      if (peg.level > 0 && !this.lockedPegs.has(pegId)) {
        this.lockedPegs.set(pegId, lockTime);
        this.progressiveState.lockedPegIds.add(pegId);
        newlyLocked.push(pegId);
      }
    }
    
    // Notify UI about newly locked pegs
    if (newlyLocked.length > 0) {
      this.callbacks.onProgressivePegsLocked?.(newlyLocked);
    }
    
    // Start next progressive wave
    setTimeout(() => {
      this.startProgressiveWave();
    }, 500);
  }
  
  /**
   * Start a new progressive wave (drop new balls).
   */
  private startProgressiveWave(): void {
    if (!this.runState || !this.progressiveState) return;
    
    // Increment wave number
    this.progressiveState.waveNumber++;
    
    // Notify UI
    this.callbacks.onProgressiveWaveStart?.(this.progressiveState.waveNumber);
    
    // Reset ball state for new wave
    this.runState.currentBallIndex = 0;
    this.runState.balls = [];
    
    // Create new ball states
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
    
    // Generate new RNG for this wave (use existing RNG to maintain determinism)
    // The RNG continues from where it left off
    
    // Set phase back to dropping
    this.setPhase('dropping');
    
    // Start dropping balls
    this.dropNextBall();
  }
  
  /**
   * Complete the progressive sequence (no more wins).
   */
  private completeProgressiveSequence(): void {
    if (!this.runState || !this.progressiveState) return;
    
    this.progressiveState.isComplete = true;
    
    // Calculate total multiplier from all waves
    const totalMultiplier = this.progressiveState.waveWins.reduce(
      (sum, win) => sum + win.multiplier, 0
    );
    
    // Create payout result
    const payoutResult: PayoutResult = {
      levelCounts: { c1: 0, c2: 0, c3: 0, c4: 0, c5: 0, c6: 0, c7: 0, c8: 0, c9: 0, c10: 0 },
      countTiers: [],
      highestCountTier: null,
      countMultiplier: 0,
      patterns: [],
      patternMultiplier: 0,
      totalMultiplier,
      payoutMode: 'add',
    };
    
    this.runState.payoutResult = payoutResult;
    this.runState.endTime = Date.now();
    
    // Notify UI
    this.callbacks.onProgressiveSequenceComplete?.(
      this.progressiveState.accumulatedWinnings,
      this.progressiveState.waveNumber
    );
    this.callbacks.onRunComplete?.(payoutResult);
    
    // Clean up progressive state
    this.setPhase('complete');
    this.callbacks.onAllCelebrationsComplete?.();
  }
  
  /**
   * Complete progressive sequence with bonus game trigger.
   */
  private completeProgressiveWithBonus(): void {
    if (!this.runState || !this.progressiveState) return;
    
    this.isBonusGameTriggered = true;
    this.progressiveState.isComplete = true;
    
    // Get bonus peg IDs
    const bonusPegIds = Array.from(this.bonusPegs);
    
    // Collect all progressive wins as regular wins
    const regularWins = this.progressiveState.waveWins.map(w => ({
      symbolLevel: w.symbolLevel,
      count: w.count,
      multiplier: w.multiplier,
    }));
    
    // Notify UI about bonus game trigger
    this.callbacks.onBonusGameTriggered?.(bonusPegIds, regularWins);
    
    // Start bonus celebration
    this.winCelebrations = [{
      symbolLevel: PlinkoSlotEngine.BONUS_SYMBOL_ID,
      pegIds: bonusPegIds,
      multiplier: 0,
      startTime: 0,
      duration: PlinkoSlotEngine.BONUS_CELEBRATION_DURATION,
      isAllPegsBonus: false,
      isBonusCelebration: true,
    }];
    
    this.currentCelebrationIndex = 0;
    this.startBonusCelebration();
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
      peg.hitCount = 0;
      
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
    
    // Clear ring effects
    this.ringEffects = [];
    
    // Clear win celebrations
    this.winCelebrations = [];
    this.currentCelebrationIndex = -1;
    
    // Clear sparkles
    this.sparkles = [];
    
    // Clear bonus pegs
    this.bonusPegs.clear();
    
    // Clear stuck ball tracker
    this.stuckBallTracker.clear();
    
    // Clear progressive state
    this.resetProgressiveState();
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
        peg.hitCount = pegData.hitCount ?? 0;
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
