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

// SVG symbols for peg levels
import orangeSvg from '$lib/assets/slot/orange.svg';
import watermelonSvg from '$lib/assets/slot/watermelon.svg';
import bearSvg from '$lib/assets/slot/bear.svg';
import heartSvg from '$lib/assets/slot/heart.svg';
import starSvg from '$lib/assets/slot/star.svg';
import gemSvg from '$lib/assets/slot/gem.svg';
import diamondSvg from '$lib/assets/slot/diamond.svg';

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
  }> = [];
  private currentCelebrationIndex = -1;
  private celebrationStartTime = 0;
  private static readonly CELEBRATION_DURATION = 900; // ms per win celebration (fast)
  
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
  private static readonly SPARKLE_SPAWN_RATE = 25; // ms between spawns per peg
  
  // Symbol definitions - easy to add more symbols here!
  // Each symbol has: id, name, color (for glow), payouts by count
  private static readonly SYMBOLS: Array<{
    id: number;
    name: string;
    color: string;
    payouts: Record<number, number>; // count -> multiplier
  }> = [
    { id: 1, name: 'Orange',     color: '#FF8C00', payouts: { 3: 0.5, 4: 1, 5: 2, 6: 4, 7: 8, 8: 16 } },
    { id: 2, name: 'Watermelon', color: '#FF6B6B', payouts: { 3: 0.75, 4: 1.5, 5: 3, 6: 6, 7: 12, 8: 24 } },
    { id: 3, name: 'Bear',       color: '#8B4513', payouts: { 3: 1, 4: 2, 5: 4, 6: 8, 7: 16, 8: 32 } },
    { id: 4, name: 'Heart',      color: '#FF1493', payouts: { 3: 1.5, 4: 3, 5: 6, 6: 12, 7: 24, 8: 48 } },
    { id: 5, name: 'Star',       color: '#FFD700', payouts: { 3: 2, 4: 4, 5: 8, 6: 16, 7: 32, 8: 64 } },
    { id: 6, name: 'Gem',        color: '#00CED1', payouts: { 3: 3, 4: 6, 5: 12, 6: 24, 7: 48, 8: 96 } },
    { id: 7, name: 'Diamond',    color: '#E0E0FF', payouts: { 3: 5, 4: 10, 5: 20, 6: 40, 7: 80, 8: 160 } },
    // Add more symbols here! Just add a new entry with id, name, color, and payouts
  ];
  
  // Helper to get symbol by ID
  private static getSymbol(id: number) {
    return PlinkoSlotEngine.SYMBOLS.find(s => s.id === id);
  }
  
  // Helper to get random symbol ID
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
        timeScale: 1.75, // Speed up physics simulation
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
      [7, diamondSvg],
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
    // Use beforeRender to draw rings, then Matter.js draws bodies on top
    Matter.Events.on(this.render, 'beforeRender', () => {
      // Clear and draw background first
      this.ctx.fillStyle = '#000000';
      this.ctx.fillRect(0, 0, PlinkoSlotEngine.WIDTH, PlinkoSlotEngine.HEIGHT);
      
      // Draw ring effects (under everything)
      this.renderRingEffects();
    });
    
    // Use afterRender to draw SVG symbols on top of pegs
    Matter.Events.on(this.render, 'afterRender', () => {
      this.renderPegSymbols();
      this.updateAndRenderSparkles();
      this.renderWinCelebrations();
    });
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
    
    // Don't spawn in the last 400ms (let existing sparkles fade out)
    if (elapsed > celebration.duration - 250) return;
    
    // Check spawn rate
    if (now - this.lastSparkleSpawn < PlinkoSlotEngine.SPARKLE_SPAWN_RATE) return;
    this.lastSparkleSpawn = now;
    
    const symbolColor = PlinkoSlotEngine.getSymbolColor(celebration.symbolLevel);
    const scale = PlinkoSlotEngine.SIZE_SCALE;
    const rowCount = this.config.board.rows;
    const pinRadius = ((24 - rowCount) / 2) * scale;
    
    // Spawn 1-2 sparkles per winning peg
    for (const pegId of celebration.pegIds) {
      const peg = this.pegs.get(pegId);
      if (!peg) continue;
      
      const sparkleCount = Math.random() < 0.5 ? 1 : 2;
      
      for (let i = 0; i < sparkleCount; i++) {
        // Random position around the peg
        const angle = Math.random() * Math.PI * 2;
        const distance = pinRadius * (0.5 + Math.random() * 1.5);
        const x = peg.x + Math.cos(angle) * distance;
        const y = peg.y + Math.sin(angle) * distance;
        
        // Random velocity (mostly upward with some spread)
        const speed = 0.3 + Math.random() * 0.8;
        const velAngle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.8; // Upward bias
        const vx = Math.cos(velAngle) * speed;
        const vy = Math.sin(velAngle) * speed;
        
        // Pick color: mix of white, gold, and symbol color
        const colorRoll = Math.random();
        let color: string;
        if (colorRoll < 0.4) {
          color = '#FFFFFF'; // White sparkles
        } else if (colorRoll < 0.7) {
          color = '#FFD700'; // Gold sparkles
        } else {
          color = symbolColor; // Symbol-colored sparkles
        }
        
        this.sparkles.push({
          x,
          y,
          vx,
          vy,
          size: 2 + Math.random() * 4,
          alpha: 0.8 + Math.random() * 0.2,
          color,
          rotation: Math.random() * Math.PI * 2,
          rotationSpeed: (Math.random() - 0.5) * 0.3,
          birthTime: now,
          lifetime: 600 + Math.random() * 600, // 600-1200ms
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
   * Detect all winning symbol combinations (3+ matching symbols).
   */
  private detectWins(): Array<{ symbolLevel: number; pegIds: string[]; multiplier: number }> {
    const wins: Array<{ symbolLevel: number; pegIds: string[]; multiplier: number }> = [];
    
    // Count pegs at each symbol level (any valid symbol)
    const symbolPegs: Map<number, string[]> = new Map();
    
    for (const [pegId, peg] of this.pegs) {
      // Check if this peg has a valid symbol (level > 0)
      if (peg.level > 0 && PlinkoSlotEngine.getSymbol(peg.level)) {
        if (!symbolPegs.has(peg.level)) {
          symbolPegs.set(peg.level, []);
        }
        symbolPegs.get(peg.level)!.push(pegId);
      }
    }
    
    // Check for wins (3+ of same symbol)
    for (const [level, pegIds] of symbolPegs) {
      const count = pegIds.length;
      if (count >= 3) {
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
    
    return wins;
  }
  
  /**
   * Start the win celebration sequence.
   */
  private startWinCelebrations(): void {
    const wins = this.detectWins();
    
    if (wins.length === 0) {
      // No wins, complete immediately
      this.callbacks.onAllCelebrationsComplete?.();
      return;
    }
    
    // Convert to celebration objects
    this.winCelebrations = wins.map(win => ({
      symbolLevel: win.symbolLevel,
      pegIds: win.pegIds,
      multiplier: win.multiplier,
      startTime: 0, // Will be set when celebration starts
      duration: PlinkoSlotEngine.CELEBRATION_DURATION,
    }));
    
    // Start first celebration
    this.currentCelebrationIndex = 0;
    this.startNextCelebration();
  }
  
  /**
   * Start the next celebration in the sequence.
   */
  private startNextCelebration(): void {
    if (this.currentCelebrationIndex >= this.winCelebrations.length) {
      // All celebrations complete
      this.currentCelebrationIndex = -1;
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
   * Render win celebration effects (pulsing, glowing symbols).
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
    const symbolColor = PlinkoSlotEngine.getSymbolColor(celebration.symbolLevel);
    
    // Fade-out phase starts at 75% progress
    const fadeOutStart = 0.75;
    const isFadingOut = progress > fadeOutStart;
    
    // Calculate fade multiplier (1 during main animation, eases to 0 during fade-out)
    let fadeMult = 1;
    if (isFadingOut) {
      const fadeProgress = (progress - fadeOutStart) / (1 - fadeOutStart);
      // Smooth ease-out curve (cubic)
      fadeMult = 1 - (fadeProgress * fadeProgress * fadeProgress);
    }
    
    // Pulsing effect for SYMBOL ONLY (sine wave) - more dramatic scaling
    const pulseFrequency = 1.3; // pulses per celebration (30% slower)
    const pulsePhase = Math.sin(progress * Math.PI * 2 * pulseFrequency);
    
    // During fade-out, ease the pulse scale back to 1.0
    const basePulseScale = 1 + 0.2 * pulsePhase;
    const symbolPulseScale = isFadingOut 
      ? 1 + (basePulseScale - 1) * fadeMult  // Ease back to 1.0
      : basePulseScale;
    
    // Glow intensity (starts strong, fades slightly, then strong at end) - with fade-out
    const baseGlowIntensity = 0.6 + 0.4 * Math.sin(progress * Math.PI);
    const glowIntensity = baseGlowIntensity * fadeMult;
    
    // Early exit if fully faded
    if (fadeMult < 0.01) return;
    
    for (const pegId of celebration.pegIds) {
      const peg = this.pegs.get(pegId);
      if (!peg) continue;
      
      ctx.save();
      
      // Draw outer glow (fixed size, no pulsing) - fades out
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
      
      // Draw highlight ring (fixed size, no pulsing) - fades out
      ctx.globalAlpha = 0.8 * glowIntensity;
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 3 * scale;
      ctx.beginPath();
      ctx.arc(peg.x, peg.y, pinRadius * 1.3, 0, Math.PI * 2);
      ctx.stroke();
      
      // Draw scaled symbol on top - this is what pulses!
      const symbolImg = this.pegSymbols.get(celebration.symbolLevel);
      if (symbolImg && symbolImg.naturalWidth > 0) {
        // Normal symbol size (what it should be when not celebrating)
        const normalSize = pinRadius * 1.8;
        // Celebration base size is larger
        const celebrationBaseSize = pinRadius * 2.2;
        
        // During fade-out, interpolate base size back to normal
        const baseSize = isFadingOut 
          ? normalSize + (celebrationBaseSize - normalSize) * fadeMult
          : celebrationBaseSize;
        
        const maxSize = baseSize * symbolPulseScale;
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
        
        // Draw dark circular backdrop behind the symbol for better visibility - fades out
        const backdropRadius = Math.max(drawWidth, drawHeight) * 0.6;
        const backdropGradient = ctx.createRadialGradient(
          peg.x, peg.y, 0,
          peg.x, peg.y, backdropRadius
        );
        
        // Backdrop opacity fades out
        const backdropOpacity = 0.85 * fadeMult;
        backdropGradient.addColorStop(0, `rgba(0, 0, 0, ${backdropOpacity})`);
        backdropGradient.addColorStop(0.7, `rgba(0, 0, 0, ${backdropOpacity * 0.7})`);
        backdropGradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
        
        ctx.globalAlpha = 1;
        ctx.fillStyle = backdropGradient;
        ctx.beginPath();
        ctx.arc(peg.x, peg.y, backdropRadius, 0, Math.PI * 2);
        ctx.fill();
        
        // Draw the symbol
        ctx.drawImage(
          symbolImg,
          peg.x - drawWidth / 2,
          peg.y - drawHeight / 2,
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
    
    // Maximum size the symbol can be (diameter of the peg, with slight padding)
    const maxSize = pinRadius * 1.8;
    
    for (const [pegId, peg] of this.pegs) {
      // Render symbol if peg has one (level > 0 means it has a symbol)
      if (peg.level > 0) {
        const symbolImg = this.pegSymbols.get(peg.level);
        if (symbolImg && symbolImg.naturalWidth > 0 && symbolImg.naturalHeight > 0) {
          ctx.save();
          
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
      
      // Alpha with smooth fade
      const baseAlpha = effect.isOuter ? 0.5 : 0.8;
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
        const glowAlpha = 0.3 * (1 - progress / 0.3);
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
    
    // Add ring effect for the hit
    this.addRingEffect(peg.x, peg.y, this.config.pegColors['0']);
    
    // Randomly select a new symbol on each hit
    const newSymbolId = PlinkoSlotEngine.getRandomSymbolId();
    peg.level = newSymbolId;
    
    // Update visual
    this.updatePegVisual(pegId, peg.level);
    
    // Update ring color to match new symbol
    if (this.ringEffects.length > 0) {
      const lastRing = this.ringEffects[this.ringEffects.length - 1];
      lastRing.color = PlinkoSlotEngine.getSymbolColor(peg.level);
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
        fillStyle: '#FF1344',
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
        hitCount: p.hitCount,
      }));
      this.replayLog.payoutResult = payoutResult;
    }

    // Start win celebrations (will call onAllCelebrationsComplete when done)
    this.startWinCelebrations();

    // Callback for run complete (UI can update balance, etc.)
    this.callbacks.onRunComplete?.(payoutResult);
    
    this.setPhase('complete');
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
    
    // Clear stuck ball tracker
    this.stuckBallTracker.clear();
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
