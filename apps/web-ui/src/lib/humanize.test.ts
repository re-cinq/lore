import { describe, it, expect } from 'vitest';
import { humanizeEnum } from './humanize';

describe('humanizeEnum', () => {
  it('sentence-cases a snake_case value', () => {
    expect(humanizeEnum('pull_request')).toBe('Pull request');
  });

  it('sentence-cases a kebab-case value', () => {
    expect(humanizeEnum('feature-request')).toBe('Feature request');
  });

  it('uppercases a known acronym in full', () => {
    expect(humanizeEnum('adr')).toBe('ADR');
  });

  it('uppercases an acronym word within a multi-word value', () => {
    expect(humanizeEnum('pr-review')).toBe('PR review');
  });

  it('leaves a single lowercase word sentence-cased', () => {
    expect(humanizeEnum('spec')).toBe('Spec');
  });

  it('falls back to sentence case for an unknown enum', () => {
    expect(humanizeEnum('brand-new-thing')).toBe('Brand new thing');
  });

  it('returns an empty string unchanged', () => {
    expect(humanizeEnum('')).toBe('');
  });
});
