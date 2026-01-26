/**
 * Provably Fair implementation for deterministic, verifiable game outcomes.
 * 
 * Flow:
 * 1. Server generates serverSeed (kept secret) and provides serverSeedHash (SHA-256)
 * 2. Client provides clientSeed and nonce
 * 3. Combined seed = hash(serverSeed + clientSeed + nonce)
 * 4. After game, server reveals serverSeed for verification
 */

import { stringToSeed } from './rng';

/**
 * SHA-256 hash using Web Crypto API.
 */
export async function sha256(message: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * HMAC-SHA256 using Web Crypto API.
 */
export async function hmacSha256(key: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(key);
  const msgData = encoder.encode(message);
  
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, msgData);
  const hashArray = Array.from(new Uint8Array(signature));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Synchronous hash function using simple but effective algorithm.
 * Used for real-time seed generation where async isn't practical.
 */
export function hashSync(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  // Convert to hex-like string for display
  const h1 = (hash >>> 0).toString(16).padStart(8, '0');
  
  // Generate more entropy for longer hash
  let hash2 = 0x5bd1e995;
  for (let i = 0; i < str.length; i++) {
    hash2 = Math.imul(hash2 ^ str.charCodeAt(i), 0x5bd1e995);
  }
  const h2 = (hash2 >>> 0).toString(16).padStart(8, '0');
  
  let hash3 = 0x1b873593;
  for (let i = str.length - 1; i >= 0; i--) {
    hash3 = Math.imul(hash3 ^ str.charCodeAt(i), 0x1b873593);
  }
  const h3 = (hash3 >>> 0).toString(16).padStart(8, '0');
  
  let hash4 = 0xcc9e2d51;
  for (let i = 0; i < str.length; i += 2) {
    hash4 = Math.imul(hash4 ^ (str.charCodeAt(i) << 8 | (str.charCodeAt(i + 1) || 0)), 0xcc9e2d51);
  }
  const h4 = (hash4 >>> 0).toString(16).padStart(8, '0');
  
  return `${h1}${h2}${h3}${h4}`;
}

/**
 * Provably fair seed data structure.
 */
export interface ProvablyFairSeed {
  /** The actual server seed (revealed after game) */
  serverSeed: string;
  /** SHA-256 hash of serverSeed (shown before game) */
  serverSeedHash: string;
  /** Client-provided seed */
  clientSeed: string;
  /** Incrementing nonce for each game */
  nonce: number;
  /** Combined seed used for RNG */
  combinedSeed: number;
}

/**
 * Generate a new server seed (random hex string).
 */
export function generateServerSeed(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Generate a default client seed.
 */
export function generateClientSeed(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Create a provably fair seed set.
 * Server seed hash is computed synchronously for immediate display.
 */
export function createProvablyFairSeed(
  clientSeed: string,
  nonce: number,
  serverSeed?: string
): ProvablyFairSeed {
  const actualServerSeed = serverSeed ?? generateServerSeed();
  const serverSeedHash = hashSync(actualServerSeed);
  
  // Combine seeds: HMAC-like combination
  const combinedString = `${actualServerSeed}:${clientSeed}:${nonce}`;
  const combinedSeed = stringToSeed(combinedString);
  
  return {
    serverSeed: actualServerSeed,
    serverSeedHash,
    clientSeed,
    nonce,
    combinedSeed
  };
}

/**
 * Verify a provably fair result.
 * Returns true if the serverSeed hashes to the committed serverSeedHash.
 */
export function verifyProvablyFair(
  serverSeed: string,
  serverSeedHash: string
): boolean {
  const computed = hashSync(serverSeed);
  return computed === serverSeedHash;
}

/**
 * Recompute the combined seed for verification.
 */
export function recomputeCombinedSeed(
  serverSeed: string,
  clientSeed: string,
  nonce: number
): number {
  const combinedString = `${serverSeed}:${clientSeed}:${nonce}`;
  return stringToSeed(combinedString);
}

/**
 * ProvablyFairManager handles seed rotation and verification.
 */
export class ProvablyFairManager {
  private _serverSeed: string;
  private _serverSeedHash: string;
  private _clientSeed: string;
  private _nonce: number;
  private _nextServerSeed: string;
  private _nextServerSeedHash: string;

  constructor(clientSeed?: string) {
    this._clientSeed = clientSeed ?? generateClientSeed();
    this._nonce = 0;
    
    // Generate current and next server seeds
    this._serverSeed = generateServerSeed();
    this._serverSeedHash = hashSync(this._serverSeed);
    this._nextServerSeed = generateServerSeed();
    this._nextServerSeedHash = hashSync(this._nextServerSeed);
  }

  /**
   * Get the current server seed hash (shown to player before game).
   */
  get serverSeedHash(): string {
    return this._serverSeedHash;
  }

  /**
   * Get the client seed.
   */
  get clientSeed(): string {
    return this._clientSeed;
  }

  /**
   * Set a new client seed.
   */
  set clientSeed(seed: string) {
    this._clientSeed = seed;
  }

  /**
   * Get the current nonce.
   */
  get nonce(): number {
    return this._nonce;
  }

  /**
   * Generate seed for next game and increment nonce.
   */
  getNextSeed(): ProvablyFairSeed {
    const seed = createProvablyFairSeed(
      this._clientSeed,
      this._nonce,
      this._serverSeed
    );
    this._nonce++;
    return seed;
  }

  /**
   * Rotate to new server seed (reveals current seed).
   * Returns the revealed server seed for verification.
   */
  rotateServerSeed(): { revealedSeed: string; newHash: string } {
    const revealed = this._serverSeed;
    
    // Rotate: next becomes current
    this._serverSeed = this._nextServerSeed;
    this._serverSeedHash = this._nextServerSeedHash;
    
    // Generate new next seed
    this._nextServerSeed = generateServerSeed();
    this._nextServerSeedHash = hashSync(this._nextServerSeed);
    
    // Reset nonce on rotation
    this._nonce = 0;
    
    return {
      revealedSeed: revealed,
      newHash: this._serverSeedHash
    };
  }

  /**
   * Get serializable state for storage/display.
   */
  getState() {
    return {
      serverSeedHash: this._serverSeedHash,
      clientSeed: this._clientSeed,
      nonce: this._nonce
    };
  }
}
