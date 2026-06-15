import { describe, it, expect } from 'vitest';
import { formatCost, shortAgentId, truncate, displayCreatedBy } from './task-presenter';

describe('formatCost', () => {
  it('returns $0.0000 for zero', () => {
    expect(formatCost(0)).toBe('$0.0000');
  });

  it('formats a multi-cent value to four decimals', () => {
    expect(formatCost(5.1897)).toBe('$5.1897');
  });

  it('rounds a long fraction to four decimals', () => {
    expect(formatCost(0.123456)).toBe('$0.1235');
  });

  it('rounds a sub-thousandth value up to $0.0001', () => {
    expect(formatCost(0.00005)).toBe('$0.0001');
  });

  it('returns $0.0000 for null', () => {
    expect(formatCost(null)).toBe('$0.0000');
  });

  it('returns $0.0000 for undefined', () => {
    expect(formatCost(undefined)).toBe('$0.0000');
  });

  it('returns $0.0000 for NaN', () => {
    expect(formatCost(NaN)).toBe('$0.0000');
  });
});

describe('shortAgentId', () => {
  it('returns an em dash for null', () => {
    expect(shortAgentId(null)).toBe('—');
  });

  it('returns an em dash for an empty string', () => {
    expect(shortAgentId('')).toBe('—');
  });

  it('truncates a long id to twelve chars with an ellipsis', () => {
    expect(shortAgentId('lore-agent-b7777726-67ee-40a4')).toBe('lore-agent-b…');
  });

  it('returns a short id unchanged without an ellipsis', () => {
    expect(shortAgentId('lore-agent')).toBe('lore-agent');
  });

  it('returns an id of exactly the limit length unchanged', () => {
    expect(shortAgentId('abcdefghijkl')).toBe('abcdefghijkl');
  });

  it('honors a custom length', () => {
    expect(shortAgentId('lore-agent-x', 4)).toBe('lore…');
  });
});

describe('truncate', () => {
  it('returns an em dash for null', () => {
    expect(truncate(null, 50)).toBe('—');
  });

  it('returns an em dash for an empty string', () => {
    expect(truncate('', 50)).toBe('—');
  });

  it('returns text shorter than the limit unchanged', () => {
    expect(truncate('Fix the bug', 50)).toBe('Fix the bug');
  });

  it('returns text equal to the limit unchanged', () => {
    expect(truncate('abcde', 5)).toBe('abcde');
  });

  it('truncates text longer than the limit with an ellipsis', () => {
    expect(truncate('Fix review feedback on PR', 10)).toBe('Fix review…');
  });
});

describe('displayCreatedBy', () => {
  it('returns unknown for null', () => {
    expect(displayCreatedBy(null)).toBe('unknown');
  });

  it('returns unknown for an empty string', () => {
    expect(displayCreatedBy('')).toBe('unknown');
  });

  it('returns the creator value unchanged', () => {
    expect(displayCreatedBy('review-loop')).toBe('review-loop');
  });
});
