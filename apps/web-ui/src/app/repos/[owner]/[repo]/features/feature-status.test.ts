import { describe, it, expect } from 'vitest';
import { statusBadge, isPlanningActive } from './feature-status';

describe('statusBadge', () => {
  it('maps pr-open to a labelled violet pill', () => {
    expect(statusBadge('pr-open')).toEqual({ label: 'PR open', color: '#8b5cf6' });
  });

  it('maps implemented to a green pill', () => {
    expect(statusBadge('implemented').color).toBe('#16a34a');
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
