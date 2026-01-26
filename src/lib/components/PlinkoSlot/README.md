# Plinko Slot

A deterministic, provably fair Plinko game with slot-like payouts based on a unique "peg leveling" mechanic.

## Overview

Plinko Slot combines the excitement of Plinko with slot-machine style payouts. Instead of traditional bin-based payouts, the game uses a **peg leveling system** where:

- 10 balls are dropped sequentially per round
- Each peg tracks which balls have hit it (bitmask)
- Pegs "level up" in color with each unique ball hit (max level 10)
- Final payout is calculated from the distribution of peg levels

## Game Rules

### Peg Leveling Mechanic

1. **Board**: 12-row classic Plinko triangle (configurable)
2. **Balls**: 10 balls per round, dropped one at a time
3. **Unique Ball Rule**: Each peg tracks which balls have hit it:
   - Ball #3 hitting a peg twice = only counts once
   - Ball #3 and Ball #5 both hitting same peg = level up twice
   - Maximum peg level = 10 (hit by all 10 balls)

### Peg Color Levels

| Level | Color | Hex |
|-------|-------|-----|
| 0 | Dark (unhit) | `#111827` |
| 1 | Slate Gray | `#6B7280` |
| 2 | Steel Blue | `#4B6CB7` |
| 3 | Teal | `#2FA4A9` |
| 4 | Emerald Green | `#1FAA59` |
| 5 | Lime/Neon Green | `#A3E635` |
| 6 | Gold | `#FACC15` |
| 7 | Amber/Orange | `#FB923C` |
| 8 | Crimson Red | `#DC2626` |
| 9 | Royal Purple | `#7C3AED` |
| 10 | Iridescent White | `#F9FAFB` |

Pegs at level 6+ have a soft glow effect; level 10 has a strong glow.

## Payout System

### Count-Based Payouts

Payouts are determined by counting how many pegs reach certain level thresholds:

| Tier | Threshold | Count Required | Multiplier |
|------|-----------|----------------|------------|
| Touched | Level ≥ 1 | 20 pegs | 1.2x |
| Warm | Level ≥ 2 | 15 pegs | 1.5x |
| Hot | Level ≥ 3 | 12 pegs | 2.0x |
| Blazing | Level ≥ 4 | 8 pegs | 3.0x |
| Inferno | Level ≥ 5 | 6 pegs | 5.0x |
| Golden | Level ≥ 6 | 4 pegs | 10.0x |
| Amber | Level ≥ 7 | 3 pegs | 15.0x |
| Crimson | Level ≥ 8 | 3 pegs | 20.0x |
| Royal | Level ≥ 9 | 2 pegs | 50.0x |
| Prismatic | Level = 10 | 1 peg | 100.0x |

The highest achieved tier determines the count multiplier.

### Pattern-Based Bonuses

Additional bonuses for special peg patterns:

| Pattern | Description | Requirement | Bonus |
|---------|-------------|-------------|-------|
| Diagonal Blaze | 3 diagonal pegs | Level ≥ 7 | +5.0x |
| Hot Column | 4 pegs in same column | Level ≥ 6 | +8.0x |
| Crown | V-shape of 5 pegs | Level ≥ 8 | +25.0x |
| Full Row | All pegs in any row | Level ≥ 5 | +15.0x |
| Top Triangle | First 3 rows (12 pegs) | Level ≥ 6 | +20.0x |
| Perfect Run | All pegs hit at least once | Level ≥ 1 | +3.0x |

### Payout Calculation

The default mode is **additive**:
```
Total Multiplier = Count Multiplier + Sum of Pattern Bonuses
```

This can be changed to **max** mode in the paytable config.

## RTP Control

### Paytable Configuration

All payout values are configurable in `paytable.json`:

```json
{
  "countPayouts": {
    "tiers": [
      { "levelThreshold": 3, "countRequired": 12, "multiplier": 2.0 },
      // Adjust these values to tune RTP
    ]
  },
  "targetRTP": {
    "target": 96.5,
    "tolerance": 1.0
  }
}
```

### Monte Carlo RTP Simulation

Run the RTP simulator to validate paytable changes:

