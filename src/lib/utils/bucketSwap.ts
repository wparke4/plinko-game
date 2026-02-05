export function buildIdentityBucketOrder(bucketCount: number): number[] {
  return Array.from({ length: bucketCount }, (_, index) => index);
}

function getCenterOutPositions(bucketCount: number): number[] {
  const positions: number[] = [];
  if (bucketCount <= 0) {
    return positions;
  }

  const centerLeft = Math.floor((bucketCount - 1) / 2);
  const centerRight = bucketCount % 2 === 0 ? centerLeft + 1 : centerLeft;

  positions.push(centerLeft);
  if (centerRight !== centerLeft) {
    positions.push(centerRight);
  }

  let offset = 1;
  while (positions.length < bucketCount) {
    const leftIndex = centerLeft - offset;
    const rightIndex = centerRight + offset;

    if (leftIndex >= 0) {
      positions.push(leftIndex);
    }
    if (rightIndex < bucketCount) {
      positions.push(rightIndex);
    }

    offset += 1;
  }

  return positions;
}

export function computeBucketOrder(multipliers: number[], temperature = 0.35): number[] {
  if (multipliers.length === 0) {
    return [];
  }

  const minValue = Math.min(...multipliers);
  const maxValue = Math.max(...multipliers);
  const range = maxValue - minValue;
  const noiseScale = Math.max(0, temperature);

  const scoredBuckets = multipliers.map((multiplier, bucketIndex) => {
    const normalized = range === 0 ? 0.5 : (multiplier - minValue) / range;
    const noise = (Math.random() - 0.5) * noiseScale;
    return {
      bucketIndex,
      score: normalized + noise,
    };
  });

  scoredBuckets.sort((a, b) => a.score - b.score);

  const targetPositions = getCenterOutPositions(multipliers.length);
  const nextOrder = new Array(multipliers.length);

  scoredBuckets.forEach(({ bucketIndex }, index) => {
    nextOrder[targetPositions[index]] = bucketIndex;
  });

  return nextOrder;
}
