// Pure bar geometry for the spend comparison bars; returns fractions in [0, 1] the SVG scales.

export interface ComparePair {
  estimateFraction: number;
  billedFraction: number;
}

/** Two comparable amounts scaled to the larger of the pair, so an estimate and its invoice read against the same axis. Both zero when neither has spend. */
export function comparePair(estimate: number, billed: number): ComparePair {
  const max = Math.max(estimate, billed, 0);

  if (max <= 0) {
    return { estimateFraction: 0, billedFraction: 0 };
  }

  return { estimateFraction: estimate / max, billedFraction: billed / max };
}