```bash
# Install ts-node if needed
npm install -g ts-node

# Run simulation (100k runs default)
npx ts-node scripts/monte-carlo-rtp.ts

# Run with more iterations
npx ts-node scripts/monte-carlo-rtp.ts 500000

# Verbose mode
npx ts-node scripts/monte-carlo-rtp.ts 200000 --verbose
```

Example output:
```
📊 Overall Statistics:
  Total Runs: 100,000
  Average Multiplier: 0.9650x
  Estimated RTP: 96.50%
  Target RTP: 96.5%
  Difference: +0.00% ✅ (within tolerance)

🎯 Tier Hit Rates:
  Touched     (1.2x):  45.32% ████████████████████
  Hot         (2.0x):  12.15% ██████
  ...
```

### Tuning Guidelines

To **increase RTP**:
- Lower `countRequired` values
- Increase `multiplier` values
- Make patterns easier to achieve

To **decrease RTP**:
- Raise `countRequired` values
- Decrease `multiplier` values
- Make patterns harder to achieve

## Provably Fair

### How It Works

1. **Before Play**: Server provides `serverSeedHash` (SHA-256 commitment)
2. **Client Input**: Player sets `clientSeed` and game increments `nonce`
3. **Seed Combination**: `combinedSeed = hash(serverSeed + clientSeed + nonce)`
4. **After Play**: Server reveals `serverSeed` for verification

### Verification Steps

1. Copy the `serverSeedHash` shown before you play
2. After playing, click "Rotate Server Seed" to reveal the actual seed
3. Click "Verify Server Seed" to confirm the hash matches
4. Optionally, manually verify: `hash(revealedServerSeed) === serverSeedHash`

### What's Deterministic

Given the same combined seed:
- Ball spawn positions (jitter)
- Physics simulation (fixed timestep)
- All collision outcomes
- Final peg states
- Payout calculation

## Technical Details

### Physics Engine

- Uses Matter.js with fixed timestep (60 Hz)
- `isFixed: true` ensures deterministic simulation
- Ball-peg collisions tracked via collision events
- Restitution and friction tuned for natural feel

### Key Files

```
src/lib/components/PlinkoSlot/
├── PlinkoSlot.svelte      # Main UI component
├── PlinkoSlotEngine.ts    # Physics + game logic
├── PayoutEvaluator.ts     # Payout calculation
├── types.ts               # TypeScript interfaces
├── stores.ts              # Svelte stores
├── paytable.json          # Payout configuration
├── ResultsPanel.svelte    # Results display
├── BallProgress.svelte    # Ball tracker
├── ProvablyFairPanel.svelte # Seed management
└── RunHistory.svelte      # Game history

src/lib/utils/
├── rng.ts                 # Seeded RNG implementations
└── provablyFair.ts        # Hash and verification utilities

scripts/
└── monte-carlo-rtp.ts     # RTP simulation script
```

### Data Structures

```typescript
// Peg state
interface Peg {
  id: string;       // "row-col"
  row: number;
  col: number;
  level: number;    // 0-10
  hitMask: number;  // Bitmask of balls 1-10
  x: number;
  y: number;
}

// On collision
if ((peg.hitMask & (1 << (ballId - 1))) === 0) {
  peg.level = Math.min(10, peg.level + 1);
  peg.hitMask |= (1 << (ballId - 1));
}
```

## Development

### Running Locally

```bash
# Install dependencies
pnpm install

# Start dev server
pnpm dev

# Navigate to
http://localhost:5173/slot
```

### Building

```bash
pnpm build
pnpm preview
```

### Testing

The game is deterministic - given the same seed, results are reproducible. Use the replay log feature to verify outcomes.

## Customization

### Changing Ball Count

In `paytable.json`:
```json
{
  "board": {
    "ballCount": 10  // Change to desired number
  }
}
```

Note: Changing ball count affects hit probabilities and requires retuning the paytable.

### Changing Row Count

```json
{
  "board": {
    "rows": 12  // 8-16 supported
  }
}
```

More rows = more pegs = different level distribution.

### Disabling Patterns

```json
{
  "patternPayouts": {
    "enabled": false
  }
}
```

## License

Part of the Plinko Game project. See root LICENSE file.
