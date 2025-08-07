export default class AudioManager {
  private audioContext: AudioContext | null = null;
  private masterGainNode: GainNode | null = null;
  private isInitialized: boolean = false;
  private isMuted: boolean = false;
  
  // Sound effect parameters
  private readonly BASE_FREQUENCY = 220; // A3 note
  private readonly MAX_FREQUENCY = 1760; // A6 note (4 octaves higher)
  private readonly MULTIPLIER_TONE_DURATION = 0.15; // 150ms
  private readonly MASTER_VOLUME = 0.3; // Global volume control
  
  // Progressive intensity settings
  private readonly INTENSITY_BREAKPOINTS = [
    { multiplier: 0.0, frequency: 220, volume: 0.1, filterFreq: 800 },
    { multiplier: 0.5, frequency: 330, volume: 0.15, filterFreq: 1200 },
    { multiplier: 1.0, frequency: 440, volume: 0.2, filterFreq: 1600 },
    { multiplier: 2.0, frequency: 550, volume: 0.25, filterFreq: 2000 },
    { multiplier: 5.0, frequency: 660, volume: 0.3, filterFreq: 2500 },
    { multiplier: 10.0, frequency: 880, volume: 0.35, filterFreq: 3200 },
    { multiplier: 20.0, frequency: 1100, volume: 0.4, filterFreq: 4000 },
    { multiplier: 50.0, frequency: 1320, volume: 0.45, filterFreq: 5000 },
    { multiplier: 100.0, frequency: 1760, volume: 0.5, filterFreq: 6400 }
  ];

  constructor() {
    this.initializeAudio();
  }

  private async initializeAudio() {
    try {
      // Create audio context
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      
      // Create master gain node for volume control
      this.masterGainNode = this.audioContext.createGain();
      this.masterGainNode.connect(this.audioContext.destination);
      this.masterGainNode.gain.setValueAtTime(this.MASTER_VOLUME, this.audioContext.currentTime);
      
      this.isInitialized = true;
      console.log('AudioManager initialized successfully');
    } catch (error) {
      console.warn('Failed to initialize AudioManager:', error);
      this.isInitialized = false;
    }
  }

  // Call this on first user interaction to unlock audio context
  public async unlockAudio() {
    if (!this.audioContext || this.audioContext.state === 'running') return;
    
    try {
      await this.audioContext.resume();
      console.log('Audio context unlocked');
    } catch (error) {
      console.warn('Failed to unlock audio context:', error);
    }
  }

  public setMuted(muted: boolean) {
    this.isMuted = muted;
    if (this.masterGainNode) {
      this.masterGainNode.gain.setValueAtTime(
        muted ? 0 : this.MASTER_VOLUME, 
        this.audioContext?.currentTime || 0
      );
    }
  }

  public toggleMute() {
    this.setMuted(!this.isMuted);
  }

  // Get sound parameters based on current multiplier
  private getSoundParameters(multiplier: number) {
    // Find the appropriate breakpoint range
    let lowerBreakpoint = this.INTENSITY_BREAKPOINTS[0];
    let upperBreakpoint = this.INTENSITY_BREAKPOINTS[this.INTENSITY_BREAKPOINTS.length - 1];
    
    for (let i = 0; i < this.INTENSITY_BREAKPOINTS.length - 1; i++) {
      if (multiplier >= this.INTENSITY_BREAKPOINTS[i].multiplier && 
          multiplier < this.INTENSITY_BREAKPOINTS[i + 1].multiplier) {
        lowerBreakpoint = this.INTENSITY_BREAKPOINTS[i];
        upperBreakpoint = this.INTENSITY_BREAKPOINTS[i + 1];
        break;
      }
    }
    
    // Interpolate between breakpoints
    const range = upperBreakpoint.multiplier - lowerBreakpoint.multiplier;
    const progress = range > 0 ? (multiplier - lowerBreakpoint.multiplier) / range : 0;
    
    return {
      frequency: lowerBreakpoint.frequency + (upperBreakpoint.frequency - lowerBreakpoint.frequency) * progress,
      volume: lowerBreakpoint.volume + (upperBreakpoint.volume - lowerBreakpoint.volume) * progress,
      filterFreq: lowerBreakpoint.filterFreq + (upperBreakpoint.filterFreq - lowerBreakpoint.filterFreq) * progress
    };
  }

  // Play a tone when multiplier increases
  public playMultiplierTone(multiplier: number) {
    if (!this.isInitialized || !this.audioContext || !this.masterGainNode || this.isMuted) {
      return;
    }

    try {
      const params = this.getSoundParameters(multiplier);
      const currentTime = this.audioContext.currentTime;
      
      // Create oscillator for the main tone
      const oscillator = this.audioContext.createOscillator();
      const gainNode = this.audioContext.createGain();
      const filter = this.audioContext.createBiquadFilter();
      
      // Configure filter for brightness
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(params.filterFreq, currentTime);
      filter.Q.setValueAtTime(1, currentTime);
      
      // Configure oscillator
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(params.frequency, currentTime);
      
      // Add slight frequency modulation for richness
      const lfo = this.audioContext.createOscillator();
      const lfoGain = this.audioContext.createGain();
      lfo.type = 'sine';
      lfo.frequency.setValueAtTime(5, currentTime); // 5Hz vibrato
      lfoGain.gain.setValueAtTime(params.frequency * 0.01, currentTime); // 1% vibrato depth
      lfo.connect(lfoGain);
      lfoGain.connect(oscillator.frequency);
      
      // Configure envelope
      gainNode.gain.setValueAtTime(0, currentTime);
      gainNode.gain.linearRampToValueAtTime(params.volume, currentTime + 0.01); // Quick attack
      gainNode.gain.exponentialRampToValueAtTime(0.001, currentTime + this.MULTIPLIER_TONE_DURATION); // Smooth decay
      
      // Connect audio graph
      oscillator.connect(filter);
      filter.connect(gainNode);
      if (this.masterGainNode) {
        gainNode.connect(this.masterGainNode);
      }
      
      // Start and stop
      oscillator.start(currentTime);
      lfo.start(currentTime);
      oscillator.stop(currentTime + this.MULTIPLIER_TONE_DURATION);
      lfo.stop(currentTime + this.MULTIPLIER_TONE_DURATION);
      
    } catch (error) {
      console.warn('Failed to play multiplier tone:', error);
    }
  }

  // Play cash out success sound
  public playCashOutSound(finalMultiplier: number) {
    if (!this.isInitialized || !this.audioContext || !this.masterGainNode || this.isMuted) {
      return;
    }

    try {
      const currentTime = this.audioContext.currentTime;
      
      // Determine tier based on multiplier for dramatically different sounds
      let tier: 'small' | 'medium' | 'big' | 'massive' | 'legendary';
      if (finalMultiplier < 1.0) {
        tier = 'small';
      } else if (finalMultiplier < 2.0) {
        tier = 'medium';
      } else if (finalMultiplier < 4.0) {
        tier = 'big';
      } else if (finalMultiplier < 8.0) {
        tier = 'massive';
      } else {
        tier = 'legendary';
      }

      // Tier-specific configuration
      const tierConfig = {
        small: { noteCount: 2, duration: 0.25, baseVolume: 0.12, hasFinale: false },
        medium: { noteCount: 3, duration: 0.35, baseVolume: 0.16, hasFinale: true },
        big: { noteCount: 4, duration: 0.45, baseVolume: 0.20, hasFinale: true },
        massive: { noteCount: 6, duration: 0.6, baseVolume: 0.24, hasFinale: true },
        legendary: { noteCount: 8, duration: 0.8, baseVolume: 0.28, hasFinale: true }
      };

      const config = tierConfig[tier];
      const totalDuration = config.duration;
      const noteInterval = totalDuration / config.noteCount;
      
      // Lower, warmer frequencies that are less annoying
      const baseFreq = 440; // A4 - warm, pleasant middle register
      const frequencies = [440, 550, 660, 880]; // Warm, musical frequencies
      
      // Create powerful staccato notes
      for (let i = 0; i < config.noteCount; i++) {
        const noteDelay = i * noteInterval;
        const noteDuration = 0.1; // Slightly longer for more punch
        
        // Create dual-layer sound for power
        const mainOsc = this.audioContext.createOscillator();
        const subOsc = this.audioContext.createOscillator(); // Add sub-frequency for punch
        const mainGain = this.audioContext.createGain();
        const subGain = this.audioContext.createGain();
        const filter = this.audioContext.createBiquadFilter();
        
        // Band-pass filter for punch and clarity
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(1200, currentTime + noteDelay);
        filter.Q.setValueAtTime(3, currentTime + noteDelay);
        
        // Main oscillator - warm triangle wave
        mainOsc.type = 'triangle';
        const mainFreq = frequencies[i % frequencies.length];
        mainOsc.frequency.setValueAtTime(mainFreq, currentTime + noteDelay);
        
        // Sub oscillator - adds warm low-end
        subOsc.type = 'sine';
        subOsc.frequency.setValueAtTime(mainFreq / 2, currentTime + noteDelay); // Octave down
        
        // Tier-based volume with progressive intensity
        const baseVolume = config.baseVolume;
        const volumeBoost = (i / config.noteCount) * 0.06; // Notes get louder as they progress
        const volume = baseVolume + volumeBoost;
        const subVolume = volume * (tier === 'legendary' ? 0.6 : 0.4); // More sub for legendary wins
        
        // Sharp attack, controlled decay for punch
        mainGain.gain.setValueAtTime(0, currentTime + noteDelay);
        mainGain.gain.linearRampToValueAtTime(volume, currentTime + noteDelay + 0.01); // Quick attack
        mainGain.gain.exponentialRampToValueAtTime(0.001, currentTime + noteDelay + noteDuration);
        
        subGain.gain.setValueAtTime(0, currentTime + noteDelay);
        subGain.gain.linearRampToValueAtTime(subVolume, currentTime + noteDelay + 0.01);
        subGain.gain.exponentialRampToValueAtTime(0.001, currentTime + noteDelay + noteDuration);
        
        // Connect audio graph
        mainOsc.connect(filter);
        subOsc.connect(mainGain); // Sub bypasses filter for more punch
        filter.connect(mainGain);
        
        if (this.masterGainNode) {
          mainGain.connect(this.masterGainNode);
          subGain.connect(this.masterGainNode);
        }
        
        // Start and stop
        mainOsc.start(currentTime + noteDelay);
        subOsc.start(currentTime + noteDelay);
        mainOsc.stop(currentTime + noteDelay + noteDuration);
        subOsc.stop(currentTime + noteDelay + noteDuration);
      }
      
      // Add tier-specific finale
      if (config.hasFinale) {
        const finalDelay = totalDuration + 0.02;
        
        if (tier === 'medium') {
          // Simple powerful final note for medium wins
          this.createSimpleFinale(currentTime + finalDelay, 0.18);
        } else if (tier === 'big') {
          // Stronger finale with harmony for big wins
          this.createHarmonyFinale(currentTime + finalDelay, 0.22);
        } else if (tier === 'massive') {
          // Epic finale with multiple layers for massive wins
          this.createEpicFinale(currentTime + finalDelay, 0.26);
        } else if (tier === 'legendary') {
          // Absolutely legendary finale with full orchestra-like sound
          this.createLegendaryFinale(currentTime + finalDelay, 0.30);
        }
      }
      
    } catch (error) {
      console.warn('Failed to play cash out sound:', error);
    }
  }

  // Play subtle death/turn end sound
  public playDeathSound() {
    if (!this.isInitialized || !this.audioContext || !this.masterGainNode || this.isMuted) {
      return;
    }

    try {
      const currentTime = this.audioContext.currentTime;
      
      // Create a gentle descending tone to indicate turn end
      const oscillator = this.audioContext.createOscillator();
      const gainNode = this.audioContext.createGain();
      const filter = this.audioContext.createBiquadFilter();
      
      // Configure filter for a soft, muffled sound
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(800, currentTime);
      filter.frequency.exponentialRampToValueAtTime(200, currentTime + 0.8);
      filter.Q.setValueAtTime(1, currentTime);
      
      // Create a gentle descending tone
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(330, currentTime); // Start at E4
      oscillator.frequency.exponentialRampToValueAtTime(165, currentTime + 0.8); // Descend to E3 (one octave down)
      
      // Very gentle envelope - soft and unobtrusive
      gainNode.gain.setValueAtTime(0, currentTime);
      gainNode.gain.linearRampToValueAtTime(0.08, currentTime + 0.1); // Very quiet
      gainNode.gain.exponentialRampToValueAtTime(0.001, currentTime + 0.8); // Long, gentle fade
      
      // Connect audio graph
      oscillator.connect(filter);
      filter.connect(gainNode);
      if (this.masterGainNode) {
        gainNode.connect(this.masterGainNode);
      }
      
      // Play the sound
      oscillator.start(currentTime);
      oscillator.stop(currentTime + 0.8);
      
    } catch (error) {
      console.warn('Failed to play death sound:', error);
    }
  }

  // Play ball drop sound
  public playBallDropSound() {
    if (!this.isInitialized || !this.audioContext || !this.masterGainNode || this.isMuted) {
      return;
    }

    try {
      const currentTime = this.audioContext.currentTime;
      
      // Simple click/pop sound for ball drop
      const oscillator = this.audioContext.createOscillator();
      const gainNode = this.audioContext.createGain();
      
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(800, currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(200, currentTime + 0.05);
      
      gainNode.gain.setValueAtTime(0.1, currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.001, currentTime + 0.05);
      
      oscillator.connect(gainNode);
      if (this.masterGainNode) {
        gainNode.connect(this.masterGainNode);
      }
      
      oscillator.start(currentTime);
      oscillator.stop(currentTime + 0.05);
      
    } catch (error) {
      console.warn('Failed to play ball drop sound:', error);
    }
  }

  // Helper methods for tier-specific finales
  private createSimpleFinale(startTime: number, volume: number) {
    if (!this.audioContext || !this.masterGainNode) return;
    
    const osc = this.audioContext.createOscillator();
    const gain = this.audioContext.createGain();
    
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(660, startTime); // E5 - much lower and warmer
    
    gain.gain.setValueAtTime(0, startTime);
    gain.gain.linearRampToValueAtTime(volume, startTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.3);
    
    osc.connect(gain);
    if (this.masterGainNode) {
      gain.connect(this.masterGainNode);
    }
    
    osc.start(startTime);
    osc.stop(startTime + 0.3);
  }

  private createHarmonyFinale(startTime: number, volume: number) {
    if (!this.audioContext || !this.masterGainNode) return;
    
    // Create a harmony chord (E major) - much lower and warmer
    const frequencies = [660, 825, 990]; // E5, G#5, B5
    
    frequencies.forEach((freq, index) => {
      const osc = this.audioContext!.createOscillator();
      const gain = this.audioContext!.createGain();
      
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, startTime);
      
      const noteVolume = volume * (1 - index * 0.15); // Lower volume for higher notes
      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(noteVolume, startTime + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.4);
      
      osc.connect(gain);
      if (this.masterGainNode) {
        gain.connect(this.masterGainNode);
      }
      
      osc.start(startTime);
      osc.stop(startTime + 0.4);
    });
  }

  private createEpicFinale(startTime: number, volume: number) {
    if (!this.audioContext || !this.masterGainNode) return;
    
    // Create massive chord with multiple layers - lower and warmer
    const mainChord = [660, 825, 990, 1320]; // E5, G#5, B5, E6
    const subChord = [330, 412.5, 495]; // E4, G#4, B4 (octave down)
    
    // Main chord
    mainChord.forEach((freq, index) => {
      const osc = this.audioContext!.createOscillator();
      const gain = this.audioContext!.createGain();
      
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, startTime);
      
      const noteVolume = volume * (1 - index * 0.1);
      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(noteVolume, startTime + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.5);
      
      osc.connect(gain);
      if (this.masterGainNode) {
        gain.connect(this.masterGainNode);
      }
      
      osc.start(startTime);
      osc.stop(startTime + 0.5);
    });
    
    // Sub chord for warmth
    subChord.forEach((freq, index) => {
      const osc = this.audioContext!.createOscillator();
      const gain = this.audioContext!.createGain();
      
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, startTime);
      
      const noteVolume = volume * 0.4 * (1 - index * 0.1);
      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(noteVolume, startTime + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.5);
      
      osc.connect(gain);
      if (this.masterGainNode) {
        gain.connect(this.masterGainNode);
      }
      
      osc.start(startTime);
      osc.stop(startTime + 0.5);
    });
  }

  private createLegendaryFinale(startTime: number, volume: number) {
    if (!this.audioContext || !this.masterGainNode) return;
    
    // Create absolutely massive orchestral-style finale - lower and warmer
    const mainChord = [660, 825, 990, 1320, 1650]; // Extended E major, much lower
    const harmonyChord = [330, 412.5, 495, 660]; // Lower harmony  
    const bassLine = [165, 206.25]; // Very low bass
    
    // Main warm chord
    mainChord.forEach((freq, index) => {
      const osc = this.audioContext!.createOscillator();
      const gain = this.audioContext!.createGain();
      const filter = this.audioContext!.createBiquadFilter();
      
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(2000, startTime); // Lower filter frequency for warmth
      filter.Q.setValueAtTime(1.5, startTime);
      
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, startTime);
      
      const noteVolume = volume * (1 - index * 0.08);
      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(noteVolume, startTime + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.8);
      
      osc.connect(filter);
      filter.connect(gain);
      if (this.masterGainNode) {
        gain.connect(this.masterGainNode);
      }
      
      osc.start(startTime);
      osc.stop(startTime + 0.8);
    });
    
    // Harmony layer
    harmonyChord.forEach((freq, index) => {
      const osc = this.audioContext!.createOscillator();
      const gain = this.audioContext!.createGain();
      
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, startTime + 0.1); // Slightly delayed
      
      const noteVolume = volume * 0.5 * (1 - index * 0.1);
      gain.gain.setValueAtTime(0, startTime + 0.1);
      gain.gain.linearRampToValueAtTime(noteVolume, startTime + 0.15);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.8);
      
      osc.connect(gain);
      if (this.masterGainNode) {
        gain.connect(this.masterGainNode);
      }
      
      osc.start(startTime + 0.1);
      osc.stop(startTime + 0.8);
    });
    
    // Deep bass for ultimate power
    bassLine.forEach((freq, index) => {
      const osc = this.audioContext!.createOscillator();
      const gain = this.audioContext!.createGain();
      
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, startTime);
      
      const noteVolume = volume * 0.6 * (1 - index * 0.2);
      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(noteVolume, startTime + 0.08);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 1.0);
      
      osc.connect(gain);
      if (this.masterGainNode) {
        gain.connect(this.masterGainNode);
      }
      
      osc.start(startTime);
      osc.stop(startTime + 1.0);
    });
  }

  public destroy() {
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    this.masterGainNode = null;
    this.isInitialized = false;
  }
} 