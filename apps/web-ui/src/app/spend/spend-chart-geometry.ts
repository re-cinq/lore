// Pure bar geometry for the spend charts; returns fractions in [0, 1] the SVG scales.

/** Height of each value as a fraction of the largest. Empty, all-zero, and negative inputs floor at zero rather than divide by zero or return a negative height. */
export function barHeightFractions(values: number[]): number[] {
  const max = Math.max(0, ...values);

  if (max <= 0) {
    return values.map(() => 0);
  }

  return values.map((v) => (v > 0 ? v / max : 0));
}

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
