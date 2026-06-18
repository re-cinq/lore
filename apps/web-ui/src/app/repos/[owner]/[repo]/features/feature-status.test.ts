import { describe, it, expect } from 'vitest';
import { statusBadge, isPlanningActive, featureStatusColor } from './feature-status';

describe('statusBadge', () => {
  it('maps pr-open to a labelled violet pill', () => {
    expect(statusBadge('pr-open')).toEqual({ label: 'PR open', color: '#8b5cf6' });
  });

  it('maps implemented to a green pill', () => {
    expect(statusBadge('implemented').color).toBe('#16a34a');
  });
});

describe('featureStatusColor', () => {
  it('returns the palette color for a known lifecycle status', () => {
    expect(featureStatusColor('pr-open')).toBe('#8b5cf6');
  });

  it('returns undefined for an unknown status so callers fall back', () => {
    expect(featureStatusColor('nonsense')).toBeUndefined();
  });
});

describe('isPlanningActive', () => {
  it('returns true while drafting and planning', () => {
    expect(isPlanningActive('draft')).toBe(true);
    expect(isPlanningActive('planning')).toBe(true);
    expect(isPlanningActive('awaiting-input')).toBe(true);
    expect(isPlanningActive('spec-ready')).toBe(true);
  });

  it('returns false once a PR exists or the feature shipped', () => {
    expect(isPlanningActive('pr-open')).toBe(false);
    expect(isPlanningActive('implemented')).toBe(false);
  });
});
