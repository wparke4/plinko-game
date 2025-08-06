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
      
      // Play a triumphant chord progression
      const chordFrequencies = [
        finalMultiplier < 5 ? [440, 554, 659] : // C major for low multipliers
        finalMultiplier < 20 ? [440, 554, 698] : // C major 7 for medium multipliers  
        [523, 659, 784, 988] // C major with octave for high multipliers
      ];
      
      chordFrequencies.forEach((frequencies, chordIndex) => {
        frequencies.forEach((freq, noteIndex) => {
          const oscillator = this.audioContext!.createOscillator();
          const gainNode = this.audioContext!.createGain();
          const filter = this.audioContext!.createBiquadFilter();
          
          filter.type = 'lowpass';
          filter.frequency.setValueAtTime(3000 + finalMultiplier * 50, currentTime);
          
          oscillator.type = 'sine';
          oscillator.frequency.setValueAtTime(freq, currentTime);
          
          const volume = 0.15 * (1 - noteIndex * 0.1); // Lower volume for higher notes
          gainNode.gain.setValueAtTime(0, currentTime);
          gainNode.gain.linearRampToValueAtTime(volume, currentTime + 0.05);
          gainNode.gain.exponentialRampToValueAtTime(0.001, currentTime + 1.5);
          
          oscillator.connect(filter);
          filter.connect(gainNode);
          if (this.masterGainNode) {
            gainNode.connect(this.masterGainNode);
          }
          
          oscillator.start(currentTime);
          oscillator.stop(currentTime + 1.5);
        });
      });
      
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

  public destroy() {
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    this.masterGainNode = null;
    this.isInitialized = false;
  }
} 